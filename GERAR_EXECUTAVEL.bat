@echo off
cd /d "%~dp0"
title SpaceViewer - Gerador de Executavel Atualizado
color 0b

net session >nul 2>&1
if %errorLevel% NEQ 0 (
    echo Solicitando privilegios de Administrador...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ===================================================
echo             SPACEVIEWER BUILD SYSTEM
echo ===================================================
echo.
echo Diretorio: %CD%
echo.

echo [1/3] Verificando dependencias...
call npm install
if %ERRORLEVEL% NEQ 0 (
    color 0c
    echo ERRO: npm install falhou.
    pause
    exit /b 1
)

echo.
echo [2/3] Compilando e gerando instalador Windows com elevacao UAC (perMachine)...
call npm run package:win
if %ERRORLEVEL% NEQ 0 (
    color 0c
    echo ERRO: Empacotamento falhou.
    pause
    exit /b 1
)

echo.
echo [3/3] Sincronizando instalador entre as pastas de saida...
if not exist "dist-installer" mkdir "dist-installer" >nul 2>&1
if not exist "dist-electron" mkdir "dist-electron" >nul 2>&1
if exist "release\SpaceViewer-Setup-*.exe" (
    copy /Y "release\SpaceViewer-Setup-*.exe" "dist-installer\" >nul
    copy /Y "release\SpaceViewer-Setup-*.exe" "dist-electron\" >nul
)

color 0a
echo.
echo ====================================================================
echo   CONCLUIDO COM SUCESSO!
echo.
echo   Instalador gerado com permissao de Administrador (perMachine: true):
echo   - dist-installer\SpaceViewer-Setup-2.2.1.exe
echo   - dist-electron\SpaceViewer-Setup-2.2.1.exe
echo.
echo   O instalador ira registrar automaticamente o Driver de Tela Virtual
echo   (MTT VDD) para que o Moonlight funcione no modo TELA ESTENDIDA!
echo ====================================================================
echo.
pause
