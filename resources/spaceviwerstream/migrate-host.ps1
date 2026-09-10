# Retire only the known standalone service replaced by the integrated host.
$ErrorActionPreference = 'Stop'
$expectedRoot = Join-Path $env:ProgramFiles 'SenaiStream'
$expectedService = Join-Path $expectedRoot 'SenaiStreamService.exe'
$service = Get-CimInstance Win32_Service -Filter "Name='SenaiStream'"
if ($service) {
    if ($service.PathName.Trim('"') -ne $expectedService) { throw 'SenaiStream service has an unexpected path; it was not changed.' }
    $backupDir = Join-Path $env:ProgramData 'SpaceViewer'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $backup = Join-Path $backupDir 'previous-host-service.json'
    if (!(Test-Path -LiteralPath $backup)) {
        $service | Select-Object Name, PathName, StartMode, State | ConvertTo-Json | Set-Content -LiteralPath $backup -Encoding UTF8
    }
    Set-Service -Name SenaiStream -StartupType Disabled
    Stop-Service -Name SenaiStream -Force
    foreach ($name in @('SenaiStreamTray.exe', 'SenaiStream.exe')) {
        $expected = Join-Path $expectedRoot $name
        Get-CimInstance Win32_Process -Filter "Name='$name'" | Where-Object { $_.ExecutablePath -eq $expected } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    }
}
