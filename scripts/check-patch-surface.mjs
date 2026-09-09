import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const manifestFlagIndex = process.argv.indexOf('--manifest')
if (manifestFlagIndex < 0 || !process.argv[manifestFlagIndex + 1]) {
  throw new Error('Usage: node scripts/check-patch-surface.mjs --manifest <manifest.json>')
}

const cwd = process.cwd()
const manifestPath = path.resolve(cwd, process.argv[manifestFlagIndex + 1])
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const git = (...args) =>
  execFileSync('git', ['-c', `safe.directory=${cwd.replaceAll('\\', '/')}`, ...args], {
    cwd,
    encoding: 'utf8'
  }).trim()

const excludedPaths = new Set(manifest.excludedPaths ?? [])
const changedExistingFiles = git(
  'diff',
  '--name-only',
  '--diff-filter=MRTUXB',
  manifest.upstreamBaseline,
  '--'
)
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => !excludedPaths.has(file))

const manifestFiles = manifest.patches.map((patch) => patch.upstreamFile)
const missingFromManifest = changedExistingFiles.filter((file) => !manifestFiles.includes(file))
const staleManifestEntries = manifestFiles.filter((file) => !changedExistingFiles.includes(file))

const changedLines = git(
  'diff',
  '--numstat',
  manifest.upstreamBaseline,
  '--',
  ...changedExistingFiles
)
  .split(/\r?\n/)
  .filter(Boolean)
  .reduce((total, line) => {
    const [added, deleted] = line.split('\t')
    return total + (Number(added) || 0) + (Number(deleted) || 0)
  }, 0)

const errors = []
if (missingFromManifest.length) errors.push(`Unmanifested files: ${missingFromManifest.join(', ')}`)
if (staleManifestEntries.length)
  errors.push(`Stale manifest entries: ${staleManifestEntries.join(', ')}`)
if (changedExistingFiles.length > manifest.budget.hardMaxFiles) {
  errors.push(
    `Modified upstream files ${changedExistingFiles.length} exceed hard maximum ${manifest.budget.hardMaxFiles}`
  )
}
if (changedLines > manifest.budget.hardMaxChangedLines) {
  errors.push(
    `Changed lines ${changedLines} exceed hard maximum ${manifest.budget.hardMaxChangedLines}`
  )
}

console.log(
  JSON.stringify(
    {
      upstreamBaseline: manifest.upstreamBaseline,
      modifiedUpstreamFiles: changedExistingFiles.length,
      changedLines,
      targetFiles: manifest.budget.targetFiles,
      hardMaxFiles: manifest.budget.hardMaxFiles,
      targetChangedLines: manifest.budget.targetChangedLines,
      hardMaxChangedLines: manifest.budget.hardMaxChangedLines
    },
    null,
    2
  )
)

if (errors.length) {
  throw new Error(errors.join('\n'))
}
