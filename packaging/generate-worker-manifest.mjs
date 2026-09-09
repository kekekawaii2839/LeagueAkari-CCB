import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? 'resources/member-analysis/worker')
const output = resolve(process.argv[3] ?? 'resources/member-analysis/worker-manifest.json')

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : []
  })
}

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
      python: '3.12.13',
      pyinstaller: '6.16.0',
      entrypoint: 'worker/member-analysis-worker.exe',
      files: entries
    },
    null,
    2
  )}\n`
)
console.log(`Wrote ${entries.length} worker hashes to ${output}`)
