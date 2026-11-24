# Fetches the pinned FFmpeg LGPL build (BtbN) used by the real-time transport (ddagrab + NVENC/QuickSync/MF).
# Output: resources\ffmpeg\ffmpeg.exe and LICENSE.txt. A verified local copy is reused, because BtbN
# removes dated autobuilds after a few weeks.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $root 'resources\ffmpeg'
$exe = Join-Path $dest 'ffmpeg.exe'
$stamp = Join-Path $dest 'ffmpeg.sha256'

$version = 'n8.1.3-32-g760d10603e (LGPL)'
$url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-03-12-50/ffmpeg-n8.1.3-32-g760d10603e-win64-lgpl-8.1.zip'
$zipSha256 = '0D1CA152675055CA2F79A1BE3A2D6310BAF9508F60E31C5AA19CCDD8082E03BF'

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $stream.Dispose(); $sha.Dispose() }
}

if ((Test-Path $exe) -and (Test-Path $stamp) -and ((Get-Content $stamp -Raw).Trim() -eq (Get-Sha256 $exe))) {
    Write-Host "FFmpeg $version ja presente em $dest." -ForegroundColor Green
    exit 0
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("spaceviewer-ffmpeg-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work, $dest | Out-Null
try {
    $zip = Join-Path $work 'ffmpeg.zip'
    Write-Host "Baixando FFmpeg $version..."
    $ProgressPreference = 'SilentlyContinue'
    try {
        Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
    } catch {
        throw "Nao foi possivel baixar o FFmpeg ($url). Se a build foi removida pelo BtbN, atualize a URL e o SHA-256 em scripts/fetch-ffmpeg.ps1. Detalhe: $($_.Exception.Message)"
    }
    $actual = Get-Sha256 $zip
    if ($actual -ne $zipSha256) { throw "SHA-256 do FFmpeg nao confere (esperado $zipSha256, obtido $actual)." }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName -match '/bin/ffmpeg\.exe$') { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $exe, $true) }
            elseif ($entry.FullName -match '/LICENSE\.txt$') { [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, (Join-Path $dest 'LICENSE.txt'), $true) }
        }
    } finally { $archive.Dispose() }
    if (-not (Test-Path $exe)) { throw 'ffmpeg.exe nao encontrado no pacote baixado.' }
    Set-Content -LiteralPath $stamp -Value (Get-Sha256 $exe) -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $dest 'SOURCE.txt') -Value "FFmpeg $version`r`n$url`r`nLicense: LGPL v2.1 or later (see LICENSE.txt). Source: https://github.com/FFmpeg/FFmpeg and https://github.com/BtbN/FFmpeg-Builds" -Encoding ASCII
    Write-Host "FFmpeg $version pronto em $dest." -ForegroundColor Green
} finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
