$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$destination = Join-Path $root 'resources\spaceviwerstream\driver\audio'
$archive = Join-Path $destination 'VBCABLE_Driver_Pack45.zip'
$expectedHash = 'B950E39F01AF1D04EA623C8F6D8EB9B6EA5C477C637295FABF20631C85116BFB'

function Get-FileSha256([string]$filePath) {
    if (!(Test-Path -LiteralPath $filePath)) { return '' }
    $fileStream = [System.IO.File]::OpenRead($filePath)
    try {
        $sha = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha.ComputeHash($fileStream)
        return (-join ($hashBytes | ForEach-Object { '{0:X2}' -f $_ }))
    } finally {
        $fileStream.Dispose()
    }
}

New-Item -ItemType Directory -Path $destination -Force | Out-Null
$currentHash = Get-FileSha256 $archive
if ($currentHash -ne $expectedHash) {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $client = New-Object Net.WebClient
    try {
        $client.DownloadFile('https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip', $archive)
    } finally {
        $client.Dispose()
    }
}

$finalHash = Get-FileSha256 $archive
if ($finalHash -ne $expectedHash) {
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    throw 'O pacote oficial VB-CABLE nao passou na verificacao SHA-256.'
}
Write-Host 'Pacote oficial VB-CABLE verificado para inclusao no instalador.'
