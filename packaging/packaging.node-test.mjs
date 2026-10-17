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
