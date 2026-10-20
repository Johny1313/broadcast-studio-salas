@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Broadcast Studio Dual Canvas v1.7.0
where node >nul 2>nul
if errorlevel 1 (
 echo [ERRO] Node.js 20+ nao encontrado.
 echo Instale o Node.js pelo site oficial e execute novamente.
 pause
 exit /b 1
)
if exist "node_modules\.bin\electron.cmd" (
 echo [MODO DESKTOP] Abrindo Electron com filtro de anuncios.
 call "node_modules\.bin\electron.cmd" .
 exit /b %ERRORLEVEL%
)
echo.
echo [ATENCAO] Electron nao instalado nesta pasta.
echo Neste modo NAVEGADOR o bloqueador de anuncios NAO funciona.
echo Para habilitar, execute manualmente: npm install e depois npm start.
echo.
start "" "http://127.0.0.1:8791/"
echo Estudio: http://127.0.0.1:8791
echo Convidados local: http://127.0.0.1:8792
echo Ctrl+C encerra servidor local.
node server\room-server.cjs
if errorlevel 1 pause
