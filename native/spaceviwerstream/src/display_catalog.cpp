#include "senaistream/display_catalog.hpp"

#include <windows.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <algorithm>
#include <cstdio>
#include <cstdint>
#include <cwctype>
#include <map>
#include <string>

namespace {

  using Microsoft::WRL::ComPtr;

  /**
   * @brief Converts UTF-16 text to UTF-8.
   *
   * @param value Null-terminated UTF-16 text.
   * @return UTF-8 text, or an empty string when conversion fails.
   */
  std::string to_utf8(const wchar_t *value) {
    const auto size = WideCharToMultiByte(CP_UTF8, 0, value, -1, nullptr, 0, nullptr, nullptr);
    if (size <= 1) {
      return {};
    }
    std::string result(static_cast<std::size_t>(size - 1), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value, -1, result.data(), size, nullptr, nullptr);
    return result;
  }

  /**
   * @brief Converts an HRESULT to readable text.
   *
   * @param value HRESULT value.
   * @return Readable hexadecimal HRESULT.
   */
  std::string hresult_text(HRESULT value) {
    char buffer[16] {};
    std::snprintf(buffer, sizeof(buffer), "0x%08lx", static_cast<unsigned long>(value));
    return buffer;
  }

  /**
   * @brief Describes the target attached to one GDI display source.
   */
  struct TargetMetadata {
    std::string friendly_name;  ///< Windows monitor-friendly name.
    bool indirect {};  ///< Whether the output uses an indirect-display transport.
  };

  /**
   * @brief Builds a mapping from GDI display names to monitor target metadata.
   *
   * @return Metadata keyed by names such as `\\.\DISPLAY1`.
   */
  std::map<std::wstring, TargetMetadata> display_target_metadata() {
    UINT32 path_count = 0;
    UINT32 mode_count = 0;
    if (GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &path_count, &mode_count) != ERROR_SUCCESS) {
      return {};
    }
    std::vector<DISPLAYCONFIG_PATH_INFO> paths(path_count);
    std::vector<DISPLAYCONFIG_MODE_INFO> modes(mode_count);
    if (QueryDisplayConfig(
          QDC_ONLY_ACTIVE_PATHS, &path_count, paths.data(), &mode_count, modes.data(), nullptr) != ERROR_SUCCESS) {
      return {};
    }
    paths.resize(path_count);
    std::map<std::wstring, TargetMetadata> metadata;
    for (const auto &path : paths) {
      DISPLAYCONFIG_SOURCE_DEVICE_NAME source {};
      source.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
      source.header.size = sizeof(source);
      source.header.adapterId = path.sourceInfo.adapterId;
      source.header.id = path.sourceInfo.id;
      DISPLAYCONFIG_TARGET_DEVICE_NAME target {};
      target.header.type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
      target.header.size = sizeof(target);
      target.header.adapterId = path.targetInfo.adapterId;
      target.header.id = path.targetInfo.id;
      if (DisplayConfigGetDeviceInfo(&source.header) != ERROR_SUCCESS ||
          DisplayConfigGetDeviceInfo(&target.header) != ERROR_SUCCESS) {
        continue;
      }
      std::wstring friendly(target.monitorFriendlyDeviceName);
      std::transform(friendly.begin(), friendly.end(), friendly.begin(), [](wchar_t value) {
        return static_cast<wchar_t>(std::towlower(value));
      });
      const bool named_virtual = friendly.find(L"virtual") != std::wstring::npos ||
                                 friendly.find(L"vdd") != std::wstring::npos || friendly.find(L"mtt") != std::wstring::npos;
      metadata[source.viewGdiDeviceName] = {
        to_utf8(target.monitorFriendlyDeviceName),
        named_virtual || path.targetInfo.outputTechnology == DISPLAYCONFIG_OUTPUT_TECHNOLOGY_INDIRECT_WIRED,
      };
    }
    return metadata;
  }

}  // namespace

namespace senaistream {

  std::vector<DisplayInfo> DisplayCatalog::enumerate(std::string &error) const {
    error.clear();
    ComPtr<IDXGIFactory1> factory;
    const auto factory_result = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(factory_result)) {
      error = "CreateDXGIFactory1 failed with " + hresult_text(factory_result);
      return {};
    }

    std::vector<DisplayInfo> displays;
    const auto targets = display_target_metadata();
    for (UINT adapter_index = 0;; ++adapter_index) {
      ComPtr<IDXGIAdapter1> adapter;
      const auto adapter_result = factory->EnumAdapters1(adapter_index, &adapter);
      if (adapter_result == DXGI_ERROR_NOT_FOUND) {
        break;
      }
      if (FAILED(adapter_result)) {
        error = "DXGI adapter enumeration failed with " + hresult_text(adapter_result);
        return {};
      }

      for (UINT output_index = 0;; ++output_index) {
        ComPtr<IDXGIOutput> output;
        const auto output_result = adapter->EnumOutputs(output_index, &output);
        if (output_result == DXGI_ERROR_NOT_FOUND) {
          break;
        }
        if (FAILED(output_result)) {
          error = "DXGI output enumeration failed with " + hresult_text(output_result);
          return {};
        }

        DXGI_OUTPUT_DESC description {};
        if (FAILED(output->GetDesc(&description)) || !description.AttachedToDesktop) {
          continue;
        }
        const auto width = description.DesktopCoordinates.right - description.DesktopCoordinates.left;
        const auto height = description.DesktopCoordinates.bottom - description.DesktopCoordinates.top;
        const auto target = targets.find(description.DeviceName);
        const auto friendly_name = target != targets.end() && !target->second.friendly_name.empty() ?
                                     target->second.friendly_name :
                                     to_utf8(description.DeviceName);
        displays.push_back({
          static_cast<std::uint32_t>(displays.size()),
          friendly_name,
          to_utf8(description.DeviceName),
          static_cast<std::uint32_t>(width),
          static_cast<std::uint32_t>(height),
          description.DesktopCoordinates.left <= 0 && description.DesktopCoordinates.right > 0 &&
          description.DesktopCoordinates.top <= 0 && description.DesktopCoordinates.bottom > 0,
          target != targets.end() && target->second.indirect,
          description.DesktopCoordinates.left,
          description.DesktopCoordinates.top,
        });
      }
    }
    return displays;
  }

}  // namespace senaistream
