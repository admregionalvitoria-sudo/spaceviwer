#include <windows.h>
#include <dwmapi.h>
#include <shellapi.h>
#include <shlobj.h>
#include <wrl.h>

#include "WebView2.h"

#include <cstring>
#include <filesystem>
#include <string>

namespace {

  using Microsoft::WRL::ComPtr;

  constexpr wchar_t window_class_name[] = L"SenaiStreamDesktopWindow";
  constexpr wchar_t window_title[] = L"SenaiStream";
  constexpr wchar_t dashboard_url[] = L"http://127.0.0.1:47990/";

  ComPtr<ICoreWebView2Controller> webview_controller;
  ComPtr<ICoreWebView2> webview;
  HMODULE webview_loader = nullptr;

  /**
   * @brief Signature exported by the native WebView2 loader.
   */
  using CreateEnvironmentFunction = HRESULT(STDAPICALLTYPE *)(
    PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *, ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);

  /**
   * @brief Returns the directory containing the running user-interface executable.
   *
   * @return Absolute executable directory, or an empty path on failure.
   */
  std::filesystem::path executable_directory() {
    std::wstring path(32768, L'\0');
    const auto size = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (size == 0 || size >= path.size()) {
      return {};
    }
    path.resize(size);
    return std::filesystem::path(path).parent_path();
  }

