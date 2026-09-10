#include "senaistream/audio_output.hpp"
// clang-format off
#include <windows.h>
#include <mmdeviceapi.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
// clang-format on
#include <array>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iomanip>

namespace senaistream_audio_detail {
  using Microsoft::WRL::ComPtr;

  /** @brief Windows playback-policy ABI with external linkage to prevent closed-world devirtualization of COM calls. */
  struct PlaybackPolicy: IUnknown {
    virtual HRESULT STDMETHODCALLTYPE Reserved1() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved2() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved3() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved4() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved5() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved6() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved7() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved8() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved9() = 0;
    virtual HRESULT STDMETHODCALLTYPE Reserved10() = 0;
    virtual HRESULT STDMETHODCALLTYPE SetDefaultEndpoint(PCWSTR id, ERole role) = 0;
  };

  const GUID policy_class {0x870af99c, 0x171d, 0x4f9e, {0xaf, 0x0d, 0xe6, 0x3d, 0xf4, 0x0c, 0x2b, 0xc9}};
  const GUID policy_interface {0xf8679f50, 0x850a, 0x41cf, {0x9c, 0x72, 0x43, 0x0f, 0x29, 0x02, 0x90, 0xc8}};

  /** @brief Reads an endpoint ID while releasing COM-allocated memory. @param device Endpoint. @return ID. */
  std::wstring device_id(IMMDevice *device) {
    LPWSTR id = nullptr;
    if (!device || FAILED(device->GetId(&id))) {
      return {};
    }
    std::wstring result(id);
    CoTaskMemFree(id);
    return result;
  }
}  // namespace senaistream_audio_detail

namespace senaistream {
  using namespace senaistream_audio_detail;

  /** @brief Owns endpoint policy, role snapshots and a recovery journal. */
  struct AudioOutput::Implementation {
    HRESULT com {CoInitializeEx(nullptr, COINIT_MULTITHREADED)};  ///< Balanced COM initialization.
    ComPtr<IMMDeviceEnumerator> enumerator;  ///< Playback catalog.
    ComPtr<PlaybackPolicy> policy;  ///< Default-role policy interface.
    std::array<std::wstring, 3> previous;  ///< Original console, media and communication outputs.
    std::wstring sink;  ///< Our virtual playback endpoint.
    std::filesystem::path journal;  ///< Recovery record, never committed with source.
    bool redirected {};  ///< At least one role is owned by the host.

    /** @brief Finds the active signed virtual driver by its endpoint name. @return ID or empty. */
    std::wstring find_sink() const {
      if (!enumerator) {
        return {};
      }
      ComPtr<IMMDeviceCollection> devices;
      if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices))) {
        return {};
      }
      UINT count = 0;
      devices->GetCount(&count);
      for (UINT i = 0; i < count; ++i) {
        ComPtr<IMMDevice> device;
        ComPtr<IPropertyStore> properties;
        if (FAILED(devices->Item(i, &device)) || FAILED(device->OpenPropertyStore(STGM_READ, &properties))) {
          continue;
        }
        PROPVARIANT name {};
        properties->GetValue(PKEY_Device_FriendlyName, &name);
        bool matches = name.vt == VT_LPWSTR && name.pwszVal && (std::wstring(name.pwszVal).find(L"VB-Audio Virtual Cable") != std::wstring::npos || std::wstring(name.pwszVal).find(L"Virtual Audio Driver by MTT") != std::wstring::npos);
        PropVariantClear(&name);
        if (matches) {
          return device_id(device.Get());
        }
      }
      return {};
    }

    /** @brief Reads one default playback role. @param role Role. @return ID. */
    std::wstring current(int role) const {
      ComPtr<IMMDevice> device;
      if (!enumerator || FAILED(enumerator->GetDefaultAudioEndpoint(eRender, static_cast<ERole>(role), &device))) {
        return {};
      }
      return device_id(device.Get());
    }

    /** @brief Restores only defaults still pointing at our virtual endpoint. @return Success. */
    bool restore() {
      if (!policy) {
        return false;
      }
      bool ok = true;
      for (int role = 0; role < 3; ++role) {
        if (!previous[role].empty() && current(role) == sink) {
          if (FAILED(policy->SetDefaultEndpoint(previous[role].c_str(), static_cast<ERole>(role)))) {
            ok = false;
          }
        }
      }
      if (ok) {
        redirected = false;
        std::error_code error;
        std::filesystem::remove(journal, error);
      }
      return ok;
    }
  };

  AudioOutput::AudioOutput():
      implementation_(std::make_unique<Implementation>()) {
    auto &state = *implementation_;
    CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&state.enumerator));
    CoCreateInstance(policy_class, nullptr, CLSCTX_ALL, policy_interface, reinterpret_cast<void **>(state.policy.GetAddressOf()));
    const char *base = std::getenv("SPACEVIEWER_DATA_DIR");
    state.journal = base ? std::filesystem::path(base) : std::filesystem::path(std::getenv("LOCALAPPDATA") ? std::getenv("LOCALAPPDATA") : ".") / "SpaceViewer";
    state.journal /= "audio-output-recovery.txt";
    std::wifstream file(state.journal);
    if (file >> std::quoted(state.sink) >> std::quoted(state.previous[0]) >> std::quoted(state.previous[1]) >> std::quoted(state.previous[2])) {
      state.redirected = true;
      state.restore();
    }
  }

  AudioOutput::~AudioOutput() {
    auto &state = *implementation_;
    if (state.redirected) {
      state.restore();
    }
    state.policy.Reset();
    state.enumerator.Reset();
    if (SUCCEEDED(state.com)) {
      CoUninitialize();
    }
  }

  bool AudioOutput::available() const {
    return !implementation_->find_sink().empty();
  }

  bool AudioOutput::active() const {
    return implementation_->redirected;
  }

  Status AudioOutput::update(bool enabled) {
    auto &state = *implementation_;
    if (!enabled) {
      return !state.redirected || state.restore() ? Status::success() : Status::failure("Nao foi possivel restaurar a saida de audio do PC.");
    }
    if (state.redirected) {
      return Status::success();
    }
    state.sink = state.find_sink();
    if (state.sink.empty()) {
      return Status::failure("Instale o driver de audio virtual para ouvir somente nas TVs.");
    }
    if (!state.policy) {
      return Status::failure("A politica de audio deste Windows nao esta disponivel.");
    }
    for (int role = 0; role < 3; ++role) {
      state.previous[role] = state.current(role);
    }
    std::error_code error;
    std::filesystem::create_directories(state.journal.parent_path(), error);
    if (error) {
      return Status::failure("Nao foi possivel salvar a saida de audio original.");
    }
    {
      std::wofstream file(state.journal, std::ios::trunc);
      file << std::quoted(state.sink) << '\n';
      for (const auto &id : state.previous) {
        file << std::quoted(id) << '\n';
      }
      file.flush();
      if (!file) {
        return Status::failure("Nao foi possivel salvar a saida de audio original.");
      }
    }
    state.redirected = true;
    for (int role = 0; role < 3; ++role) {
      if (FAILED(state.policy->SetDefaultEndpoint(state.sink.c_str(), static_cast<ERole>(role)))) {
        state.restore();
        return Status::failure("Falha ao direcionar audio para as TVs.");
      }
    }
    return Status::success();
  }
}  // namespace senaistream
