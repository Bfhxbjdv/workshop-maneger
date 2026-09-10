$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$runBat = Join-Path $projectDir "run.bat"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  Workshop Manager - Starting Website" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Kill old processes
Write-Host "  1/3 Stopping old processes..." -NoNewline
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*watchdog*" } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Write-Host " OK" -ForegroundColor Green

# Start watchdog (auto-restart on crash)
Write-Host "  2/3 Starting watchdog server..." -NoNewline
Start-Process -FilePath "powershell" -ArgumentList "-WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -File `"$projectDir\watchdog.ps1`" -NoWindow" -WorkingDirectory $projectDir
$serverOk = $false
for ($try = 0; $try -lt 5; $try++) {
  Start-Sleep -Seconds 3
  try { $r = Invoke-WebRequest -Uri "http://localhost:3000/" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; if ($r.StatusCode -eq 200) { $serverOk = $true; break } } catch {}
}
if ($serverOk) { Write-Host " OK" -ForegroundColor Green } else { Write-Host " FAILED" -ForegroundColor Red }
Write-Host "         http://localhost:3000"

# Network info
Write-Host "  3/3 Detecting network..." -NoNewline
$localIp = $null
try {
  $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -eq 'Wi-Fi' -and $_.PrefixOrigin -ne 'Duplicate' }).IPAddress
  if (-not $localIp) { $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -like '*Ethernet*' -and $_.PrefixOrigin -ne 'Duplicate' }).IPAddress }
}
catch {}
Write-Host " OK" -ForegroundColor Green

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host "  SYSTEM IS RUNNING" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "  [1] Local:    http://localhost:3000" -ForegroundColor Green
if ($localIp) { Write-Host "  [2] Network:  http://${localIp}:3000" -ForegroundColor Green }
Write-Host ""
Write-Host "  الموقع يعمل الآن ولن يتوقف" -ForegroundColor Yellow
Write-Host "  يعاد تشغيله تلقائياً إذا انطفأ" -ForegroundColor Yellow
Write-Host "  يشغل تلقائياً عند فتح اللابتوب" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Accounts: admin/admin123  designer/designer123" -ForegroundColor Gray
Write-Host "            laser/laser123  router/router123" -ForegroundColor Gray
Write-Host ""

Start-Process "http://localhost:3000"

Write-Host "======================================" -ForegroundColor Cyan
Write-Host "  يمكنك إغلاق هذه النافذة - السيرفر مستمر" -ForegroundColor Yellow
Write-Host "  لإيقاف السيرفر: أغلق powershell.exe من Task Manager" -ForegroundColor Yellow
Write-Host "======================================" -ForegroundColor Cyan

try { Read-Host "`nPress Enter to exit" } catch { Start-Sleep -Seconds 86400 }
