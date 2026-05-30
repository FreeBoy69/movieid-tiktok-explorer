# Starts local_comment_bridge.mjs (used by Task Scheduler at logon).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $Root "tmp"
$LogFile = Join-Path $LogDir "comment-bridge.log"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Set-Location $Root

function Resolve-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) { return $node.Source }
  throw "Node.js not found on PATH. Install Node or add it to PATH."
}

$nodeExe = Resolve-Node
$bridgeScript = Join-Path $Root "scripts\local_comment_bridge.mjs"

Add-Content -Path $LogFile -Value ("[{0}] starting bridge pid={1}" -f (Get-Date -Format "o"), $PID)

& $nodeExe $bridgeScript *>> $LogFile
