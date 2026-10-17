@echo off
rem 上載修改到 GitHub / Push your changes to GitHub
rem 用法 Usage: publish.cmd "你的訊息 your commit message"
cd /d "%~dp0"
set MSG=%~1
if "%MSG%"=="" set MSG=Update (%date% %time%)
git add -A
git commit -m "%MSG%"
git push
echo.
echo ✅ 已上載到 GitHub / Pushed to GitHub
pause
