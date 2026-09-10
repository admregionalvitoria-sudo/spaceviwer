#include "senaistream/audio_recorder.hpp"
#include "senaistream/audio_output.hpp"
// clang-format off
#include <windows.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>
// clang-format on
#include <gtest/gtest.h>
#include <opus.h>
#include <cmath>
#include <filesystem>
#include <thread>
#include <vector>

namespace {
  /** @brief A test-owned playback process; no other process can be stopped by this owner. */
  struct Tone {
    PROCESS_INFORMATION process {};  ///< Child handles.

    /** @brief Starts the sibling test tone program. @param frequency Tone in Hz. */
    explicit Tone(int frequency) {
      wchar_t executable[MAX_PATH] {};
      GetModuleFileNameW(nullptr, executable, MAX_PATH);
      const auto path = std::filesystem::path(executable).parent_path() / "test_audio_source.exe";
      std::wstring command = L"\"" + path.wstring() + L"\" " + std::to_wstring(frequency);
      STARTUPINFOW startup {};
      startup.cb = sizeof(startup);
      if (!CreateProcessW(path.c_str(), command.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &startup, &process)) {
        process = {};
      }
    }

    /** @brief Stops only this test child before restoring the physical output. */
    ~Tone() {
      if (process.hProcess) {
        TerminateProcess(process.hProcess, 0);
        WaitForSingleObject(process.hProcess, 2000);
        CloseHandle(process.hProcess);
        CloseHandle(process.hThread);
      }
    }
  };

  /** @brief Measures one tone's spectral energy. @param values Stereo PCM. @param frequency Target frequency. @return Squared amplitude. */
  double energy(const std::vector<float> &values, double frequency) {
    double real = 0, imag = 0;
    for (std::size_t i = 0; i < values.size() / 2; ++i) {
      const auto phase = 6.283185307179586 * frequency * i / 48000;
      real += values[i * 2] * std::cos(phase);
      imag += values[i * 2] * std::sin(phase);
    }
    return real * real + imag * imag;
  }

  TEST(ProcessAudio, SeparatesTwoApplicationsAndRestoresLocalOutput) {
    if (!std::getenv("SPACEVIEWER_TEST_AUDIO")) {
      GTEST_SKIP() << "Set SPACEVIEWER_TEST_AUDIO=1 for real process-audio validation";
    }
    senaistream::AudioOutput output;
    ASSERT_TRUE(output.available());
    const auto route = output.update(true);
    ASSERT_TRUE(route.ok()) << route.message();
    ASSERT_TRUE(output.active());
    {
      Tone first(440), second(880);
      ASSERT_NE(first.process.dwProcessId, 0u);
      ASSERT_NE(second.process.dwProcessId, 0u);
      std::vector<float> samples[2];
      std::string failures[2];
      const auto capture = [&](int index, DWORD pid) {
        int error = 0;
        auto *decoder = opus_decoder_create(48000, 2, &error);
        if (!decoder) {
          failures[index] = "decoder";
          return;
        }
        senaistream::AudioRecordConfig config;
        config.isolate_process = true;
        config.process_id = pid;
        config.duration_seconds = 3;
        config.frame_duration_ms = 5;
        std::atomic_bool stop {};
        const auto status = senaistream::AudioRecorder().stream_opus(config, stop, [&](std::span<const std::uint8_t> packet, std::uint32_t) {
          float decoded[5760 * 2];
          const auto count = opus_decode_float(decoder, packet.data(), static_cast<opus_int32>(packet.size()), decoded, 5760, 0);
          if (count > 0) {
            samples[index].insert(samples[index].end(), decoded, decoded + count * 2);
          }
          return true;
        });
        if (!status.ok()) {
          failures[index] = status.message();
        }
        opus_decoder_destroy(decoder);
      };
      std::thread a(capture, 0, first.process.dwProcessId), b(capture, 1, second.process.dwProcessId);
      a.join();
      b.join();
      EXPECT_TRUE(failures[0].empty()) << failures[0];
      EXPECT_TRUE(failures[1].empty()) << failures[1];
      ASSERT_GT(samples[0].size(), 48000u);
      ASSERT_GT(samples[1].size(), 48000u);
      const auto a440 = energy(samples[0], 440), a880 = energy(samples[0], 880), b440 = energy(samples[1], 440), b880 = energy(samples[1], 880);
      EXPECT_GT(a440, 100.0);
      EXPECT_GT(b880, 100.0);
      EXPECT_GT(a440, 20 * a880);
      EXPECT_GT(b880, 20 * b440);
    }
    EXPECT_TRUE(output.update(false).ok());
    EXPECT_FALSE(output.active());
  }
}  // namespace
