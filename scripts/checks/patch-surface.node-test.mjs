import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const checker = fileURLToPath(new URL('./check-patch-surface.mjs', import.meta.url))

function fixture(count = 1) {
  // Disposable source-only fixtures are retained for this review; no user data,
  // commits, application build or changes to the real repository's index.
  const cwd = mkdtempSync(path.join(tmpdir(), 'akari-patch-surface-test-'))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  git('init', '--quiet')
  const files = Array.from({ length: count }, (_, index) => `source-${index}.txt`)
  for (const file of files) writeFileSync(path.join(cwd, file), 'baseline\n')
  git('add', '--', ...files)
  const upstreamBaseline = git('write-tree')
  for (const file of files) writeFileSync(path.join(cwd, file), 'changed\n')
  const manifest = {
    upstreamBaseline,
    budget: { targetChangedLines: 800, hardMaxChangedLines: 900 },
    patches: files.map((upstreamFile) => ({ upstreamFile }))
  }
  const run = () => {
    writeFileSync(path.join(cwd, 'manifest.json'), JSON.stringify(manifest))
    return spawnSync(process.execPath, [checker, '--manifest', 'manifest.json'], {
      cwd,
      encoding: 'utf8',
      windowsHide: true
    })
  }
  return { cwd, files, manifest, run }
}

test('registered upstream file count is observable, not capped, while line limits remain', () => {
  const { run } = fixture(45)
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.modifiedUpstreamFiles, 45)
  assert.equal(output.changedLines, 90)
  assert.equal(output.targetChangedLines, 800)
  assert.equal(output.hardMaxChangedLines, 900)
  assert.equal('targetFiles' in output, false)
  assert.equal('hardMaxFiles' in output, false)
})

test('unregistered modifications still fail with no file-count cap', () => {
  const { manifest, run } = fixture(45)
  manifest.patches.pop()
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unmanifested files: source-44\.txt/)
})

test('stale registration still fails', () => {
  const { manifest, run } = fixture()
  manifest.patches.push({ upstreamFile: 'not-modified.txt' })
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Stale manifest entries: not-modified\.txt/)
})

test('the 800-line target stays informational and the 900-line hard limit is enforced', () => {
  const { cwd, files, run } = fixture()
  const append = (lines) =>
    writeFileSync(path.join(cwd, files[0]), `baseline\n${'additional\n'.repeat(lines)}`)
  append(900)
  const atLimit = run()
  assert.equal(atLimit.status, 0, atLimit.stderr)
  assert.equal(JSON.parse(atLimit.stdout).changedLines, 900)
  append(901)
  const overLimit = run()
  assert.notEqual(overLimit.status, 0)
  assert.match(overLimit.stderr, /Changed lines 901 exceed hard maximum 900/)
})
