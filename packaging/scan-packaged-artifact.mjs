import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

const root = resolve(process.argv[2] ?? '')
if (!root || !existsSync(root)) throw new Error('Usage: node packaging/scan-packaged-artifact.mjs <packaged-root>')

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : []
  })
}

const allFiles = files(root)
const relativeFiles = allFiles.map((path) => relative(root, path).replaceAll('\\', '/'))
const prohibited = relativeFiles.filter((path) =>
  /(^|\/)(raw_data|analysis_output|analysis\.sqlite3|catalog\.sqlite3|jobs)(\/|$)|\.json\.gz$|\.log$/i.test(path)
)
if (prohibited.length) throw new Error(`Player-data-shaped files found:\n${prohibited.join('\n')}`)

const manifestPath = resolve(root, 'resources/member-analysis/worker-manifest.json')
const workerRoot = resolve(root, 'resources/member-analysis/worker')
if (!existsSync(manifestPath) || !existsSync(resolve(workerRoot, 'member-analysis-worker.exe'))) {
  throw new Error('Packaged member-analysis worker or manifest is missing from process.resourcesPath')
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
for (const entry of manifest.files) {
  const path = resolve(workerRoot, entry.path)
  if (!path.startsWith(`${workerRoot}\\`) || !existsSync(path)) throw new Error(`Missing worker file: ${entry.path}`)
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (hash !== entry.sha256) throw new Error(`Worker hash mismatch: ${entry.path}`)
}

const textViolations = []
for (const path of allFiles) {
  const size = statSync(path).size
  if (size > 2_000_000 || /\.(exe|dll|node|png|ico|woff2|asar|bin|pyc)$/i.test(path)) continue
  const text = readFileSync(path, 'utf8')
  if (/\b(?:token|authorization)\s*[:=]\s*['"][^'"]{12,}/i.test(text)) textViolations.push(relative(root, path))
  if (/['"][\p{L}\p{N}_. -]{3,32}#[A-Za-z0-9]{3,5}['"]/u.test(text)) textViolations.push(relative(root, path))
}
if (textViolations.length) throw new Error(`Sensitive text pattern found:\n${textViolations.join('\n')}`)

if (!relativeFiles.some((path) => basename(path).toLowerCase() === 'app.asar')) throw new Error('app.asar missing')
console.log(`Packaged artifact scan passed: ${relativeFiles.length} files, ${manifest.files.length} worker hashes`)
