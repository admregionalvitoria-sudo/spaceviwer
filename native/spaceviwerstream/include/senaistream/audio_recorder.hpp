#pragma once

#include "senaistream/status.hpp"

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <span>
#include <string>

namespace senaistream {

  /**
   * @brief Configures a finite system-audio recording.
   */
  struct AudioRecordConfig {
    bool isolate_process {false};  ///< Capture only the selected process tree; zero PID yields silence.
    std::uint32_t process_id {};  ///< Included application process tree.
    std::wstring endpoint_id;  ///< Explicit shared capture endpoint; empty uses default render loopback.
    bool endpoint_capture {};  ///< Endpoint is the cable's recording side, not a render loopback.
    std::function<void(float)> on_peak;  ///< Optional captured PCM peak, before encoding.
    std::uint32_t duration_seconds {10};  ///< Recording duration.
    std::uint32_t bitrate_bps {192'000};  ///< Target Opus bitrate.
    std::uint32_t frame_duration_ms {20};  ///< Opus frame duration in milliseconds.
  };

  /**
   * @brief Validates an audio recording configuration without accessing hardware.
   *
   * @param config Configuration to validate.
   * @return Empty text when valid or a human-readable validation error.
   */
  [[nodiscard]] std::string validate_audio_config(const AudioRecordConfig &config);

  /**
   * @brief Captures the default Windows playback endpoint and writes Ogg Opus audio.
   */
  class AudioRecorder {
  public:
    /**
     * @brief Callback invoked for each encoded Opus packet.
     *
     * Returning false requests an orderly end to the live capture loop.
     */
    using EncodedPacketCallback =
      std::function<bool(std::span<const std::uint8_t> opus, std::uint32_t timestamp_48khz)>;

    /**
     * @brief Records a finite loopback-audio stream.
     *
     * @param config Capture and encoding settings.
     * @param output_path Destination Ogg Opus file.
     * @return Operation status including a failure description when applicable.
     */
    [[nodiscard]] Status record(const AudioRecordConfig &config, const std::filesystem::path &output_path) const;

    /**
     * @brief Captures and encodes system audio for immediate network delivery.
     *
     * @param config Capture and Opus encoding settings. Duration is a safety limit.
     * @param stop_requested Cooperative cancellation flag.
     * @param restart_requested Optional request to reopen capture for a new process.
     * @param callback Consumer called synchronously for each encoded Opus packet.
     * @return Operation status.
     */
    [[nodiscard]] Status stream_opus(
      const AudioRecordConfig &config,
      const std::atomic_bool &stop_requested,
      const EncodedPacketCallback &callback,
      const std::atomic_bool *restart_requested = nullptr
    ) const;
  };

}  // namespace senaistream
