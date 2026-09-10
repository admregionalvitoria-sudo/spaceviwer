$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
function Get-Sha256([string]$FilePath) {
    $stream = [IO.File]::OpenRead($FilePath)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $hash.Dispose() }
}
Push-Location $root
try {
    & 'C:\msys64\msys2_shell.cmd' -defterm -here -no-start -ucrt64 -c 'cmake -S native/spaceviwerstream -B cmake-build-spaceviewer -G Ninja -DCMAKE_BUILD_TYPE=Release && cmake --build cmake-build-spaceviewer --target SenaiStream SenaiStreamDisplayCtl test_sunshine -j 4'
    if ($LASTEXITCODE -ne 0) { throw 'Native build or tests failed. Existing binaries were not replaced.' }
    & (Join-Path $root 'cmake-build-spaceviewer\tests\test_sunshine.exe')
    if ($LASTEXITCODE -ne 0) { throw "Native tests failed ($LASTEXITCODE). Existing binaries were not replaced." }
    $destination = Join-Path $root 'resources\spaceviwerstream'
    foreach ($name in @('SpaceviwerStream.exe', 'SpaceviwerStreamDisplayCtl.exe')) {
        Copy-Item -LiteralPath (Join-Path $root "cmake-build-spaceviewer\$name") -Destination (Join-Path $destination $name) -Force
    }
    $sources = Get-ChildItem -LiteralPath (Join-Path $root 'native\spaceviwerstream\src'), (Join-Path $root 'native\spaceviwerstream\include') -File -Recurse |
        Sort-Object FullName | ForEach-Object { @{ path = $_.FullName.Substring($root.Length + 1); sha256 = (Get-Sha256 $_.FullName) } }
    @{ version = '2.2.15'; builtAt = (Get-Date).ToUniversalTime().ToString('o'); sources = @($sources); binaries = @(
        Get-ChildItem -LiteralPath $destination -Filter '*.exe' | ForEach-Object { @{ name = $_.Name; sha256 = (Get-Sha256 $_.FullName) } }
    ) } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $destination 'build-manifest.json') -Encoding UTF8
} finally { Pop-Location }
