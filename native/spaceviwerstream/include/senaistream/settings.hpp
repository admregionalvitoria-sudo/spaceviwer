#pragma once

#include "senaistream/status.hpp"
#include "senaistream/video_types.hpp"

#include <cstdint>
#include <filesystem>
#include <mutex>
#include <string>

namespace senaistream {

  /**
   * @brief User-controlled defaults applied to each new streaming session.
   */
  struct StreamSettings {
    std::uint32_t display_index {};  ///< DXGI output index.
    std::uint32_t width {};  ///< Override width, or zero to use the client request.
    std::uint32_t height {};  ///< Override height, or zero to use the client request.
    std::uint32_t frames_per_second {};  ///< Override FPS, or zero to use the client request.
    std::uint32_t bitrate_bps {30'000'000};  ///< Target compressed-video bitrate.
    VideoCodec codec {VideoCodec::h264};  ///< Preferred video codec.
    bool prefer_hardware {true};  ///< Whether hardware transforms are attempted first.
    bool prefer_virtual_display {true};  ///< Whether a detected virtual monitor overrides the selected physical output.
  };

  /**
   * @brief Validates settings without accessing the filesystem or capture hardware.
   *
   * @param settings Settings to validate.
   * @return Empty text when valid or a human-readable error.
   */
  [[nodiscard]] std::string validate_stream_settings(const StreamSettings &settings);

  /**
   * @brief Thread-safe persistent stream-settings repository.
   */
  class SettingsStore {
  public:
    /**
     * @brief Creates a store at the standard per-user location.
     */
    SettingsStore();

    /**
     * @brief Creates a store at an explicit location, primarily for tests.
     *
     * @param path Settings file path.
     */
    explicit SettingsStore(std::filesystem::path path);

    /**
     * @brief Loads existing settings or writes defaults on first use.
     *
     * @return Operation status.
     */
    [[nodiscard]] Status initialize();

    /**
     * @brief Returns a consistent snapshot of current settings.
     *
     * @return Settings snapshot.
     */
    [[nodiscard]] StreamSettings current() const;

    /**
     * @brief Validates, persists, and publishes new settings.
     *
     * @param settings Replacement settings.
     * @return Operation status.
     */
    [[nodiscard]] Status update(const StreamSettings &settings);

  private:
    /**
     * @brief Writes one snapshot while the caller owns the store lock.
     *
     * @param settings Snapshot to persist.
     * @return Operation status.
     */
    [[nodiscard]] Status write_locked(const StreamSettings &settings) const;

    std::filesystem::path path_;  ///< Persistent INI-style settings file.
    mutable std::mutex mutex_;  ///< Guards the in-memory snapshot and file update.
    StreamSettings settings_;  ///< Last successfully persisted settings.
  };

}  // namespace senaistream
