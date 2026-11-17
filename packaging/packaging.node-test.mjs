import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

const { createPackage } = createRequire(import.meta.url)('@electron/asar')
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const generator = resolve('packaging/generate-worker-manifest.mjs')
const scanner = resolve('packaging/scan-packaged-artifact.mjs')
async function fixture(contents) {
  const root = mkdtempSync(join(tmpdir(), 'ccb-package-test-')),
    resources = join(root, 'resources'),
    worker = join(resources, 'member-analysis/worker'),
    app = mkdtempSync(join(tmpdir(), 'ccb-asar-input-'))
  mkdirSync(worker, { recursive: true })

  writeFileSync(join(worker, 'member-analysis-worker.exe'), 'synthetic-not-executable')
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'synthetic', version: '0.2.2' }))
  if (contents) {
    mkdirSync(join(app, 'out/main'), { recursive: true })
    writeFileSync(join(app, 'out/main/nested.js'), contents)
  }
  const provenance = join(resources, 'member-analysis/build-provenance.json')
  writeFileSync(
    provenance,
    JSON.stringify({
      toolchain: { python: '3.12.14', packages: { pyinstaller: '6.16.0' } },
      sources: Array.from({ length: 6 }, (_, i) => ({
        path: `python/source${i}.py`,
        sha256: '0'.repeat(64)
      })),
      requirementsLockSHA256: '0'.repeat(64)
    })
  )
  const manifest = join(resources, 'member-analysis/worker-manifest.json')
  assert.equal(
    spawnSync(process.execPath, [generator, worker, manifest, provenance], { encoding: 'utf8' })
      .status,
    0
  )
  await createPackage(app, join(resources, 'app.asar'))
  return { root, manifest, provenance }
}
test('manifest binds actual metadata and scan inspects asar content', async () => {
  const f = await fixture('console.log("synthetic")')
  const m = JSON.parse(readFileSync(f.manifest, 'utf8'))
  assert.equal(m.python, '3.12.14')
  assert.equal(m.buildProvenanceSHA256, hash(f.provenance))
  assert.equal(m.sourceWitnesses.length, 6)
  const r = spawnSync(process.execPath, [scanner, f.root], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})
test('sensitive text inside asar cannot evade outer directory scan', async () => {
  const f = await fixture('const authorization = "synthetic_secret_long_value"')
  const r = spawnSync(process.execPath, [scanner, f.root], { encoding: 'utf8' })
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /Sensitive or local source-path text in asar/)
})

test('release file matcher admits runtime roots but never enumerates local data, recovery archives or earlier packages', () => {
  const require = createRequire(import.meta.url)
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher.js')
  const { parse } = require('yaml')
  const base = parse(readFileSync(resolve('electron-builder.yml'), 'utf8'))
  const ccb = parse(readFileSync(resolve('packaging/member-analysis-builder.yml'), 'utf8'))
  const root = resolve('synthetic-packaging-root')
  const matcher = new FileMatcher(root, resolve(root, 'destination'), (value) => value, [
    ...base.files,
    ...ccb.files
  ])
  const include = matcher.createFilter()
  const file = { isDirectory: () => false }
  const directory = { isDirectory: () => true }
  for (const name of [
    'out/main/main.js',
    'out/preload/index.js',
    'out/renderer/main-window.html',
    'resources/LA_ICON.ico',
    'resources/magic/magic.win32-x64.node',
    'package.json',
    'LICENSE'
  ])
    assert.equal(include(join(root, name), file), true, name)
  for (const name of [
    '.local',
    '.cache',
    '.phase7-package',
    'raw_data',
    'analysis_output',
    'outputs',
    'scratch',
    'akari-public-sanitize',
    'akari-sync-review',
    'storybook-static'
  ])
    assert.equal(include(join(root, name), directory), false, name)
  for (const name of [
    'akari-pre-public-backup.bundle',
    '.env.riot.local',
    'src/main/main.ts',
    'docs/private.md',
    'resources/member-analysis/worker/member-analysis-worker.exe',
    'out/main/main.js.map',
    'collect.log'
  ])
    assert.equal(include(join(root, name), file), false, name)
})
