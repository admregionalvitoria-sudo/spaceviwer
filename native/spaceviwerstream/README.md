# SenaiStream

SenaiStream is an independent Windows game-streaming host for Moonlight clients. It does not install, execute, or link to Sunshine.

## Install and use

Run `SenaiStream-Setup.exe` as administrator. The installer registers the Windows service, installs the native desktop console and tray application, creates shortcuts, opens the required local-network firewall ports, and installs a signed indirect-display driver that creates an additional Windows monitor.

The service launches the interactive host in the signed-in user's desktop session. Open the SenaiStream desktop console from the shortcut or tray icon. In Moonlight on the phone, add the LAN address displayed in the console, select **Desktop**, and enter the four-digit PIN when prompted.

`SenaiStreamUI.exe` is a native Windows window with an embedded, light glassmorphic management experience and bottom navigation; it does not open an external browser. Its internal control endpoint remains loopback-only at `127.0.0.1:47990`. The console controls the monitor, resolution, frame rate, H.264 bitrate, hardware-encoder preference, display topology, and Moonlight pairing. Video settings are reapplied inside an active session without reconnecting. Settings are stored in `%LOCALAPPDATA%\SenaiStream\settings.ini`. Closing the console leaves the background host active.

## Extended virtual display

Setup 0.4.0 installs the independently distributed, signed Virtual Display Driver 25.7.23. Windows sees it as another monitor. The native console can switch between extended and duplicated topology while Moonlight remains connected; the host restarts only its video capture pipeline and keeps the control/audio session alive. In extended mode SenaiStream chooses the virtual monitor and requests the resolution and refresh rate negotiated by the client. The physical screen remains available for local work.

If Windows reports that a restart is required, restart once before streaming. The uninstaller removes the virtual device and its driver package.

## Network ports

- TCP 47984: paired GameStream control over TLS.
- TCP 47989: discovery and pairing.
- TCP 48010: RTSP stream negotiation.
- UDP 47998: video.
- UDP 47999: reliable ENet control and input.
- UDP 48000: Opus audio.
- UDP 48010: input/connectivity compatibility.

The installer creates inbound Windows Firewall rules for these ports for local-subnet devices only. This works whether Windows labels the Wi-Fi as public or private without exposing the host beyond the local network.

## Low-latency profile

Live H.264 enables the Media Foundation low-latency and real-time codec properties, requests low-delay rate control with no B-frame reordering, prioritizes encoding speed, and runs the video producer at high thread priority. Capture-to-NV12 conversion has dedicated equal-size and cached scaling paths. For a balanced phone test, start with 1920x1080, 60 FPS, hardware encoding, and 20 Mbps; raise bitrate only after latency is stable.

## Build

From the repository root, using the required MSYS2 UCRT64 environment:

```powershell
C:\msys64\msys2_shell.cmd -defterm -here -no-start -ucrt64 -c "cmake -S SenaiStream -B cmake-build-senaistream-persist -G Ninja"
C:\msys64\msys2_shell.cmd -defterm -here -no-start -ucrt64 -c "cmake --build cmake-build-senaistream-persist"
C:\msys64\msys2_shell.cmd -defterm -here -no-start -ucrt64 -c "ctest --test-dir cmake-build-senaistream-persist --output-on-failure"
C:\msys64\msys2_shell.cmd -defterm -here -no-start -ucrt64 -c "makensis SenaiStream/installer/SenaiStream.nsi"
```

The MinGW runtime, OpenSSL, Opus, and ENet are statically linked. The installer includes the Microsoft WebView2 loader and official Evergreen Runtime bootstrapper for the native console. The virtual monitor is a separately attributed signed third-party driver; see `THIRD_PARTY_NOTICES.md`.

## Diagnostic commands

```powershell
cmake-build-senaistream-persist\SenaiStream.exe --list-displays
cmake-build-senaistream-persist\SenaiStream.exe --record-video capture.mp4 --display 0 --seconds 10 --fps 60 --bitrate 30000000 --codec h264
cmake-build-senaistream-persist\SenaiStream.exe --record-audio system-audio.opus --seconds 10 --bitrate 192000 --frame-ms 20
```

Finite local recording supports H.264 and HEVC when the corresponding Windows Media Foundation encoder is installed. The current interoperable live profile intentionally advertises H.264 only, maximizing compatibility while the live HEVC profile remains outside this tested release.

## Current validation

Automated tests cover configuration, pairing identity persistence, GameStream responses, RTSP responses, and audio/video packet framing. A desktop Moonlight client completed discovery, PIN pairing, launch negotiation, and received live H.264 and Opus packets. Final visual, audio, and input validation on the target phone and network remains a real-device acceptance test.
