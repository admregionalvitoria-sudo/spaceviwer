@echo off
setlocal
cd /d "%~dp0"
echo [SpaceViewer] Configurando e Instalando Driver de Video Virtual (4 Telas)...

:: Verificar se tem permissao de Administrador
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [SpaceViewer] Solicitando permissao de Administrador para registrar o driver...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process '%~f0' -Verb RunAs -Wait"
    exit /b %errorLevel%
)

:: 1. Garantir pasta C:\VirtualDisplayDriver e copiar arquivos do driver
if not exist "C:\VirtualDisplayDriver" mkdir "C:\VirtualDisplayDriver"
if exist "virtual-display\vdd_settings.xml" (
    copy /Y "virtual-display\*" "C:\VirtualDisplayDriver\" >nul 2>&1
    echo [SpaceViewer] Arquivos do driver sincronizados em C:\VirtualDisplayDriver.
)

:: 2. Instalar pacote de driver no Windows Driver Store (garante que o Windows reconheca o INF)
echo [SpaceViewer] Adicionando pacote de driver ao Windows DriverStore...
if exist "virtual-display\MttVDD.inf" (
    pnputil /add-driver "virtual-display\MttVDD.inf" /install >nul 2>&1
)
if exist "C:\VirtualDisplayDriver\MttVDD.inf" (
    pnputil /add-driver "C:\VirtualDisplayDriver\MttVDD.inf" /install >nul 2>&1
)

:: 3. Criar / Registrar dispositivo PnP via SpaceviwerStreamDisplayCtl ensure
set CTL_EXE=""
if exist "..\SpaceviwerStreamDisplayCtl.exe" set CTL_EXE="..\SpaceviwerStreamDisplayCtl.exe"

if %CTL_EXE% neq "" (
    echo [SpaceViewer] Registrando adaptador de video virtual no Windows PnP...
    if exist "virtual-display\MttVDD.inf" (
        %CTL_EXE% ensure "virtual-display\MttVDD.inf" >nul 2>&1
    ) else if exist "C:\VirtualDisplayDriver\MttVDD.inf" (
        %CTL_EXE% ensure "C:\VirtualDisplayDriver\MttVDD.inf" >nul 2>&1
    )
)

:: 4. Reiniciar dispositivo PnP para carregar as telas virtuais imediatamente
echo [SpaceViewer] Reiniciando adaptador de video virtual para ativar os monitores...
pnputil /restart-device "ROOT\SPACEVIWERSTREAM_VIRTUAL_DISPLAY\0000" >nul 2>&1
pnputil /restart-device "ROOT\MTTVDD\0000" >nul 2>&1
pnputil /restart-device "SWD\MTT_VDD\0000" >nul 2>&1

:: 5. Ativar modo de tela estendida no Windows
if %CTL_EXE% neq "" (
    %CTL_EXE% extend >nul 2>&1
)
DisplaySwitch.exe /extend >nul 2>&1

echo [SpaceViewer] Driver e telas virtuais configurados com sucesso!
exit /b 0
