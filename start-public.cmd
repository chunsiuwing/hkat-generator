@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   HKAT Generator - public mode
echo ============================================

rem Start the local server (if not already running)
netstat -ano | findstr ":3000.*LISTENING" >nul
if errorlevel 1 (
  start "HKAT server" cmd /k "node server\index.js"
  timeout /t 3 /nobreak >nul
  echo [OK] server started
) else (
  echo [OK] server already running
)

rem Start the Cloudflare tunnel (free, no account needed)
if not exist cloudflared.exe (
  echo.
  echo [X] cloudflared.exe not found - download it once from:
  echo     https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
  echo     and put it in this folder.
  pause
  exit /b 1
)
start "HKAT tunnel" cmd /k "cloudflared.exe tunnel --url http://localhost:3000"
echo [OK] tunnel starting

echo.
echo   Local:   http://localhost:3000
echo   Public:  look in the "HKAT tunnel" window for the https://....trycloudflare.com address
echo             (the address CHANGES every time the tunnel restarts)
echo.
echo   NOTE: keep both windows open. Closing them stops the service.
pause
