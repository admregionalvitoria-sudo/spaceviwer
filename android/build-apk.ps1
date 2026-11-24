# Builds SpaceViewer Display (Android receiver) without Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner.
# Output: dist-apk\SpaceViewerDisplay-<version>.apk and resources\apk\SpaceViewerDisplay.apk
$ErrorActionPreference = 'Stop'
$android = $PSScriptRoot
$root = Split-Path $android -Parent

function Invoke-Tool([string]$Name, [string]$Exe, [string[]]$Arguments) {
    Write-Host "==> $Name" -ForegroundColor Cyan
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Name falhou (codigo $LASTEXITCODE)." }
}

function Get-HighestVersionDir([string]$Parent, [string]$Preferred) {
    if (Test-Path (Join-Path $Parent $Preferred)) { return Join-Path $Parent $Preferred }
    $dirs = @(Get-ChildItem -LiteralPath $Parent -Directory -ErrorAction SilentlyContinue | Sort-Object { [version](($_.Name -replace '[^\d\.]', '') + '.0') } -Descending)
    if ($dirs.Count -eq 0) { throw "Nenhum diretorio encontrado em $Parent." }
    return $dirs[0].FullName
}

# --- Toolchain -------------------------------------------------------------
$sdk = @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA 'Android\Sdk')) |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $sdk) { throw 'Android SDK nao encontrado. Defina ANDROID_HOME ou instale o SDK em %LOCALAPPDATA%\Android\Sdk.' }
$buildTools = Get-HighestVersionDir (Join-Path $sdk 'build-tools') '34.0.0'
$platformDir = Get-HighestVersionDir (Join-Path $sdk 'platforms') 'android-34'
$androidJar = Join-Path $platformDir 'android.jar'
$aapt2 = Join-Path $buildTools 'aapt2.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
foreach ($tool in @($androidJar, $aapt2, $d8, $zipalign, $apksigner)) {
    if (-not (Test-Path $tool)) { throw "Ferramenta do SDK ausente: $tool" }
}
$javac = (Get-Command javac -ErrorAction SilentlyContinue).Source
$keytool = (Get-Command keytool -ErrorAction SilentlyContinue).Source
if (-not $javac -or -not $keytool) {
    $java = (Get-Command java -ErrorAction SilentlyContinue).Source
    if ($java) {
        $jdkBin = Split-Path $java -Parent
        if (-not $javac) { $javac = Join-Path $jdkBin 'javac.exe' }
        if (-not $keytool) { $keytool = Join-Path $jdkBin 'keytool.exe' }
    }
}
if (-not $javac -or -not (Test-Path $javac)) { throw 'JDK (javac) nao encontrado no PATH. Instale o JDK 17.' }
Write-Host "SDK: $sdk | build-tools: $(Split-Path $buildTools -Leaf) | plataforma: $(Split-Path $platformDir -Leaf)"

# --- Version ---------------------------------------------------------------
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$numbers = @($version.Split('.') | ForEach-Object { [int]('0' + ($_ -replace '[^\d].*$', '')) }) + @(0, 0, 0)
$versionCode = [int]($numbers[0] * 10000 + $numbers[1] * 100 + $numbers[2])
Write-Host "Versao: $version ($versionCode)"

# --- Workspace -------------------------------------------------------------
$build = Join-Path $android 'build'
if (Test-Path $build) { Remove-Item -LiteralPath $build -Recurse -Force }
$res = Join-Path $build 'res'
$gen = Join-Path $build 'gen'
$classes = Join-Path $build 'classes'
$dex = Join-Path $build 'dex'
New-Item -ItemType Directory -Force -Path $res, $gen, $classes, $dex | Out-Null
Copy-Item -Path (Join-Path $android 'res\*') -Destination $res -Recurse -Force

# Launcher icons scaled from resources\icon.png.
Add-Type -AssemblyName System.Drawing
$iconSource = Join-Path $root 'resources\icon.png'
$sizes = @{ 'mipmap-mdpi' = 48; 'mipmap-hdpi' = 72; 'mipmap-xhdpi' = 96; 'mipmap-xxhdpi' = 144; 'mipmap-xxxhdpi' = 192 }
$sourceImage = [System.Drawing.Image]::FromFile($iconSource)
try {
    foreach ($entry in $sizes.GetEnumerator()) {
        $dir = Join-Path $res $entry.Key
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        $bitmap = New-Object System.Drawing.Bitmap $entry.Value, $entry.Value
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($sourceImage, 0, 0, $entry.Value, $entry.Value)
        $graphics.Dispose()
        $bitmap.Save((Join-Path $dir 'ic_launcher.png'), [System.Drawing.Imaging.ImageFormat]::Png)
        $bitmap.Dispose()
    }
} finally { $sourceImage.Dispose() }

