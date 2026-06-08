@echo off
setlocal
cd /d "%~dp0"
echo Instalando dependencias do Corretivas...
call npm.cmd install
if errorlevel 1 goto erro
echo Preparando banco de dados local...
call npm.cmd run db:migrate
if errorlevel 1 goto erro
echo Gerando versao do sistema...
call npm.cmd run build
if errorlevel 1 goto erro
echo.
echo Instalacao concluida.
echo Use "Iniciar Corretivas.bat" para abrir o sistema.
pause
exit /b 0

:erro
echo.
echo Ocorreu uma falha na instalacao.
pause
exit /b 1

