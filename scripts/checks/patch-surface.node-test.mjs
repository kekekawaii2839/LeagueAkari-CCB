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

test('registered upstream file and line counts are observable, not capped', () => {
  const { run } = fixture(45)
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  const output = JSON.parse(result.stdout)
  assert.equal(output.modifiedUpstreamFiles, 45)
  assert.equal(output.changedLines, 90)
  assert.equal('targetChangedLines' in output, false)
  assert.equal('hardMaxChangedLines' in output, false)
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

test('large registered changes pass without a numeric line cap, including legacy budget metadata', () => {
  const { cwd, files, manifest, run } = fixture()
  manifest.budget = { targetChangedLines: 800, hardMaxChangedLines: 900 }
  for (const lines of [900, 901, 2500, 10000]) {
    writeFileSync(path.join(cwd, files[0]), 'baseline\n' + 'additional\n'.repeat(lines))
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).changedLines, lines)
  }
})

test('large unregistered changes still fail the registration gate rather than a line budget', () => {
  const { cwd, files, manifest, run } = fixture()
  writeFileSync(path.join(cwd, files[0]), 'baseline\n' + 'additional\n'.repeat(2500))
  manifest.patches = []
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Unmanifested files: source-0\.txt/)
  assert.doesNotMatch(result.stderr, /hard maximum|line limit/)
})
