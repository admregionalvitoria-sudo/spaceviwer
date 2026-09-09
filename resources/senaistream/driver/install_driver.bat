@echo off
setlocal
cd /d "%~dp0"
echo [SpaceViewer] Configurando e Sincronizando Driver de Video Virtual (4 Telas)...

:: 1. Garantir pasta C:\VirtualDisplayDriver e copiar vdd_settings.xml com 4 telas
if not exist "C:\VirtualDisplayDriver" mkdir "C:\VirtualDisplayDriver"
if exist "virtual-display\vdd_settings.xml" (
    copy /Y "virtual-display\vdd_settings.xml" "C:\VirtualDisplayDriver\vdd_settings.xml" >nul 2>&1
    echo [SpaceViewer] Configuracao vdd_settings.xml (4 telas) sincronizada em C:\VirtualDisplayDriver.
)

:: 2. Instalar / Registrar driver se necessario via SenaiStreamDisplayCtl ensure
if exist "..\SenaiStreamDisplayCtl.exe" (
    echo [SpaceViewer] Registrando driver no Windows PnP...
    "..\SenaiStreamDisplayCtl.exe" ensure "virtual-display\MttVDD.inf"
)

:: 3. Reiniciar dispositivo PnP para carregar as 4 telas virtuais imediatamente
echo [SpaceViewer] Reiniciando adaptador de video virtual para ativar os 4 monitores...
pnputil /restart-device "ROOT\SENAISTREAM_VIRTUAL_DISPLAY\0000" >nul 2>&1
pnputil /restart-device "ROOT\MTTVDD\0000" >nul 2>&1
pnputil /restart-device "SWD\MTT_VDD\0000" >nul 2>&1

:: 4. Ativar modo de tela estendida no Windows
if exist "..\SenaiStreamDisplayCtl.exe" (
    "..\SenaiStreamDisplayCtl.exe" extend >nul 2>&1
)
DisplaySwitch.exe /extend >nul 2>&1

echo [SpaceViewer] Driver e 4 telas virtuais configurados com sucesso!
exit /b 0
