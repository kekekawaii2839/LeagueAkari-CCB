param([string]$RunnerTemp = $env:RUNNER_TEMP)

$ErrorActionPreference = 'Stop'

function Assert-WorkerPythonPathIsNotLinked([string]$Path) {
  $current = [IO.Path]::GetFullPath($Path)
  while ($current) {
    if (Test-Path -LiteralPath $current) {
      if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Worker Python path contains a reparse point'
      }
    }
    $parent = [IO.Path]::GetDirectoryName($current)
    if ($parent -eq $current) { break }
    $current = $parent
  }
}

function Expand-VerifiedWorkerPythonArchive {
  param(
    [Parameter(Mandatory)][string]$Archive,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$AllowedRoot,
    [Parameter(Mandatory)][string]$ExpectedSHA256,
    [long]$MaximumBytes = 1GB,
    [long]$MaximumFileBytes = 256MB,
    [int]$MaximumEntries = 30000
  )
  Add-Type -AssemblyName System.Formats.Tar
  $allowed = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $target = [IO.Path]::GetFullPath($Destination)
  if (-not $target.StartsWith($allowed + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Worker Python extraction destination is outside its allowed root'
  }
  Assert-WorkerPythonPathIsNotLinked $allowed
  Assert-WorkerPythonPathIsNotLinked $target
  Assert-WorkerPythonPathIsNotLinked $Archive
  if (Test-Path -LiteralPath $target) { throw 'Worker Python extraction requires a fresh destination' }
  if ($ExpectedSHA256 -cnotmatch '^[a-f0-9]{64}$' -or
      (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSHA256) {
    throw 'Worker Python archive SHA-256 mismatch'
  }
  if ((Get-Item -LiteralPath $Archive).Length -gt 128MB) { throw 'Worker Python archive is too large' }

  # Validate the complete archive before creating any extraction directory.
  $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  $entries = [Collections.Generic.List[object]]::new()
  [long]$bytes = 0
  $file = [IO.File]::Open($Archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $gzip = [IO.Compression.GZipStream]::new($file, [IO.Compression.CompressionMode]::Decompress, $true)
    try {
      $tar = [System.Formats.Tar.TarReader]::new($gzip, $true)
      try {
        while ($entry = $tar.GetNextEntry()) {
          $name = $entry.Name
          $kind = $entry.EntryType.ToString()
          if ($kind -notin @('RegularFile', 'V7RegularFile', 'Directory')) {
            throw 'Worker Python archive contains a link or unsupported entry type'
          }
          if ($kind -eq 'Directory') { $name = $name.TrimEnd('/') }
          if (-not $name -or $name.Contains('\') -or $name.Contains(':') -or
              $name.StartsWith('/') -or $name -match '[\x00-\x1f<>"|?*]' -or
              ($name -ne 'python' -and -not $name.StartsWith('python/', [StringComparison]::Ordinal))) {
            throw 'Worker Python archive contains an invalid relative path'
          }
          foreach ($segment in $name.Split('/')) {
            if (-not $segment -or $segment -in @('.', '..') -or $segment -match '[. ]$' -or
                $segment -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
              throw 'Worker Python archive contains an unsafe path segment'
            }
          }
          if ($name -eq 'python' -and $kind -ne 'Directory') {
            throw 'Worker Python archive root must be a directory'
          }
          if (-not $seen.Add($name)) { throw 'Worker Python archive contains a duplicate path' }
          $full = [IO.Path]::GetFullPath((Join-Path $target $name))
          if (-not $full.StartsWith($target + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Worker Python archive entry escapes its destination'
          }
          if ($entry.Length -lt 0 -or $entry.Length -gt $MaximumFileBytes) {
            throw 'Worker Python archive entry exceeds its size limit'
          }
          $bytes += $entry.Length
          if ($bytes -gt $MaximumBytes -or $entries.Count -ge $MaximumEntries) {
            throw 'Worker Python archive exceeds its extraction limits'
          }
          $entries.Add([pscustomobject]@{ Name = $name; Kind = $kind; Length = $entry.Length })
        }
      } finally { $tar.Dispose() }
    } finally { $gzip.Dispose() }
  } finally { $file.Dispose() }
  if (-not ($entries | Where-Object { $_.Name -ceq 'python/python.exe' -and $_.Kind -ne 'Directory' -and $_.Length -gt 0 })) {
    throw 'Worker Python archive does not contain the expected executable'
  }
  # A file cannot also be the parent of another archive entry, including case aliases.
  $files = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in $entries) { if ($entry.Kind -ne 'Directory') { [void]$files.Add($entry.Name) } }
  foreach ($entry in $entries) {
    $parent = $entry.Name
    while ($parent.Contains('/')) {
      $parent = $parent.Substring(0, $parent.LastIndexOf('/'))
      if ($files.Contains($parent)) { throw 'Worker Python archive has a file/directory path collision' }
    }
  }
  if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSHA256) {
    throw 'Worker Python archive changed before extraction'
  }
  [void][IO.Directory]::CreateDirectory($target)
  $file = [IO.File]::Open($Archive, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  try {
    $gzip = [IO.Compression.GZipStream]::new($file, [IO.Compression.CompressionMode]::Decompress, $true)
    try {
      $tar = [System.Formats.Tar.TarReader]::new($gzip, $true)
      try {
        $index = 0
        while ($entry = $tar.GetNextEntry()) {
          $expected = $entries[$index++]
          if ($entry.Name.TrimEnd('/') -cne $expected.Name -or $entry.EntryType.ToString() -cne $expected.Kind -or $entry.Length -ne $expected.Length) {
            throw 'Worker Python archive changed during extraction'
          }
          $full = [IO.Path]::GetFullPath((Join-Path $target $expected.Name))
          Assert-WorkerPythonPathIsNotLinked $full
          if ($expected.Kind -eq 'Directory') { [void][IO.Directory]::CreateDirectory($full) }
          else {
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($full))
            Assert-WorkerPythonPathIsNotLinked $full
            $destinationFile = [IO.File]::Open($full, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
              # TarReader legitimately exposes no stream for an empty regular file.
              if ($expected.Length -gt 0) {
                if ($null -eq $entry.DataStream) { throw 'Worker Python nonempty archive entry has no data stream' }
                $entry.DataStream.CopyTo($destinationFile)
              }
              if ($destinationFile.Length -ne $expected.Length) { throw 'Worker Python extracted file length mismatch' }
            } finally { $destinationFile.Dispose() }
          }
        }
        if ($index -ne $entries.Count) { throw 'Worker Python archive entry count changed' }
      } finally { $tar.Dispose() }
    } finally { $gzip.Dispose() }
  } finally { $file.Dispose() }
  if ((Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $ExpectedSHA256) {
    throw 'Worker Python archive changed during extraction'
  }
  return [pscustomobject]@{ Entries = $entries.Count; Bytes = $bytes; Python = (Join-Path $target 'python/python.exe') }
}

function Invoke-WorkerPythonBootstrap([string]$RunnerTemp) {
  $asset = 'cpython-3.12.14+20260929-x86_64-pc-windows-msvc-install_only.tar.gz'
  $url = 'https://github.com/astral-sh/python-build-standalone/releases/download/20260929/cpython-3.12.14%2B20260929-x86_64-pc-windows-msvc-install_only.tar.gz'
  $sha = '28728baf30b65e263f0b25c5a85be8226e7ab0d212fbadd6a8f0f796139fa804'
  Add-Type -AssemblyName System.Formats.Tar
  if (-not $RunnerTemp -or -not (Test-Path -LiteralPath $RunnerTemp -PathType Container)) { throw 'An existing runner temporary root is required' }
  $root = [IO.Path]::GetFullPath($RunnerTemp)
  Assert-WorkerPythonPathIsNotLinked $root
  $work = Join-Path $root ('ccb-python-' + [guid]::NewGuid().ToString('N'))
  if (Test-Path -LiteralPath $work) { throw 'A fresh worker Python bootstrap directory is required' }
  [void][IO.Directory]::CreateDirectory($work)
  $archive = Join-Path $work $asset
  Invoke-WebRequest -Uri $url -OutFile $archive -MaximumRedirection 5
  $expanded = Expand-VerifiedWorkerPythonArchive -Archive $archive -Destination (Join-Path $work 'runtime') -AllowedRoot $root -ExpectedSHA256 $sha
  $python = $expanded.Python
  $reported = & $python -I -c 'import json,platform,struct,sys;print(json.dumps({"version":platform.python_version(),"platform":sys.platform,"machine":platform.machine(),"bits":struct.calcsize("P")*8}))'
  if ($LASTEXITCODE -ne 0) { throw 'Verified worker Python could not report its runtime identity' }
  $identity = $reported | ConvertFrom-Json
  if ($identity.version -cne '3.12.14' -or $identity.platform -cne 'win32' -or $identity.machine -notin @('AMD64', 'x86_64') -or $identity.bits -ne 64) {
    throw 'Verified worker Python runtime identity does not match the fixed Windows x64 contract'
  }
  $receipt = [ordered]@{
    schemaVersion = 1
    provider = 'Astral python-build-standalone (not a PSF Windows installer)'
    release = '20260929'
    target = 'x86_64-pc-windows-msvc'
    sourceURL = $url
    archive = @{ file = $asset; sha256 = $sha }
    executable = @{ path = 'python/python.exe'; sha256 = (Get-FileHash -LiteralPath $python -Algorithm SHA256).Hash.ToLowerInvariant() }
    reported = $identity
    extractedEntries = $expanded.Entries
    extractedBytes = $expanded.Bytes
  }
  $receiptPath = Join-Path $work 'worker-python-bootstrap-provenance.json'
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $receiptPath -Encoding utf8
  if ($env:GITHUB_ENV) {
    "WORKER_BOOTSTRAP_PYTHON=$python" | Add-Content -LiteralPath $env:GITHUB_ENV -Encoding utf8
    "WORKER_PYTHON_BOOTSTRAP_PROVENANCE=$receiptPath" | Add-Content -LiteralPath $env:GITHUB_ENV -Encoding utf8
  }
  if ($env:GITHUB_STEP_SUMMARY) {
    @("### Worker Python bootstrap", '- Provider: Astral python-build-standalone, not a PSF Windows installer.', '- CPython: 3.12.14; Windows x64; fixed release: 20260929.', "- Archive SHA-256: $sha", "- Python executable SHA-256: $($receipt.executable.sha256)") | Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Encoding utf8
  }
  Write-Output 'Verified fixed Astral CPython 3.12.14 Windows x64 bootstrap; no system installation or fallback.'
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-WorkerPythonBootstrap -RunnerTemp $RunnerTemp }
