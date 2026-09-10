#include "senaistream/settings.hpp"

#include <charconv>
#include <cstdlib>
#include <fstream>
#include <string_view>
#include <system_error>
#include <utility>
#include <windows.h>

namespace {

  /**
   * @brief Returns the standard per-user settings file.
   *
   * @return Settings path below LocalAppData.
   */
  std::filesystem::path default_settings_path() {
    if (const auto *state = std::getenv("SPACEVIEWER_DATA_DIR")) {
      return std::filesystem::path(state) / "settings.ini";
    }
    if (const auto *local_app_data = std::getenv("LOCALAPPDATA")) {
      return std::filesystem::path(local_app_data) / "SpaceViewer" / "settings.ini";
    }
    return std::filesystem::current_path() / "settings.ini";
  }

  /**
   * @brief Parses an unsigned decimal value.
   *
   * @param text Input text.
   * @param value Receives the number.
   * @return True when all characters were consumed.
   */
  bool parse_number(std::string_view text, std::uint32_t &value) {
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    return result.ec == std::errc {} && result.ptr == text.data() + text.size();
  }

}  // namespace

namespace senaistream {

  std::string validate_stream_settings(const StreamSettings &settings) {
    if ((settings.width == 0) != (settings.height == 0)) {
      return "width and height must both be automatic or both be specified";
    }
    if (settings.width != 0 && (settings.width < 320 || settings.width > 7680 || settings.height < 240 || settings.height > 4320 || settings.width % 2 != 0 || settings.height % 2 != 0)) {
      return "manual resolution must be even and between 320x240 and 7680x4320";
    }
    if (settings.frames_per_second > 240) {
      return "frames per second must be automatic or between 1 and 240";
    }
    if (settings.bitrate_bps < 1'000'000 || settings.bitrate_bps > 200'000'000) {
      return "bitrate must be between 1 and 200 Mbps";
    }
    return {};
  }

  SettingsStore::SettingsStore():
      SettingsStore(default_settings_path()) {
  }

  SettingsStore::SettingsStore(std::filesystem::path path):
      path_(std::move(path)) {
  }

  Status SettingsStore::initialize() {
    std::scoped_lock lock(mutex_);
    std::ifstream input(path_);
    if (!input) {
      return write_locked(settings_);
    }
    StreamSettings loaded;
    std::string line;
    while (std::getline(input, line)) {
      const auto equals = line.find('=');
      if (equals == std::string::npos) {
        continue;
      }
      const std::string_view name(line.data(), equals);
      const std::string_view value(line.data() + equals + 1, line.size() - equals - 1);
      if (name == "display") {
        parse_number(value, loaded.display_index);
      } else if (name == "width") {
        parse_number(value, loaded.width);
      } else if (name == "height") {
        parse_number(value, loaded.height);
      } else if (name == "fps") {
        parse_number(value, loaded.frames_per_second);
      } else if (name == "bitrate") {
        parse_number(value, loaded.bitrate_bps);
      } else if (name == "codec") {
        loaded.codec = value == "hevc" ? VideoCodec::hevc : VideoCodec::h264;
      } else if (name == "hardware") {
        loaded.prefer_hardware = value != "0";
      } else if (name == "virtual_display") {
        loaded.prefer_virtual_display = value != "0";
      }
    }
    const auto validation_error = validate_stream_settings(loaded);
    if (!validation_error.empty()) {
      return Status::failure("invalid saved stream settings: " + validation_error);
    }
    settings_ = loaded;
    return Status::success();
  }

  StreamSettings SettingsStore::current() const {
    std::scoped_lock lock(mutex_);
    return settings_;
  }

  Status SettingsStore::update(const StreamSettings &settings) {
    const auto validation_error = validate_stream_settings(settings);
    if (!validation_error.empty()) {
      return Status::failure(validation_error);
    }
    std::scoped_lock lock(mutex_);
    const auto status = write_locked(settings);
    if (status.ok()) {
      settings_ = settings;
    }
    return status;
  }

  Status SettingsStore::write_locked(const StreamSettings &settings) const {
    std::error_code error;
    std::filesystem::create_directories(path_.parent_path(), error);
    if (error) {
      return Status::failure("unable to create settings directory: " + error.message());
    }
    auto temporary = path_;
    temporary += ".tmp";
    {
      std::ofstream output(temporary, std::ios::trunc);
      if (!output) {
        return Status::failure("unable to open temporary settings file");
      }
      output << "display=" << settings.display_index << '\n'
             << "width=" << settings.width << '\n'
             << "height=" << settings.height << '\n'
             << "fps=" << settings.frames_per_second << '\n'
             << "bitrate=" << settings.bitrate_bps << '\n'
             << "codec=" << (settings.codec == VideoCodec::hevc ? "hevc" : "h264") << '\n'
             << "hardware=" << (settings.prefer_hardware ? 1 : 0) << '\n'
             << "virtual_display=" << (settings.prefer_virtual_display ? 1 : 0) << '\n';
      if (!output) {
        return Status::failure("unable to write temporary settings file");
      }
    }
    std::filesystem::remove(path_, error);
    error.clear();
    std::filesystem::rename(temporary, path_, error);
    if (error) {
      return Status::failure("unable to replace settings file: " + error.message());
    }
    return Status::success();
  }

}  // namespace senaistream
