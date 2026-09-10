@echo off
cd /d "%~dp0"
title SpaceViewer - Desinstalador do Driver de Tela Virtual
color 0c

:: Verificar e solicitar privilegios de Administrador
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Solicitando privilegios de Administrador para remover o driver...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ====================================================================
echo      SPACEVIEWER - REMOCAO DO DRIVER DE MONITOR VIRTUAL
echo ====================================================================
echo.

set CTL_EXE="%~dp0resources\spaceviwerstream\SpaceviwerStreamDisplayCtl.exe"

if not exist %CTL_EXE% (
    echo ERRO: Utilitario SpaceviwerStreamDisplayCtl.exe nao encontrado.
    pause
    exit /b 1
)

echo Removendo monitor virtual e pacote de driver OEM...
%CTL_EXE% remove
set ERR=%errorlevel%

if %ERR% EQU 0 (
    color 0a
    echo.
    echo Driver de monitor virtual removido com sucesso do Windows.
) else (
    echo Codigo de saida: %ERR%
)

echo.
pause
