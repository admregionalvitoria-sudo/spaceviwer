#include "senaistream/audio_recorder.hpp"
#include "senaistream/audio_output.hpp"
#include "senaistream/display_catalog.hpp"
#include "senaistream/gamestream_host.hpp"
#include "senaistream/video_recorder.hpp"

#include <windows.h>
#include <shellapi.h>

#include <charconv>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>
#include <string_view>
#include <thread>

namespace {

  /**
   * @brief Opens the installed native management console.
   */
  void open_management_app() {
    std::wstring path(32768, L'\0');
    const auto size = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    if (size != 0 && size < path.size()) {
      path.resize(size);
      const auto ui_path = std::filesystem::path(path).parent_path() / L"SenaiStreamUI.exe";
      if (std::filesystem::exists(ui_path)) {
        ShellExecuteW(nullptr, L"open", ui_path.c_str(), nullptr, ui_path.parent_path().c_str(), SW_SHOWNORMAL);
        return;
      }
    }
    ShellExecuteW(nullptr, L"open", L"http://127.0.0.1:47990/", nullptr, nullptr, SW_SHOWNORMAL);
  }

  /**
   * @brief Prints command-line usage.
   */
  void print_usage() {
    std::cout << "SenaiStream local media prototype\n\n"
              << "  SenaiStream --list-displays\n"
              << "  SenaiStream --record-video FILE [--display N] [--seconds N] [--fps N]\n"
              << "              [--bitrate BPS] [--width PX --height PX] [--codec h264|hevc]\n"
              << "              [--software]\n"
              << "  SenaiStream --record-audio FILE [--seconds N] [--bitrate BPS] [--frame-ms 5|10|20]\n"
              << "  SenaiStream --host\n"
              << "  SenaiStream --dashboard\n";
  }

  /**
   * @brief Parses an unsigned 32-bit integer.
   *
   * @param text Text to parse.
   * @param value Receives the parsed value.
   * @return True when the entire input is a valid number.
   */
  bool parse_u32(std::string_view text, std::uint32_t &value) {
    const auto result = std::from_chars(text.data(), text.data() + text.size(), value);
    return result.ec == std::errc {} && result.ptr == text.data() + text.size();
  }

}  // namespace

/**
 * @brief Runs the SenaiStream command-line prototype.
 *
 * @param argument_count Number of command-line arguments.
 * @param arguments Command-line argument array.
 * @return Zero on success or a non-zero process exit code on failure.
 */
int main(int argument_count, char **arguments) {
  if (argument_count == 2 && std::string_view(arguments[1]) == "--restore-audio") {
    senaistream::AudioOutput output;
    return output.update(false).ok() ? 0 : 1;
  }
  if (argument_count == 2 && std::string_view(arguments[1]) == "--list-displays") {
    senaistream::DisplayCatalog catalog;
    std::string error;
    const auto displays = catalog.enumerate(error);
    if (!error.empty()) {
      std::cerr << error << '\n';
      return 2;
    }
    for (const auto &display : displays) {
      std::cout << display.index << "\t" << display.name << "\t" << display.device_name << "\t" << display.width
                << 'x' << display.height
                << (display.primary ? "\tprimary" : "") << (display.virtual_display ? "\tvirtual" : "") << '\n';
    }
    return 0;
  }

  if (argument_count == 2 && (std::string_view(arguments[1]) == "--host" || std::string_view(arguments[1]) == "--dashboard")) {
    const bool open_dashboard = std::string_view(arguments[1]) == "--dashboard";
    std::thread dashboard_opener;
    if (open_dashboard) {
      dashboard_opener = std::thread([]() {
        std::this_thread::sleep_for(std::chrono::milliseconds(600));
        open_management_app();
      });
    }
    senaistream::GameStreamHost host(senaistream::default_host_identity());
    const auto status = host.run();
    if (dashboard_opener.joinable()) {
      dashboard_opener.join();
    }
    if (!status.ok()) {
      std::cerr << status.message() << '\n';
      return 2;
    }
    return 0;
  }

  if (argument_count < 3 || (std::string_view(arguments[1]) != "--record-video" && std::string_view(arguments[1]) != "--record-audio")) {
    print_usage();
    return argument_count == 1 ? 0 : 1;
  }

  const bool audio_mode = std::string_view(arguments[1]) == "--record-audio";
  senaistream::VideoRecordConfig config;
  senaistream::AudioRecordConfig audio_config;
  const std::filesystem::path output_path = arguments[2];
  for (int index = 3; index < argument_count; ++index) {
    const std::string_view option = arguments[index];
    if (option == "--software") {
      if (audio_mode) {
        std::cerr << "Option --software is only valid for video recording\n";
        return 1;
      }
      config.prefer_hardware = false;
      continue;
    }
    if (index + 1 >= argument_count) {
      std::cerr << "Missing value for " << option << '\n';
      return 1;
    }
    const std::string_view value = arguments[++index];
    bool parsed = true;
    if (option == "--display") {
      if (audio_mode) {
        std::cerr << "Option --display is only valid for video recording\n";
        return 1;
      }
      parsed = parse_u32(value, config.display_index);
    } else if (option == "--seconds") {
      parsed = audio_mode ? parse_u32(value, audio_config.duration_seconds) : parse_u32(value, config.duration_seconds);
    } else if (option == "--fps") {
      if (audio_mode) {
        std::cerr << "Option --fps is only valid for video recording\n";
        return 1;
      }
      parsed = parse_u32(value, config.frames_per_second);
    } else if (option == "--bitrate") {
      parsed = audio_mode ? parse_u32(value, audio_config.bitrate_bps) : parse_u32(value, config.bitrate_bps);
    } else if (option == "--width") {
      if (audio_mode) {
        std::cerr << "Option --width is only valid for video recording\n";
        return 1;
      }
      parsed = parse_u32(value, config.width);
    } else if (option == "--height") {
      if (audio_mode) {
        std::cerr << "Option --height is only valid for video recording\n";
        return 1;
      }
      parsed = parse_u32(value, config.height);
    } else if (option == "--frame-ms" && audio_mode) {
      parsed = parse_u32(value, audio_config.frame_duration_ms);
    } else if (option == "--codec") {
      if (audio_mode) {
        std::cerr << "Option --codec is only valid for video recording\n";
        return 1;
      }
      if (value == "h264") {
        config.codec = senaistream::VideoCodec::h264;
      } else if (value == "hevc") {
        config.codec = senaistream::VideoCodec::hevc;
      } else {
        parsed = false;
      }
    } else {
      std::cerr << "Unknown option: " << option << '\n';
      return 1;
    }
    if (!parsed) {
      std::cerr << "Invalid value for " << option << ": " << value << '\n';
      return 1;
    }
  }

  std::cout << "Recording " << (audio_mode ? "system audio" : "desktop video") << " to " << output_path.string() << "...\n";
  const auto status = audio_mode ? senaistream::AudioRecorder().record(audio_config, output_path) :
                                   senaistream::VideoRecorder().record(config, output_path);
  if (!status.ok()) {
    std::cerr << status.message() << '\n';
    return 2;
  }
  std::cout << "Recording completed.\n";
  return 0;
}
