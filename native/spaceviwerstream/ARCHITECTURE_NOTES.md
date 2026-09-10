# Clean-room architecture notes

## Reference boundary

The adjacent Sunshine repository was used only as architectural study material: configuration and management, capture, encoding, pairing, session control, media transport, input, tray integration, and platform separation. No Sunshine implementation body, resource, string table, build target, or vendored file is part of SenaiStream.

SenaiStream has its own names, interfaces, state machines, error handling, configuration schema, source layout, build, service, and installer. The installed processes never locate, launch, or communicate with Sunshine.

## Independent implementation

- DXGI adapter/output enumeration and Desktop Duplication are wrapped in SenaiStream-owned capture types.
- Media Foundation transforms are selected through Windows capability enumeration, allowing vendor drivers to expose NVENC, AMF, or Quick Sync without bundling their SDKs.
- WASAPI loopback data is normalized and encoded by a SenaiStream-owned Opus pipeline.
- Pairing is a SenaiStream state machine with an independently persisted DPAPI-protected host identity.
- Observable Moonlight requests and public client interoperability behavior define the wire contract; SenaiStream owns its parsers, serializers, packetizers, encryption helpers, and tests.
- The service is a small active-session supervisor; the tray process owns interactive capture and the loopback-only management UI.
- Virtual display lifecycle is handled by a small SenaiStream SetupAPI/NewDev controller. The display implementation itself is the separately signed MIT-licensed Virtual Display Driver package, not Sunshine code.

## External dependencies

SenaiStream uses Windows system APIs, OpenSSL, Opus, GoogleTest for tests, the Moonlight-compatible ENet fork pinned in CMake, Microsoft WebView2 for the native desktop console, and the signed Virtual Display Driver 25.7.23 package. Dependency licenses and attribution are recorded in `THIRD_PARTY_NOTICES.md`. OpenSSL, Opus, ENet, and the MinGW runtime are statically linked into the host executables; WebView2 uses Microsoft's official loader and Evergreen Runtime; the display driver remains an independently attributed driver package.

## Deliberate scope boundaries

The live profile in this build advertises H.264 only. HEVC is available for the isolated local recording diagnostic but is not represented as Moonlight-live support until its negotiation and parameter-set path passes a real-client test. Gamepad emulation is not bundled because it requires a separately distributed signed virtual-controller driver; keyboard and mouse input are implemented through Win32.

These boundaries prevent the application or installer from claiming capabilities that were not exercised. Phone-based picture, sound, input, reconnect, and reboot acceptance remains the final environment-specific validation step.
