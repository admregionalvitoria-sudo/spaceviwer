#pragma once

#include <cstdint>
#include <string>

namespace senaistream {

  /**
   * @brief Identifies a video codec supported by the recording pipeline.
   */
  enum class VideoCodec {
    h264,  ///< H.264/AVC video.
    hevc,  ///< H.265/HEVC video.
  };

  /**
   * @brief Describes one desktop output exposed by DXGI.
   */
  struct DisplayInfo {
    std::uint32_t index {};  ///< Stable index for the current enumeration.
    std::string name;  ///< UTF-8 device name reported by Windows.
    std::string device_name;  ///< GDI source name used for Windows display-mode changes.
    std::uint32_t width {};  ///< Desktop width in physical pixels.
    std::uint32_t height {};  ///< Desktop height in physical pixels.
    bool primary {};  ///< Whether the display contains desktop coordinate zero.
    bool virtual_display {};  ///< Whether Windows reports an indirect or virtual monitor.
    std::int32_t desktop_left {};  ///< Left coordinate in the Windows virtual desktop.
    std::int32_t desktop_top {};  ///< Top coordinate in the Windows virtual desktop.
  };

  /**
   * @brief Configures a finite local video recording.
   */
  struct VideoRecordConfig {
    std::uint32_t display_index {};  ///< Display index returned by enumeration.
    std::uint32_t width {};  ///< Output width, or zero to use capture width.
    std::uint32_t height {};  ///< Output height, or zero to use capture height.
    std::uint32_t frames_per_second {60};  ///< Target frame rate.
    std::uint32_t bitrate_bps {15'000'000};  ///< Target compressed bitrate.
    std::uint32_t duration_seconds {10};  ///< Recording duration.
    VideoCodec codec {VideoCodec::h264};  ///< Requested compressed video codec.
    bool prefer_hardware {true};  ///< Whether hardware Media Foundation transforms are preferred.
  };

  /**
   * @brief Validates a video recording configuration without accessing hardware.
   *
   * @param config Configuration to validate.
   * @return Empty text when valid or a human-readable validation error.
   */
  [[nodiscard]] std::string validate_video_config(const VideoRecordConfig &config);

}  // namespace senaistream
