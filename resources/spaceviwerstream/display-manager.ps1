param(
    [ValidateSet('query', 'set-count', 'enable', 'disable', 'install', 'remove', 'set-position', 'set-primary', 'attach', 'detach', 'detach-all', 'dxgi-outputs')]
    [string]$Action = 'query',
    [ValidateRange(1, 4)][int]$Count = 4,
    [string]$Device = '',
    [int]$X = 0,
    [int]$Y = 0,
    [int]$Width = 1920,
    [int]$Height = 1080,
    [int]$Hz = 60
)
$ErrorActionPreference = 'Stop'

# Match this driver's hardware identity, never all secondary video adapters.
function Get-VirtualAdapters {
    @(Get-CimInstance Win32_PnPEntity -Filter "PNPClass='Display'" | Where-Object {
        $_.PNPDeviceID -match '^(ROOT\\(MTTVDD|SENAISTREAM_VIRTUAL_DISPLAY|SPACEVIWERSTREAM_VIRTUAL_DISPLAY)|SWD\\MTT_VDD)\\' -or
        @($_.HardwareID | Where-Object { $_ -match '^(Root\\)?MttVDD$' }).Count -gt 0
    })
}

function Invoke-Pnp([string[]]$Arguments) {
    & "$env:SystemRoot\System32\pnputil.exe" @Arguments | Out-Null
    # 259 (ERROR_NO_MORE_ITEMS): the package is already in the driver store and no device needed an update.
    if ($LASTEXITCODE -eq 259 -and $Arguments[0] -eq '/add-driver') { return }
    if ($LASTEXITCODE -ne 0) {
        if ($LASTEXITCODE -eq 3010) { throw 'O Windows solicitou uma reinicializacao para concluir a alteracao do driver.' }
        throw "PnPUtil falhou (codigo $LASTEXITCODE): $($Arguments[0])"
    }
}

