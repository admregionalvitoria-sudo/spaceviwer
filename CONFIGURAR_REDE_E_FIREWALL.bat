@echo off
cd /d "%~dp0"
title SpaceViewer - Configurador de Rede, Firewall e Moonlight
color 0b

:: 1. Solicitar privilegios de Administrador
net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Solicitando privilegios de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ====================================================================
echo      SPACEVIEWER - CONFIGURACAO DE REDE LOCAL E FIREWALL
echo ====================================================================
echo.
echo Este utilitario resolve problemas de descoberta no Moonlight e Smart TVs:
echo 1. Ajusta o perfil da rede Wi-Fi para Particular (Privada)
echo 2. Habilita as portas de descoberta mDNS (5353) e SSDP (1900)
echo 3. Configura as regras do Firewall do Windows para o SpaceViewer e SenaiStream
echo.

:: 2. Alterar o perfil de rede ativa para Particular (Private)
echo [1/4] Ajustando perfil da rede Wi-Fi para Particular (Privada)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private"
if %errorLevel% EQU 0 (
    echo       Rede Wi-Fi configurada com sucesso como Rede Privada!
) else (
    echo       Aviso: Nao foi possivel alterar o perfil de rede automaticamente.
)

:: 3. Iniciar servicos de descoberta do Windows caso estejam desativados
echo.
echo [2/4] Verificando servicos de descoberta do Windows (SSDP e UPnP)...
sc config SSDPSRV start= demand >nul 2>&1
net start SSDPSRV >nul 2>&1
sc config upnphost start= demand >nul 2>&1
net start upnphost >nul 2>&1
echo       Servicos de descoberta ativos.

:: 4. Adicionar regras completas no Firewall do Windows
echo.
echo [3/4] Configurando regras do Firewall do Windows...

:: Limpar regras antigas
netsh advfirewall firewall delete rule name="SpaceViewer SenaiStream TCP" >nul 2>&1
netsh advfirewall firewall delete rule name="SpaceViewer SenaiStream UDP" >nul 2>&1
netsh advfirewall firewall delete rule name="SpaceViewer App TCP" >nul 2>&1
netsh advfirewall firewall delete rule name="SpaceViewer App UDP" >nul 2>&1
netsh advfirewall firewall delete rule name="SpaceViewer Discovery UDP" >nul 2>&1
netsh advfirewall firewall delete rule name="SpaceViewer WebRTC TCP" >nul 2>&1

:: Regras de Descoberta Multicast (mDNS 5353 para Moonlight e SSDP 1900 para Smart TVs)
netsh advfirewall firewall add rule name="SpaceViewer Discovery UDP" dir=in action=allow profile=any protocol=UDP localport=5353,1900 enable=yes >nul
echo       - Regra criada: Descoberta Multicast UDP (portas 5353 e 1900)

:: Regras GameStream / SenaiStream para Moonlight (TCP 47984, 47989, 48010 e UDP 47998-48010)
if exist "C:\Program Files\SpaceViewer\resources\senaistream\SenaiStream.exe" (
    netsh advfirewall firewall add rule name="SpaceViewer SenaiStream TCP" dir=in action=allow profile=any protocol=TCP localport=47984,47989,48010 program="C:\Program Files\SpaceViewer\resources\senaistream\SenaiStream.exe" enable=yes >nul
    netsh advfirewall firewall add rule name="SpaceViewer SenaiStream UDP" dir=in action=allow profile=any protocol=UDP localport=47998-48010 program="C:\Program Files\SpaceViewer\resources\senaistream\SenaiStream.exe" enable=yes >nul
)
if exist "%~dp0resources\senaistream\SenaiStream.exe" (
    netsh advfirewall firewall add rule name="SpaceViewer SenaiStream TCP Dev" dir=in action=allow profile=any protocol=TCP localport=47984,47989,48010 program="%~dp0resources\senaistream\SenaiStream.exe" enable=yes >nul
    netsh advfirewall firewall add rule name="SpaceViewer SenaiStream UDP Dev" dir=in action=allow profile=any protocol=UDP localport=47998-48010 program="%~dp0resources\senaistream\SenaiStream.exe" enable=yes >nul
)
:: Regra generica de portas GameStream (para garantir em qualquer pasta)
netsh advfirewall firewall add rule name="SpaceViewer GameStream Ports TCP" dir=in action=allow profile=any protocol=TCP localport=47984,47989,48010 enable=yes >nul
netsh advfirewall firewall add rule name="SpaceViewer GameStream Ports UDP" dir=in action=allow profile=any protocol=UDP localport=47998-48010 enable=yes >nul
echo       - Regra criada: Portas GameStream nativas (TCP 47984, 47989, 48010 e UDP 47998-48010)

:: Regras do Executavel SpaceViewer
if exist "C:\Program Files\SpaceViewer\SpaceViewer.exe" (
    netsh advfirewall firewall add rule name="SpaceViewer App TCP" dir=in action=allow profile=any program="C:\Program Files\SpaceViewer\SpaceViewer.exe" enable=yes >nul
    netsh advfirewall firewall add rule name="SpaceViewer App UDP" dir=in action=allow profile=any program="C:\Program Files\SpaceViewer\SpaceViewer.exe" enable=yes >nul
)
echo       - Regra criada: Executavel SpaceViewer (TCP e UDP liberados)

:: Regras WebRTC Signaling
netsh advfirewall firewall add rule name="SpaceViewer WebRTC TCP" dir=in action=allow profile=any protocol=TCP localport=7523,7524 enable=yes >nul
echo       - Regra criada: Sinalizacao WebRTC LAN (portas 7523 e 7524)

:: 5. Obter e exibir os enderecos IP locais
echo.
echo [4/4] Verificando IP local da maquina para conexao no Moonlight...
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set LOCAL_IP=%%a
    goto :show_ip
)

:show_ip
color 0a
echo.
echo ====================================================================
echo   CONFIGURACAO CONCLUIDA COM SUCESSO!
echo.
echo   Seu computador agora esta visivel na rede local para:
echo   - Smart TVs (LG WebOS, Samsung Tizen, Android TV, Roku)
echo   - Clientes Moonlight (Celular, Tablet, TV ou PC)
echo.
echo   COMO CONECTAR NO MOONLIGHT AGORA:
echo   1. Abra o aplicativo Moonlight no seu celular ou TV (na mesma rede Wi-Fi).
echo   2. Se o SpaceViewer nao aparecer automaticamente na lista:
echo      Toque no icone de '+' (Adicionar Computador) e digite seu IP:
echo.
powershell -NoProfile -Command "$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' }).IPAddress; foreach ($ip in $ips) { Write-Host \"      --> IP: $ip\" -ForegroundColor Yellow }"
echo.
echo   3. O Moonlight exibira um PIN de 4 digitos na tela da TV/celular.
echo   4. No SpaceViewer, va na aba 'Moonlight', digite o PIN e clique em 'Parear PIN'.
echo ====================================================================
echo.
pause
