@echo off
rem 啟動 HKAT 閱讀理解生成器 / Start the app (double-click this file)
cd /d "%~dp0"
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  echo Installing dependencies, please wait...
  call npm install
)
echo.
echo   Open http://localhost:3000 in your browser. Press Ctrl+C to stop.
node server/index.js
pause
