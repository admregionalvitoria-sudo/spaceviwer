@echo off
cd /d "%~dp0"
title SpaceViewer - Instalador do Driver de Tela Virtual (Extensor Moonlight)
color 0b

:: Verificar e solicitar privilegios de Administrador
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando privilegios de Administrador para registrar o driver no Windows...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ====================================================================
echo      SPACEVIEWER - INSTALACAO DO DRIVER DE MONITOR VIRTUAL
echo ====================================================================
echo.
echo Este processo instala o driver de monitor virtual (MTT VDD) no Windows.
echo Isso permite que o Moonlight transmita como uma SEGUNDA TELA INDEPENDENTE
echo sem bloquear ou espelhar a tela principal do seu computador.
echo.

:: 1. Copiar configuracoes do driver para C:\VirtualDisplayDriver
echo [1/4] Preparando pasta de configuracoes C:\VirtualDisplayDriver...
if not exist "C:\VirtualDisplayDriver" (
    mkdir "C:\VirtualDisplayDriver" >nul 2>&1
)
if exist "resources\senaistream\driver\virtual-display\vdd_settings.xml" (
    copy /Y "resources\senaistream\driver\virtual-display\vdd_settings.xml" "C:\VirtualDisplayDriver\vdd_settings.xml" >nul
    echo       Arquivo de resolucoes e configuracoes copiado.
)

:: 2. Localizar utilitario e INF
set CTL_EXE="%~dp0resources\senaistream\SenaiStreamDisplayCtl.exe"
set INF_FILE="%~dp0resources\senaistream\driver\virtual-display\MttVDD.inf"

if not exist %CTL_EXE% (
    color 0c
    echo.
    echo ERRO: Utilitario SenaiStreamDisplayCtl.exe nao encontrado em:
    echo %CTL_EXE%
    echo.
    pause
    exit /b 1
)

if not exist %INF_FILE% (
    color 0c
    echo.
    echo ERRO: Arquivo do driver MttVDD.inf nao encontrado em:
    echo %INF_FILE%
    echo.
    pause
    exit /b 1
)

:: 3. Instalar o dispositivo virtual e assinar com o driver
echo.
echo [2/4] Registrando dispositivo e instalando driver de video virtual...
%CTL_EXE% ensure %INF_FILE%
set ERR=%errorlevel%

if %ERR% EQU 0 (
    echo       Driver de monitor virtual instalado com sucesso!
) else if %ERR% EQU 3010 (
    echo       Driver instalado! Reinicio do Windows recomendado para finalizar.
) else (
    color 0c
    echo.
    echo ERRO: Falha na instalacao do driver. Codigo de erro: %ERR%
    echo.
    pause
    exit /b %ERR%
)

:: 4. Ativar modo Estendido no Windows
echo.
echo [3/4] Ativando modo de extensao de tela no Windows (DisplaySwitch /extend)...
%CTL_EXE% extend
timeout /t 2 /nobreak >nul

:: 5. Validar status do monitor virtual
echo.
echo [4/4] Validando deteccao do monitor virtual...
%CTL_EXE% status
if %errorlevel% EQU 0 (
    color 0a
    echo.
    echo ====================================================================
    echo   SUCESSO! O MONITOR VIRTUAL ESTA ATIVO E PRONTO!
    echo.
    echo   Agora abra o SpaceViewer e inicie a conexao pelo Moonlight:
    echo   A transmissao sera exibida na TV como uma tela estendida.
    echo ====================================================================
) else (
    color 0e
    echo.
    echo ====================================================================
    echo   AVISO: O driver foi registrado, mas o monitor virtual ainda nao
    echo   apareceu na lista ativa de monitores do Windows.
    echo   Recomendamos reiniciar o Windows uma vez para carregar o driver.
    echo ====================================================================
)

echo.
pause
