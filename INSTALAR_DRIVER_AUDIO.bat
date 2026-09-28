@echo off
setlocal
cd /d "%~dp0"
title Instalador do Driver de Audio Virtual - SpaceViewer

net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo =======================================================================
    echo  AVISO: Este instalador requer privilegios de Administrador.
    echo  Solicitando permissao...
    echo =======================================================================
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo =======================================================================
echo     SPACEVIEWER - INSTALACAO DO DRIVER DE AUDIO VIRTUAL (VB-CABLE)
echo =======================================================================
echo.
echo  Instalando driver de audio virtual para transmissao de som
echo  sincronizado em tempo real para as TVs (Moonlight)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resources\spaceviwerstream\install-audio.ps1"
set TASK_EXIT=%errorlevel%

echo.
if %TASK_EXIT%==0 (
    echo =======================================================================
    echo  SUCESSO: Driver de audio virtual instalado e ativado!
    echo  O som do Windows agora sera transmitido sincronizado para as TVs.
    echo =======================================================================
) else (
    echo =======================================================================
    echo  ERRO (%TASK_EXIT%): Nao foi possivel concluir a instalacao automaticamente.
    echo  Verifique o log de erro acima.
    echo =======================================================================
)

echo.
pause
exit /b %TASK_EXIT%
