# Register AutoYT comment bridge to start hidden at Windows logon.
# Run once: powershell -ExecutionPolicy Bypass -File scripts/install_comment_bridge_autostart.ps1

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Starter = Join-Path $Root "scripts\start_comment_bridge.ps1"
$TaskName = "AutoYT TikTok Comment Bridge"

if (-not (Test-Path $Starter)) {
  throw "Missing starter script: $Starter"
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Starter`"" `
  -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description "Headless TikTok comment bridge for autoyt.cc (local Playwright -> VPS cache)" `
  -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Starts at logon for user: $env:USERNAME"
