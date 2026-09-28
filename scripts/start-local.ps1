param([int]$Port = 8787)

$ErrorActionPreference = 'Stop'
$isOpen = Test-NetConnection -ComputerName localhost -Port $Port -InformationLevel Quiet -WarningAction SilentlyContinue
if ($isOpen) {
  Write-Host "Local site is already running at http://localhost:$Port"
  exit 0
}

$env:PORT = [string]$Port
$env:NODE_ENV = 'development'
Write-Host "Starting local site at http://localhost:$Port ..."
node server.js
