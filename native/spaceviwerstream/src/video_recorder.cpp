#include "senaistream/video_recorder.hpp"

// Windows declarations must precede codecapi.h under MinGW.
// clang-format off
#include <windows.h>
// clang-format on

#include <algorithm>
#include <chrono>
#include <codecapi.h>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <d3d11.h>
#include <dxgi1_2.h>
#include <icodecapi.h>
#include <limits>
#include <map>
#include <memory>
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mftransform.h>
#include <mutex>
#include <span>
#include <string>
#include <thread>
#include <utility>
#include <vector>
#include <wrl/client.h>

namespace {

  using Microsoft::WRL::ComPtr;

  /**
   * @brief Owns one successful COM initialization.
   */
  class ComRuntime {
  public:
    /**
     * @brief Initializes COM for a multithreaded command-line worker.
     */
    ComRuntime():
        result_(CoInitializeEx(nullptr, COINIT_MULTITHREADED)) {
    }

    /**
     * @brief Balances a successful COM initialization.
     */
    ~ComRuntime() {
      if (SUCCEEDED(result_)) {
        CoUninitialize();
      }
    }

    ComRuntime(const ComRuntime &) = delete;
    ComRuntime &operator=(const ComRuntime &) = delete;

    /**
     * @brief Returns the COM initialization result.
     *
     * @return Initialization HRESULT.
     */
    [[nodiscard]] HRESULT result() const noexcept {
      return result_;
    }

  private:
    HRESULT result_;  ///< COM initialization result.
  };

  /**
   * @brief Owns one successful Media Foundation initialization.
   */
  class MediaFoundationRuntime {
  public:
    /**
     * @brief Starts Media Foundation.
     */
    MediaFoundationRuntime():
        result_(MFStartup(MF_VERSION, MFSTARTUP_FULL)) {
    }

    /**
     * @brief Shuts Media Foundation down after successful startup.
     */
    ~MediaFoundationRuntime() {
      if (SUCCEEDED(result_)) {
        MFShutdown();
      }
    }

    MediaFoundationRuntime(const MediaFoundationRuntime &) = delete;
    MediaFoundationRuntime &operator=(const MediaFoundationRuntime &) = delete;

    /**
     * @brief Returns the Media Foundation startup result.
     *
     * @return Startup HRESULT.
     */
    [[nodiscard]] HRESULT result() const noexcept {
      return result_;
    }

  private:
    HRESULT result_;  ///< Media Foundation startup result.
  };

  /**
   * @brief Converts an HRESULT to readable hexadecimal text.
   *
   * @param value HRESULT value.
   * @return Readable HRESULT.
   */
  std::string hresult_text(HRESULT value) {
    char buffer[16] {};
    std::snprintf(buffer, sizeof(buffer), "0x%08lx", static_cast<unsigned long>(value));
    return buffer;
  }

  /**
   * @brief Creates a failed status for a Windows multimedia operation.
   *
   * @param operation Operation that failed.
   * @param result Failure HRESULT.
   * @return Failed status.
   */
  senaistream::Status failure(const std::string &operation, HRESULT result) {
    return senaistream::Status::failure(operation + " failed with " + hresult_text(result));
  }

  /**
   * @brief Holds the DXGI duplication objects for one display.
   */
  struct CaptureState {
    ComPtr<ID3D11Device> device;  ///< D3D11 device associated with the selected adapter.
    ComPtr<ID3D11DeviceContext> context;  ///< Immediate D3D11 device context.
    ComPtr<IDXGIOutputDuplication> duplication;  ///< Desktop duplication interface.
    ComPtr<ID3D11Texture2D> staging;  ///< CPU-readable staging texture.
    std::uint32_t width {};  ///< Captured width in pixels.
    std::uint32_t height {};  ///< Captured height in pixels.
  };

  /**
   * @brief Opens a DXGI desktop duplication session by flattened display index.
   *
   * @param requested_index Flattened display index.
   * @param session Receives initialized capture state.
   * @return Operation status.
   */
  senaistream::Status open_capture_state(std::uint32_t requested_index, CaptureState &session) {
    ComPtr<IDXGIFactory1> factory;
    auto result = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(result)) {
      return failure("CreateDXGIFactory1", result);
    }

