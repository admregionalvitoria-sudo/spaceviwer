# VB-CABLE is downloaded from its publisher; it is not redistributed in SpaceViewer.
# Donationware and professional-use licensing: https://vb-audio.com/Services/licensing.htm
$ErrorActionPreference = 'Stop'
$driver = Join-Path $env:ProgramData 'SpaceViewer\VB-CABLE-45'
New-Item -ItemType Directory -Path $driver -Force | Out-Null
$archive = Join-Path $driver 'VBCABLE_Driver_Pack45.zip'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$client = New-Object Net.WebClient
try { $client.DownloadFile('https://download.vb-audio.com/Download_CABLE/VBCABLE_Driver_Pack45.zip', $archive) } finally { $client.Dispose() }
$stream = [IO.File]::OpenRead($archive)
$hasher = [Security.Cryptography.SHA256]::Create()
try { $hash = [BitConverter]::ToString($hasher.ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose(); $hasher.Dispose() }
if ($hash -ne 'B950E39F01AF1D04EA623C8F6D8EB9B6EA5C477C637295FABF20631C85116BFB') { throw 'O pacote do fornecedor mudou. Atualize o SpaceViewer antes de instalar.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
# Extract only the fixed archive's files, retaining the complete vendor package and its license.
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($entry in $zip.Entries) {
        if (!$entry.Name) { continue }
        $target = [IO.Path]::GetFullPath((Join-Path $driver $entry.FullName))
        if (!$target.StartsWith($driver + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Caminho invalido no pacote.' }
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
} finally { $zip.Dispose() }
$signature = Get-AuthenticodeSignature -LiteralPath (Join-Path $driver 'vbaudio_cable64_win10.cat')
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Windows Hardware Compatibility Publisher*') { throw 'Assinatura do driver de audio invalida.' }
$inf = Join-Path $driver 'vbMmeCable64_win10.inf'
& "$env:SystemRoot\System32\pnputil.exe" /add-driver $inf /install | Out-Null
if ($LASTEXITCODE -notin @(0, 3010)) { throw "Falha ao preparar VB-CABLE ($LASTEXITCODE)." }
& (Join-Path $PSScriptRoot 'SpaceviwerStreamDisplayCtl.exe') audio-ensure $inf
if ($LASTEXITCODE -notin @(0, 3010)) { throw "Falha ao instalar VB-CABLE ($LASTEXITCODE)." }
$verified = $false
for ($attempt=0; $attempt -lt 20; $attempt++) {
    $devices = @(Get-CimInstance Win32_PnPEntity | Where-Object { @($_.HardwareID) -contains 'VBAudioVACWDM' })
    if (@($devices | Where-Object { $_.ConfigManagerErrorCode -eq 0 }).Count -gt 0) { $verified=$true; break }
    Start-Sleep -Milliseconds 300
}
if (!$verified) { throw 'O Windows ainda nao ativou o VB-CABLE. Reinicie o computador para concluir.' }
