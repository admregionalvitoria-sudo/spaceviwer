#include <windows.h>
#include <mmsystem.h>
#include <cmath>
#include <cstdlib>
#include <vector>

/** @brief Plays a deterministic tone from its own process for isolation tests. @param argc Argument count. @param argv Frequency. @return Exit code. */
int main(int argc, char **argv) {
  const double frequency = argc > 1 ? std::atof(argv[1]) : 440.0;
  WAVEFORMATEX format {WAVE_FORMAT_PCM, 2, 48000, 192000, 4, 16, 0};
  HWAVEOUT output {};
  if (waveOutOpen(&output, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
    return 1;
  }
  std::vector<short> samples(48000 * 2 * 10);
  for (std::size_t i = 0; i < samples.size() / 2; ++i) {
    samples[i * 2] = samples[i * 2 + 1] = static_cast<short>(2000 * std::sin(6.283185307179586 * frequency * i / 48000));
  }
  WAVEHDR buffer {};
  buffer.lpData = reinterpret_cast<char *>(samples.data());
  buffer.dwBufferLength = static_cast<DWORD>(samples.size() * sizeof(short));
  waveOutPrepareHeader(output, &buffer, sizeof(buffer));
  waveOutWrite(output, &buffer, sizeof(buffer));
  while (!(buffer.dwFlags & WHDR_DONE)) {
    Sleep(20);
  }
  waveOutUnprepareHeader(output, &buffer, sizeof(buffer));
  waveOutClose(output);
  return 0;
}
