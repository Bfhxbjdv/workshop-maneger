param([switch]$NoWindow)
$ErrorActionPreference = "Continue"
$projectDir = "C:\Users\HP\Desktop\FCD6~1"
$logFile = Join-Path $projectDir "server-watchdog.log"
$restartCount = 0

function Write-Log {
  param($msg)
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  "$timestamp $msg" | Out-File -FilePath $logFile -Append -Encoding UTF8
}

Write-Log "=============================================="
Write-Log "Watchdog started"

while ($true) {
  $restartCount++
  Write-Log "Starting server (attempt #$restartCount)..."
  
  $nodeExe = "node"
  $nodeArgs = @("server.js")
  
  if ($NoWindow) {
    try {
      $psi = New-Object System.Diagnostics.ProcessStartInfo
      $psi.FileName = $nodeExe
      $psi.Arguments = $nodeArgs
      $psi.WorkingDirectory = $projectDir
      $psi.UseShellExecute = $false
      $psi.RedirectStandardOutput = $true
      $psi.RedirectStandardError = $true
      $psi.CreateNoWindow = $true
      $p = [System.Diagnostics.Process]::Start($psi)
      $output = $p.StandardOutput.ReadToEnd()
      $errorOut = $p.StandardError.ReadToEnd()
      $p.WaitForExit()
      $exitCode = $p.ExitCode
      if ($output) { Write-Log "OUT: $output" }
      if ($errorOut) { Write-Log "ERR: $errorOut" }
    } catch {
      Write-Log "ERROR starting process: $_"
      $exitCode = -1
    }
  } else {
    Write-Log "Running in window mode"
    try {
      $p = Start-Process -FilePath $nodeExe -ArgumentList $nodeArgs -WorkingDirectory $projectDir -NoNewWindow -Wait -PassThru
      $exitCode = $p.ExitCode
    } catch {
      Write-Log "ERROR: $_"
      $exitCode = -1
    }
  }
  
  Write-Log "Server stopped (exit code: $exitCode)"
  
  if ($exitCode -eq 0) {
    Write-Log "Clean exit - stopping watchdog"
    break
  }
  
  Write-Log "Restarting in 3 seconds..."
  Start-Sleep -Seconds 3
}
