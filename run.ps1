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

function Resolve-Mongod {
  $cmd = Get-Command mongod -ErrorAction SilentlyContinue
  if ($cmd -and (Test-Path $cmd.Path)) {
    return $cmd.Path
  }

  $mongoRoot = "C:\Program Files\MongoDB\Server"
  if (Test-Path $mongoRoot) {
    $versionDirs = Get-ChildItem $mongoRoot -Directory -ErrorAction SilentlyContinue
    if ($versionDirs) {
      $latest = $versionDirs |
        Sort-Object {
          try { [version]$_.Name } catch { [version]"0.0" }
        } -Descending |
        Select-Object -First 1
      if ($latest) {
        $exe = Join-Path $latest.FullName "bin\mongod.exe"
        if (Test-Path $exe) {
          return $exe
        }
      }
    }
  }

  return $null
}

function Resolve-MongodConfig($mongodExe) {
  $binDir = Split-Path -Parent $mongodExe
  $rootDir = Split-Path -Parent $binDir
  $candidates = @(
    (Join-Path $binDir "mongod.cfg"),
    (Join-Path $rootDir "mongod.cfg")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  return $null
}

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
      $mongodExe = Resolve-Mongod
      if ($mongodExe) {
        $args = @()
        $mongodCfg = Resolve-MongodConfig $mongodExe
        if ($mongodCfg) {
          $args += "--config"
          $args += "`"$mongodCfg`""
        } else {
          $dbPath = Join-Path $backend "data\db"
          New-Item -ItemType Directory -Force -Path $dbPath | Out-Null
          $args += "--dbpath"
          $args += "`"$dbPath`""
          $args += "--bind_ip"
          $args += "127.0.0.1"
        }
        Start-Process -FilePath $mongodExe -ArgumentList $args -WindowStyle Minimized
      } else {
        Write-Info "mongod.exe not found. Install MongoDB or add it to PATH."
      }
    }
  } else {
    Write-Info "MongoDB service not found. Trying to start mongod directly..."
    $mongodExe = Resolve-Mongod
    if ($mongodExe) {
      $args = @()
      $mongodCfg = Resolve-MongodConfig $mongodExe
      if ($mongodCfg) {
        $args += "--config"
        $args += "`"$mongodCfg`""
      } else {
        $dbPath = Join-Path $backend "data\db"
        New-Item -ItemType Directory -Force -Path $dbPath | Out-Null
        $args += "--dbpath"
        $args += "`"$dbPath`""
        $args += "--bind_ip"
        $args += "127.0.0.1"
      }
      Start-Process -FilePath $mongodExe -ArgumentList $args -WindowStyle Minimized
    } else {
      Write-Info "mongod.exe not found. Install MongoDB or add it to PATH."
    }
  }
}

Write-Info "Starting Flask backend..."
$venvPython = Join-Path $backend "venv\Scripts\python.exe"
if (Test-Path $venvPython) {
  $backendCmd = "& `"$venvPython`" server.py"
} else {
  Write-Info "No venv found at backend\\venv. Using system python/py launcher."
  $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
  $pyLauncher = Get-Command py -ErrorAction SilentlyContinue
  if ($pythonCmd) {
    $backendCmd = "python server.py"
  } elseif ($pyLauncher) {
    $backendCmd = "py server.py"
  } else {
    Write-Info "Python not found. Install Python or ensure 'py' is available."
    exit 1
  }
}

Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$backend`"; $backendCmd"

Write-Info "Starting React frontend..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd `"$frontend`"; npm start"

Write-Info "Done. Backend and frontend are running in separate windows."
