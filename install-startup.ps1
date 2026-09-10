$taskName = "WorkshopManagerServer"
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $projectDir "run.bat"

# Remove old task if exists
schtasks /DELETE /TN $taskName /F 2>$null

# Create new task: run at user logon, with highest privileges
schtasks /CREATE /SC ONLOGON /TN $taskName /TR "`"$batPath`"" /IT /DELAY 0000:10 /F

if ($LASTEXITCODE -eq 0) {
  Write-Host "✅ تم تثبيت المهمة '$taskName' - ستعمل تلقائياً عند تسجيل الدخول" -ForegroundColor Green
} else {
  Write-Host "❌ فشل تثبيت المهمة، سيتم استخدام Startup Folder كبديل" -ForegroundColor Yellow
  # Fallback: add to Startup folder
  $startupFolder = [Environment]::GetFolderPath("Startup")
  $shortcutPath = Join-Path $startupFolder "ورشة التصميم والقص.lnk"
  $wsh = New-Object -ComObject WScript.Shell
  $shortcut = $wsh.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $batPath
  $shortcut.WindowStyle = 7  # Minimized
  $shortcut.Description = "تشغيل خادم ورشة التصميم والقص"
  $shortcut.WorkingDirectory = $projectDir
  $shortcut.Save()
  Write-Host "✅ تم إنشاء اختصار في Startup Folder: $startupFolder" -ForegroundColor Green
}

Write-Host "`n🔍 للتحقق، افتح Task Scheduler وابحث عن '$taskName'" -ForegroundColor Cyan
pause
