@echo off
setlocal
cd /d "%~dp0"
echo Importando planilha base para o banco local...
call npm.cmd run import:excel
echo.
pause

