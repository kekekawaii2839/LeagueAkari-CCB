[CmdletBinding()]
param(
  [string]$Python,
  [switch]$NoWatch,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$workerEntry = Join-Path $repoRoot 'python\member_analysis\src\member_analysis\worker.py'

function Test-MemberAnalysisPython {
  param([Parameter(Mandatory)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $false
  }

  & $Path -I -c "import struct, sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) and struct.calcsize('P') * 8 == 64 else 1)"
  return $LASTEXITCODE -eq 0
}

function Resolve-MemberAnalysisPython {
  param([string]$RequestedPath)

  $candidates = [System.Collections.Generic.List[string]]::new()
  if ($RequestedPath) {
    $candidates.Add($RequestedPath)
  }
  if ($env:MEMBER_ANALYSIS_PYTHON) {
    $candidates.Add($env:MEMBER_ANALYSIS_PYTHON)
  }

  $candidates.Add(
    (Join-Path $HOME '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe')
  )

  $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
  if ($pythonCommand) {
    $candidates.Add($pythonCommand.Source)
  }

  $pyLauncher = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($pyLauncher) {
    $py312 = & $pyLauncher.Source -3.12 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $py312) {
      $candidates.Add(($py312 | Select-Object -First 1))
    }
  }

  foreach ($candidate in $candidates) {
    if (-not $candidate) {
      continue
    }
    try {
      $resolved = (Resolve-Path -LiteralPath $candidate -ErrorAction Stop).Path
      if (Test-MemberAnalysisPython -Path $resolved) {
        return $resolved
      }
    } catch {
      continue
    }
  }

  throw @'
No suitable Python runtime was found.
Member analysis development requires 64-bit Python 3.12.
Pass one explicitly, for example:
  powershell -ExecutionPolicy Bypass -File .\scripts\start-member-analysis-dev.ps1 -Python C:\Python312\python.exe
'@
}

if (-not (Test-Path -LiteralPath $workerEntry -PathType Leaf)) {
  throw "Member analysis worker entrypoint was not found: $workerEntry"
}

$pythonPath = Resolve-MemberAnalysisPython -RequestedPath $Python
$pythonVersion = & $pythonPath -I -c "import platform, sys; print(f'{platform.python_implementation()} {sys.version.split()[0]} {platform.machine()}')"

Write-Host "League Akari repository: $repoRoot"
Write-Host "Member analysis Python: $pythonPath"
Write-Host "Python runtime: $pythonVersion"

Set-Location -LiteralPath $repoRoot

$devScript = if ($NoWatch) { 'dev:no-watch' } else { 'dev' }
$yarnCommand = Get-Command yarn -ErrorAction SilentlyContinue
$yarnPrefixArgs = @()
if (-not $yarnCommand) {
  $corepackCommand = Get-Command corepack -ErrorAction SilentlyContinue
  if ($corepackCommand) {
    $yarnCommand = $corepackCommand
    $yarnPrefixArgs = @('yarn')
  } else {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $bundledYarn = Get-ChildItem (Join-Path $repoRoot '.yarn\releases\yarn-*.cjs') -File -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      Select-Object -First 1
    if ($nodeCommand -and $bundledYarn) {
      $yarnCommand = $nodeCommand
      $yarnPrefixArgs = @($bundledYarn.FullName)
    }
  }
}
if (-not $yarnCommand) {
  throw 'Yarn is unavailable. Install Node.js with Corepack or restore the repository .yarn/releases runtime.'
}

Write-Host "Yarn launcher: $($yarnCommand.Source) $($yarnPrefixArgs -join ' ')"
if ($CheckOnly) {
  Write-Host 'Development prerequisites are ready.' -ForegroundColor Green
  exit 0
}

$runningDev = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($repoRoot) }
if ($runningDev) {
  throw 'A League Akari dev instance from this repository is already running. Close it before restarting with the member-analysis worker.'
}

$env:MEMBER_ANALYSIS_PYTHON = $pythonPath
$env:PYTHONDONTWRITEBYTECODE = '1'
Write-Host "Starting League Akari with yarn $devScript ..." -ForegroundColor Cyan
& $yarnCommand.Source @yarnPrefixArgs $devScript
exit $LASTEXITCODE