# Current mode / position changes for a single monitor (ChangeDisplaySettingsEx).
$modeSource = @'
public class SpaceViewerDisplayMode {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmDeviceName;
        public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
        public int dmFields, dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
        public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
        public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
    }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct MonitorDevice {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string description;
        public int flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key;
    }
    public class VirtualOutput {
        public string deviceName;
        public bool attached;
        public int width;
        public int height;
        public int refreshRate;
    }
    const int ENUM_CURRENT_SETTINGS = -1;
    const int DM_POSITION = 0x20;
    const int DM_PELSWIDTH = 0x80000;
    const int DM_PELSHEIGHT = 0x100000;
    const int DM_DISPLAYFREQUENCY = 0x400000;
    const int DM_BITSPERPEL = 0x40000;
    const int CDS_UPDATEREGISTRY = 0x1, CDS_SET_PRIMARY = 0x10, CDS_NORESET = 0x10000000;
    const int ATTACHED_TO_DESKTOP = 0x1;
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplaySettings(string name, int mode, ref DEVMODE dm);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string name, ref DEVMODE dm, IntPtr hwnd, int flags, IntPtr param);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int ChangeDisplaySettingsEx(string name, IntPtr dm, IntPtr hwnd, int flags, IntPtr param);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string name, uint index, ref MonitorDevice dev, uint flags);
    [DllImport("user32.dll")] static extern int SetDisplayConfig(uint numPaths, IntPtr paths, uint numModes, IntPtr modes, uint flags);
    const uint SDC_TOPOLOGY_EXTEND = 0x4, SDC_APPLY = 0x80;

    static DEVMODE Current(string name) {
        var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        if (!EnumDisplaySettings(name, ENUM_CURRENT_SETTINGS, ref dm)) throw new Exception("Tela nao encontrada: " + name);
        return dm;
    }
    public static int RefreshRate(string name) {
        try { return Current(name).dmDisplayFrequency; } catch { return 0; }
    }
    static void Check(int code, string name) {
        if (code != 0) throw new Exception("O Windows recusou a alteracao de " + name + " (codigo " + code + ").");
    }
    public static void Apply() { Check(ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero), "layout"); }
    public static void SetPosition(string name, int x, int y) {
        var dm = Current(name);
        if (dm.dmPositionX == 0 && dm.dmPositionY == 0) throw new Exception("A tela principal fica sempre na origem. Mova as outras telas ou escolha outra principal.");
        dm.dmPositionX = x; dm.dmPositionY = y; dm.dmFields = DM_POSITION;
        Check(ChangeDisplaySettingsEx(name, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero), name);
        Apply();
    }
    public static void SetPrimary(string name) {
        var target = Current(name);
        int dx = target.dmPositionX, dy = target.dmPositionY;
        for (uint i = 0;; i++) {
            var dev = new MonitorDevice(); dev.cb = Marshal.SizeOf(typeof(MonitorDevice));
            if (!EnumDisplayDevices(null, i, ref dev, 0)) break;
            if ((dev.flags & ATTACHED_TO_DESKTOP) == 0) continue;
            var dm = Current(dev.name);
            dm.dmPositionX -= dx; dm.dmPositionY -= dy; dm.dmFields = DM_POSITION;
            int flags = CDS_UPDATEREGISTRY | CDS_NORESET;
            if (String.Equals(dev.name, name, StringComparison.OrdinalIgnoreCase)) flags |= CDS_SET_PRIMARY;
            Check(ChangeDisplaySettingsEx(dev.name, ref dm, IntPtr.Zero, flags, IntPtr.Zero), dev.name);
        }
        Apply();
    }
    /// Modes the driver advertises for this output (works for attached and detached outputs).
    static List<DEVMODE> Modes(string name) {
        var list = new List<DEVMODE>();
        for (int i = 0; i < 2000; i++) {
            var dm = new DEVMODE(); dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
            if (!EnumDisplaySettings(name, i, ref dm)) break;
            if (dm.dmPelsWidth > 0 && dm.dmPelsHeight > 0) list.Add(dm);
        }
        return list;
    }
    /// Lower is better: exact size+rate, exact size, then same orientation by aspect ratio and area.
    static double Score(DEVMODE m, int w, int h, int hz) {
        if (m.dmPelsWidth == w && m.dmPelsHeight == h) return m.dmDisplayFrequency == hz ? 0 : 1 + Math.Abs(m.dmDisplayFrequency - hz) / 1000.0;
        if ((m.dmPelsHeight > m.dmPelsWidth) != (h > w)) return 1e12;
        double aspect = Math.Abs((double)m.dmPelsWidth / m.dmPelsHeight - (double)w / h);
        double area = Math.Abs((double)m.dmPelsWidth * m.dmPelsHeight - (double)w * h);
        return 10 + aspect * 1e6 + area / 1000.0 + Math.Abs(m.dmDisplayFrequency - (hz > 0 ? hz : 60)) / 1000.0;
    }
    static int TryMode(string name, DEVMODE mode, int x, int y) {
        var dm = mode;
        dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        dm.dmPositionX = x; dm.dmPositionY = y;
        dm.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY | DM_BITSPERPEL;
        int code = ChangeDisplaySettingsEx(name, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero);
        if (code == 0) code = ChangeDisplaySettingsEx(null, IntPtr.Zero, IntPtr.Zero, 0, IntPtr.Zero);
        return code;
    }
    /// Attaches one virtual output to the desktop at (x, y), using a mode the driver supports.
    /// Returns the applied mode as "WxH@Hz".
    public static string Attach(string name, int x, int y, int width, int height, int hz) {
        int last = -1;
        var modes = Modes(name);
        modes.Sort((a, b) => Score(a, width, height, hz).CompareTo(Score(b, width, height, hz)));
        for (int i = 0; i < modes.Count && i < 6; i++) {
            last = TryMode(name, modes[i], x, y);
            if (last == 0) return modes[i].dmPelsWidth + "x" + modes[i].dmPelsHeight + "@" + modes[i].dmDisplayFrequency;
        }
        if (modes.Count == 0) {
            var manual = new DEVMODE();
            manual.dmPelsWidth = width; manual.dmPelsHeight = height; manual.dmDisplayFrequency = hz; manual.dmBitsPerPel = 32;
            last = TryMode(name, manual, x, y);
            if (last == 0) return width + "x" + height + "@" + hz;
        }

        // Fallback: let Windows extend the desktop (same path as Settings > Display > Extend),
        // then remove the virtual outputs that were not on the desktop before, except this one.
        var before = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var o in GetVirtualOutputs()) if (o.attached) before.Add(o.deviceName);
        int extend = SetDisplayConfig(0, IntPtr.Zero, 0, IntPtr.Zero, SDC_APPLY | SDC_TOPOLOGY_EXTEND);
        System.Threading.Thread.Sleep(1200);
        foreach (var o in GetVirtualOutputs()) {
            if (o.attached && !before.Contains(o.deviceName) && !String.Equals(o.deviceName, name, StringComparison.OrdinalIgnoreCase)) {
                try { Detach(o.deviceName); } catch { }
            }
        }
        var now = GetVirtualOutputs();
        bool attached = false;
        foreach (var o in now) if (o.attached && String.Equals(o.deviceName, name, StringComparison.OrdinalIgnoreCase)) attached = true;
        if (!attached) {
            throw new Exception("O Windows recusou ligar a tela estendida " + name + " (codigo " + last + ", extend " + extend + "). Verifique o driver de tela estendida.");
        }
        // Now attached: apply the closest supported mode and the position.
        modes = Modes(name);
        modes.Sort((a, b) => Score(a, width, height, hz).CompareTo(Score(b, width, height, hz)));
        for (int i = 0; i < modes.Count && i < 6; i++) {
            if (TryMode(name, modes[i], x, y) == 0) return modes[i].dmPelsWidth + "x" + modes[i].dmPelsHeight + "@" + modes[i].dmDisplayFrequency;
        }
        var current = Current(name);
        return current.dmPelsWidth + "x" + current.dmPelsHeight + "@" + current.dmDisplayFrequency;
    }
    public static void Detach(string name) {
        var dm = new DEVMODE();
        dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        dm.dmDeviceName = name;
        dm.dmPositionX = 0;
        dm.dmPositionY = 0;
        dm.dmPelsWidth = 0;
        dm.dmPelsHeight = 0;
        dm.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT;
        int code = ChangeDisplaySettingsEx(name, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero);
        Check(code, name);
        Apply();
    }
    public static VirtualOutput[] GetVirtualOutputs() {
        var result = new List<VirtualOutput>();
        for (uint i = 0;; i++) {
            var dev = new MonitorDevice();
            dev.cb = Marshal.SizeOf(typeof(MonitorDevice));
            if (!EnumDisplayDevices(null, i, ref dev, 0)) break;
            bool isVirtual = dev.description.IndexOf("Virtual Display Driver", StringComparison.OrdinalIgnoreCase) >= 0 ||
                             dev.description.IndexOf("MttVDD", StringComparison.OrdinalIgnoreCase) >= 0;
            if (!isVirtual) continue;
            var mon = new MonitorDevice();
            mon.cb = Marshal.SizeOf(typeof(MonitorDevice));
            if (!EnumDisplayDevices(dev.name, 0, ref mon, 0)) continue;
            bool attached = (dev.flags & ATTACHED_TO_DESKTOP) != 0;
            int width = 0, height = 0, refreshRate = 0;
            var dm = new DEVMODE();
            dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
            if (EnumDisplaySettings(dev.name, ENUM_CURRENT_SETTINGS, ref dm)) {
                width = dm.dmPelsWidth;
                height = dm.dmPelsHeight;
                refreshRate = dm.dmDisplayFrequency;
            }
            result.Add(new VirtualOutput {
                deviceName = dev.name,
                attached = attached,
                width = width,
                height = height,
                refreshRate = refreshRate
            });
        }
        return result.ToArray();
    }
    public static void DetachAll() {
        var outputs = GetVirtualOutputs();
        bool changed = false;
        for (int i = 0; i < outputs.Length; i++) {
            if (outputs[i].attached) {
                var dm = new DEVMODE();
                dm.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
                dm.dmDeviceName = outputs[i].deviceName;
                dm.dmPositionX = 0;
                dm.dmPositionY = 0;
                dm.dmPelsWidth = 0;
                dm.dmPelsHeight = 0;
                dm.dmFields = DM_POSITION | DM_PELSWIDTH | DM_PELSHEIGHT;
                ChangeDisplaySettingsEx(outputs[i].deviceName, ref dm, IntPtr.Zero, CDS_UPDATEREGISTRY | CDS_NORESET, IntPtr.Zero);
                changed = true;
            }
        }
        if (changed) Apply();
    }
}
'@

