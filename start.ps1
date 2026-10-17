# 啟動 HKAT 閱讀理解生成器 / Start the app
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User')
Set-Location $PSScriptRoot

if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "已建立 .env（請填入 API Key，或到 http://localhost:3000 的「⚙️ 設定」貼上）" -ForegroundColor Yellow
}

Write-Host "啟動中… http://localhost:3000  (Ctrl+C 結束)" -ForegroundColor Cyan
node server/index.js
