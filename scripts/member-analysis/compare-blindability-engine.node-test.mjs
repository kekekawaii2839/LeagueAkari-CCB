import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./compare-blindability-engine.mjs', import.meta.url))
const locals = [
  'matchupMean',
  'synergyMean',
  'laneMatchup',
  'outOfLaneMatchup',
  'laneSynergy',
  'outOfLaneSynergy'
]

function runAudit(localValue, referenceValue = '0') {
  const directory = mkdtempSync(path.join(tmpdir(), 'blindability-audit-'))
  try {
    const scorer = path.join(directory, 'scorer.mjs')
    const reference = path.join(directory, 'reference.mjs')
    const wasm = path.join(directory, 'synthetic.wasm')
    writeFileSync(
      scorer,
      `export function scoreBlindability(){return [{champion:'Synthetic',${locals.map((key) => `${key}:null`).join(',')},aggregate:${localValue}}]}`
    )
    writeFileSync(
      reference,
      `export function initSync(){};export class Engine{blindability(){return {rows:[{champion:'Synthetic',aggregate:${referenceValue}}]}};free(){}}`
    )
    writeFileSync(wasm, '')
    const result = spawnSync(process.execPath, [script, reference, wasm, scorer], {
      encoding: 'utf8',
      windowsHide: true
    })
    if (result.error) throw result.error
    return { status: result.status, report: JSON.parse(result.stdout) }
  } finally {
    // This directory is the exact fresh mkdtemp result, never a caller-supplied path.
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep))
    assert.ok(path.basename(directory).startsWith('blindability-audit-'))
    rmSync(directory, { recursive: true, force: true })
  }
}

test('synthetic differential audit accepts finite matching results', () => {
  const { status, report } = runAudit('0')
  assert.equal(status, 0)
  assert.equal(report.cases, 240)
  assert.equal(report.nonFiniteMismatch, 0)
  assert.equal(report.maxAbsoluteError, 0)
})

for (const value of ['NaN', 'Infinity', 'undefined']) {
  test(`synthetic differential audit rejects local ${value} instead of silently passing`, () => {
    const { status, report } = runAudit(value)
    assert.equal(status, 1)
    assert.ok(report.nonFiniteMismatch > 0)
  })
}

test('synthetic differential audit also rejects nonfinite reference output', () => {
  const { status, report } = runAudit('0', 'NaN')
  assert.equal(status, 1)
  assert.ok(report.nonFiniteMismatch > 0)
})