function Ensure-ModeType {
    if (-not ([System.Management.Automation.PSTypeName]'SpaceViewerDisplayMode').Type) {
        Add-Type ("using System;`nusing System.Collections.Generic;`nusing System.Runtime.InteropServices;`n" + $modeSource)
    }
}

# DXGI adapter/output indexes per Windows device name (used by FFmpeg ddagrab: -init_hw_device d3d11va=dd:<adapter>, output_idx=<output>).
$dxgiSource = @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class SpaceViewerDxgi {
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DXGI_OUTPUT_DESC {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
        public RECT DesktopCoordinates;
        public int AttachedToDesktop;
        public int Rotation;
        public IntPtr Monitor;
    }
    [ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIOutput {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        [PreserveSig] int GetDesc(out DXGI_OUTPUT_DESC desc);
    }
    [ComImport, Guid("29038f61-3839-4626-91fd-086879011a05"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIAdapter1 {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        [PreserveSig] int EnumOutputs(uint index, out IDXGIOutput output);
    }
    [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDXGIFactory1 {
        void SetPrivateData(); void SetPrivateDataInterface(); void GetPrivateData(); void GetParent();
        void EnumAdapters(); void MakeWindowAssociation(); void GetWindowAssociation(); void CreateSwapChain(); void CreateSoftwareAdapter();
        [PreserveSig] int EnumAdapters1(uint index, out IDXGIAdapter1 adapter);
    }
    [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDXGIFactory1 factory);
    public class Output { public int adapter, output, x, y, width, height; public long hmonitor; public string deviceName; public bool attached; }
    public static Output[] List() {
        var result = new List<Output>();
        var iid = typeof(IDXGIFactory1).GUID;
        IDXGIFactory1 factory;
        if (CreateDXGIFactory1(ref iid, out factory) != 0) return result.ToArray();
        for (uint a = 0; ; a++) {
            IDXGIAdapter1 adapter;
            if (factory.EnumAdapters1(a, out adapter) != 0) break;
            for (uint o = 0; ; o++) {
                IDXGIOutput output;
                if (adapter.EnumOutputs(o, out output) != 0) break;
                DXGI_OUTPUT_DESC d;
                if (output.GetDesc(out d) == 0) {
                    result.Add(new Output { adapter = (int)a, output = (int)o, deviceName = d.DeviceName,
                        x = d.DesktopCoordinates.left, y = d.DesktopCoordinates.top,
                        width = d.DesktopCoordinates.right - d.DesktopCoordinates.left,
                        height = d.DesktopCoordinates.bottom - d.DesktopCoordinates.top,
                        attached = d.AttachedToDesktop != 0, hmonitor = d.Monitor.ToInt64() });
                }
                Marshal.ReleaseComObject(output);
            }
            Marshal.ReleaseComObject(adapter);
        }
        Marshal.ReleaseComObject(factory);
        return result.ToArray();
    }
}
'@

$settingsPath = 'C:\VirtualDisplayDriver\vdd_settings.xml'
$previousSettings = $null
try {
    if ($Action -eq 'dxgi-outputs') {
        Add-Type -TypeDefinition $dxgiSource
        @([SpaceViewerDxgi]::List()) | ConvertTo-Json -Compress -Depth 3
        exit 0
    }
    if (@('set-position', 'set-primary', 'attach', 'detach', 'detach-all') -contains $Action) {
        Ensure-ModeType
        if ($Action -eq 'attach') {
            if (-not $Device) { throw 'Informe a tela (-Device).' }
            [SpaceViewerDisplayMode]::Attach($Device, $X, $Y, $Width, $Height, $Hz)
        }
        elseif ($Action -eq 'detach') {
            if (-not $Device) { throw 'Informe a tela (-Device).' }
            [SpaceViewerDisplayMode]::Detach($Device)
        }
        elseif ($Action -eq 'detach-all') {
            [SpaceViewerDisplayMode]::DetachAll()
        }
        elseif ($Action -eq 'set-position') {
            if (-not $Device) { throw 'Informe a tela (-Device).' }
            [SpaceViewerDisplayMode]::SetPosition($Device, $X, $Y)
        }
        elseif ($Action -eq 'set-primary') {
            if (-not $Device) { throw 'Informe a tela (-Device).' }
            [SpaceViewerDisplayMode]::SetPrimary($Device)
        }
        exit 0
    }
    if ($Action -ne 'query') {
        $adapters = @(Get-VirtualAdapters)
        if (@('install', 'enable', 'set-count') -contains $Action) {
            $driverDir = Join-Path $PSScriptRoot 'driver\virtual-display'
            New-Item -ItemType Directory -Path 'C:\VirtualDisplayDriver' -Force | Out-Null
            foreach ($file in @('MttVDD.inf', 'MttVDD.dll', 'mttvdd.cat', 'vdd_settings.xml')) {
                $target = Join-Path 'C:\VirtualDisplayDriver' $file
                Copy-Item -LiteralPath (Join-Path $driverDir $file) -Destination $target -Force
            }
            if (Test-Path -LiteralPath $settingsPath) {
                [xml]$settings = Get-Content -LiteralPath $settingsPath -Raw
                $settings.vdd_settings.monitors.count = [string]$Count
                if ($null -ne $settings.vdd_settings.options.HardwareCursor) {
                    $settings.vdd_settings.options.HardwareCursor = 'false'
                }
                $settings.Save($settingsPath)
            }
        }
        # An adapter that already existed must be restarted to pick up the new monitor count.
        $restartExisting = $adapters.Count -gt 0
        if ($Action -eq 'install' -or (($Action -eq 'enable' -or $Action -eq 'set-count') -and $adapters.Count -eq 0)) {
            $inf = Join-Path $driverDir 'MttVDD.inf'
            Invoke-Pnp @('/add-driver', $inf, '/install')
            & (Join-Path $PSScriptRoot 'SpaceviwerStreamDisplayCtl.exe') ensure $inf | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o dispositivo virtual (codigo $LASTEXITCODE)." }
            $adapters = @(Get-VirtualAdapters)
            if ($adapters.Count -eq 0) { throw 'O Windows nao registrou o dispositivo virtual.' }
        }
        if ($Action -eq 'set-count' -or $Action -eq 'enable') {
            if (Test-Path -LiteralPath $settingsPath) {
                [xml]$settings = Get-Content -LiteralPath $settingsPath -Raw
                $settings.vdd_settings.monitors.count = [string]$Count
                if ($null -ne $settings.vdd_settings.options.HardwareCursor) {
                    $settings.vdd_settings.options.HardwareCursor = 'false'
                }
                $settings.Save($settingsPath)
            }
        }
        # If there are duplicate virtual display adapters in PnP, disable any extras beyond the first
        if ($adapters.Count -gt 1) {
            for ($i = 1; $i -lt $adapters.Count; $i++) {
                try { Invoke-Pnp @('/disable-device', $adapters[$i].PNPDeviceID) } catch {}
            }
            $adapters = @($adapters[0])
        }
        foreach ($adapter in $adapters) {
            switch ($Action) {
                'disable' { Invoke-Pnp @('/disable-device', $adapter.PNPDeviceID) }
                'remove' { Invoke-Pnp @('/remove-device', $adapter.PNPDeviceID) }
                default {
                    if ($adapter.ConfigManagerErrorCode -eq 22) { Invoke-Pnp @('/enable-device', $adapter.PNPDeviceID) }
                    if ($Action -eq 'set-count' -or $Action -eq 'enable' -or ($Action -eq 'install' -and $restartExisting)) { Invoke-Pnp @('/restart-device', $adapter.PNPDeviceID) }
                }
            }
        }
        if (@('set-count', 'enable', 'install') -contains $Action) {
            Ensure-ModeType
            # Windows attaches newly enumerated monitors asynchronously: keep them off the desktop
            # until a device connects.
            for ($pass = 0; $pass -lt 5; $pass++) {
                [SpaceViewerDisplayMode]::DetachAll()
                Start-Sleep -Milliseconds 800
            }
            try {
                $cursorDef = @'
using System;
using System.Runtime.InteropServices;
public class WinUserCursorPS {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
}
'@
                Add-Type -TypeDefinition $cursorDef -ErrorAction SilentlyContinue
                [WinUserCursorPS]::SystemParametersInfo(0x005D, 0, [IntPtr]::Zero, 3) | Out-Null
                Set-ItemProperty -Path 'HKCU:\Control Panel\Mouse' -Name MouseTrails -Value "0" -ErrorAction SilentlyContinue
            } catch {}
        }
        # Confirm the OS state instead of reporting success from the elevation wrapper.
        $verified = $false
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            $actual = @(Get-VirtualAdapters)
            $healthy = @($actual | Where-Object { $_.ConfigManagerErrorCode -eq 0 })
            if ($Action -eq 'remove') { $verified = $actual.Count -eq 0 }
            elseif ($Action -eq 'disable') { $verified = @($actual | Where-Object { $_.ConfigManagerErrorCode -ne 22 }).Count -eq 0 }
            else { $verified = $actual.Count -gt 0 -and $healthy.Count -eq $actual.Count }
            if ($verified) { break }
            Start-Sleep -Milliseconds 250
        }
        if (!$verified) { throw 'O Windows nao confirmou a alteracao do dispositivo virtual.' }
        exit 0
    }

    $adapters = @(Get-VirtualAdapters)
    $enabled = @($adapters | Where-Object { $_.ConfigManagerErrorCode -eq 0 }).Count -gt 0
    $configuredCount = 1
    if (Test-Path -LiteralPath $settingsPath) {
        [xml]$settings = Get-Content -LiteralPath $settingsPath -Raw
        $configuredCount = [int]$settings.vdd_settings.monitors.count
    }
    # Enumerate the Windows display device names, bounds and refresh rates used for capture.
    if (-not ([System.Management.Automation.PSTypeName]'SpaceViewerDisplays').Type) {
        Add-Type (@'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class SpaceViewerDisplays {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Device {
        public int cb;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string name;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string description;
        public int flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string id;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=128)] public string key;
    }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Info {
        public int size; public Rect monitor, work; public int flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=32)] public string device;
    }
    public class Display { public string deviceName, label; public int x, y, width, height, refreshRate; public long hmonitor; public bool primary, isVirtual; }
    public delegate bool Callback(IntPtr monitor, IntPtr hdc, ref Rect rect, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, Callback cb, IntPtr data);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref Info info);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool EnumDisplayDevices(string name, uint index, ref Device dev, uint flags);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    public static Display[] Read() {
        var result = new List<Display>();
        var previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, delegate(IntPtr h, IntPtr dc, ref Rect rect, IntPtr data) {
                var info = new Info(); info.size=Marshal.SizeOf(typeof(Info));
                if (!GetMonitorInfo(h, ref info)) return true;
                string description="";
                for (uint i=0;;i++) {
                    var dev=new Device(); dev.cb=Marshal.SizeOf(typeof(Device));
                    if (!EnumDisplayDevices(null, i, ref dev, 0)) break;
                    if (dev.name==info.device) { description=dev.description; break; }
                }
                result.Add(new Display { deviceName=info.device, label=description, hmonitor=h.ToInt64(),
                    x=info.monitor.left, y=info.monitor.top, width=info.monitor.right-info.monitor.left,
                    height=info.monitor.bottom-info.monitor.top, primary=(info.flags & 1)!=0,
                    refreshRate=SpaceViewerDisplayMode.RefreshRate(info.device),
                    isVirtual=description.IndexOf("Virtual Display Driver", StringComparison.OrdinalIgnoreCase)>=0 || description.IndexOf("MttVDD", StringComparison.OrdinalIgnoreCase)>=0 });
                return true;
            }, IntPtr.Zero);
        } finally { SetThreadDpiAwarenessContext(previous); }
        return result.ToArray();
    }
}
'@ + $modeSource)
    }
    $displays = @([SpaceViewerDisplays]::Read())
    $virtualOutputs = @([SpaceViewerDisplayMode]::GetVirtualOutputs())
    [pscustomobject]@{
        installed = $adapters.Count -gt 0
        enabled = $enabled
        active = $enabled -and @($displays | Where-Object { $_.isVirtual }).Count -gt 0
        count = @($displays | Where-Object { $_.isVirtual }).Count
        configuredCount = $configuredCount
        displays = $displays
        virtualOutputs = $virtualOutputs
    } | ConvertTo-Json -Depth 4 -Compress
} catch {
    if ($null -ne $previousSettings) {
        try { [IO.File]::WriteAllText($settingsPath, $previousSettings) } catch {}
    }
    # Report the innermost (ASCII) message; PowerShell's own wrapper text is localized and garbles accents.
    $inner = $_.Exception
    while ($null -ne $inner.InnerException) { $inner = $inner.InnerException }
    [Console]::Error.WriteLine($inner.Message)
    exit 1
}
