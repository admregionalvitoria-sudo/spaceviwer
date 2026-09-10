# SpaceViewer native host

Based on the independently implemented SenaiStream source supplied with this project. Sunshine code and executables are not linked into the packaged host.

The native host uses the Moonlight-compatible ENet fork, OpenSSL, Opus and Windows Media Foundation. Original source notices are retained in native/spaceviwerstream/THIRD_PARTY_NOTICES.md and third_party. The signed virtual display driver package and its license are in driver/virtual-display.

Only SpaceviwerStream.exe and SpaceviwerStreamDisplayCtl.exe are packaged. The standalone SenaiStream UI, service and WebView2 bootstrapper are not part of this installer.
