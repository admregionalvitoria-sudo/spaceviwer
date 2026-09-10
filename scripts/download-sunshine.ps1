$ErrorActionPreference = 'Stop'
# Compatibility entry point: the application now builds its own native host.
& (Join-Path $PSScriptRoot 'build-native.ps1')
exit $LASTEXITCODE
