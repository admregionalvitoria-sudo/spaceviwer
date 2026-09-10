param(
    [ValidateSet('query', 'set-count', 'enable', 'disable', 'install', 'remove')]
    [string]$Action = 'query',
    [ValidateRange(1, 4)][int]$Count = 1
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
    if ($LASTEXITCODE -ne 0) {
        if ($LASTEXITCODE -eq 3010) { throw 'O Windows solicitou uma reinicializacao para concluir a alteracao do driver.' }
        throw "PnPUtil falhou (codigo $LASTEXITCODE): $($Arguments[0])"
    }
}

$settingsPath = 'C:\VirtualDisplayDriver\vdd_settings.xml'
$previousSettings = $null
try {
    if ($Action -ne 'query') {
        $adapters = @(Get-VirtualAdapters)
        if (@('install', 'enable', 'set-count') -contains $Action) {
            $driverDir = Join-Path $PSScriptRoot 'driver\virtual-display'
            New-Item -ItemType Directory -Path 'C:\VirtualDisplayDriver' -Force | Out-Null
            foreach ($file in @('MttVDD.inf', 'MttVDD.dll', 'mttvdd.cat', 'vdd_settings.xml')) {
                $target = Join-Path 'C:\VirtualDisplayDriver' $file
                if (!(Test-Path -LiteralPath $target)) { Copy-Item -LiteralPath (Join-Path $driverDir $file) -Destination $target }
            }
        }
        if ($Action -eq 'install' -or (($Action -eq 'enable' -or $Action -eq 'set-count') -and $adapters.Count -eq 0)) {
            $inf = Join-Path $driverDir 'MttVDD.inf'
            Invoke-Pnp @('/add-driver', $inf, '/install')
            & (Join-Path $PSScriptRoot 'SpaceviwerStreamDisplayCtl.exe') ensure $inf | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o dispositivo virtual (codigo $LASTEXITCODE)." }
            $adapters = @(Get-VirtualAdapters)
            if ($adapters.Count -eq 0) { throw 'O Windows nao registrou o dispositivo virtual.' }
        }
        if ($Action -eq 'set-count') {
            if (!(Test-Path -LiteralPath $settingsPath)) { throw 'Configuracao do driver virtual nao encontrada.' }
            $previousSettings = Get-Content -LiteralPath $settingsPath -Raw
            [xml]$settings = $previousSettings
            $settings.vdd_settings.monitors.count = [string]$Count
            $settings.Save($settingsPath)
        }
        foreach ($adapter in $adapters) {
            switch ($Action) {
                'disable' { Invoke-Pnp @('/disable-device', $adapter.PNPDeviceID) }
                'remove' { Invoke-Pnp @('/remove-device', $adapter.PNPDeviceID) }
                default {
                    if ($adapter.ConfigManagerErrorCode -eq 22) { Invoke-Pnp @('/enable-device', $adapter.PNPDeviceID) }
                    if ($Action -eq 'set-count') { Invoke-Pnp @('/restart-device', $adapter.PNPDeviceID) }
                }
            }
        }
        if (@('set-count', 'enable', 'install') -contains $Action) {
            & (Join-Path $PSScriptRoot 'SpaceviwerStreamDisplayCtl.exe') extend | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "Falha ao ativar a area de trabalho estendida (codigo $LASTEXITCODE)." }
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
        $configuredCount = [Math]::Max(1, [Math]::Min(4, [int]$settings.vdd_settings.monitors.count))
    }
    # Enumerate the Windows display device names and bounds used by native capture.
    Add-Type @'
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
    public class Display { public string deviceName, label; public int x,y,width,height; public bool primary, isVirtual; }
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
                result.Add(new Display { deviceName=info.device, label=description,
                    x=info.monitor.left, y=info.monitor.top, width=info.monitor.right-info.monitor.left,
                    height=info.monitor.bottom-info.monitor.top, primary=(info.flags & 1)!=0,
                    isVirtual=description.IndexOf("Virtual Display Driver", StringComparison.OrdinalIgnoreCase)>=0 || description.IndexOf("MttVDD", StringComparison.OrdinalIgnoreCase)>=0 });
                return true;
            }, IntPtr.Zero);
        } finally { SetThreadDpiAwarenessContext(previous); }
        return result.ToArray();
    }
}
'@
    $displays = @([SpaceViewerDisplays]::Read())
    [pscustomobject]@{
        installed = $adapters.Count -gt 0
        enabled = $enabled
        active = $enabled -and @($displays | Where-Object { $_.isVirtual }).Count -gt 0
        count = $(if ($enabled) { $configuredCount } else { 0 })
        configuredCount = $configuredCount
        displays = $displays
    } | ConvertTo-Json -Depth 4 -Compress
} catch {
    if ($null -ne $previousSettings) {
        try { [IO.File]::WriteAllText($settingsPath, $previousSettings) } catch {}
    }
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