  /**
   * @brief Returns a writable directory for the embedded browser profile.
   *
   * @return Per-user WebView2 data directory, falling back to the executable directory.
   */
  std::filesystem::path browser_data_directory() {
    PWSTR local_app_data = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_CREATE, nullptr, &local_app_data)) &&
        local_app_data != nullptr) {
      const auto path = std::filesystem::path(local_app_data) / L"SenaiStream" / L"WebView2";
      CoTaskMemFree(local_app_data);
      return path;
    }
    return executable_directory() / L"ui-data";
  }

  /**
   * @brief Starts the background tray host when the service has not started it yet.
   */
  void ensure_host_agent() {
    HANDLE existing = OpenMutexW(SYNCHRONIZE, FALSE, L"Local\\SenaiStreamTray");
    if (existing != nullptr) {
      CloseHandle(existing);
      return;
    }
    const auto tray_path = executable_directory() / L"SenaiStreamTray.exe";
    if (std::filesystem::exists(tray_path)) {
      ShellExecuteW(nullptr, L"open", tray_path.c_str(), L"--agent", tray_path.parent_path().c_str(), SW_HIDE);
    }
  }

  /**
   * @brief Applies Windows 11 backdrop, dark-frame, and rounded-corner attributes.
   *
   * Unsupported attributes are intentionally ignored on older Windows versions.
   *
   * @param window Top-level SenaiStream window.
   */
  void apply_window_material(HWND window) {
    constexpr DWORD immersive_dark_mode_attribute = 20;
    constexpr DWORD corner_preference_attribute = 33;
    constexpr DWORD system_backdrop_attribute = 38;
    constexpr int rounded_corners = 2;
    constexpr int mica_backdrop = 2;
    const BOOL dark_mode = TRUE;
    DwmSetWindowAttribute(window, immersive_dark_mode_attribute, &dark_mode, sizeof(dark_mode));
    DwmSetWindowAttribute(window, corner_preference_attribute, &rounded_corners, sizeof(rounded_corners));
    DwmSetWindowAttribute(window, system_backdrop_attribute, &mica_backdrop, sizeof(mica_backdrop));
  }

  /**
   * @brief Resizes the embedded browser to the native client area.
   *
   * @param window Parent window containing WebView2.
   */
  void resize_webview(HWND window) {
    if (!webview_controller) {
      return;
    }
    RECT bounds {};
    GetClientRect(window, &bounds);
    webview_controller->put_Bounds(bounds);
  }

  /**
   * @brief Shows a friendly native error when the WebView2 runtime is unavailable.
   *
   * @param window Parent window for the message box.
   * @param detail Optional HRESULT identifying the failure.
   */
  void show_webview_error(HWND window, HRESULT detail) {
    std::wstring message =
      L"A interface visual do SenaiStream não pôde ser iniciada.\n\n"
      L"Repare ou instale o Microsoft Edge WebView2 Runtime e abra o SenaiStream novamente.\n\nCódigo: ";
    wchar_t code[24] {};
    swprintf_s(code, L"0x%08lX", static_cast<unsigned long>(detail));
    message += code;
    MessageBoxW(window, message.c_str(), L"SenaiStream", MB_OK | MB_ICONERROR);
  }

  /**
   * @brief Receives completion of asynchronous WebView2 controller creation.
   */
  class ControllerCompletedHandler final : public ICoreWebView2CreateCoreWebView2ControllerCompletedHandler {
  public:
    /**
     * @brief Creates a completion handler for one native window.
     *
     * @param window Parent window that will contain WebView2.
     */
    explicit ControllerCompletedHandler(HWND window): window_(window) {
    }

    /**
     * @brief Resolves the COM interfaces implemented by this callback.
     *
     * @param interface_id Requested interface identifier.
     * @param object Receives the interface pointer.
     * @return S_OK when the requested interface is supported.
     */
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID interface_id, void **object) override {
      if (object == nullptr) {
        return E_POINTER;
      }
      *object = nullptr;
      if (IsEqualIID(interface_id, IID_IUnknown) ||
          IsEqualIID(interface_id, IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler)) {
        *object = static_cast<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *>(this);
        AddRef();
        return S_OK;
      }
      return E_NOINTERFACE;
    }

    /**
     * @brief Adds a COM reference to this callback.
     *
     * @return New reference count.
     */
    ULONG STDMETHODCALLTYPE AddRef() override {
      return static_cast<ULONG>(InterlockedIncrement(&references_));
    }

    /**
     * @brief Releases a COM reference and deletes the callback at zero.
     *
     * @return Remaining reference count.
     */
    ULONG STDMETHODCALLTYPE Release() override {
      const auto remaining = static_cast<ULONG>(InterlockedDecrement(&references_));
      if (remaining == 0) {
        delete this;
      }
      return remaining;
    }

    /**
     * @brief Configures the browser controller after asynchronous creation.
     *
     * @param result Controller-creation result.
     * @param controller Created browser controller.
     * @return S_OK after handling the completion.
     */
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Controller *controller) override {
      if (FAILED(result) || controller == nullptr) {
        show_webview_error(window_, result);
        return S_OK;
      }
      webview_controller = controller;
      controller->get_CoreWebView2(&webview);
      if (!webview) {
        show_webview_error(window_, E_NOINTERFACE);
        return S_OK;
      }

      ComPtr<ICoreWebView2Settings> settings;
      if (SUCCEEDED(webview->get_Settings(&settings)) && settings) {
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_IsZoomControlEnabled(FALSE);
      }
      ComPtr<ICoreWebView2Controller2> controller2;
      if (SUCCEEDED(controller->QueryInterface(
            IID_ICoreWebView2Controller2, reinterpret_cast<void **>(controller2.GetAddressOf()))) &&
          controller2) {
        COREWEBVIEW2_COLOR transparent {0, 0, 0, 0};
        controller2->put_DefaultBackgroundColor(transparent);
      }
      resize_webview(window_);
      webview->Navigate(dashboard_url);
      return S_OK;
    }

  private:
    volatile LONG references_ = 1;  ///< COM reference count.
    HWND window_;  ///< Native parent window.
  };

  /**
   * @brief Receives completion of asynchronous WebView2 environment creation.
   */
  class EnvironmentCompletedHandler final : public ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler {
  public:
    /**
     * @brief Creates an environment callback for one native window.
     *
     * @param window Parent window that will contain WebView2.
     */
    explicit EnvironmentCompletedHandler(HWND window): window_(window) {
    }

    /**
     * @brief Resolves the COM interfaces implemented by this callback.
     *
     * @param interface_id Requested interface identifier.
     * @param object Receives the interface pointer.
     * @return S_OK when the requested interface is supported.
     */
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID interface_id, void **object) override {
      if (object == nullptr) {
        return E_POINTER;
      }
      *object = nullptr;
      if (IsEqualIID(interface_id, IID_IUnknown) ||
          IsEqualIID(interface_id, IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler)) {
        *object = static_cast<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *>(this);
        AddRef();
        return S_OK;
      }
      return E_NOINTERFACE;
    }

    /**
     * @brief Adds a COM reference to this callback.
     *
     * @return New reference count.
     */
    ULONG STDMETHODCALLTYPE AddRef() override {
      return static_cast<ULONG>(InterlockedIncrement(&references_));
    }

    /**
     * @brief Releases a COM reference and deletes the callback at zero.
     *
     * @return Remaining reference count.
     */
    ULONG STDMETHODCALLTYPE Release() override {
      const auto remaining = static_cast<ULONG>(InterlockedDecrement(&references_));
      if (remaining == 0) {
        delete this;
      }
      return remaining;
    }

    /**
     * @brief Requests a browser controller from the initialized environment.
     *
     * @param result Environment-creation result.
     * @param environment Created WebView2 environment.
     * @return Result returned by the controller request.
     */
    HRESULT STDMETHODCALLTYPE Invoke(HRESULT result, ICoreWebView2Environment *environment) override {
      if (FAILED(result) || environment == nullptr) {
        show_webview_error(window_, result);
        return S_OK;
      }
      auto *handler = new ControllerCompletedHandler(window_);
      const auto status = environment->CreateCoreWebView2Controller(window_, handler);
      handler->Release();
      return status;
    }

  private:
    volatile LONG references_ = 1;  ///< COM reference count.
    HWND window_;  ///< Native parent window.
  };

  /**
   * @brief Starts the WebView2 environment and embeds the management experience.
   *
   * @param window Native window that owns the browser controller.
   * @return True when asynchronous initialization was started.
   */
  bool initialize_webview(HWND window) {
    const auto loader_path = executable_directory() / L"WebView2Loader.dll";
    webview_loader = LoadLibraryExW(loader_path.c_str(), nullptr, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR | LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (webview_loader == nullptr) {
      show_webview_error(window, HRESULT_FROM_WIN32(GetLastError()));
      return false;
    }
    const auto exported_function = GetProcAddress(webview_loader, "CreateCoreWebView2EnvironmentWithOptions");
    CreateEnvironmentFunction create_environment = nullptr;
    static_assert(sizeof(create_environment) == sizeof(exported_function));
    std::memcpy(&create_environment, &exported_function, sizeof(create_environment));
    if (create_environment == nullptr) {
      show_webview_error(window, HRESULT_FROM_WIN32(GetLastError()));
      return false;
    }

    const auto user_data = browser_data_directory();
    auto *completion = new EnvironmentCompletedHandler(window);
    const auto status = create_environment(nullptr, user_data.c_str(), nullptr, completion);
    completion->Release();
    if (FAILED(status)) {
      show_webview_error(window, status);
      return false;
    }
    return true;
  }

  /**
   * @brief Handles messages for the native SenaiStream management window.
   *
   * @param window Window receiving the message.
   * @param message Windows message identifier.
   * @param word Word parameter.
   * @param long_value Long parameter.
   * @return Message-processing result.
   */
  LRESULT CALLBACK window_proc(HWND window, UINT message, WPARAM word, LPARAM long_value) {
    switch (message) {
      case WM_CREATE:
        apply_window_material(window);
        initialize_webview(window);
        return 0;
      case WM_SIZE:
        resize_webview(window);
        return 0;
      case WM_GETMINMAXINFO: {
        auto *limits = reinterpret_cast<MINMAXINFO *>(long_value);
        limits->ptMinTrackSize.x = 920;
        limits->ptMinTrackSize.y = 640;
        return 0;
      }
      case WM_DPICHANGED: {
        const auto *suggested = reinterpret_cast<const RECT *>(long_value);
        SetWindowPos(window, nullptr, suggested->left, suggested->top, suggested->right - suggested->left,
                     suggested->bottom - suggested->top, SWP_NOACTIVATE | SWP_NOZORDER);
        return 0;
      }
      case WM_DESTROY:
        webview.Reset();
        if (webview_controller) {
          webview_controller->Close();
          webview_controller.Reset();
        }
        PostQuitMessage(0);
        return 0;
      default:
        return DefWindowProcW(window, message, word, long_value);
    }
  }

  /**
   * @brief Centers a window within the current work area.
   *
   * @param window Window to position.
   */
  void center_window(HWND window) {
    RECT window_rect {};
    RECT work_area {};
    GetWindowRect(window, &window_rect);
    SystemParametersInfoW(SPI_GETWORKAREA, 0, &work_area, 0);
    const int width = window_rect.right - window_rect.left;
    const int height = window_rect.bottom - window_rect.top;
    const int left = work_area.left + ((work_area.right - work_area.left) - width) / 2;
    const int top = work_area.top + ((work_area.bottom - work_area.top) - height) / 2;
    SetWindowPos(window, nullptr, left, top, width, height, SWP_NOACTIVATE | SWP_NOZORDER);
  }

}  // namespace

