param(
  [switch]$NoMongo
)

$ErrorActionPreference = "Stop"

function Write-Info($msg) {
  Write-Host "[run.ps1] $msg"
}

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $repoRoot "backend"
$frontend = Join-Path $repoRoot "frontend"

if (-not $NoMongo) {
  Write-Info "Starting MongoDB..."
  $mongoService = Get-Service -Name "MongoDB" -ErrorAction SilentlyContinue
  if ($mongoService) {
    try {
      if ($mongoService.Status -ne "Running") {
        Start-Service MongoDB
        Start-Sleep -Seconds 2
      }
      Write-Info "MongoDB service status: $((Get-Service MongoDB).Status)"
    } catch {
      Write-Info "Could not start MongoDB service. Trying to start mongod directly..."
      $mongodExe = "C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe"
      $mongodCfg = "C:\Program Files\MongoDB\Server\8.2\bin\mongod.cfg"
      if (Test-Path $mongodExe) {
        $args = @()
        if (Test-Path $mongodCfg) {
          $args += "--config"
          $args += "`"$mongodCfg`""
        }
        Start-Process -FilePath $mongodExe -ArgumentList $args -WindowStyle Minimized
      } else {
        Write-Info "mongod.exe not found at $mongodExe"
      }
    }
  } else {
    Write-Info "MongoDB service not found. Skipping service start."
  }
}

Write-Info "Starting Flask backend..."
$venvPython = Join-Path $backend "venv\Scripts\python.exe"
if (Test-Path $venvPython) {
  $backendCmd = "& `"$venvPython`" server.py"
} else {
  Write-Info "No venv found at backend\\venv. Using system python."
  $backendCmd = "python server.py"
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$backend`"; $backendCmd"

Write-Info "Starting React frontend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$frontend`"; npm start"

Write-Info "Done. Backend and frontend are running in separate windows."