# --- Resources -------------------------------------------------------------
$compiled = Join-Path $build 'compiled-res.zip'
$unsigned = Join-Path $build 'app-unsigned.apk'
Invoke-Tool 'aapt2 compile' $aapt2 @('compile', '--dir', $res, '-o', $compiled)
Invoke-Tool 'aapt2 link' $aapt2 @('link', '-o', $unsigned, '-I', $androidJar,
    '--manifest', (Join-Path $android 'AndroidManifest.xml'), '--java', $gen,
    '-A', (Join-Path $android 'assets'), '--min-sdk-version', '24', '--target-sdk-version', '34',
    '--version-code', "$versionCode", '--version-name', $version, '--auto-add-overlay', $compiled)

# --- Java ------------------------------------------------------------------
$sources = @(Get-ChildItem -Path (Join-Path $android 'src'), $gen -Recurse -Filter '*.java' | ForEach-Object { '"' + ($_.FullName -replace '\\', '/') + '"' })
$sourcesFile = Join-Path $build 'sources.txt'
[IO.File]::WriteAllLines($sourcesFile, $sources)
Invoke-Tool 'javac' $javac @('-encoding', 'UTF-8', '-source', '8', '-target', '8', '-Xlint:-options',
    '-bootclasspath', $androidJar, '-d', $classes, "@$sourcesFile")

$classFiles = @(Get-ChildItem -Path $classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
Invoke-Tool 'd8' $d8 (@('--release', '--min-api', '24', '--lib', $androidJar, '--output', $dex) + $classFiles)

# --- Package ---------------------------------------------------------------
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($unsigned, [System.IO.Compression.ZipArchiveMode]::Update)
try {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $dex 'classes.dex'), 'classes.dex', [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
} finally { $zip.Dispose() }

$aligned = Join-Path $build 'app-aligned.apk'
Invoke-Tool 'zipalign' $zipalign @('-f', '-p', '4', $unsigned, $aligned)

# --- Signing ---------------------------------------------------------------
$keystoreDir = Join-Path $android 'keystore'
$keystore = Join-Path $keystoreDir 'spaceviewer-debug.keystore'
$alias = if ($env:SPACEVIEWER_APK_KEY_ALIAS) { $env:SPACEVIEWER_APK_KEY_ALIAS } else { 'spaceviewer' }
$password = if ($env:SPACEVIEWER_APK_KEYSTORE_PASSWORD) { $env:SPACEVIEWER_APK_KEYSTORE_PASSWORD } else { 'spaceviewer' }
# CI: a fixed keystore keeps the signature stable so Android accepts updates over an installed APK.
if ($env:SPACEVIEWER_APK_KEYSTORE_BASE64) {
    New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null
    [IO.File]::WriteAllBytes($keystore, [Convert]::FromBase64String($env:SPACEVIEWER_APK_KEYSTORE_BASE64))
}
if (-not (Test-Path $keystore)) {
    New-Item -ItemType Directory -Force -Path $keystoreDir | Out-Null
    Invoke-Tool 'keytool' $keytool @('-genkeypair', '-keystore', $keystore, '-alias', $alias, '-keyalg', 'RSA', '-keysize', '2048',
        '-validity', '10000', '-storepass', $password, '-keypass', $password, '-dname', 'CN=SpaceViewer Display, O=SpaceViewer, C=BR')
}

$distDir = Join-Path $root 'dist-apk'
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
$signed = Join-Path $distDir "SpaceViewerDisplay-$version.apk"
Invoke-Tool 'apksigner sign' $apksigner @('sign', '--ks', $keystore, '--ks-key-alias', $alias,
    '--ks-pass', "pass:$password", '--key-pass', "pass:$password", '--out', $signed, $aligned)
Invoke-Tool 'apksigner verify' $apksigner @('verify', $signed)

$resourceApkDir = Join-Path $root 'resources\apk'
New-Item -ItemType Directory -Force -Path $resourceApkDir | Out-Null
Copy-Item -LiteralPath $signed -Destination (Join-Path $resourceApkDir 'SpaceViewerDisplay.apk') -Force
Remove-Item -LiteralPath "$signed.idsig" -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item $signed).Length / 1KB)
Write-Host "APK gerado: $signed ($size KB)" -ForegroundColor Green
