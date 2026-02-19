@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado o no esta en PATH.
  echo Instala Node.js desde https://nodejs.org/
  pause
  exit /b 1
)

echo Iniciando YumeVerse en http://localhost:8787
start "" "http://localhost:8787"

node server.js

echo.
echo El servidor se ha detenido.
pause

