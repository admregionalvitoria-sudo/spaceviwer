@echo off
setlocal
cd /d "%~dp0"
net session >nul 2>&1
if %errorlevel% NEQ 0 (
    echo Execute este arquivo como Administrador para alterar o driver.
    pause
    exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0resources\spaceviwerstream\display-manager.ps1" -Action remove
set TASK_EXIT=%errorlevel%
if not %TASK_EXIT%==0 echo O Windows nao confirmou a alteracao. Consulte o erro acima.
pause
exit /b %TASK_EXIT%
