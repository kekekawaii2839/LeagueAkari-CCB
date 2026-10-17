import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const [python, outputArg, workArg] = process.argv.slice(2)
if (!python || !isAbsolute(python) || !outputArg || !workArg)
  throw new Error(
    'Usage: node packaging/build-worker.mjs <absolute-python> <new-output-resources/member-analysis> <new-work-dir>'
  )
const output = resolve(outputArg),
  work = resolve(workArg)
if (output === work || output.startsWith(work + sep) || work.startsWith(output + sep))
  throw new Error('Output/work must be separate')
if (existsSync(output) || existsSync(work))
  throw new Error('Fresh output and work directories required; preserve prior artifacts')
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
function run(args) {
  const result = spawnSync(python, ['-I', ...args], {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    shell: false
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error || result.status !== 0)
    throw result.error ?? new Error(`Python failed: ${result.status}`)
  return result.stdout
}
const metadata = JSON.parse(
  run([
    '-c',
    'import sys,json,platform,importlib.metadata as m; print(json.dumps({"python":platform.python_version(),"platform":sys.platform,"machine":platform.machine(),"packages":{n:m.version(n) for n in ["pyinstaller","pyinstaller-hooks-contrib","altgraph","packaging","pefile","pywin32-ctypes","setuptools"]}}))'
  ])
)
if (
  metadata.platform !== 'win32' ||
  !['AMD64', 'x86_64'].includes(metadata.machine) ||
  !metadata.python.startsWith('3.12.') ||
  metadata.packages.pyinstaller !== '6.16.0'
)
  throw new Error('Wrong Windows x64 Python/PyInstaller toolchain')
const sourcePaths = ['worker.py', 'analysis.py', 'opgg.py', '__init__.py', 'schema.sql'].map(
  (n) => `python/member_analysis/src/member_analysis/${n}`
)
sourcePaths.push('python/member_analysis/entrypoint.py')
const sources = sourcePaths.map((path) => ({ path, sha256: sha(resolve(repo, path)) }))
const lock = resolve(repo, 'packaging/worker-build-requirements.lock')
for (const line of readFileSync(lock, 'utf8')
  .split(/\r?\n/)
  .filter((l) => l && !l.startsWith('#'))) {
  const match = /^(\S+)==(\S+) --hash=sha256:[0-9a-f]{64}$/.exec(line)
  if (!match || metadata.packages[match[1]] !== match[2])
    throw new Error('Installed toolchain differs from lock')
}
mkdirSync(work, { recursive: true })
run([
  '-m',
  'PyInstaller',
  '--noconfirm',
  '--clean',
  '--onedir',
  '--console',
  '--name',
  'member-analysis-worker',
  '--paths',
  resolve(repo, 'python/member_analysis/src'),
  '--add-data',
  `${resolve(repo, 'python/member_analysis/src/member_analysis/schema.sql')};member_analysis`,
  '--distpath',
  resolve(work, 'dist'),
  '--workpath',
  resolve(work, 'build'),
  '--specpath',
  resolve(work, 'spec'),
  resolve(repo, 'python/member_analysis/entrypoint.py')
])
for (const s of sources)
  if (sha(resolve(repo, s.path)) !== s.sha256) throw new Error('Source changed during worker build')
run([
  resolve(repo, 'packaging/scan-worker-archive.py'),
  resolve(work, 'dist/member-analysis-worker/member-analysis-worker.exe')
])
mkdirSync(output, { recursive: true })
cpSync(resolve(work, 'dist/member-analysis-worker'), resolve(output, 'worker'), {
  recursive: true,
  errorOnExist: true,
  force: false
})
writeFileSync(
  resolve(output, 'build-provenance.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      toolchain: metadata,
      requirementsLockSHA256: sha(lock),
      sources,
      entrypoint: 'python/member_analysis/entrypoint.py',
      command:
        'PyInstaller --onedir --console --name member-analysis-worker --paths python/member_analysis/src --add-data schema.sql;member_analysis',
      created: new Date().toISOString()
    },
    null,
    2
  ) + '\n'
)
const manifest = spawnSync(
  process.execPath,
  [
    resolve(repo, 'packaging/generate-worker-manifest.mjs'),
    resolve(output, 'worker'),
    resolve(output, 'worker-manifest.json'),
    resolve(output, 'build-provenance.json')
  ],
  { cwd: repo, stdio: 'inherit', windowsHide: true, shell: false }
)
if (manifest.status !== 0) throw new Error('Manifest failed')
