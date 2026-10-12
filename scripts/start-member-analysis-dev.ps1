[CmdletBinding()]
param(
  [string]$Python,
  [switch]$NoWatch,
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

# Preserve the existing command-line entrypoint and parameter forwarding.
& (Join-Path $PSScriptRoot 'member-analysis/start-member-analysis-dev.ps1') @PSBoundParameters
exit $LASTEXITCODE
