# SpaceViewer native host

Based on the independently implemented SenaiStream source supplied with this project. Sunshine code and executables are not linked into the packaged host.

The native host uses the Moonlight-compatible ENet fork, OpenSSL, Opus and Windows Media Foundation. Original source notices are retained in native/spaceviwerstream/THIRD_PARTY_NOTICES.md and third_party. The signed virtual display driver package and its license are in driver/virtual-display.

Only SpaceviwerStream.exe and SpaceviwerStreamDisplayCtl.exe are packaged. The standalone SenaiStream UI, service and WebView2 bootstrapper are not part of this installer.


## Optional VB-CABLE output

VB-CABLE by VB-Audio (https://www.vb-cable.com/) is donationware. Contributions are welcome; professional use requires the publisher's license. The official package is downloaded and SHA-256 verified during the Windows build, included in the SpaceViewer installer, and installed only when selected in setup. Its driver catalog signature is checked before installation. Licensing: https://vb-audio.com/Services/licensing.htm . The package and its license remain in ProgramData/SpaceViewer/VB-CABLE-45.

Process audio capture uses the Windows Application Loopback API, documented at https://learn.microsoft.com/en-us/samples/microsoft/windows-classic-samples/applicationloopbackaudio-sample/ . Playback policy ABI reference: https://github.com/File-New-Project/EarTrumpet/blob/master/EarTrumpet/Interop/MMDeviceAPI/IPolicyConfig.cs .