    std::uint32_t flat_index = 0;
    for (UINT adapter_index = 0;; ++adapter_index) {
      ComPtr<IDXGIAdapter1> adapter;
      result = factory->EnumAdapters1(adapter_index, &adapter);
      if (result == DXGI_ERROR_NOT_FOUND) {
        break;
      }
      if (FAILED(result)) {
        return failure("EnumAdapters1", result);
      }

      for (UINT output_index = 0;; ++output_index) {
        ComPtr<IDXGIOutput> output;
        result = adapter->EnumOutputs(output_index, &output);
        if (result == DXGI_ERROR_NOT_FOUND) {
          break;
        }
        if (FAILED(result)) {
          return failure("EnumOutputs", result);
        }
        DXGI_OUTPUT_DESC output_description {};
        if (FAILED(output->GetDesc(&output_description)) || !output_description.AttachedToDesktop) {
          continue;
        }
        if (flat_index++ != requested_index) {
          continue;
        }

        D3D_FEATURE_LEVEL selected_level {};
        result = D3D11CreateDevice(
          adapter.Get(),
          D3D_DRIVER_TYPE_UNKNOWN,
          nullptr,
          D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_VIDEO_SUPPORT,
          nullptr,
          0,
          D3D11_SDK_VERSION,
          &session.device,
          &selected_level,
          &session.context
        );
        if (FAILED(result)) {
          return failure("D3D11CreateDevice", result);
        }

        ComPtr<IDXGIOutput1> output_one;
        result = output.As(&output_one);
        if (FAILED(result)) {
          return failure("IDXGIOutput1 query", result);
        }
        result = output_one->DuplicateOutput(session.device.Get(), &session.duplication);
        if (FAILED(result)) {
          return failure("DuplicateOutput", result);
        }

        DXGI_OUTDUPL_DESC duplication_description {};
        session.duplication->GetDesc(&duplication_description);
        session.width = duplication_description.ModeDesc.Width;
        session.height = duplication_description.ModeDesc.Height;

        D3D11_TEXTURE2D_DESC staging_description {};
        staging_description.Width = session.width;
        staging_description.Height = session.height;
        staging_description.MipLevels = 1;
        staging_description.ArraySize = 1;
        staging_description.Format = duplication_description.ModeDesc.Format;
        staging_description.SampleDesc.Count = 1;
        staging_description.Usage = D3D11_USAGE_STAGING;
        staging_description.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
        result = session.device->CreateTexture2D(&staging_description, nullptr, &session.staging);
        if (FAILED(result)) {
          return failure("CreateTexture2D", result);
        }
        return senaistream::Status::success();
      }
    }
    return senaistream::Status::failure("The requested display index does not exist");
  }

  /**
   * @brief Acquires the newest desktop image into tightly packed BGRA memory.
   *
   * @param session Active capture session.
   * @param pixels Destination pixel buffer.
   * @param received_frame Receives whether a new frame was available before timeout.
   * @param access_lost Receives whether desktop duplication must be reopened.
   * @return Operation status.
   */
  senaistream::Status acquire_frame_state(
    CaptureState &session,
    std::vector<std::byte> &pixels,
    bool &received_frame,
    bool &access_lost
  ) {
    received_frame = false;
    access_lost = false;
    DXGI_OUTDUPL_FRAME_INFO frame_info {};
    ComPtr<IDXGIResource> resource;
    auto result = session.duplication->AcquireNextFrame(5, &frame_info, &resource);
    if (result == DXGI_ERROR_WAIT_TIMEOUT) {
      return senaistream::Status::success();
    }
    if (result == DXGI_ERROR_ACCESS_LOST) {
      access_lost = true;
      return senaistream::Status::success();
    }
    if (FAILED(result)) {
      return failure("AcquireNextFrame", result);
    }

    ComPtr<ID3D11Texture2D> desktop_texture;
    result = resource.As(&desktop_texture);
    if (FAILED(result)) {
      session.duplication->ReleaseFrame();
      return failure("Desktop texture query", result);
    }
    session.context->CopyResource(session.staging.Get(), desktop_texture.Get());

    D3D11_MAPPED_SUBRESOURCE mapped {};
    result = session.context->Map(session.staging.Get(), 0, D3D11_MAP_READ, 0, &mapped);
    if (FAILED(result)) {
      session.duplication->ReleaseFrame();
      return failure("Desktop staging map", result);
    }

    const auto row_size = static_cast<std::size_t>(session.width) * 4;
    pixels.resize(row_size * session.height);
    for (std::uint32_t row = 0; row < session.height; ++row) {
      const auto *source = static_cast<const std::byte *>(mapped.pData) + static_cast<std::size_t>(row) * mapped.RowPitch;
      auto *destination = pixels.data() + static_cast<std::size_t>(session.height - row - 1) * row_size;
      std::memcpy(destination, source, row_size);
    }
    session.context->Unmap(session.staging.Get(), 0);
    session.duplication->ReleaseFrame();
    received_frame = true;
    return senaistream::Status::success();
  }

  /**
   * @brief Serializes the single duplication interface allowed per Windows output.
   */
  struct SharedCapture {
    std::mutex mutex;  ///< Protects the D3D context and cached frame.
    CaptureState state;  ///< One desktop duplication interface.
    std::vector<std::byte> pixels;  ///< Latest image, including an unchanged desktop.
    bool valid {true};  ///< False after topology invalidates duplication.
  };

  /**
   * @brief Gives each encoder a reference to a shared capture and snapshot dimensions.
   */
  struct CaptureSession {
    std::shared_ptr<SharedCapture> shared;  ///< Shared output capture.
    std::uint32_t width {};  ///< Width of this encoder's last snapshot.
    std::uint32_t height {};  ///< Height of this encoder's last snapshot.
  };

  /**
   * @brief Opens or reuses a capture keyed by the stable Windows output name.
   * @param requested_index Flattened output index.
   * @param session Receives shared capture ownership.
   * @return Operation status.
   */
  senaistream::Status open_capture(std::uint32_t requested_index, CaptureSession &session) {
    static std::mutex registry_mutex;
    static std::map<std::wstring, std::weak_ptr<SharedCapture>> registry;
    std::lock_guard registry_lock(registry_mutex);
    ComPtr<IDXGIFactory1> factory;
    auto result = CreateDXGIFactory1(IID_PPV_ARGS(&factory));
    if (FAILED(result)) {
      return failure("CreateDXGIFactory1", result);
    }
    std::wstring key;
    std::uint32_t index = 0;
    for (UINT a = 0; key.empty(); ++a) {
      ComPtr<IDXGIAdapter1> adapter;
      if (factory->EnumAdapters1(a, &adapter) != S_OK) {
        break;
      }
      for (UINT o = 0;; ++o) {
        ComPtr<IDXGIOutput> output;
        if (adapter->EnumOutputs(o, &output) != S_OK) {
          break;
        }
        DXGI_OUTPUT_DESC description {};
        if (FAILED(output->GetDesc(&description)) || !description.AttachedToDesktop) {
          continue;
        }
        if (index++ == requested_index) {
          key = description.DeviceName;
          break;
        }
      }
    }
    if (key.empty()) {
      return senaistream::Status::failure("The requested display index does not exist");
    }
    std::erase_if(registry, [](const auto &entry) {
      return entry.second.expired();
    });
    auto shared = registry[key].lock();
    bool valid = false;
    if (shared) {
      std::lock_guard lock(shared->mutex);
      valid = shared->valid;
    }
    if (!valid) {
      shared.reset();
    }
    if (!shared) {
      shared = std::make_shared<SharedCapture>();
      auto status = open_capture_state(requested_index, shared->state);
      if (!status.ok()) {
        return status;
      }
      registry[key] = shared;
    }
    {
      std::lock_guard lock(shared->mutex);
      session.width = shared->state.width;
      session.height = shared->state.height;
    }
    session.shared = std::move(shared);
    return senaistream::Status::success();
  }

  /**
   * @brief Copies a serialized desktop snapshot for an independent encoder.
   * @param session Shared capture reference.
   * @param pixels Receives the latest complete BGRA frame.
   * @param received_frame Whether a cached or newly acquired image is available.
   * @param access_lost Whether every reader must reopen the output.
   * @return Operation status.
   */
  senaistream::Status acquire_frame(CaptureSession &session, std::vector<std::byte> &pixels, bool &received_frame, bool &access_lost) {
    auto &shared = *session.shared;
    std::lock_guard lock(shared.mutex);
    received_frame = false;
    access_lost = !shared.valid;
    if (access_lost) {
      return senaistream::Status::success();
    }
    auto status = acquire_frame_state(shared.state, shared.pixels, received_frame, access_lost);
    if (access_lost || !status.ok()) {
      shared.valid = false;
      shared.state = {};  // Release duplication before any reader opens its replacement.
      shared.pixels.clear();
      return status;
    }
    received_frame = !shared.pixels.empty();
    if (received_frame) {
      pixels = shared.pixels;
    }
    return status;
  }

  /**
   * @brief Configures a Media Foundation video media type.
   *
   * @param type Media type to configure.
   * @param subtype Video subtype GUID.
   * @param width Frame width.
   * @param height Frame height.
   * @param frames_per_second Frame rate numerator.
   * @return First failed HRESULT or S_OK.
   */
  HRESULT configure_video_type(
    IMFMediaType *type,
    const GUID &subtype,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t frames_per_second
  ) {
    HRESULT result = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    if (SUCCEEDED(result)) {
      result = type->SetGUID(MF_MT_SUBTYPE, subtype);
    }
    if (SUCCEEDED(result)) {
      result = MFSetAttributeSize(type, MF_MT_FRAME_SIZE, width, height);
    }
    if (SUCCEEDED(result)) {
      result = MFSetAttributeRatio(type, MF_MT_FRAME_RATE, frames_per_second, 1);
    }
    if (SUCCEEDED(result)) {
      result = MFSetAttributeRatio(type, MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    }
    if (SUCCEEDED(result)) {
      result = type->SetUINT32(MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive);
    }
    return result;
  }

  /**
   * @brief Converts and scales a captured BGRA frame into NV12.
   *
   * @param bgra Bottom-up tightly packed BGRA pixels.
   * @param source_width Source width.
   * @param source_height Source height.
   * @param output_width Destination width.
   * @param output_height Destination height.
   * @return Tightly packed NV12 image.
   */
  std::vector<std::uint8_t> bgra_to_nv12(
    std::span<const std::byte> bgra,
    std::uint32_t source_width,
    std::uint32_t source_height,
    std::uint32_t output_width,
    std::uint32_t output_height
  ) {
    const auto luma_size = static_cast<std::size_t>(output_width) * output_height;
    std::vector<std::uint8_t> nv12(luma_size + luma_size / 2);
    const auto clamp_byte = [](int value) {
      return static_cast<std::uint8_t>(std::clamp(value, 0, 255));
    };
    if (source_width == output_width && source_height == output_height) {
      for (std::uint32_t y = 0; y < output_height; ++y) {
        const auto source_y = source_height - 1 - y;
        for (std::uint32_t x = 0; x < output_width; ++x) {
          const auto source_offset = (static_cast<std::size_t>(source_y) * source_width + x) * 4;
          const auto blue = std::to_integer<int>(bgra[source_offset]);
          const auto green = std::to_integer<int>(bgra[source_offset + 1]);
          const auto red = std::to_integer<int>(bgra[source_offset + 2]);
          nv12[static_cast<std::size_t>(y) * output_width + x] =
            clamp_byte(((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16);
        }
      }
      for (std::uint32_t y = 0; y < output_height; y += 2) {
        const auto source_y = source_height - 1 - y;
        for (std::uint32_t x = 0; x < output_width; x += 2) {
          const auto source_offset = (static_cast<std::size_t>(source_y) * source_width + x) * 4;
          const auto blue = std::to_integer<int>(bgra[source_offset]);
          const auto green = std::to_integer<int>(bgra[source_offset + 1]);
          const auto red = std::to_integer<int>(bgra[source_offset + 2]);
          const auto chroma_offset = luma_size + static_cast<std::size_t>(y / 2) * output_width + x;
          nv12[chroma_offset] = clamp_byte(((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128);
          nv12[chroma_offset + 1] = clamp_byte(((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128);
        }
      }
      return nv12;
    }

    /** @brief Cached nearest-neighbor coordinates for the active stream size. */
    struct ScaleLookup {
      std::uint32_t source_width {};  ///< Cached source width.
      std::uint32_t source_height {};  ///< Cached source height.
      std::uint32_t output_width {};  ///< Cached destination width.
      std::uint32_t output_height {};  ///< Cached destination height.
      std::vector<std::uint32_t> x;  ///< Source column for each output column.
      std::vector<std::uint32_t> y;  ///< Source row for each output row.
    };

    thread_local ScaleLookup lookup;
    if (lookup.source_width != source_width || lookup.source_height != source_height || lookup.output_width != output_width || lookup.output_height != output_height) {
      lookup.source_width = source_width;
      lookup.source_height = source_height;
      lookup.output_width = output_width;
      lookup.output_height = output_height;
      lookup.x.resize(output_width);
      lookup.y.resize(output_height);
      for (std::uint32_t x = 0; x < output_width; ++x) {
        lookup.x[x] = static_cast<std::uint32_t>(static_cast<std::uint64_t>(x) * source_width / output_width);
      }
      for (std::uint32_t y = 0; y < output_height; ++y) {
        lookup.y[y] = source_height - 1 -
                      static_cast<std::uint32_t>(static_cast<std::uint64_t>(y) * source_height / output_height);
      }
    }
    for (std::uint32_t y = 0; y < output_height; ++y) {
      const auto source_y = lookup.y[y];
      for (std::uint32_t x = 0; x < output_width; ++x) {
        const auto source_x = lookup.x[x];
        const auto source_offset = (source_y * source_width + source_x) * 4;
        const auto blue = std::to_integer<int>(bgra[source_offset]);
        const auto green = std::to_integer<int>(bgra[source_offset + 1]);
        const auto red = std::to_integer<int>(bgra[source_offset + 2]);
        nv12[static_cast<std::size_t>(y) * output_width + x] =
          clamp_byte(((66 * red + 129 * green + 25 * blue + 128) >> 8) + 16);
      }
    }
    for (std::uint32_t y = 0; y < output_height; y += 2) {
      const auto source_y = lookup.y[y];
      for (std::uint32_t x = 0; x < output_width; x += 2) {
        const auto source_x = lookup.x[x];
        const auto source_offset = (source_y * source_width + source_x) * 4;
        const auto blue = std::to_integer<int>(bgra[source_offset]);
        const auto green = std::to_integer<int>(bgra[source_offset + 1]);
        const auto red = std::to_integer<int>(bgra[source_offset + 2]);
        const auto chroma_offset = luma_size + static_cast<std::size_t>(y / 2) * output_width + x;
        nv12[chroma_offset] = clamp_byte(((-38 * red - 74 * green + 112 * blue + 128) >> 8) + 128);
        nv12[chroma_offset + 1] = clamp_byte(((112 * red - 94 * green - 18 * blue + 128) >> 8) + 128);
      }
    }
    return nv12;
  }

  /**
   * @brief Applies real-time, no-reordering settings supported by an encoder.
   *
   * Unsupported optional properties are ignored because hardware vendors expose
   * different subsets of the Media Foundation codec API.
   *
   * @param encoder Activated H.264 transform.
   */
  void configure_low_latency_encoder(IMFTransform *encoder) {
    ComPtr<ICodecAPI> codec;
    if (encoder == nullptr || FAILED(encoder->QueryInterface(IID_PPV_ARGS(&codec)))) {
      return;
    }
    VARIANT value {};
    value.vt = VT_BOOL;
    value.boolVal = VARIANT_TRUE;
    codec->SetValue(&CODECAPI_AVLowLatencyMode, &value);
    codec->SetValue(&CODECAPI_AVEncCommonRealTime, &value);

    value = {};
    value.vt = VT_UI4;
    value.ulVal = eAVEncCommonRateControlMode_LowDelayVBR;
    codec->SetValue(&CODECAPI_AVEncCommonRateControlMode, &value);
    value.ulVal = 0;
    codec->SetValue(&CODECAPI_AVEncMPVDefaultBPictureCount, &value);
    codec->SetValue(&CODECAPI_AVEncCommonQualityVsSpeed, &value);
  }

  /**
   * @brief Activates a configured H.264 Media Foundation encoder.
   *
   * @param prefer_hardware Whether hardware transforms are attempted first.
   * @param width Encoded width.
   * @param height Encoded height.
   * @param frames_per_second Encoded frame rate.
   * @param bitrate_bps Target bitrate.
   * @param encoder Receives the configured encoder.
   * @return S_OK or the final activation/configuration error.
   */
  HRESULT create_h264_encoder(
    bool prefer_hardware,
    std::uint32_t width,
    std::uint32_t height,
    std::uint32_t frames_per_second,
    std::uint32_t bitrate_bps,
    ComPtr<IMFTransform> &encoder
  ) {
    const MFT_REGISTER_TYPE_INFO input_info {MFMediaType_Video, MFVideoFormat_NV12};
    const MFT_REGISTER_TYPE_INFO output_info {MFMediaType_Video, MFVideoFormat_H264};
    const std::array<UINT32, 2> searches {
      static_cast<UINT32>(prefer_hardware ? MFT_ENUM_FLAG_HARDWARE | MFT_ENUM_FLAG_SORTANDFILTER : MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER),
      static_cast<UINT32>(MFT_ENUM_FLAG_SYNCMFT | MFT_ENUM_FLAG_LOCALMFT | MFT_ENUM_FLAG_SORTANDFILTER)
    };
    HRESULT final_result = MF_E_TOPO_CODEC_NOT_FOUND;
    for (const auto flags : searches) {
      IMFActivate **activations = nullptr;
      UINT32 activation_count = 0;
      auto result = MFTEnumEx(MFT_CATEGORY_VIDEO_ENCODER, flags, &input_info, &output_info, &activations, &activation_count);
      if (FAILED(result)) {
        final_result = result;
        continue;
      }
      for (UINT32 index = 0; index < activation_count; ++index) {
        ComPtr<IMFTransform> candidate;
        result = activations[index]->ActivateObject(IID_PPV_ARGS(&candidate));
        if (SUCCEEDED(result)) {
          configure_low_latency_encoder(candidate.Get());
          ComPtr<IMFAttributes> transform_attributes;
          if (SUCCEEDED(candidate->GetAttributes(&transform_attributes))) {
            transform_attributes->SetUINT32(MF_TRANSFORM_ASYNC_UNLOCK, TRUE);
            transform_attributes->SetUINT32(MF_LOW_LATENCY, TRUE);
          }
          ComPtr<IMFMediaType> output_type;
          result = MFCreateMediaType(&output_type);
          if (SUCCEEDED(result)) {
            result = configure_video_type(output_type.Get(), MFVideoFormat_H264, width, height, frames_per_second);
          }
          if (SUCCEEDED(result)) {
            result = output_type->SetUINT32(MF_MT_AVG_BITRATE, bitrate_bps);
          }
          if (SUCCEEDED(result)) {
            result = output_type->SetUINT32(MF_MT_MPEG2_PROFILE, eAVEncH264VProfile_Main);
          }
          if (SUCCEEDED(result)) {
            result = candidate->SetOutputType(0, output_type.Get(), 0);
          }
          ComPtr<IMFMediaType> input_type;
          if (SUCCEEDED(result)) {
            result = MFCreateMediaType(&input_type);
          }
          if (SUCCEEDED(result)) {
            result = configure_video_type(input_type.Get(), MFVideoFormat_NV12, width, height, frames_per_second);
          }
          if (SUCCEEDED(result)) {
            result = candidate->SetInputType(0, input_type.Get(), 0);
          }
        }
        final_result = result;
        activations[index]->Release();
        if (SUCCEEDED(result)) {
          for (++index; index < activation_count; ++index) {
            activations[index]->Release();
          }
          CoTaskMemFree(activations);
          encoder = std::move(candidate);
          return S_OK;
        }
      }
      CoTaskMemFree(activations);
      if (!prefer_hardware) {
        break;
      }
    }
    return final_result;
  }

  /**
   * @brief Converts length-prefixed H.264 NAL units to Annex-B when necessary.
   *
   * @param encoded Encoded access unit.
   * @return Annex-B access unit, or the original bytes when already Annex-B.
   */
  std::vector<std::uint8_t> normalize_annex_b(std::vector<std::uint8_t> encoded) {
    if (encoded.size() >= 4 && encoded[0] == 0 && encoded[1] == 0 && (encoded[2] == 1 || (encoded[2] == 0 && encoded[3] == 1))) {
      return encoded;
    }
    std::vector<std::uint8_t> annex_b;
    std::size_t offset = 0;
    while (offset + 4 <= encoded.size()) {
      const auto nal_size = (static_cast<std::uint32_t>(encoded[offset]) << 24) |
                            (static_cast<std::uint32_t>(encoded[offset + 1]) << 16) |
                            (static_cast<std::uint32_t>(encoded[offset + 2]) << 8) | encoded[offset + 3];
      offset += 4;
      if (nal_size == 0 || nal_size > encoded.size() - offset) {
        return encoded;
      }
      annex_b.insert(annex_b.end(), {0, 0, 0, 1});
      annex_b.insert(annex_b.end(), encoded.begin() + static_cast<std::ptrdiff_t>(offset), encoded.begin() + static_cast<std::ptrdiff_t>(offset + nal_size));
      offset += nal_size;
    }
    return offset == encoded.size() ? annex_b : encoded;
  }

  /**
   * @brief Tests whether an Annex-B access unit contains a requested H.264 NAL type.
   *
   * @param encoded Annex-B bytes.
   * @param requested_type Five-bit H.264 NAL type.
   * @return True when a matching NAL unit begins in the buffer.
   */
  bool contains_h264_nal(std::span<const std::uint8_t> encoded, std::uint8_t requested_type) {
    for (std::size_t index = 0; index + 4 < encoded.size(); ++index) {
      std::size_t prefix_size = 0;
      if (encoded[index] == 0 && encoded[index + 1] == 0 && encoded[index + 2] == 1) {
        prefix_size = 3;
      } else if (index + 4 < encoded.size() && encoded[index] == 0 && encoded[index + 1] == 0 && encoded[index + 2] == 0 && encoded[index + 3] == 1) {
        prefix_size = 4;
      }
      if (prefix_size != 0 && index + prefix_size < encoded.size() && (encoded[index + prefix_size] & 0x1FU) == requested_type) {
        return true;
      }
    }
    return false;
  }

  /**
   * @brief Converts an AVCDecoderConfigurationRecord into Annex-B parameter sets.
   *
   * @param sequence_header Media Foundation MPEG sequence-header blob.
   * @return SPS/PPS bytes in Annex-B form, or an empty vector when malformed.
   */
  std::vector<std::uint8_t> avc_sequence_header_to_annex_b(std::vector<std::uint8_t> sequence_header) {
    if (sequence_header.size() < 7 || sequence_header[0] != 1) {
      const auto normalized = normalize_annex_b(std::move(sequence_header));
      return contains_h264_nal(normalized, 7) ? normalized : std::vector<std::uint8_t> {};
    }
    std::vector<std::uint8_t> output;
    std::size_t offset = 6;
    const auto append_units = [&](std::size_t count, std::size_t &position) -> bool {
      for (std::size_t index = 0; index < count; ++index) {
        if (position + 2 > sequence_header.size()) {
          return false;
        }
        const auto length = (static_cast<std::size_t>(sequence_header[position]) << 8) |
                            sequence_header[position + 1];
        position += 2;
        if (length == 0 || position + length > sequence_header.size()) {
          return false;
        }
        output.insert(output.end(), {0, 0, 0, 1});
        output.insert(output.end(), sequence_header.begin() + static_cast<std::ptrdiff_t>(position), sequence_header.begin() + static_cast<std::ptrdiff_t>(position + length));
        position += length;
      }
      return true;
    };
    const auto sequence_count = sequence_header[5] & 0x1FU;
    if (!append_units(sequence_count, offset) || offset >= sequence_header.size()) {
      return {};
    }
    const auto picture_count = sequence_header[offset++];
    if (!append_units(picture_count, offset)) {
      return {};
    }
    return output;
  }

}  // namespace

namespace senaistream {

  std::string validate_video_config(const VideoRecordConfig &config) {
    if (config.frames_per_second == 0 || config.frames_per_second > 240) {
      return "frames_per_second must be between 1 and 240";
    }
    if (config.bitrate_bps < 100'000 || config.bitrate_bps > 200'000'000) {
      return "bitrate_bps must be between 100000 and 200000000";
    }
    if (config.duration_seconds == 0 || config.duration_seconds > 86'400) {
      return "duration_seconds must be between 1 and 86400";
    }
    if ((config.width == 0) != (config.height == 0)) {
      return "width and height must both be zero or both be specified";
    }
    if (config.width != 0 && (config.width < 64 || config.height < 64 || config.width > 16'384 || config.height > 16'384)) {
      return "output dimensions must be between 64 and 16384 pixels";
    }
    if ((config.width & 1U) != 0 || (config.height & 1U) != 0) {
      return "output dimensions must be even for H.264/HEVC";
    }
    return {};
  }

  Status VideoRecorder::record(const VideoRecordConfig &config, const std::filesystem::path &output_path) const {
    const auto validation_error = validate_video_config(config);
    if (!validation_error.empty()) {
      return Status::failure(validation_error);
    }
    if (output_path.empty()) {
      return Status::failure("output path must not be empty");
    }

    ComRuntime com;
    if (FAILED(com.result()) && com.result() != RPC_E_CHANGED_MODE) {
      return failure("CoInitializeEx", com.result());
    }
    MediaFoundationRuntime media_foundation;
    if (FAILED(media_foundation.result())) {
      return failure("MFStartup", media_foundation.result());
    }

    CaptureSession capture;
    auto status = open_capture(config.display_index, capture);
    if (!status.ok()) {
      return status;
    }
    const auto output_width = config.width == 0 ? capture.width : config.width;
    const auto output_height = config.height == 0 ? capture.height : config.height;

    ComPtr<IMFAttributes> attributes;
    auto result = MFCreateAttributes(&attributes, 4);
    if (FAILED(result)) {
      return failure("MFCreateAttributes", result);
    }
    attributes->SetUINT32(MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, config.prefer_hardware ? TRUE : FALSE);
    attributes->SetUINT32(MF_SINK_WRITER_DISABLE_THROTTLING, TRUE);
    attributes->SetUINT32(MF_LOW_LATENCY, TRUE);

    ComPtr<IMFSinkWriter> writer;
    result = MFCreateSinkWriterFromURL(output_path.c_str(), nullptr, attributes.Get(), &writer);
    if (FAILED(result)) {
      return failure("MFCreateSinkWriterFromURL", result);
    }

    ComPtr<IMFMediaType> output_type;
    result = MFCreateMediaType(&output_type);
    if (FAILED(result)) {
      return failure("MFCreateMediaType for output", result);
    }
    result = configure_video_type(
      output_type.Get(),
      config.codec == VideoCodec::h264 ? MFVideoFormat_H264 : MFVideoFormat_HEVC,
      output_width,
      output_height,
      config.frames_per_second
    );
    if (SUCCEEDED(result)) {
      result = output_type->SetUINT32(MF_MT_AVG_BITRATE, config.bitrate_bps);
    }
    if (FAILED(result)) {
      return failure("Compressed media type configuration", result);
    }

    DWORD stream_index = 0;
    result = writer->AddStream(output_type.Get(), &stream_index);
    if (FAILED(result)) {
      return failure("AddStream", result);
    }

    ComPtr<IMFMediaType> input_type;
    result = MFCreateMediaType(&input_type);
    if (FAILED(result)) {
      return failure("MFCreateMediaType for input", result);
    }
    result = configure_video_type(input_type.Get(), MFVideoFormat_RGB32, capture.width, capture.height, config.frames_per_second);
    if (SUCCEEDED(result)) {
      result = input_type->SetUINT32(MF_MT_DEFAULT_STRIDE, capture.width * 4);
    }
    if (SUCCEEDED(result)) {
      result = writer->SetInputMediaType(stream_index, input_type.Get(), nullptr);
    }
    if (FAILED(result)) {
      return failure("SetInputMediaType", result);
    }
    result = writer->BeginWriting();
    if (FAILED(result)) {
      return failure("BeginWriting", result);
    }

    const auto frame_count = static_cast<std::uint64_t>(config.duration_seconds) * config.frames_per_second;
    const auto frame_duration = 10'000'000LL / config.frames_per_second;
    const auto buffer_size64 = static_cast<std::uint64_t>(capture.width) * capture.height * 4;
    if (buffer_size64 > std::numeric_limits<DWORD>::max()) {
      return Status::failure("captured frame is too large for a Media Foundation sample");
    }
    const auto buffer_size = static_cast<DWORD>(buffer_size64);
    std::vector<std::byte> pixels;
    bool have_frame = false;
    const auto start = std::chrono::steady_clock::now();

    for (std::uint64_t frame_index = 0; frame_index < frame_count; ++frame_index) {
      bool received_frame = false;
      bool access_lost = false;
      status = acquire_frame(capture, pixels, received_frame, access_lost);
      if (!status.ok()) {
        return status;
      }
      if (access_lost) {
        CaptureSession reopened;
        status = open_capture(config.display_index, reopened);
        if (!status.ok() || reopened.width != capture.width || reopened.height != capture.height) {
          return status.ok() ? Status::failure("display dimensions changed during local recording") : status;
        }
        capture = std::move(reopened);
        --frame_index;
        continue;
      }
      have_frame = have_frame || received_frame;
      if (!have_frame) {
        --frame_index;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
        continue;
      }

      ComPtr<IMFMediaBuffer> buffer;
      result = MFCreateMemoryBuffer(buffer_size, &buffer);
      if (FAILED(result)) {
        return failure("MFCreateMemoryBuffer", result);
      }
      BYTE *destination = nullptr;
      result = buffer->Lock(&destination, nullptr, nullptr);
      if (FAILED(result)) {
        return failure("IMFMediaBuffer::Lock", result);
      }
      std::memcpy(destination, pixels.data(), buffer_size);
      buffer->Unlock();
      buffer->SetCurrentLength(buffer_size);

      ComPtr<IMFSample> sample;
      result = MFCreateSample(&sample);
      if (SUCCEEDED(result)) {
        result = sample->AddBuffer(buffer.Get());
      }
      if (SUCCEEDED(result)) {
        result = sample->SetSampleTime(static_cast<LONGLONG>(frame_index) * frame_duration);
      }
      if (SUCCEEDED(result)) {
        result = sample->SetSampleDuration(frame_duration);
      }
      if (SUCCEEDED(result)) {
        result = writer->WriteSample(stream_index, sample.Get());
      }
      if (FAILED(result)) {
        return failure("WriteSample", result);
      }

      const auto deadline = start + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                                      std::chrono::duration<double>(static_cast<double>(frame_index + 1) / config.frames_per_second)
                                    );
      std::this_thread::sleep_until(deadline);
    }

    result = writer->Finalize();
    if (FAILED(result)) {
      return failure("Finalize", result);
    }
    return Status::success();
  }

  Status VideoRecorder::stream_h264(
    const VideoRecordConfig &config,
    const std::atomic_bool &stop_requested,
    const EncodedFrameCallback &callback,
    const std::atomic_bool *restart_requested
  ) const {
    const auto interrupted = [&]() {
      return stop_requested.load() || (restart_requested && restart_requested->load());
    };
    const auto validation_error = validate_video_config(config);
    if (!validation_error.empty()) {
      return Status::failure(validation_error);
    }
    if (!callback) {
      return Status::failure("encoded frame callback must not be empty");
    }

    ComRuntime com;
    if (FAILED(com.result()) && com.result() != RPC_E_CHANGED_MODE) {
      return failure("CoInitializeEx", com.result());
    }
    MediaFoundationRuntime media_foundation;
    if (FAILED(media_foundation.result())) {
      return failure("MFStartup", media_foundation.result());
    }
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);
    CaptureSession capture;
    auto status = open_capture(config.display_index, capture);
    if (!status.ok()) {
      return status;
    }
    const auto output_width = config.width == 0 ? capture.width : config.width;
    const auto output_height = config.height == 0 ? capture.height : config.height;

    ComPtr<IMFTransform> encoder;
    auto result = create_h264_encoder(
      config.prefer_hardware,
      output_width,
      output_height,
      config.frames_per_second,
      config.bitrate_bps,
      encoder
    );
    if (FAILED(result)) {
      return failure("H.264 encoder activation", result);
    }
    MFT_OUTPUT_STREAM_INFO output_information {};
    result = encoder->GetOutputStreamInfo(0, &output_information);
    if (FAILED(result)) {
      return failure("GetOutputStreamInfo", result);
    }
    ComPtr<IMFMediaEventGenerator> event_generator;
    ComPtr<IMFAttributes> encoder_attributes;
    UINT32 asynchronous = FALSE;
    if (SUCCEEDED(encoder->GetAttributes(&encoder_attributes))) {
      encoder_attributes->GetUINT32(MF_TRANSFORM_ASYNC, &asynchronous);
    }
    if (asynchronous != FALSE) {
      result = encoder.As(&event_generator);
      if (FAILED(result)) {
        return failure("Querying asynchronous H.264 encoder events", result);
      }
    }
    result = encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_BEGIN_STREAMING, 0);
    if (SUCCEEDED(result)) {
      result = encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_START_OF_STREAM, 0);
    }
    if (FAILED(result)) {
      return failure("Starting H.264 encoder", result);
    }

    bool continue_stream = true;
    std::vector<std::uint8_t> codec_parameters;
    const auto output_buffer_size = static_cast<DWORD>(std::max<std::uint64_t>(
      output_information.cbSize,
      static_cast<std::uint64_t>(output_width) * output_height * 2
    ));
    const auto drain_outputs = [&]() -> HRESULT {
      for (;;) {
        ComPtr<IMFSample> supplied_sample;
        if ((output_information.dwFlags & (MFT_OUTPUT_STREAM_PROVIDES_SAMPLES | MFT_OUTPUT_STREAM_CAN_PROVIDE_SAMPLES)) == 0) {
          ComPtr<IMFMediaBuffer> supplied_buffer;
          auto output_result = MFCreateMemoryBuffer(output_buffer_size, &supplied_buffer);
          if (FAILED(output_result)) {
            return output_result;
          }
          output_result = MFCreateSample(&supplied_sample);
          if (SUCCEEDED(output_result)) {
            output_result = supplied_sample->AddBuffer(supplied_buffer.Get());
          }
          if (FAILED(output_result)) {
            return output_result;
          }
        }
        MFT_OUTPUT_DATA_BUFFER output {};
        output.dwStreamID = 0;
        output.pSample = supplied_sample.Get();
        DWORD output_status = 0;
        auto output_result = encoder->ProcessOutput(0, 1, &output, &output_status);
        if (output.pEvents != nullptr) {
          output.pEvents->Release();
        }
        if (output_result == MF_E_TRANSFORM_NEED_MORE_INPUT) {
          return S_OK;
        }
        if (output_result == MF_E_TRANSFORM_STREAM_CHANGE) {
          ComPtr<IMFMediaType> changed_type;
          output_result = encoder->GetOutputAvailableType(0, 0, &changed_type);
          if (SUCCEEDED(output_result)) {
            output_result = encoder->SetOutputType(0, changed_type.Get(), 0);
          }
          if (SUCCEEDED(output_result)) {
            output_result = encoder->GetOutputStreamInfo(0, &output_information);
          }
          return output_result;
        }
        if (FAILED(output_result)) {
          if (output.pSample != nullptr && output.pSample != supplied_sample.Get()) {
            output.pSample->Release();
          }
          return output_result;
        }
        ComPtr<IMFSample> produced_sample;
        if (output.pSample == supplied_sample.Get()) {
          produced_sample = supplied_sample;
        } else {
          produced_sample.Attach(output.pSample);
        }
        if (!produced_sample) {
          continue;
        }
        ComPtr<IMFMediaBuffer> contiguous;
        output_result = produced_sample->ConvertToContiguousBuffer(&contiguous);
        if (FAILED(output_result)) {
          return output_result;
        }
        BYTE *bytes = nullptr;
        DWORD length = 0;
        output_result = contiguous->Lock(&bytes, nullptr, &length);
        if (FAILED(output_result)) {
          return output_result;
        }
        std::vector<std::uint8_t> encoded(bytes, bytes + length);
        contiguous->Unlock();
        encoded = normalize_annex_b(std::move(encoded));
        UINT32 clean_point = FALSE;
        produced_sample->GetUINT32(MFSampleExtension_CleanPoint, &clean_point);
        const bool key_frame = clean_point != FALSE || contains_h264_nal(encoded, 5);
        const bool has_parameter_sets = contains_h264_nal(encoded, 7) && contains_h264_nal(encoded, 8);
        if (key_frame && !has_parameter_sets) {
          if (codec_parameters.empty()) {
            ComPtr<IMFMediaType> current_type;
            if (SUCCEEDED(encoder->GetOutputCurrentType(0, &current_type))) {
              UINT32 header_size = 0;
              if (SUCCEEDED(current_type->GetBlobSize(MF_MT_MPEG_SEQUENCE_HEADER, &header_size)) && header_size != 0) {
                std::vector<std::uint8_t> header(header_size);
                UINT32 written_size = 0;
                if (SUCCEEDED(current_type->GetBlob(MF_MT_MPEG_SEQUENCE_HEADER, header.data(), header_size, &written_size))) {
                  header.resize(written_size);
                  codec_parameters = avc_sequence_header_to_annex_b(std::move(header));
                }
              }
            }
          }
          if (!codec_parameters.empty()) {
            std::vector<std::uint8_t> configured;
            configured.reserve(codec_parameters.size() + encoded.size());
            configured.insert(configured.end(), codec_parameters.begin(), codec_parameters.end());
            configured.insert(configured.end(), encoded.begin(), encoded.end());
            encoded = std::move(configured);
          }
        }
        LONGLONG timestamp = 0;
        produced_sample->GetSampleTime(&timestamp);
        if (!encoded.empty() && !callback(encoded, key_frame, static_cast<std::uint64_t>(timestamp))) {
          continue_stream = false;
          return S_OK;
        }
        if (event_generator) {
          return S_OK;
        }
      }
    };

    const auto wait_for_async_input = [&]() -> HRESULT {
      if (!event_generator) {
        return S_OK;
      }
      for (;;) {
        ComPtr<IMFMediaEvent> event;
        if (interrupted()) {
          return E_ABORT;
        }
        auto event_result = event_generator->GetEvent(MF_EVENT_FLAG_NO_WAIT, &event);
        if (event_result == MF_E_NO_EVENTS_AVAILABLE) {
          std::this_thread::sleep_for(std::chrono::milliseconds(2));
          continue;
        }
        if (FAILED(event_result)) {
          return event_result;
        }
        MediaEventType type = MEUnknown;
        event_result = event->GetType(&type);
        if (FAILED(event_result)) {
          return event_result;
        }
        HRESULT event_status = S_OK;
        event->GetStatus(&event_status);
        if (FAILED(event_status)) {
          return event_status;
        }
        if (type == METransformNeedInput) {
          return S_OK;
        }
        if (type == METransformHaveOutput) {
          event_result = drain_outputs();
          if (FAILED(event_result)) {
            return event_result;
          }
        }
      }
    };

    const auto frame_duration = 10'000'000LL / config.frames_per_second;
    const auto frame_limit = static_cast<std::uint64_t>(config.duration_seconds) * config.frames_per_second;
    std::vector<std::byte> pixels;
    bool have_frame = false;
    const auto start = std::chrono::steady_clock::now();
    for (std::uint64_t frame_index = 0;
         frame_index < frame_limit && !interrupted() && continue_stream;
         ++frame_index) {
      bool received_frame = false;
      bool access_lost = false;
      status = acquire_frame(capture, pixels, received_frame, access_lost);
      if (!status.ok()) {
        return status;
      }
      if (access_lost) {
        CaptureSession reopened;
        status = open_capture(config.display_index, reopened);
        if (!status.ok()) {
          return status;
        }
        capture = std::move(reopened);
        pixels.clear();
        have_frame = false;
        --frame_index;
        continue;
      }
      have_frame = have_frame || received_frame;
      if (!have_frame) {
        --frame_index;
        std::this_thread::sleep_for(std::chrono::milliseconds(2));
        continue;
      }
      const auto nv12 = bgra_to_nv12(pixels, capture.width, capture.height, output_width, output_height);
      if (nv12.size() > std::numeric_limits<DWORD>::max()) {
        return Status::failure("live NV12 frame is too large for Media Foundation");
      }
      ComPtr<IMFMediaBuffer> input_buffer;
      result = MFCreateMemoryBuffer(static_cast<DWORD>(nv12.size()), &input_buffer);
      if (FAILED(result)) {
        return failure("MFCreateMemoryBuffer for live frame", result);
      }
      BYTE *destination = nullptr;
      result = input_buffer->Lock(&destination, nullptr, nullptr);
      if (FAILED(result)) {
        return failure("Locking live input frame", result);
      }
      std::memcpy(destination, nv12.data(), nv12.size());
      input_buffer->Unlock();
      input_buffer->SetCurrentLength(static_cast<DWORD>(nv12.size()));

      ComPtr<IMFSample> input_sample;
      result = MFCreateSample(&input_sample);
      if (SUCCEEDED(result)) {
        result = input_sample->AddBuffer(input_buffer.Get());
      }
      if (SUCCEEDED(result)) {
        result = input_sample->SetSampleTime(static_cast<LONGLONG>(frame_index) * frame_duration);
      }
      if (SUCCEEDED(result)) {
        result = input_sample->SetSampleDuration(frame_duration);
      }
      if (SUCCEEDED(result)) {
        result = wait_for_async_input();
      }
      if (SUCCEEDED(result)) {
        result = encoder->ProcessInput(0, input_sample.Get(), 0);
      }
      if (result == MF_E_NOTACCEPTING) {
        result = drain_outputs();
        if (SUCCEEDED(result)) {
          result = encoder->ProcessInput(0, input_sample.Get(), 0);
        }
      }
      if (FAILED(result)) {
        return failure("Encoding live H.264 input", result);
      }
      if (!event_generator) {
        result = drain_outputs();
        if (FAILED(result)) {
          return failure("Reading live H.264 output", result);
        }
      }
      const auto deadline = start + std::chrono::duration_cast<std::chrono::steady_clock::duration>(
                                      std::chrono::duration<double>(static_cast<double>(frame_index + 1) / config.frames_per_second)
                                    );
      std::this_thread::sleep_until(deadline);
    }
    encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_OF_STREAM, 0);
    encoder->ProcessMessage(MFT_MESSAGE_COMMAND_DRAIN, 0);
    if (continue_stream && !event_generator) {
      result = drain_outputs();
      if (FAILED(result)) {
        return failure("Draining live H.264 encoder", result);
      }
    }
    encoder->ProcessMessage(MFT_MESSAGE_NOTIFY_END_STREAMING, 0);
    return Status::success();
  }

}  // namespace senaistream
