@echo off
setlocal

cd /d "%~dp0"

title Sistema Corretivas

echo =====================================
echo Iniciando Sistema Corretivas...
echo =====================================
echo.
echo Aguarde o servidor iniciar...
echo.

start "" cmd /c "timeout /t 6 >nul && start http://localhost:3001"

call npm.cmd start

pause