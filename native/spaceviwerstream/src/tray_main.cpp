#include "senaistream/gamestream_host.hpp"

#include <windows.h>
#include <shellapi.h>

#include <chrono>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <thread>

namespace {

  constexpr UINT tray_message = WM_APP + 1;
  constexpr UINT command_open = 1001;
  constexpr UINT command_exit = 1002;
  senaistream::GameStreamHost *running_host = nullptr;

  /**
   * @brief Opens the local SenaiStream management application.
   */
  void open_dashboard() {
    std::wstring path(32768, L'\0');
    const auto size = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (size != 0 && size < path.size()) {
      path.resize(size);
      const auto ui_path = std::filesystem::path(path).parent_path() / L"SenaiStreamUI.exe";
      if (std::filesystem::exists(ui_path)) {
        ShellExecuteW(nullptr, L"open", ui_path.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        return;
      }
    }
    ShellExecuteW(nullptr, L"open", L"http://127.0.0.1:47990/", nullptr, nullptr, SW_SHOWNORMAL);
  }

  /**
   * @brief Handles messages for the hidden tray-owner window.
   *
   * @param window Window handle.
   * @param message Windows message identifier.
   * @param word Word parameter.
   * @param long_value Long parameter.
   * @return Message-processing result.
   */
  LRESULT CALLBACK tray_window_proc(HWND window, UINT message, WPARAM word, LPARAM long_value) {
    if (message == tray_message) {
      if (LOWORD(long_value) == WM_LBUTTONUP) {
        open_dashboard();
      }
      else if (LOWORD(long_value) == WM_RBUTTONUP) {
        POINT cursor {};
        GetCursorPos(&cursor);
        HMENU menu = CreatePopupMenu();
        AppendMenuW(menu, MF_STRING, command_open, L"Abrir SenaiStream");
        AppendMenuW(menu, MF_SEPARATOR, 0, nullptr);
        AppendMenuW(menu, MF_STRING, command_exit, L"Encerrar host");
        SetForegroundWindow(window);
        TrackPopupMenu(menu, TPM_RIGHTBUTTON, cursor.x, cursor.y, 0, window, nullptr);
        DestroyMenu(menu);
      }
      return 0;
    }
    if (message == WM_COMMAND) {
      if (LOWORD(word) == command_open) {
        open_dashboard();
      }
      else if (LOWORD(word) == command_exit) {
        DestroyWindow(window);
      }
      return 0;
    }
    if (message == WM_DESTROY) {
      NOTIFYICONDATAW icon {};
      icon.cbSize = sizeof(icon);
      icon.hWnd = window;
      icon.uID = 1;
      Shell_NotifyIconW(NIM_DELETE, &icon);
      if (running_host != nullptr) {
        running_host->request_stop();
      }
      PostQuitMessage(0);
      return 0;
    }
    return DefWindowProcW(window, message, word, long_value);
  }

}  // namespace

/**
 * @brief Runs the per-user SenaiStream tray and interactive capture host.
 *
 * @param instance Application instance.
 * @param previous_instance Unused previous instance.
 * @param command_line Command line excluding the executable name.
 * @param show_command Requested show state.
 * @return Process exit code.
 */
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous_instance, PWSTR command_line, int show_command) {
  static_cast<void>(previous_instance);
  static_cast<void>(show_command);
  HANDLE singleton = CreateMutexW(nullptr, TRUE, L"Local\\SenaiStreamTray");
  if (singleton == nullptr || GetLastError() == ERROR_ALREADY_EXISTS) {
    if (singleton != nullptr) {
      CloseHandle(singleton);
    }
    open_dashboard();
    return 0;
  }

  WNDCLASSW window_class {};
  window_class.lpfnWndProc = tray_window_proc;
  window_class.hInstance = instance;
  window_class.lpszClassName = L"SenaiStreamTrayWindow";
  window_class.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
  RegisterClassW(&window_class);
  HWND window = CreateWindowExW(
    0, window_class.lpszClassName, L"SenaiStream", WS_OVERLAPPED, 0, 0, 0, 0, nullptr, nullptr, instance, nullptr);
  if (window == nullptr) {
    CloseHandle(singleton);
    return 2;
  }

  NOTIFYICONDATAW icon {};
  icon.cbSize = sizeof(icon);
  icon.hWnd = window;
  icon.uID = 1;
  icon.uFlags = NIF_ICON | NIF_MESSAGE | NIF_TIP | NIF_SHOWTIP;
  icon.uCallbackMessage = tray_message;
  icon.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
  wcscpy_s(icon.szTip, L"SenaiStream — host ativo");
  Shell_NotifyIconW(NIM_ADD, &icon);

  senaistream::GameStreamHost host(senaistream::default_host_identity());
  running_host = &host;
  std::thread host_thread([&host, window]() {
    const auto status = host.run();
    if (!status.ok()) {
      const auto narrow_message = status.message();
      const std::wstring message(narrow_message.begin(), narrow_message.end());
      MessageBoxW(window, message.c_str(), L"SenaiStream não iniciou", MB_OK | MB_ICONERROR);
      PostMessageW(window, WM_CLOSE, 0, 0);
    }
  });

  if (std::wstring_view(command_line).find(L"--agent") == std::wstring_view::npos) {
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    open_dashboard();
  }
  MSG message {};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  host.request_stop();
  if (host_thread.joinable()) {
    host_thread.join();
  }
  running_host = nullptr;
  ReleaseMutex(singleton);
  CloseHandle(singleton);
  return 0;
}
