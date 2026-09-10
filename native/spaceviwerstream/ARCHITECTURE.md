# SenaiStream architecture

## Decision record

SenaiStream uses C++20 and CMake. Native C++ gives direct access to DXGI, D3D11, WASAPI, Media Foundation, Windows service/session APIs, and low-latency sockets without a managed interop layer. The final package is generated with NSIS and needs no Node.js or Sunshine runtime.

## Module diagram

```text
Windows service
    -> active-user tray host
        -> signed indirect-display device -> extended Windows desktop
        -> loopback management API (127.0.0.1:47990)
        -> native SenaiStreamUI.exe -> embedded WebView2 glass interface
        -> settings store (%LOCALAPPDATA%\SenaiStream)
        -> GameStream HTTP/TLS + certificate/PIN pairing
        -> RTSP session negotiation
        -> DXGI capture -> BGRA/NV12 -> Media Foundation H.264 -> video UDP
        -> WASAPI loopback -> resample -> Opus -> encrypted audio UDP
        -> encrypted ENet control -> Win32 keyboard/mouse input
```

## Components and contracts

### Display and video

`DisplayCatalog` combines DXGI output enumeration with `QueryDisplayConfig`, exposing the GDI source name, friendly name, dimensions, primary state, and indirect-display status. Setup installs a signed, root-enumerated UMDF indirect-display device. `SenaiStreamDisplayCtl` creates/removes that device and asks Windows for the extended topology. At stream start the host prefers the virtual output and applies the client's resolution and refresh rate before Desktop Duplication opens it.

`VideoRecorder` uses Desktop Duplication, recovers lost duplication sessions, converts captured BGRA frames to NV12, and activates Media Foundation video transforms. Live streaming prefers an installed hardware encoder and retries with the Windows software encoder when needed. The encoder is configured for low-delay rate control, no frame reordering, real-time priority, and the fastest supported quality/speed tradeoff. Equal-size BGRA-to-NV12 conversion uses a division-free path. The current live interoperability profile is H.264 Annex-B with SPS/PPS attached to key frames.

### Audio

`AudioRecorder` captures the default system-render endpoint in WASAPI loopback mode. It normalizes samples to floating-point stereo at 48 kHz and emits Opus frames. The transport layer wraps them in the Moonlight RTP layout and applies the negotiated AES-CBC session encryption mode.

### Session and transport

HTTP 47989 supplies discovery and pairing. HTTPS 47984 authenticates paired client certificates and handles application and launch requests. RTSP on TCP 48010 negotiates H.264 and stereo Opus. UDP 47998 carries video, UDP 48000 carries audio, and the Moonlight-compatible ENet fork provides reliable control on UDP 47999. Media loops use bounded, cancellation-aware processing so disconnects do not accumulate stale frames.

### Pairing and security

The host creates a self-signed identity on first run. The private key is protected with Windows DPAPI; paired client certificates are persisted by SHA-256 fingerprint. PIN pairing is a state machine, and launch session secrets are kept in memory and redacted from logs. The management server binds only to loopback.

### Input

Encrypted control records are authenticated with AES-GCM and decoded into Win32 keyboard, relative/absolute mouse, button, and wheel events. Absolute coordinates are translated into the captured monitor's rectangle inside the combined Windows virtual desktop, so touch input lands on the extended Moonlight screen. Virtual gamepad support requires a separately licensed and signed virtual-controller driver and is not bundled in this build.

### Service, tray, and installation

`SenaiStreamService.exe` runs under the Service Control Manager and launches `SenaiStreamTray.exe --agent` with the active user's token and environment. Capture therefore runs in the interactive desktop session. The tray owns the host lifecycle and opens `SenaiStreamUI.exe`, a native Win32 shell containing an embedded WebView2 view. The view consumes the loopback-only management API, so no external browser or visible localhost address is part of the normal experience. Closing the console does not stop the host. The NSIS installer registers the service, firewall rules, shortcuts, virtual display, WebView2 Evergreen bootstrapper, uninstaller, and host executables.

## Data-flow rules

1. The Moonlight launch request supplies the session key and desired mode.
2. Console overrides are validated and persisted atomically. Video settings and display-topology changes restart only the video producer inside the active Moonlight session.
3. Capture timestamps drive encoder and RTP timestamps.
4. Encoded frames are immutable after leaving the encoder.
5. Disconnect requests cancel both media loops and release capture/encoder state.

## Verification gates

- Automated gate: all unit tests pass in `cmake-build-senaistream-persist/tests/test_sunshine.exe`.
- Runtime gate: the host binds all documented TCP/UDP ports and the dashboard reports the routed LAN address.
- Protocol gate: a real Moonlight desktop client completed discovery, pairing, launch, control connection, and first H.264/Opus delivery.
- Acceptance gate: confirm decoded picture, sound, keyboard/touch/mouse input, reconnect, service startup after reboot, and uninstall on the user's phone and network.
- Hardware matrix gate: validate NVIDIA, AMD, and Intel Media Foundation transforms on clean machines; software fallback is retained for machines without an available hardware transform.
