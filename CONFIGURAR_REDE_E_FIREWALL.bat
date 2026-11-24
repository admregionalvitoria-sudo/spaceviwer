:: SpaceViewer v3.0.0
@echo off
cd /d "%~dp0"
title SpaceViewer - Configurador de Rede e Firewall
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
echo Este utilitario resolve problemas para encontrar tablets e celulares
echo com o app SpaceViewer Display:
echo 1. Ajusta o perfil da rede Wi-Fi para Particular (Privada)
echo 2. Libera a descoberta dos aparelhos (UDP 47810 e 47812) e mDNS (5353)
echo 3. Libera a conexao de video do SpaceViewer (TCP 7523 e WebRTC)
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

:: 4. Adicionar regras no Firewall do Windows
echo.
echo [3/4] Configurando regras do Firewall do Windows...

:: Limpar regras antigas (inclui as do Sunshine / Moonlight de versoes anteriores)
for %%r in ("SpaceViewer SpaceviwerStream TCP" "SpaceViewer SpaceviwerStream UDP" "SpaceViewer SpaceviwerStream TCP Dev" "SpaceViewer SpaceviwerStream UDP Dev" "SpaceViewer Sunshine TCP" "SpaceViewer Sunshine UDP" "SpaceViewer GameStream Ports TCP" "SpaceViewer GameStream Ports UDP" "SpaceViewer App TCP" "SpaceViewer App UDP" "SpaceViewer Discovery UDP" "SpaceViewer Display Discovery UDP" "SpaceViewer WebRTC TCP") do (
    netsh advfirewall firewall delete rule name=%%r >nul 2>&1
)

:: Descoberta multicast (mDNS 5353, SSDP 1900) e dos aparelhos SpaceViewer Display (47810, 47812)
netsh advfirewall firewall add rule name="SpaceViewer Discovery UDP" dir=in action=allow profile=any protocol=UDP localport=5353,1900 enable=yes >nul
netsh advfirewall firewall add rule name="SpaceViewer Display Discovery UDP" dir=in action=allow profile=any protocol=UDP localport=47810,47812 enable=yes >nul
echo       - Regra criada: Descoberta UDP (5353, 1900, 47810, 47812)

:: Executavel SpaceViewer (WebRTC usa portas UDP dinamicas)
if exist "C:\Program Files\SpaceViewer\SpaceViewer.exe" (
    netsh advfirewall firewall add rule name="SpaceViewer App TCP" dir=in action=allow profile=any program="C:\Program Files\SpaceViewer\SpaceViewer.exe" enable=yes >nul
    netsh advfirewall firewall add rule name="SpaceViewer App UDP" dir=in action=allow profile=any program="C:\Program Files\SpaceViewer\SpaceViewer.exe" enable=yes >nul
)
echo       - Regra criada: Executavel SpaceViewer (TCP e UDP liberados)

:: Sinalizacao WebRTC e download do APK (7523) e agente PC (7524)
netsh advfirewall firewall add rule name="SpaceViewer WebRTC TCP" dir=in action=allow profile=any protocol=TCP localport=7523,7524 enable=yes >nul
echo       - Regra criada: Sinalizacao e download do APK (portas 7523 e 7524)

:: 5. Exibir os enderecos IP locais
echo.
echo [4/4] Enderecos IP deste computador:
powershell -NoProfile -Command "$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.IPAddress -notlike '169.254*' }).IPAddress; foreach ($ip in $ips) { Write-Host \"      --> IP: $ip   (APK: http://$($ip):7523/apk)\" -ForegroundColor Yellow }"

color 0a
echo.
echo ====================================================================
echo   CONFIGURACAO CONCLUIDA COM SUCESSO!
echo.
echo   COMO USAR UM TABLET OU CELULAR COMO TELA:
echo   1. Instale o app SpaceViewer Display (link do APK acima ou QR code
echo      em SpaceViewer ^> Telas ^> Instalar o app no aparelho).
echo   2. Abra o app no aparelho, na mesma rede Wi-Fi deste PC.
echo   3. No SpaceViewer, abra Telas, clique em Buscar e escolha
echo      Estender ou Duplicar.
echo ====================================================================
echo.
pause
