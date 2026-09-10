#include "senaistream/audio_recorder.hpp"

#include <windows.h>
#include <audioclient.h>
#include <ks.h>
#include <ksmedia.h>
#include <mmdeviceapi.h>
#include <opus.h>
#include <wrl/client.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {

  using Microsoft::WRL::ComPtr;

  /** @brief Win32 process-loopback activation payload (Windows build 20348+). */
  struct ProcessActivation {
    int activation_type {1};  ///< AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK.
    DWORD process_id {};  ///< Included process tree root.
    int mode {};  ///< PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE.
  };

  /** @brief Agile completion callback owning the asynchronous activation result. */
  class ProcessAudioActivation final: public IActivateAudioInterfaceCompletionHandler, public IAgileObject {
  public:
    std::atomic<ULONG> references {1};  ///< COM lifetime, including asynchronous callbacks.
    HANDLE ready {CreateEventW(nullptr, TRUE, FALSE, nullptr)};  ///< Completion event.
    HRESULT result {E_PENDING};  ///< Activation result.
    ComPtr<IAudioClient> client;  ///< Activated process loopback client.
    ProcessActivation parameters;  ///< Payload remains alive through completion.

    /** @brief Releases the completion handle. */
    ~ProcessAudioActivation() {
      if (ready) {
        CloseHandle(ready);
      }
    }

    /** @brief Exposes completion and agility interfaces. @param iid Interface. @param value Result. @return COM status. */
    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, void **value) override {
      if (!value) {
        return E_POINTER;
      }
      *value = nullptr;
      if (iid == __uuidof(IUnknown) || iid == __uuidof(IActivateAudioInterfaceCompletionHandler)) {
        *value = static_cast<IActivateAudioInterfaceCompletionHandler *>(this);
      } else if (iid == __uuidof(IAgileObject)) {
        *value = static_cast<IAgileObject *>(this);
      } else {
        return E_NOINTERFACE;
      }
      AddRef();
      return S_OK;
    }

    /** @brief Retains the callback. @return Reference count. */
    ULONG STDMETHODCALLTYPE AddRef() override {
      return ++references;
    }

    /** @brief Releases the callback. @return Remaining references. */
    ULONG STDMETHODCALLTYPE Release() override {
      const auto count = --references;
      if (!count) {
        delete this;
      }
      return count;
    }

    /** @brief Receives the process-audio interface. @param operation Async result. @return Callback status. */
    HRESULT STDMETHODCALLTYPE ActivateCompleted(IActivateAudioInterfaceAsyncOperation *operation) override {
      ComPtr<IUnknown> activated;
      HRESULT activation_result = E_FAIL;
      result = operation->GetActivateResult(&activation_result, &activated);
      if (SUCCEEDED(result)) {
        result = activation_result;
      }
      if (SUCCEEDED(result)) {
        result = activated.As(&client);
      }
      SetEvent(ready);
      return S_OK;
    }
  };

  /** @brief Activates capture restricted to one application process tree.
   * @param pid Selected process. @param client Receives client. @return HRESULT. */
  HRESULT activate_process_audio(DWORD pid, ComPtr<IAudioClient> &client) {
    ComPtr<ProcessAudioActivation> callback;
    callback.Attach(new ProcessAudioActivation());
    if (!callback->ready) {
      return HRESULT_FROM_WIN32(GetLastError());
    }
    callback->parameters.process_id = pid;
    PROPVARIANT parameters {};
    parameters.vt = VT_BLOB;
    parameters.blob.cbSize = sizeof(ProcessActivation);
    parameters.blob.pBlobData = reinterpret_cast<BYTE *>(&callback->parameters);
    ComPtr<IActivateAudioInterfaceAsyncOperation> operation;
    auto result = ActivateAudioInterfaceAsync(L"VAD\\Process_Loopback", __uuidof(IAudioClient), &parameters, callback.Get(), &operation);
    if (FAILED(result)) {
      return result;
    }
    if (WaitForSingleObject(callback->ready, 5000) != WAIT_OBJECT_0) {
      return HRESULT_FROM_WIN32(WAIT_TIMEOUT);
    }
    client = callback->client;
    return callback->result;
  }

  /**
   * @brief Owns COM initialization for the audio worker.
   */
  class ComRuntime {
  public:
    /**
     * @brief Initializes COM for a multithreaded worker.
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
     * @brief Returns the initialization result.
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
   * @brief Owns a Windows event handle.
   */
  class EventHandle {
  public:
    /**
     * @brief Creates an automatic-reset event.
     */
    EventHandle():
        value_(CreateEventW(nullptr, FALSE, FALSE, nullptr)) {
    }

    /**
     * @brief Closes the event handle.
     */
    ~EventHandle() {
      if (value_ != nullptr) {
        CloseHandle(value_);
      }
    }

    EventHandle(const EventHandle &) = delete;
    EventHandle &operator=(const EventHandle &) = delete;

    /**
     * @brief Returns the native event handle.
     *
     * @return Native handle, possibly null after creation failure.
     */
    [[nodiscard]] HANDLE get() const noexcept {
      return value_;
    }

  private:
    HANDLE value_;  ///< Native event handle.
  };

  /**
   * @brief Releases a WAVEFORMATEX allocated by COM.
   */
  struct WaveFormatDeleter {
    /**
     * @brief Releases the format block.
     *
     * @param value Format block to release.
     */
    void operator()(WAVEFORMATEX *value) const noexcept {
      CoTaskMemFree(value);
    }
  };

  /**
   * @brief Converts an HRESULT to hexadecimal text.
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
   * @brief Creates a failed status for a Windows audio operation.
   *
   * @param operation Operation that failed.
   * @param result Failure HRESULT.
   * @return Failed status.
   */
  senaistream::Status failure(const std::string &operation, HRESULT result) {
    return senaistream::Status::failure(operation + " failed with " + hresult_text(result));
  }

  /**
   * @brief Classifies a wave sample representation.
   */
  enum class SampleKind {
    unsupported,  ///< An unsupported representation.
    integer_pcm,  ///< Signed little-endian PCM.
    floating_point,  ///< IEEE 32-bit floating point.
  };

  /**
   * @brief Returns the effective sample representation for a wave format.
   *
   * @param format Wave format.
   * @return Effective sample representation.
   */
  SampleKind sample_format(const WAVEFORMATEX &format) {
    if (format.wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
      return SampleKind::floating_point;
    }
    if (format.wFormatTag == WAVE_FORMAT_PCM) {
      return SampleKind::integer_pcm;
    }
    if (format.wFormatTag == WAVE_FORMAT_EXTENSIBLE && format.cbSize >= 22) {
      const auto &subtype = reinterpret_cast<const WAVEFORMATEXTENSIBLE &>(format).SubFormat;
      if (subtype.Data1 == WAVE_FORMAT_IEEE_FLOAT) {
        return SampleKind::floating_point;
      }
      if (subtype.Data1 == WAVE_FORMAT_PCM) {
        return SampleKind::integer_pcm;
      }
    }
    return SampleKind::unsupported;
  }

  /**
   * @brief Decodes one PCM sample into normalized floating-point form.
   *
   * @param source Address of the sample bytes.
   * @param format Wave format that describes the sample.
   * @return Sample clamped to the range from -1.0 to 1.0.
   */
  float decode_sample(const BYTE *source, const WAVEFORMATEX &format) {
    const auto subtype = sample_format(format);
    if (subtype == SampleKind::floating_point && format.wBitsPerSample == 32) {
      float value = 0.0F;
      std::memcpy(&value, source, sizeof(value));
      return std::clamp(value, -1.0F, 1.0F);
    }
    if (subtype != SampleKind::integer_pcm) {
      return 0.0F;
    }
    if (format.wBitsPerSample == 16) {
      std::int16_t value = 0;
      std::memcpy(&value, source, sizeof(value));
      return static_cast<float>(value) / 32768.0F;
    }
    if (format.wBitsPerSample == 24) {
      std::int32_t value = static_cast<std::int32_t>(source[0]) |
                           (static_cast<std::int32_t>(source[1]) << 8) |
                           (static_cast<std::int32_t>(source[2]) << 16);
      if ((value & 0x00800000) != 0) {
        value |= static_cast<std::int32_t>(0xFF000000);
      }
      return static_cast<float>(value) / 8388608.0F;
    }
    if (format.wBitsPerSample == 32) {
      std::int32_t value = 0;
      std::memcpy(&value, source, sizeof(value));
      return static_cast<float>(static_cast<double>(value) / 2147483648.0);
    }
    return 0.0F;
  }

  /**
   * @brief Appends interleaved stereo samples decoded from a WASAPI packet.
   *
   * @param data Packet bytes, or null for a silent packet.
   * @param frame_count Number of audio frames in the packet.
   * @param format Packet wave format.
   * @param destination Interleaved stereo destination.
   */
  void append_stereo(const BYTE *data, UINT32 frame_count, const WAVEFORMATEX &format, std::vector<float> &destination) {
    const auto bytes_per_sample = format.wBitsPerSample / 8;
    destination.reserve(destination.size() + static_cast<std::size_t>(frame_count) * 2);
    for (UINT32 frame = 0; frame < frame_count; ++frame) {
      if (data == nullptr) {
        destination.push_back(0.0F);
        destination.push_back(0.0F);
        continue;
      }
      const auto *frame_data = data + static_cast<std::size_t>(frame) * format.nBlockAlign;
      const auto left = decode_sample(frame_data, format);
      const auto right = format.nChannels > 1 ? decode_sample(frame_data + bytes_per_sample, format) : left;
      destination.push_back(left);
      destination.push_back(right);
    }
  }

  /**
   * @brief Resamples interleaved stereo audio with linear interpolation.
   *
   * @param source Source interleaved stereo samples.
   * @param source_rate Source sample rate.
   * @param destination_rate Destination sample rate.
   * @return Resampled interleaved stereo samples.
   */
  std::vector<float> resample_stereo(const std::vector<float> &source, std::uint32_t source_rate, std::uint32_t destination_rate) {
    const auto source_frames = source.size() / 2;
    if (source_frames == 0 || source_rate == 0) {
      return {};
    }
    if (source_rate == destination_rate) {
      return source;
    }
    const auto destination_frames = static_cast<std::size_t>(
      std::llround(static_cast<double>(source_frames) * destination_rate / source_rate)
    );
    std::vector<float> destination(destination_frames * 2);
    const auto ratio = static_cast<double>(source_rate) / destination_rate;
    for (std::size_t frame = 0; frame < destination_frames; ++frame) {
      const auto source_position = static_cast<double>(frame) * ratio;
      const auto first = std::min(static_cast<std::size_t>(source_position), source_frames - 1);
      const auto second = std::min(first + 1, source_frames - 1);
      const auto fraction = static_cast<float>(source_position - first);
      for (std::size_t channel = 0; channel < 2; ++channel) {
        const auto first_value = source[first * 2 + channel];
        const auto second_value = source[second * 2 + channel];
        destination[frame * 2 + channel] = first_value + (second_value - first_value) * fraction;
      }
    }
    return destination;
  }

  /**
   * @brief Appends an unsigned integer in little-endian byte order.
   *
   * @tparam Value Unsigned integer type.
   * @param output Destination bytes.
   * @param value Integer to append.
   */
  template<typename Value>
  void append_little_endian(std::vector<std::uint8_t> &output, Value value) {
    for (std::size_t index = 0; index < sizeof(Value); ++index) {
      output.push_back(static_cast<std::uint8_t>((value >> (index * 8)) & 0xFF));
    }
  }

  /**
   * @brief Computes the Ogg page CRC checksum.
   *
   * @param bytes Complete page bytes with a zero checksum field.
   * @return Ogg CRC-32 value.
   */
  std::uint32_t ogg_crc(const std::vector<std::uint8_t> &bytes) {
    std::uint32_t checksum = 0;
    for (const auto byte : bytes) {
      checksum ^= static_cast<std::uint32_t>(byte) << 24;
      for (int bit = 0; bit < 8; ++bit) {
        checksum = (checksum & 0x80000000U) != 0 ? (checksum << 1) ^ 0x04C11DB7U : checksum << 1;
      }
    }
    return checksum;
  }

  /**
   * @brief Writes a minimal Ogg stream with one Opus packet per page.
   */
  class OggOpusWriter {
  public:
    /**
     * @brief Opens an Ogg Opus destination and writes identification metadata.
     *
     * @param path Destination path.
     * @param source_rate Original capture sample rate.
     * @param pre_skip Number of decoder samples to discard from the beginning.
     */
    OggOpusWriter(const std::filesystem::path &path, std::uint32_t source_rate, std::uint16_t pre_skip):
        stream_(path, std::ios::binary),
        serial_(static_cast<std::uint32_t>(GetTickCount64()) ^ GetCurrentProcessId()) {
      std::vector<std::uint8_t> head {'O', 'p', 'u', 's', 'H', 'e', 'a', 'd', 1, 2};
      append_little_endian<std::uint16_t>(head, pre_skip);
      append_little_endian<std::uint32_t>(head, source_rate);
      append_little_endian<std::uint16_t>(head, 0);
      head.push_back(0);
      write_page(head, 0, 0x02);

      const std::string vendor = "SenaiStream";
      std::vector<std::uint8_t> tags {'O', 'p', 'u', 's', 'T', 'a', 'g', 's'};
      append_little_endian<std::uint32_t>(tags, static_cast<std::uint32_t>(vendor.size()));
      tags.insert(tags.end(), vendor.begin(), vendor.end());
      append_little_endian<std::uint32_t>(tags, 0);
      write_page(tags, 0, 0);
    }

    /**
     * @brief Reports whether the destination stream is writable.
     *
     * @return True when the stream is ready.
     */
    [[nodiscard]] bool ready() const noexcept {
      return stream_.good();
    }

    /**
     * @brief Writes one encoded Opus packet.
     *
     * @param packet Encoded Opus bytes.
     * @param granule_position Total decoded 48 kHz samples including this packet.
     * @param final_packet Whether this is the final packet in the stream.
     * @return True when the page was written successfully.
     */
    bool write_packet(const std::vector<std::uint8_t> &packet, std::uint64_t granule_position, bool final_packet) {
      return write_page(packet, granule_position, final_packet ? 0x04 : 0);
    }

  private:
    /**
     * @brief Writes one complete Ogg page.
     *
     * @param packet Packet payload.
     * @param granule_position Ogg granule position.
     * @param header_type Ogg page flags.
     * @return True when the page was written successfully.
     */
    bool write_page(const std::vector<std::uint8_t> &packet, std::uint64_t granule_position, std::uint8_t header_type) {
      const auto full_segments = packet.size() / 255;
      const auto segment_count = full_segments + 1;
      if (segment_count > 255) {
        return false;
      }
      std::vector<std::uint8_t> page {'O', 'g', 'g', 'S', 0, header_type};
      append_little_endian<std::uint64_t>(page, granule_position);
      append_little_endian<std::uint32_t>(page, serial_);
      append_little_endian<std::uint32_t>(page, sequence_++);
      append_little_endian<std::uint32_t>(page, 0);
      page.push_back(static_cast<std::uint8_t>(segment_count));
      for (std::size_t segment = 0; segment < full_segments; ++segment) {
        page.push_back(255);
      }
      page.push_back(static_cast<std::uint8_t>(packet.size() % 255));
      page.insert(page.end(), packet.begin(), packet.end());
      const auto checksum = ogg_crc(page);
      for (std::size_t index = 0; index < 4; ++index) {
        page[22 + index] = static_cast<std::uint8_t>((checksum >> (index * 8)) & 0xFF);
      }
      stream_.write(reinterpret_cast<const char *>(page.data()), static_cast<std::streamsize>(page.size()));
      return stream_.good();
    }

    std::ofstream stream_;  ///< Binary Ogg destination.
    std::uint32_t serial_;  ///< Per-stream Ogg serial number.
    std::uint32_t sequence_ {};  ///< Next Ogg page sequence number.
  };

}  // namespace

