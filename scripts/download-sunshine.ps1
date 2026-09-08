$ErrorActionPreference = 'Stop'
$repo = 'LizardByte/Sunshine'

Write-Host "Fetching latest release info from GitHub..."
try {
    # Force TLS 1.2
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/latest"
    $asset = $release.assets | Where-Object { $_.name -like "*portable.zip*" } | Select-Object -First 1
    
    if (-not $asset) {
        throw "Could not find a portable.zip asset in the latest release!"
    }
    
    Write-Host "Found asset: $($asset.name) (Tag: $($release.tag_name))"
    Write-Host "Downloading from $($asset.browser_download_url)..."
    
    $destDir = Join-Path $PSScriptRoot "..\resources\sunshine"
    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir | Out-Null
    }
    
    $zipPath = Join-Path $destDir "sunshine.zip"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
    
    Write-Host "Download complete. Extracting to $destDir..."
    Expand-Archive -Path $zipPath -DestinationPath $destDir -Force
    
    Write-Host "Cleaning up zip file..."
    Remove-Item $zipPath
    
    Write-Host "Sunshine successfully downloaded and extracted!"
} catch {
    Write-Error "Failed to download Sunshine: $_"
    exit 1
}
