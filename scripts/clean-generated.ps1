[CmdletBinding(SupportsShouldProcess)]
param()
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
# Only disposable Vite configuration snapshots and the development log.
# Keep source, native dependencies, installers, and release artifacts.
$targets = @(Get-ChildItem -LiteralPath $root -File | Where-Object {
    $_.Name -match '^electron\.vite\.config\.\d+\.mjs$' -or $_.Name -eq 'dev_log.txt'
})
foreach ($target in $targets) {
    if ([IO.Path]::GetDirectoryName($target.FullName) -ne $root) { throw 'Caminho fora do projeto.' }
    if ($PSCmdlet.ShouldProcess($target.FullName, 'Remover arquivo temporario gerado')) {
        Remove-Item -LiteralPath $target.FullName -Force
    }
}
