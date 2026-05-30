# Start comment bridge now (hidden background process).
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Starter = Join-Path $Root "scripts\start_comment_bridge.ps1"
$Port = if ($env:LOCAL_COMMENT_BRIDGE_PORT) { $env:LOCAL_COMMENT_BRIDGE_PORT } else { "8765" }

try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
  if ($health.StatusCode -eq 200) {
    Write-Host "Bridge already running on port $Port"
    Write-Host $health.Content
    exit 0
  }
} catch {
  # not running
}

Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Starter`"" `
  -WorkingDirectory $Root `
  -WindowStyle Hidden

Start-Sleep -Seconds 2
$deadline = (Get-Date).AddSeconds(15)
while ((Get-Date) -lt $deadline) {
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -UseBasicParsing -TimeoutSec 2
    Write-Host "Bridge started on port $Port"
    Write-Host $health.Content
    exit 0
  } catch {
    Start-Sleep -Seconds 1
  }
}

Write-Host "Bridge process launched but health check did not pass yet. See tmp/comment-bridge.log"
exit 1
