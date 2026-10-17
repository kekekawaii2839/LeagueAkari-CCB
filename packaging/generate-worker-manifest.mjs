import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'resources/member-analysis/worker')
const output = resolve(process.argv[3] ?? 'resources/member-analysis/worker-manifest.json')

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : []
  })
}

const provenancePath = resolve(process.argv[4] ?? 'resources/member-analysis/build-provenance.json')
const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'))
if (
  !/^3\.12\.\d+$/.test(provenance.toolchain?.python ?? '') ||
  provenance.toolchain?.packages?.pyinstaller !== '6.16.0' ||
  !Array.isArray(provenance.sources) ||
  provenance.sources.length !== 6
)
  throw new Error('Invalid worker build provenance')

const entries = files(root)
  .sort()
  .map((path) => ({
    path: relative(root, path).replaceAll('\\', '/'),
    bytes: statSync(path).size,
    sha256: createHash('sha256').update(readFileSync(path)).digest('hex')
  }))

writeFileSync(
  output,
  `${JSON.stringify(
    {
      schemaVersion: 1,
      platform: 'win32-x64',
      python: provenance.toolchain.python,
      pyinstaller: provenance.toolchain.packages.pyinstaller,
      buildProvenanceSHA256: createHash('sha256')
        .update(readFileSync(provenancePath))
        .digest('hex'),
      sourceWitnesses: provenance.sources,
      requirementsLockSHA256: provenance.requirementsLockSHA256,
      entrypoint: 'worker/member-analysis-worker.exe',
      files: entries
    },
    null,
    2
  )}\n`
)
console.log(`Wrote ${entries.length} worker hashes to ${output}`)
