#pragma once

#include "senaistream/status.hpp"
#include "senaistream/video_types.hpp"

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <span>

namespace senaistream {

  /**
   * @brief Captures a Windows desktop output and writes compressed video to an MP4 file.
   */
  class VideoRecorder {
  public:
    /**
     * @brief Callback invoked for each encoded H.264 access unit.
     *
     * Returning false requests an orderly end to the live encoding loop.
     */
    using EncodedFrameCallback =
      std::function<bool(std::span<const std::uint8_t> annex_b, bool key_frame, std::uint64_t timestamp_100ns)>;

    /**
     * @brief Records a finite desktop video.
     *
     * @param config Capture and encoding settings.
     * @param output_path Destination MP4 file.
     * @return Operation status including a failure description when applicable.
     */
    [[nodiscard]] Status record(const VideoRecordConfig &config, const std::filesystem::path &output_path) const;

    /**
     * @brief Captures and encodes desktop frames for immediate network delivery.
     *
     * @param config Capture and H.264 encoding settings. Duration is a safety limit.
     * @param stop_requested Cooperative cancellation flag.
     * @param restart_requested Optional capture-only interruption, leaving the client connection alive.
     * @param callback Consumer called synchronously for each encoded access unit.
     * @return Operation status.
     */
    [[nodiscard]] Status stream_h264(
      const VideoRecordConfig &config,
      const std::atomic_bool &stop_requested,
      const EncodedFrameCallback &callback,
      const std::atomic_bool *restart_requested = nullptr
    ) const;
  };

}  // namespace senaistream