namespace senaistream {

  std::string validate_audio_config(const AudioRecordConfig &config) {
    if (config.duration_seconds == 0 || config.duration_seconds > 86'400) {
      return "duration_seconds must be between 1 and 86400";
    }
    if (config.bitrate_bps < 16'000 || config.bitrate_bps > 512'000) {
      return "bitrate_bps must be between 16000 and 512000";
    }
    if (config.frame_duration_ms != 5 && config.frame_duration_ms != 10 && config.frame_duration_ms != 20) {
      return "frame_duration_ms must be 5, 10, or 20";
    }
    return {};
  }

  Status AudioRecorder::record(const AudioRecordConfig &config, const std::filesystem::path &output_path) const {
    const auto validation_error = validate_audio_config(config);
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

    ComPtr<IMMDeviceEnumerator> enumerator;
    auto result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(result)) {
      return failure("MMDeviceEnumerator creation", result);
    }
    ComPtr<IMMDevice> device;
    result = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    if (FAILED(result)) {
      return failure("GetDefaultAudioEndpoint", result);
    }
    ComPtr<IAudioClient> audio_client;
    result = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audio_client);
    if (FAILED(result)) {
      return failure("IAudioClient activation", result);
    }
    WAVEFORMATEX *raw_format = nullptr;
    result = audio_client->GetMixFormat(&raw_format);
    if (FAILED(result)) {
      return failure("GetMixFormat", result);
    }
    std::unique_ptr<WAVEFORMATEX, WaveFormatDeleter> format(raw_format);
    if (format->nChannels == 0 || format->nSamplesPerSec == 0 || format->nBlockAlign == 0 || sample_format(*format) == SampleKind::unsupported) {
      return Status::failure("the default playback endpoint uses an unsupported sample format");
    }

    result = audio_client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
      0,
      0,
      format.get(),
      nullptr
    );
    if (FAILED(result)) {
      return failure("IAudioClient::Initialize", result);
    }
    EventHandle event;
    if (event.get() == nullptr) {
      return Status::failure("CreateEventW failed");
    }
    result = audio_client->SetEventHandle(event.get());
    if (FAILED(result)) {
      return failure("SetEventHandle", result);
    }
    ComPtr<IAudioCaptureClient> capture_client;
    result = audio_client->GetService(IID_PPV_ARGS(&capture_client));
    if (FAILED(result)) {
      return failure("IAudioCaptureClient query", result);
    }
    result = audio_client->Start();
    if (FAILED(result)) {
      return failure("IAudioClient::Start", result);
    }

    std::vector<float> captured_samples;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(config.duration_seconds);
    while (std::chrono::steady_clock::now() < deadline) {
      WaitForSingleObject(event.get(), 100);
      for (;;) {
        UINT32 packet_frames = 0;
        result = capture_client->GetNextPacketSize(&packet_frames);
        if (FAILED(result)) {
          audio_client->Stop();
          return failure("GetNextPacketSize", result);
        }
        if (packet_frames == 0) {
          break;
        }
        BYTE *data = nullptr;
        DWORD flags = 0;
        result = capture_client->GetBuffer(&data, &packet_frames, &flags, nullptr, nullptr);
        if (FAILED(result)) {
          audio_client->Stop();
          return failure("IAudioCaptureClient::GetBuffer", result);
        }
        append_stereo((flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 ? nullptr : data, packet_frames, *format, captured_samples);
        result = capture_client->ReleaseBuffer(packet_frames);
        if (FAILED(result)) {
          audio_client->Stop();
          return failure("IAudioCaptureClient::ReleaseBuffer", result);
        }
      }
    }
    audio_client->Stop();

    auto samples = resample_stereo(captured_samples, format->nSamplesPerSec, 48'000);
    if (samples.empty()) {
      samples.resize(static_cast<std::size_t>(config.duration_seconds) * 48'000 * 2, 0.0F);
    }
    const auto frame_samples = static_cast<int>(48 * config.frame_duration_ms);
    const auto input_frame_count = samples.size() / 2;
    const auto total_frames = (input_frame_count + frame_samples - 1) / frame_samples;
    samples.resize(total_frames * static_cast<std::size_t>(frame_samples) * 2, 0.0F);

    int opus_error = OPUS_OK;
    OpusEncoder *raw_encoder = opus_encoder_create(48'000, 2, OPUS_APPLICATION_AUDIO, &opus_error);
    if (raw_encoder == nullptr || opus_error != OPUS_OK) {
      return Status::failure("opus_encoder_create failed: " + std::string(opus_strerror(opus_error)));
    }

    struct EncoderDeleter {
      /**
       * @brief Releases an Opus encoder.
       *
       * @param encoder Encoder to release.
       */
      void operator()(OpusEncoder *encoder) const noexcept {
        opus_encoder_destroy(encoder);
      }
    };

    std::unique_ptr<OpusEncoder, EncoderDeleter> encoder(raw_encoder);
    opus_error = opus_encoder_ctl(encoder.get(), OPUS_SET_BITRATE(static_cast<int>(config.bitrate_bps)));
    if (opus_error != OPUS_OK) {
      return Status::failure("OPUS_SET_BITRATE failed: " + std::string(opus_strerror(opus_error)));
    }
    opus_int32 lookahead = 0;
    opus_error = opus_encoder_ctl(encoder.get(), OPUS_GET_LOOKAHEAD(&lookahead));
    if (opus_error != OPUS_OK || lookahead < 0 || lookahead > std::numeric_limits<std::uint16_t>::max()) {
      return Status::failure("OPUS_GET_LOOKAHEAD failed");
    }

    const auto pre_skip = static_cast<std::uint16_t>(lookahead);
    OggOpusWriter writer(output_path, format->nSamplesPerSec, pre_skip);
    if (!writer.ready()) {
      return Status::failure("unable to open the Ogg Opus output file");
    }
    std::vector<std::uint8_t> packet(4'000);
    for (std::size_t frame = 0; frame < total_frames; ++frame) {
      const auto encoded_size = opus_encode_float(
        encoder.get(),
        samples.data() + frame * static_cast<std::size_t>(frame_samples) * 2,
        frame_samples,
        packet.data(),
        static_cast<opus_int32>(packet.size())
      );
      if (encoded_size < 0) {
        return Status::failure("opus_encode_float failed: " + std::string(opus_strerror(encoded_size)));
      }
      packet.resize(static_cast<std::size_t>(encoded_size));
      const auto consumed_frames = std::min((frame + 1) * static_cast<std::size_t>(frame_samples), input_frame_count);
      const auto granule_position = static_cast<std::uint64_t>(pre_skip) + consumed_frames;
      if (!writer.write_packet(packet, granule_position, frame + 1 == total_frames)) {
        return Status::failure("failed to write an Ogg Opus page");
      }
      packet.resize(4'000);
    }
    return Status::success();
  }

  Status AudioRecorder::stream_opus(
    const AudioRecordConfig &config,
    const std::atomic_bool &stop_requested,
    const EncodedPacketCallback &callback,
    const std::atomic_bool *restart_requested
  ) const {
    const auto validation_error = validate_audio_config(config);
    if (!validation_error.empty()) {
      return Status::failure(validation_error);
    }
    if (!callback) {
      return Status::failure("encoded audio callback must not be empty");
    }

    ComRuntime com;
    if (FAILED(com.result()) && com.result() != RPC_E_CHANGED_MODE) {
      return failure("CoInitializeEx", com.result());
    }
    ComPtr<IAudioClient> audio_client;
    WAVEFORMATEX *raw_format = nullptr;
    HRESULT result = S_OK;
    if (config.isolate_process) {
      result = activate_process_audio(config.process_id ? config.process_id : GetCurrentProcessId(), audio_client);
      if (FAILED(result)) {
        return failure("Process audio capture requires Windows build 20348 or newer", result);
      }
      raw_format = static_cast<WAVEFORMATEX *>(CoTaskMemAlloc(sizeof(WAVEFORMATEX)));
      if (!raw_format) {
        return failure("Allocating process audio format", E_OUTOFMEMORY);
      }
      *raw_format = WAVEFORMATEX {WAVE_FORMAT_PCM, 2, 48000, 192000, 4, 16, 0};
    } else {
      ComPtr<IMMDeviceEnumerator> enumerator;
      result = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
      if (FAILED(result)) {
        return failure("MMDeviceEnumerator creation", result);
      }
      ComPtr<IMMDevice> device;
      result = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
      if (FAILED(result)) {
        return failure("GetDefaultAudioEndpoint", result);
      }
      result = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &audio_client);
      if (FAILED(result)) {
        return failure("IAudioClient activation", result);
      }
      result = audio_client->GetMixFormat(&raw_format);
      if (FAILED(result)) {
        return failure("GetMixFormat", result);
      }
    }
    std::unique_ptr<WAVEFORMATEX, WaveFormatDeleter> format(raw_format);
    if (format->nChannels == 0 || format->nSamplesPerSec == 0 || format->nBlockAlign == 0 || sample_format(*format) == SampleKind::unsupported) {
      return Status::failure("the default playback endpoint uses an unsupported sample format");
    }
    result = audio_client->Initialize(
      AUDCLNT_SHAREMODE_SHARED,
      AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
      0,
      0,
      format.get(),
      nullptr
    );
    if (FAILED(result)) {
      return failure("IAudioClient::Initialize", result);
    }
    EventHandle event;
    if (event.get() == nullptr) {
      return Status::failure("CreateEventW failed");
    }
    result = audio_client->SetEventHandle(event.get());
    if (FAILED(result)) {
      return failure("SetEventHandle", result);
    }
    ComPtr<IAudioCaptureClient> capture_client;
    result = audio_client->GetService(IID_PPV_ARGS(&capture_client));
    if (FAILED(result)) {
      return failure("IAudioCaptureClient query", result);
    }

    int opus_error = OPUS_OK;
    OpusEncoder *raw_encoder = opus_encoder_create(48'000, 2, OPUS_APPLICATION_AUDIO, &opus_error);
    if (raw_encoder == nullptr || opus_error != OPUS_OK) {
      return Status::failure("opus_encoder_create failed: " + std::string(opus_strerror(opus_error)));
    }

    struct LiveEncoderDeleter {
      /**
       * @brief Releases a live Opus encoder.
       *
       * @param encoder Encoder to release.
       */
      void operator()(OpusEncoder *encoder) const noexcept {
        opus_encoder_destroy(encoder);
      }
    };

    std::unique_ptr<OpusEncoder, LiveEncoderDeleter> encoder(raw_encoder);
    opus_error = opus_encoder_ctl(encoder.get(), OPUS_SET_BITRATE(static_cast<int>(config.bitrate_bps)));
    if (opus_error == OPUS_OK) {
      opus_error = opus_encoder_ctl(encoder.get(), OPUS_SET_INBAND_FEC(1));
    }
    if (opus_error == OPUS_OK) {
      opus_error = opus_encoder_ctl(encoder.get(), OPUS_SET_PACKET_LOSS_PERC(10));
    }
    if (opus_error != OPUS_OK) {
      return Status::failure("configuring the live Opus encoder failed: " + std::string(opus_strerror(opus_error)));
    }

    result = audio_client->Start();
    if (FAILED(result)) {
      return failure("IAudioClient::Start", result);
    }
    const auto frame_samples = static_cast<int>(48 * config.frame_duration_ms);
    const auto frame_values = static_cast<std::size_t>(frame_samples) * 2;
    const auto packet_period = std::chrono::milliseconds(config.frame_duration_ms);
    const auto end_time = std::chrono::steady_clock::now() + std::chrono::seconds(config.duration_seconds);
    auto next_packet = std::chrono::steady_clock::now() + packet_period;
    std::vector<float> pending_samples;
    std::vector<std::uint8_t> encoded(4'000);
    std::uint32_t timestamp = 0;
    bool continue_stream = true;
    const auto interrupted = [&] {
      return stop_requested.load() || (restart_requested && restart_requested->load());
    };
    while (std::chrono::steady_clock::now() < end_time && !interrupted() && continue_stream) {
      const auto now = std::chrono::steady_clock::now();
      const auto wait_time = next_packet > now ?
                               std::min<std::chrono::milliseconds>(
                                 std::chrono::duration_cast<std::chrono::milliseconds>(next_packet - now),
                                 std::chrono::milliseconds(100)
                               ) :
                               std::chrono::milliseconds(0);
      WaitForSingleObject(event.get(), static_cast<DWORD>(wait_time.count()));
      for (;;) {
        UINT32 packet_frames = 0;
        result = capture_client->GetNextPacketSize(&packet_frames);
        if (FAILED(result)) {
          audio_client->Stop();
          return failure("GetNextPacketSize", result);
        }
        if (packet_frames == 0) {
          break;
        }
        BYTE *data = nullptr;
        DWORD flags = 0;
        result = capture_client->GetBuffer(&data, &packet_frames, &flags, nullptr, nullptr);
        if (FAILED(result)) {
          audio_client->Stop();
          return failure("IAudioCaptureClient::GetBuffer", result);
        }
        std::vector<float> source_packet;
        append_stereo(
          (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0 ? nullptr : data,
          packet_frames,
          *format,
          source_packet
        );
        result = capture_client->ReleaseBuffer(packet_frames);
        if (FAILED(result)) {
          audio_client->Stop();
          return failure("IAudioCaptureClient::ReleaseBuffer", result);
        }
        auto resampled = resample_stereo(source_packet, format->nSamplesPerSec, 48'000);
        pending_samples.insert(pending_samples.end(), resampled.begin(), resampled.end());
      }

      auto current_time = std::chrono::steady_clock::now();
      while (current_time >= next_packet && continue_stream && !interrupted()) {
        std::vector<float> frame(frame_values, 0.0F);
        const auto available = std::min(frame_values, pending_samples.size());
        std::copy_n(pending_samples.begin(), available, frame.begin());
        pending_samples.erase(pending_samples.begin(), pending_samples.begin() + static_cast<std::ptrdiff_t>(available));
        const auto encoded_size = opus_encode_float(
          encoder.get(),
          frame.data(),
          frame_samples,
          encoded.data(),
          static_cast<opus_int32>(encoded.size())
        );
        if (encoded_size < 0) {
          audio_client->Stop();
          return Status::failure("opus_encode_float failed: " + std::string(opus_strerror(encoded_size)));
        }
        continue_stream = callback(
          std::span<const std::uint8_t>(encoded.data(), static_cast<std::size_t>(encoded_size)),
          timestamp
        );
        timestamp += static_cast<std::uint32_t>(frame_samples);
        next_packet += packet_period;
        current_time = std::chrono::steady_clock::now();
      }
    }
    audio_client->Stop();
    return Status::success();
  }

}  // namespace senaistream
