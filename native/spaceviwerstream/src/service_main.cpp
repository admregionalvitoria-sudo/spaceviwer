#include <windows.h>
#include <userenv.h>
#include <wtsapi32.h>

#include <filesystem>
#include <string>

namespace {

  SERVICE_STATUS_HANDLE service_handle = nullptr;
  SERVICE_STATUS service_status {};
  HANDLE stop_event = nullptr;

  /**
   * @brief Publishes a state transition to the Windows Service Control Manager.
   *
   * @param state SERVICE_* state value.
   * @param error Win32 exit code.
   * @param wait_hint Expected transition duration in milliseconds.
   */
  void publish_service_state(DWORD state, DWORD error = NO_ERROR, DWORD wait_hint = 0) {
    service_status.dwServiceType = SERVICE_WIN32_OWN_PROCESS;
    service_status.dwCurrentState = state;
    service_status.dwWin32ExitCode = error;
    service_status.dwWaitHint = wait_hint;
    service_status.dwControlsAccepted = state == SERVICE_RUNNING ? SERVICE_ACCEPT_STOP | SERVICE_ACCEPT_SHUTDOWN : 0;
    SetServiceStatus(service_handle, &service_status);
  }

  /**
   * @brief Handles stop and shutdown requests from the Service Control Manager.
   *
   * @param control Service control code.
   */
  void WINAPI service_control(DWORD control) {
    if ((control == SERVICE_CONTROL_STOP || control == SERVICE_CONTROL_SHUTDOWN) && stop_event != nullptr) {
      publish_service_state(SERVICE_STOP_PENDING, NO_ERROR, 5'000);
      SetEvent(stop_event);
    }
  }

  /**
   * @brief Starts the interactive tray agent in the active console session.
   *
   * @param process Receives the launched process handle.
   * @param session_id Receives the target Windows session identifier.
   * @return True when a process was started.
   */
  bool launch_interactive_agent(HANDLE &process, DWORD &session_id) {
    session_id = WTSGetActiveConsoleSessionId();
    if (session_id == 0xFFFFFFFFU) {
      return false;
    }
    HANDLE raw_user_token = nullptr;
    if (!WTSQueryUserToken(session_id, &raw_user_token)) {
      return false;
    }
    HANDLE primary_token = nullptr;
    const auto duplicated = DuplicateTokenEx(
      raw_user_token,
      TOKEN_ALL_ACCESS,
      nullptr,
      SecurityImpersonation,
      TokenPrimary,
      &primary_token);
    CloseHandle(raw_user_token);
    if (!duplicated) {
      return false;
    }

    void *environment = nullptr;
    CreateEnvironmentBlock(&environment, primary_token, FALSE);
    std::wstring module_path(32'768, L'\0');
    const auto path_length = GetModuleFileNameW(nullptr, module_path.data(), static_cast<DWORD>(module_path.size()));
    module_path.resize(path_length);
    const auto tray_path = std::filesystem::path(module_path).parent_path() / L"SenaiStreamTray.exe";
    std::wstring command = L"\"" + tray_path.wstring() + L"\" --agent";
    STARTUPINFOW startup {};
    startup.cb = sizeof(startup);
    startup.lpDesktop = const_cast<wchar_t *>(L"winsta0\\default");
    PROCESS_INFORMATION information {};
    const auto created = CreateProcessAsUserW(
      primary_token,
      tray_path.c_str(),
      command.data(),
      nullptr,
      nullptr,
      FALSE,
      CREATE_UNICODE_ENVIRONMENT,
      environment,
      tray_path.parent_path().c_str(),
      &startup,
      &information);
    if (environment != nullptr) {
      DestroyEnvironmentBlock(environment);
    }
    CloseHandle(primary_token);
    if (!created) {
      return false;
    }
    CloseHandle(information.hThread);
    process = information.hProcess;
    return true;
  }

  /**
   * @brief Runs the service supervisor and maintains one per-user tray agent.
   *
   * @param argument_count Service argument count.
   * @param arguments Service argument vector.
   */
  void WINAPI service_main(DWORD argument_count, wchar_t **arguments) {
    static_cast<void>(argument_count);
    static_cast<void>(arguments);
    service_handle = RegisterServiceCtrlHandlerW(L"SenaiStream", service_control);
    if (service_handle == nullptr) {
      return;
    }
    publish_service_state(SERVICE_START_PENDING, NO_ERROR, 5'000);
    stop_event = CreateEventW(nullptr, TRUE, FALSE, nullptr);
    if (stop_event == nullptr) {
      publish_service_state(SERVICE_STOPPED, GetLastError());
      return;
    }
    publish_service_state(SERVICE_RUNNING);
    HANDLE agent_process = nullptr;
    DWORD agent_session = 0xFFFFFFFFU;
    while (WaitForSingleObject(stop_event, 0) != WAIT_OBJECT_0) {
      const auto active_session = WTSGetActiveConsoleSessionId();
      if (agent_process == nullptr || active_session != agent_session ||
          WaitForSingleObject(agent_process, 0) == WAIT_OBJECT_0) {
        if (agent_process != nullptr) {
          CloseHandle(agent_process);
          agent_process = nullptr;
        }
        launch_interactive_agent(agent_process, agent_session);
      }
      WaitForSingleObject(stop_event, 2'000);
    }
    if (agent_process != nullptr) {
      CloseHandle(agent_process);
    }
    CloseHandle(stop_event);
    stop_event = nullptr;
    publish_service_state(SERVICE_STOPPED);
  }

}  // namespace

/**
 * @brief Connects the SenaiStream supervisor to the Service Control Manager.
 *
 * @param instance Application instance.
 * @param previous_instance Unused previous instance.
 * @param command_line Unused command line.
 * @param show_command Unused show state.
 * @return Process exit code.
 */
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous_instance, PWSTR command_line, int show_command) {
  static_cast<void>(instance);
  static_cast<void>(previous_instance);
  static_cast<void>(command_line);
  static_cast<void>(show_command);
  SERVICE_TABLE_ENTRYW table[] {{const_cast<wchar_t *>(L"SenaiStream"), service_main}, {nullptr, nullptr}};
  if (!StartServiceCtrlDispatcherW(table)) {
    return static_cast<int>(GetLastError());
  }
  return 0;
}
