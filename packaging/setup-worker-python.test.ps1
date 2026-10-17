$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'setup-worker-python.ps1')
Add-Type -AssemblyName System.Formats.Tar

$root = Join-Path ([IO.Path]::GetTempPath()) ('ccb-python-safe-extract-test-' + [guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($root)
$script:passed = 0

function Assert-Test([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function New-TestArchive([object[]]$Entries) {
  $file = Join-Path $root ([guid]::NewGuid().ToString('N') + '.tar.gz')
  $stream = [IO.File]::Open($file, [IO.FileMode]::CreateNew)
  try {
    $gzip = [IO.Compression.GZipStream]::new($stream, [IO.Compression.CompressionMode]::Compress, $true)
    try {
      $writer = [System.Formats.Tar.TarWriter]::new($gzip, $true)
      try {
        foreach ($spec in $Entries) {
          $kind = if ($spec.Kind) { [System.Enum]::Parse([System.Formats.Tar.TarEntryType], $spec.Kind) } else { [System.Formats.Tar.TarEntryType]::RegularFile }
          $entry = [System.Formats.Tar.PaxTarEntry]::new($kind, $spec.Name)
          if ($spec.Link) { $entry.LinkName = $spec.Link }
          $data = $null
          try {
            if ($kind -eq [System.Formats.Tar.TarEntryType]::RegularFile) {
              $data = [IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($(if ($spec.ContainsKey('Data')) { $spec.Data } else { 'MZ-synthetic-not-executable' })))
              $entry.DataStream = $data
            }
            $writer.WriteEntry($entry)
          } finally { if ($data) { $data.Dispose() } }
        }
      } finally { $writer.Dispose() }
    } finally { $gzip.Dispose() }
  } finally { $stream.Dispose() }
  return $file
}

function Assert-ArchiveRejected([object[]]$Entries, [string]$Reason, [hashtable]$Limits = @{}, [switch]$WrongHash) {
  $archive = New-TestArchive $Entries
  $destination = Join-Path $root ([guid]::NewGuid().ToString('N'))
  $hash = if ($WrongHash) { '0' * 64 } else { (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() }
  $rejected = $false
  try { Expand-VerifiedWorkerPythonArchive -Archive $archive -Destination $destination -AllowedRoot $root -ExpectedSHA256 $hash @Limits | Out-Null }
  catch {
    Assert-Test ($_.Exception.Message.Contains($Reason)) ('Unexpected rejection reason for ' + $Reason)
    $rejected = $true
  }
  Assert-Test $rejected ('Archive was accepted: ' + $Reason)
  Assert-Test (-not (Test-Path -LiteralPath $destination)) 'Unsafe archive wrote an extraction directory'
  $script:passed++
}

$valid = @(
  @{ Name = 'python/'; Kind = 'Directory' },
  @{ Name = 'python/python.exe'; Data = 'MZ-synthetic-not-executable' },
  @{ Name = 'python/Lib/example.txt'; Data = 'synthetic standard library placeholder' }
)
$archive = New-TestArchive $valid
$destination = Join-Path $root 'valid'
$result = Expand-VerifiedWorkerPythonArchive -Archive $archive -Destination $destination -AllowedRoot $root -ExpectedSHA256 (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Test ($result.Entries -eq 3) 'Normal structure entry count changed'
Assert-Test ([IO.File]::ReadAllText($result.Python) -ceq 'MZ-synthetic-not-executable') 'Normal file bytes changed'
Assert-Test ([IO.File]::ReadAllText((Join-Path $destination 'python/Lib/example.txt')) -ceq 'synthetic standard library placeholder') 'Nested extraction failed'
$script:passed++

$emptyArchive = New-TestArchive @(
  @{ Name = 'python/python.exe'; Data = 'MZ-synthetic-not-executable' },
  @{ Name = 'python/Lib/empty.py'; Data = '' }
)
$emptyDestination = Join-Path $root 'zero-byte'
$emptyResult = Expand-VerifiedWorkerPythonArchive -Archive $emptyArchive -Destination $emptyDestination -AllowedRoot $root -ExpectedSHA256 (Get-FileHash -LiteralPath $emptyArchive -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-Test ($emptyResult.Entries -eq 2) 'Empty regular file was omitted'
$emptyFile = Join-Path $emptyDestination 'python/Lib/empty.py'
Assert-Test ((Test-Path -LiteralPath $emptyFile -PathType Leaf) -and (Get-Item -LiteralPath $emptyFile).Length -eq 0) 'Empty regular file was not faithfully extracted'
Assert-Test ([IO.File]::ReadAllText($emptyResult.Python) -ceq 'MZ-synthetic-not-executable') 'Nonempty entry bytes changed beside empty entry'
$script:passed++

Assert-ArchiveRejected $valid 'SHA-256 mismatch' -WrongHash
Assert-ArchiveRejected @(@{ Name = 'python/../escape' }) 'unsafe path segment'
Assert-ArchiveRejected @(@{ Name = '/python/python.exe' }) 'invalid relative path'
Assert-ArchiveRejected @(@{ Name = 'C:/python/python.exe' }) 'invalid relative path'
Assert-ArchiveRejected @(@{ Name = 'python\..\escape' }) 'invalid relative path'
Assert-ArchiveRejected @(@{ Name = 'python/escape'; Kind = 'SymbolicLink'; Link = '../../outside' }) 'link or unsupported'
Assert-ArchiveRejected @(@{ Name = 'python/escape'; Kind = 'HardLink'; Link = '../../outside' }) 'link or unsupported'
Assert-ArchiveRejected @(@{ Name = 'python/python.exe' }, @{ Name = 'python/PYTHON.exe' }) 'duplicate path'
Assert-ArchiveRejected @(@{ Name = 'other/python.exe' }) 'invalid relative path'
Assert-ArchiveRejected @(@{ Name = 'python/CON.txt' }) 'unsafe path segment'
Assert-ArchiveRejected @(@{ Name = 'python/python.exe' }, @{ Name = 'python/python.exe/child' }) 'file/directory path collision'
Assert-ArchiveRejected $valid 'size limit' @{ MaximumFileBytes = 2 }
Assert-ArchiveRejected $valid 'extraction limits' @{ MaximumBytes = 30 }
Assert-ArchiveRejected $valid 'extraction limits' @{ MaximumEntries = 1 }
Assert-ArchiveRejected @(@{ Name = 'python/Lib/example.txt' }) 'expected executable'

$rejected = $false
try { Expand-VerifiedWorkerPythonArchive -Archive $archive -Destination $destination -AllowedRoot $root -ExpectedSHA256 (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() | Out-Null }
catch { $rejected = $_.Exception.Message.Contains('fresh destination') }
Assert-Test $rejected 'Existing extraction destination was accepted'
$script:passed++

$outside = Join-Path ([IO.Path]::GetTempPath()) ('ccb-python-outside-' + [guid]::NewGuid().ToString('N'))
$rejected = $false
try { Expand-VerifiedWorkerPythonArchive -Archive $archive -Destination $outside -AllowedRoot $root -ExpectedSHA256 (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() | Out-Null }
catch { $rejected = $_.Exception.Message.Contains('outside its allowed root') }
Assert-Test ($rejected -and -not (Test-Path -LiteralPath $outside)) 'Extraction escaped its explicit root'
$script:passed++

# NTFS directory junctions require no administrator token. Only disposable test paths
# are used; leave them in the temporary evidence root rather than recursively deleting links.
$linkTarget = Join-Path $root 'junction-target'
[void][IO.Directory]::CreateDirectory($linkTarget)
$link = Join-Path $root 'junction'
New-Item -ItemType Junction -Path $link -Target $linkTarget | Out-Null
$rejected = $false
try { Expand-VerifiedWorkerPythonArchive -Archive $archive -Destination (Join-Path $link 'runtime') -AllowedRoot $root -ExpectedSHA256 (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() | Out-Null }
catch { $rejected = $_.Exception.Message.Contains('reparse point') }
Assert-Test ($rejected -and -not (Test-Path -LiteralPath (Join-Path $linkTarget 'runtime'))) 'Extraction followed a reparse parent'
$script:passed++

Write-Output "Worker Python safe extraction: $script:passed checks passed; no network or executable invocation."
