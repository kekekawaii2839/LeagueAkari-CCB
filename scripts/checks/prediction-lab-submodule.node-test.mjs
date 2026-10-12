import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  evaluatePredictionLabState,
  readPredictionLabState
} from './check-prediction-lab-submodule.mjs'

const head = 'a'.repeat(40)
const pinned = {
  sourceReady: true,
  independent: true,
  head,
  gitlink: head,
  dirty: false,
  parentTracksSource: false,
  configured: true
}

test('pinned acceptance requires matching revision, clean checkout and configured metadata', () => {
  assert.equal(evaluatePredictionLabState(pinned, true).pinned, true)
  for (const change of [
    { gitlink: 'b'.repeat(40) },
    { dirty: true },
    { configured: false },
    { sourceReady: false },
    { independent: false },
    { parentTracksSource: true }
  ])
    assert.equal(evaluatePredictionLabState({ ...pinned, ...change }, true).ok, false)
})

test('unborn preparation is explicit and never passes pinned acceptance', () => {
  const state = { ...pinned, head: null, gitlink: null, dirty: true, configured: false }
  const result = evaluatePredictionLabState(state)
  assert.equal(result.ok, true)
  assert.equal(result.pinned, false)
  assert.equal(result.pending.length, 4)
  assert.equal(evaluatePredictionLabState(state, true).ok, false)
})

test('real no-commit fixture distinguishes missing, parent-owned and independent Lab', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'akari-lab-state-test-'))
  const init = (cwd) => {
    const result = spawnSync('git', ['init', '--quiet'], { cwd, windowsHide: true })
    assert.equal(result.status, 0)
  }
  try {
    init(root)
    assert.equal(readPredictionLabState(root).sourceReady, false)
    const lab = path.join(root, 'packages/prediction-lab')
    for (const file of [
      'package.json',
      'src/metrics.ts',
      'runner/opportunity-ledger.mjs',
      'build.mjs'
    ]) {
      const target = path.join(lab, file)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, 'synthetic source')
    }
    assert.equal(readPredictionLabState(root).independent, false)
    init(lab)
    const state = readPredictionLabState(root)
    assert.equal(state.independent, true)
    assert.equal(state.head, null)
    assert.equal(state.gitlink, null)
    assert.equal(evaluatePredictionLabState(state).ok, true)
    assert.equal(evaluatePredictionLabState(state, true).ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
