import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, normalize, relative, resolve } from 'node:path'

const { listPackage, extractFile } = createRequire(import.meta.url)('@electron/asar')

const root = resolve(process.argv[2] ?? '')
if (!root || !existsSync(root))
  throw new Error('Usage: node packaging/scan-packaged-artifact.mjs <packaged-root>')

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : entry.isFile() ? [path] : []
  })
}

const allFiles = files(root)
const relativeFiles = allFiles.map((path) => relative(root, path).replaceAll('\\', '/'))
const prohibited = relativeFiles.filter((path) =>
  /(^|\/)(raw_data|analysis_output|analysis\.sqlite3|catalog\.sqlite3|jobs)(\/|$)|\.json\.gz$|\.log$/i.test(
    path
  )
)
if (prohibited.length) throw new Error(`Player-data-shaped files found:\n${prohibited.join('\n')}`)

const manifestPath = resolve(root, 'resources/member-analysis/worker-manifest.json')
const workerRoot = resolve(root, 'resources/member-analysis/worker')
if (!existsSync(manifestPath) || !existsSync(resolve(workerRoot, 'member-analysis-worker.exe'))) {
  throw new Error(
    'Packaged member-analysis worker or manifest is missing from process.resourcesPath'
  )
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const provenancePath = resolve(root, 'resources/member-analysis/build-provenance.json')
if (
  !existsSync(provenancePath) ||
  createHash('sha256').update(readFileSync(provenancePath)).digest('hex') !==
    manifest.buildProvenanceSHA256
) {
  throw new Error('Missing or mismatched source-current worker build provenance')
}
for (const entry of manifest.files) {
  const path = resolve(workerRoot, entry.path)
  if (!path.startsWith(`${workerRoot}\\`) || !existsSync(path))
    throw new Error(`Missing worker file: ${entry.path}`)
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (hash !== entry.sha256) throw new Error(`Worker hash mismatch: ${entry.path}`)
}

const textViolations = []
for (const path of allFiles) {
  const size = statSync(path).size
  if (size > 2_000_000 || /\.(exe|dll|node|png|ico|woff2|asar|bin|pyc)$/i.test(path)) continue
  const text = readFileSync(path, 'utf8')
  if (/\b(?:token|authorization)\s*[:=]\s*['"][^'"]{12,}/i.test(text))
    textViolations.push(relative(root, path))
  if (/['"][\p{L}\p{N}_. -]{3,32}#[A-Za-z0-9]{3,5}['"]/u.test(text))
    textViolations.push(relative(root, path))
}
if (textViolations.length)
  throw new Error(`Sensitive text pattern found:\n${textViolations.join('\n')}`)

const archives = allFiles.filter((path) => basename(path).toLowerCase() === 'app.asar')
if (archives.length !== 1) throw new Error('Expected exactly one app.asar')
const archive = archives[0]
const asarEntries = listPackage(archive).map((path) =>
  path.replaceAll('\\', '/').replace(/^\//, '')
)
const privateEntries = asarEntries.filter(
  (path) =>
    /(^|\/)(raw_data|analysis_output|jobs|\.git|\.cache)(\/|$)|\.(sqlite3?|db-wal|db-shm|json\.gz|log|map)$/i.test(
      path
    ) || /^(packages|python|src)\//.test(path)
)
if (privateEntries.length)
  throw new Error(`Private source/data shaped asar entries: ${privateEntries.join('\n')}`)
for (const path of asarEntries.filter((path) =>
  /\.(js|cjs|mjs|json|yaml|yml|html|css)$/i.test(path)
)) {
  const text = extractFile(archive, normalize(path)).toString('utf8')
  if (
    /\b(?:token|authorization)\s*[:=]\s*['"][^'"]{12,}/i.test(text) ||
    /['"][\p{L}\p{N}_. -]{3,32}#[A-Za-z0-9]{3,5}['"]/u.test(text) ||
    /[A-Z]:[\\/](?:Users|home)[\\/][^"'\r\n]+[\\/](?:Documents|AppData)[\\/]/i.test(text)
  ) {
    throw new Error(`Sensitive or local source-path text in asar: ${path}`)
  }
}
console.log(
  `Packaged artifact scan passed: ${relativeFiles.length} files, ${manifest.files.length} worker hashes, ${asarEntries.length} asar entries inspected`
)