/**
 * @brief Runs the native SenaiStream desktop management application.
 *
 * @param instance Application instance.
 * @param previous_instance Unused previous instance.
 * @param command_line Unused command line.
 * @param show_command Requested initial visibility.
 * @return Process exit code.
 */
int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous_instance, PWSTR command_line, int show_command) {
  static_cast<void>(previous_instance);
  static_cast<void>(command_line);

  HANDLE singleton = CreateMutexW(nullptr, TRUE, L"Local\\SenaiStreamUI");
  if (singleton == nullptr) {
    return 1;
  }
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    if (HWND existing = FindWindowW(window_class_name, nullptr); existing != nullptr) {
      ShowWindow(existing, SW_RESTORE);
      SetForegroundWindow(existing);
    }
    CloseHandle(singleton);
    return 0;
  }

  const auto com_status = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(com_status)) {
    CloseHandle(singleton);
    return 2;
  }
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  ensure_host_agent();

  WNDCLASSEXW window_class {};
  window_class.cbSize = sizeof(window_class);
  window_class.style = CS_HREDRAW | CS_VREDRAW;
  window_class.lpfnWndProc = window_proc;
  window_class.hInstance = instance;
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hIcon = LoadIconW(nullptr, IDI_APPLICATION);
  window_class.hIconSm = window_class.hIcon;
  window_class.hbrBackground = CreateSolidBrush(RGB(10, 8, 30));
  window_class.lpszClassName = window_class_name;
  if (RegisterClassExW(&window_class) == 0) {
    CoUninitialize();
    CloseHandle(singleton);
    return 3;
  }

  HWND window = CreateWindowExW(WS_EX_APPWINDOW, window_class_name, window_title,
                                WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN, CW_USEDEFAULT, CW_USEDEFAULT, 1240, 800,
                                nullptr, nullptr, instance, nullptr);
  if (window == nullptr) {
    CoUninitialize();
    CloseHandle(singleton);
    return 4;
  }
  center_window(window);
  ShowWindow(window, show_command == 0 ? SW_SHOWNORMAL : show_command);
  UpdateWindow(window);

  MSG message {};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  if (webview_loader != nullptr) {
    FreeLibrary(webview_loader);
    webview_loader = nullptr;
  }
  CoUninitialize();
  ReleaseMutex(singleton);
  CloseHandle(singleton);
  return static_cast<int>(message.wParam);
}
