:: SpaceViewer v2.2.9
@echo off
setlocal
cd /d "%~dp0"
echo ============================================================
echo [SpaceViewer] Instalador e Sincronizador de Monitor Virtual
echo ============================================================
echo.

:: Solicitar elevacao de Administrador se necessario
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [SpaceViewer] Solicitando permissao de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

if exist "resources\spaceviwerstream\driver\install_driver.bat" (
    call "resources\spaceviwerstream\driver\install_driver.bat"
) else (
    echo Arquivo install_driver.bat nao encontrado em resources\spaceviwerstream\driver\
)

echo.
echo ============================================================
echo [SpaceViewer] Concluido! Suas telas virtuais foram configuradas.
echo ============================================================
timeout /t 3
