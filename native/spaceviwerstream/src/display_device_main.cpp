#include <windows.h>
#include <initguid.h>
#include <devpkey.h>
#include <newdev.h>
#include <setupapi.h>

#include <algorithm>
#include <array>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <iostream>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace {

  GUID display_class_guid {
    0x4D36E968,
    0xE325,
    0x11CE,
    {0xBF, 0xC1, 0x08, 0x00, 0x2B, 0xE1, 0x03, 0x18}
  };
  std::wstring_view virtual_hardware_id = L"ROOT\\MTTVDD";

  /**
   * @brief Closes a SetupAPI device-information set.
   */
  class DeviceSet {
  public:
    /**
     * @brief Takes ownership of a device-information set.
     *
     * @param value SetupAPI handle.
     */
    explicit DeviceSet(HDEVINFO value):
        value_(value) {
    }

    /** @brief Releases the device-information set. */
    ~DeviceSet() {
      if (value_ != INVALID_HANDLE_VALUE) {
        SetupDiDestroyDeviceInfoList(value_);
      }
    }

    DeviceSet(const DeviceSet &) = delete;
    DeviceSet &operator=(const DeviceSet &) = delete;

    /**
     * @brief Returns the native SetupAPI handle.
     *
     * @return Native device-information handle.
     */
    [[nodiscard]] HDEVINFO get() const noexcept {
      return value_;
    }

  private:
    HDEVINFO value_;  ///< Owned SetupAPI handle.
  };

  /**
   * @brief Tests a MULTI_SZ hardware-ID buffer for the virtual display ID.
   *
   * @param bytes Raw UTF-16 MULTI_SZ bytes.
   * @return True when the SenaiStream virtual display driver ID is present.
   */
  bool contains_virtual_hardware_id(const std::vector<std::uint8_t> &bytes) {
    if (bytes.size() < sizeof(wchar_t) * 2 || bytes.size() % sizeof(wchar_t) != 0) {
      return false;
    }
    const auto *current = reinterpret_cast<const wchar_t *>(bytes.data());
    const auto *end = current + bytes.size() / sizeof(wchar_t);
    while (current < end && *current != L'\0') {
      const std::wstring_view value(current);
      if (_wcsicmp(std::wstring(value).c_str(), std::wstring(virtual_hardware_id).c_str()) == 0) {
        return true;
      }
      current += value.size() + 1;
    }
    return false;
  }

  /**
   * @brief Reads a variable-size device registry property.
   *
   * @param set Device-information set.
   * @param device Device entry.
   * @param property SPDRP property identifier.
   * @return Property bytes, or no value when unavailable.
   */
  std::optional<std::vector<std::uint8_t>> device_property(
    HDEVINFO set,
    SP_DEVINFO_DATA &device,
    DWORD property
  ) {
    DWORD required = 0;
    SetupDiGetDeviceRegistryPropertyW(set, &device, property, nullptr, nullptr, 0, &required);
    if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || required == 0) {
      return std::nullopt;
    }
    std::vector<std::uint8_t> bytes(required);
    if (!SetupDiGetDeviceRegistryPropertyW(
          set,
          &device,
          property,
          nullptr,
          bytes.data(),
          static_cast<DWORD>(bytes.size()),
          nullptr
        )) {
      return std::nullopt;
    }
    return bytes;
  }

  /**
   * @brief Locates the root-enumerated virtual display device.
   *
   * @param set Device-information set containing display devices.
   * @return Device entry when installed.
   */
  std::optional<SP_DEVINFO_DATA> find_virtual_device(HDEVINFO set) {
    for (DWORD index = 0;; ++index) {
      SP_DEVINFO_DATA device {};
      device.cbSize = sizeof(device);
      if (!SetupDiEnumDeviceInfo(set, index, &device)) {
        break;
      }
      const auto identifiers = device_property(set, device, SPDRP_HARDWAREID);
      if (identifiers && contains_virtual_hardware_id(*identifiers)) {
        return device;
      }
    }
    return std::nullopt;
  }

  /**
   * @brief Applies the Windows extended-desktop topology.
   *
   * @return True when Windows accepted the topology request.
   */
  bool apply_extended_topology() {
    const auto result = SetDisplayConfig(
      0,
      nullptr,
      0,
      nullptr,
      SDC_APPLY | SDC_TOPOLOGY_EXTEND | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE
    );
    if (result == ERROR_SUCCESS) {
      return true;
    }
    std::array<wchar_t, MAX_PATH> system_directory {};
    if (GetSystemDirectoryW(system_directory.data(), static_cast<UINT>(system_directory.size())) == 0) {
      return false;
    }
    const auto executable = std::filesystem::path(system_directory.data()) / L"DisplaySwitch.exe";
    std::wstring command_line = L"\"" + executable.wstring() + L"\" /extend";
    STARTUPINFOW startup {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process {};
    if (!CreateProcessW(
          executable.c_str(),
          command_line.data(),
          nullptr,
          nullptr,
          FALSE,
          CREATE_NO_WINDOW,
          nullptr,
          nullptr,
          &startup,
          &process
        )) {
      return false;
    }
    WaitForSingleObject(process.hProcess, 10'000);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return exit_code == 0;
  }

  /**
   * @brief Applies the Windows duplicated-desktop topology.
   *
   * @return True when Windows accepted the topology request.
   */
  bool apply_duplicated_topology() {
    const auto result = SetDisplayConfig(
      0,
      nullptr,
      0,
      nullptr,
      SDC_APPLY | SDC_TOPOLOGY_CLONE | SDC_ALLOW_CHANGES | SDC_SAVE_TO_DATABASE
    );
    if (result == ERROR_SUCCESS) {
      return true;
    }
    std::array<wchar_t, MAX_PATH> system_directory {};
    if (GetSystemDirectoryW(system_directory.data(), static_cast<UINT>(system_directory.size())) == 0) {
      return false;
    }
    const auto executable = std::filesystem::path(system_directory.data()) / L"DisplaySwitch.exe";
    std::wstring command_line = L"\"" + executable.wstring() + L"\" /clone";
    STARTUPINFOW startup {};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION process {};
    if (!CreateProcessW(
          executable.c_str(),
          command_line.data(),
          nullptr,
          nullptr,
          FALSE,
          CREATE_NO_WINDOW,
          nullptr,
          nullptr,
          &startup,
          &process
        )) {
      return false;
    }
    WaitForSingleObject(process.hProcess, 10'000);
    DWORD exit_code = 1;
    GetExitCodeProcess(process.hProcess, &exit_code);
    CloseHandle(process.hThread);
    CloseHandle(process.hProcess);
    return exit_code == 0;
  }

  /**
   * @brief Applies an explicit display mode to one GDI display source.
   *
   * @param device_name GDI name such as `\\.\DISPLAY5`.
   * @param width Requested width.
   * @param height Requested height.
   * @param refresh_rate Requested integer refresh rate.
   * @return True when Windows applied the mode.
   */
  bool apply_display_mode(
    const wchar_t *device_name,
    DWORD width,
    DWORD height,
    DWORD refresh_rate
  ) {
    DEVMODEW mode {};
    mode.dmSize = sizeof(mode);
    if (!EnumDisplaySettingsW(device_name, ENUM_CURRENT_SETTINGS, &mode)) {
      std::wcerr << L"Unable to read display mode for " << device_name << L": " << GetLastError() << L'\n';
      return false;
    }
    mode.dmPelsWidth = width;
    mode.dmPelsHeight = height;
    mode.dmDisplayFrequency = refresh_rate;
    mode.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
    const auto result = ChangeDisplaySettingsExW(device_name, &mode, nullptr, CDS_UPDATEREGISTRY, nullptr);
    if (result != DISP_CHANGE_SUCCESSFUL) {
      std::wcerr << L"Unable to apply display mode for " << device_name << L": " << result << L'\n';
    }
    return result == DISP_CHANGE_SUCCESSFUL;
  }

  /**
   * @brief Finds the active GDI source name belonging to the virtual monitor.
   *
   * @return Device name such as `\\.\DISPLAY5`, or no value when inactive.
   */
  std::optional<std::wstring> active_virtual_display_name() {
    for (DWORD index = 0;; ++index) {
      DISPLAY_DEVICEW display {};
      display.cb = sizeof(display);
      if (!EnumDisplayDevicesW(nullptr, index, &display, 0)) {
        break;
      }
      if ((display.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP) == 0) {
        continue;
      }
      std::wstring label = display.DeviceString;
      std::transform(label.begin(), label.end(), label.begin(), [](wchar_t value) {
        return static_cast<wchar_t>(std::towlower(value));
      });
      if (label.find(L"virtual") != std::wstring::npos || label.find(L"vdd") != std::wstring::npos || label.find(L"mtt") != std::wstring::npos) {
        return display.DeviceName;
      }
    }
    return std::nullopt;
  }

  /**
   * @brief Creates and binds the signed virtual display device.
   *
   * @param inf_path Absolute path to the signed driver INF.
   * @return Process exit code.
   */
  int ensure_virtual_display(const std::filesystem::path &inf_path) {
    if (!std::filesystem::is_regular_file(inf_path)) {
      std::wcerr << L"Driver INF not found: " << inf_path << L'\n';
      return 2;
    }
    DeviceSet existing(SetupDiGetClassDevsW(&display_class_guid, nullptr, nullptr, DIGCF_PRESENT));
    if (existing.get() != INVALID_HANDLE_VALUE && find_virtual_device(existing.get())) {
      if (display_class_guid.Data1 != 0x4d36e96c) {
        apply_extended_topology();
      }
      return 0;
    }

    DeviceSet created(SetupDiCreateDeviceInfoList(&display_class_guid, nullptr));
    if (created.get() == INVALID_HANDLE_VALUE) {
      std::wcerr << L"Unable to create the display device set: " << GetLastError() << L'\n';
      return 3;
    }
    SP_DEVINFO_DATA device {};
    device.cbSize = sizeof(device);
    if (!SetupDiCreateDeviceInfoW(
          created.get(),
          display_class_guid.Data1 == 0x4d36e96c ? L"SpaceViewer Virtual Audio" : L"SenaiStream Virtual Display",
          &display_class_guid,
          nullptr,
          nullptr,
          DICD_GENERATE_ID,
          &device
        )) {
      std::wcerr << L"Unable to create the virtual display device: " << GetLastError() << L'\n';
      return 4;
    }
    std::wstring identifiers(virtual_hardware_id);
    identifiers.push_back(L'\0');
    identifiers.push_back(L'\0');
    if (!SetupDiSetDeviceRegistryPropertyW(created.get(), &device, SPDRP_HARDWAREID, reinterpret_cast<const BYTE *>(identifiers.data()), static_cast<DWORD>(identifiers.size() * sizeof(wchar_t))) || !SetupDiCallClassInstaller(DIF_REGISTERDEVICE, created.get(), &device)) {
      std::wcerr << L"Unable to register the virtual display device: " << GetLastError() << L'\n';
      return 5;
    }
    BOOL reboot_required = FALSE;
    if (!UpdateDriverForPlugAndPlayDevicesW(
          nullptr,
          virtual_hardware_id.data(),
          inf_path.c_str(),
          INSTALLFLAG_FORCE,
          &reboot_required
        )) {
      const auto error = GetLastError();
      SP_REMOVEDEVICE_PARAMS remove_parameters {};
      remove_parameters.ClassInstallHeader.cbSize = sizeof(SP_CLASSINSTALL_HEADER);
      remove_parameters.ClassInstallHeader.InstallFunction = DIF_REMOVE;
      remove_parameters.Scope = DI_REMOVEDEVICE_GLOBAL;
      SetupDiSetClassInstallParamsW(
        created.get(),
        &device,
        &remove_parameters.ClassInstallHeader,
        sizeof(remove_parameters)
      );
      SetupDiCallClassInstaller(DIF_REMOVE, created.get(), &device);
      std::wcerr << L"Unable to bind the signed virtual display driver: " << error << L'\n';
      return 6;
    }
    Sleep(1'500);
    if (display_class_guid.Data1 != 0x4d36e96c) {
      apply_extended_topology();
    }
    return reboot_required ? 3010 : 0;
  }

  /**
   * @brief Removes the virtual display device and its OEM driver package.
   *
   * @return Process exit code.
   */
  int remove_virtual_display() {
    DeviceSet set(SetupDiGetClassDevsW(&display_class_guid, nullptr, nullptr, DIGCF_PRESENT));
    if (set.get() == INVALID_HANDLE_VALUE) {
      return 0;
    }
    auto device = find_virtual_device(set.get());
    if (!device) {
      return 0;
    }
    std::array<wchar_t, MAX_PATH> published_inf {};
    DEVPROPTYPE property_type = 0;
    SetupDiGetDevicePropertyW(
      set.get(),
      &*device,
      &DEVPKEY_Device_DriverInfPath,
      &property_type,
      reinterpret_cast<PBYTE>(published_inf.data()),
      static_cast<DWORD>(published_inf.size() * sizeof(wchar_t)),
      nullptr,
      0
    );
    SP_REMOVEDEVICE_PARAMS remove_parameters {};
    remove_parameters.ClassInstallHeader.cbSize = sizeof(SP_CLASSINSTALL_HEADER);
    remove_parameters.ClassInstallHeader.InstallFunction = DIF_REMOVE;
    remove_parameters.Scope = DI_REMOVEDEVICE_GLOBAL;
    if (!SetupDiSetClassInstallParamsW(set.get(), &*device, &remove_parameters.ClassInstallHeader, sizeof(remove_parameters)) || !SetupDiCallClassInstaller(DIF_REMOVE, set.get(), &*device)) {
      std::wcerr << L"Unable to remove the virtual display device: " << GetLastError() << L'\n';
      return 7;
    }
    if (published_inf[0] != L'\0') {
      SetupUninstallOEMInfW(published_inf.data(), SUOI_FORCEDELETE, nullptr);
    }
    return 0;
  }

}  // namespace

/**
 * @brief Installs, removes, or probes the SenaiStream virtual display device.
 *
 * @param argument_count Number of command-line arguments.
 * @param arguments Unicode command-line arguments.
 * @return Process exit code.
 */
int wmain(int argument_count, wchar_t **arguments) {
  if (argument_count < 2) {
    std::wcerr << L"Usage: SenaiStreamDisplayCtl ensure <driver.inf> | remove | status | extend | duplicate | "
                  L"mode <device> <width> <height> <hz> | mode-virtual <width> <height> <hz>\n";
    return 1;
  }
  const std::wstring_view command(arguments[1]);
  if (command == L"audio-ensure" && argument_count == 3) {
    display_class_guid = GUID {0x4d36e96c, 0xe325, 0x11ce, {0xbf, 0xc1, 0x08, 0x00, 0x2b, 0xe1, 0x03, 0x18}};
    virtual_hardware_id = L"VBAudioVACWDM";
    return ensure_virtual_display(std::filesystem::absolute(arguments[2]));
  }

  if (command == L"ensure" && argument_count == 3) {
    return ensure_virtual_display(std::filesystem::absolute(arguments[2]));
  }
  if (command == L"remove") {
    return remove_virtual_display();
  }
  if (command == L"extend") {
    return apply_extended_topology() ? 0 : 8;
  }
  if (command == L"duplicate") {
    return apply_duplicated_topology() ? 0 : 8;
  }
  if (command == L"status") {
    DeviceSet set(SetupDiGetClassDevsW(&display_class_guid, nullptr, nullptr, DIGCF_PRESENT));
    return set.get() != INVALID_HANDLE_VALUE && find_virtual_device(set.get()) ? 0 : 3;
  }
  if (command == L"mode" && argument_count == 6) {
    const auto width = std::wcstoul(arguments[3], nullptr, 10);
    const auto height = std::wcstoul(arguments[4], nullptr, 10);
    const auto refresh_rate = std::wcstoul(arguments[5], nullptr, 10);
    if (width < 320 || height < 240 || refresh_rate == 0) {
      return 9;
    }
    return apply_display_mode(
             arguments[2],
             static_cast<DWORD>(width),
             static_cast<DWORD>(height),
             static_cast<DWORD>(refresh_rate)
           ) ?
             0 :
             10;
  }
  if (command == L"mode-virtual" && argument_count == 5) {
    const auto device = active_virtual_display_name();
    const auto width = std::wcstoul(arguments[2], nullptr, 10);
    const auto height = std::wcstoul(arguments[3], nullptr, 10);
    const auto refresh_rate = std::wcstoul(arguments[4], nullptr, 10);
    if (!device || width < 320 || height < 240 || refresh_rate == 0) {
      return 9;
    }
    return apply_display_mode(
             device->c_str(),
             static_cast<DWORD>(width),
             static_cast<DWORD>(height),
             static_cast<DWORD>(refresh_rate)
           ) ?
             0 :
             10;
  }
  std::wcerr << L"Invalid virtual display command.\n";
  return 1;
}
