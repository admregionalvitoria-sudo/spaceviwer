$ErrorActionPreference = 'Stop'
# Builds SpaceviwerStreamDisplayCtl.exe (virtual display / topology control). The GameStream
# host is no longer shipped: Android receivers stream over WebRTC from the Electron app.
$root = Split-Path $PSScriptRoot -Parent
function Get-Sha256([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hash.Dispose() }
}
Push-Location $root
try {
    $msysShell = 'C:\msys64\msys2_shell.cmd'
    $destination = Join-Path $root 'resources\spaceviwerstream'
    $ctlExe = Join-Path $destination 'SpaceviwerStreamDisplayCtl.exe'

    $recompiled = $false
    if (Test-Path $msysShell) {
        & $msysShell -defterm -here -no-start -ucrt64 -c 'which cmake && cmake -S native/spaceviwerstream -B cmake-build-spaceviewer -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build cmake-build-spaceviewer --target SenaiStreamDisplayCtl -j 4'
        $built = Join-Path $root 'cmake-build-spaceviewer\SpaceviwerStreamDisplayCtl.exe'
        if ($LASTEXITCODE -eq 0 -and (Test-Path $built)) {
            Copy-Item -LiteralPath $built -Destination $ctlExe -Force
            $appVersion = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
            @{ version = $appVersion; builtAt = (Get-Date).ToUniversalTime().ToString('o'); binaries = @(
                @{ name = 'SpaceviwerStreamDisplayCtl.exe'; sha256 = (Get-Sha256 $ctlExe) }
            ) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'build-manifest.json') -Encoding UTF8
            $recompiled = $true
        }
    }

    if (-not $recompiled) {
        if (Test-Path $ctlExe) {
            Write-Host "Utilizando SpaceviwerStreamDisplayCtl.exe pre-compilado em $destination." -ForegroundColor Yellow
        } else {
            throw "Compilacao nativa falhou e SpaceviwerStreamDisplayCtl.exe nao existe em $destination."
        }
    }
} finally { Pop-Location }
