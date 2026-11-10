import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { calculateVideoMomExperiment } from './video-mom-experiment.mjs'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
// Compile the actual core afresh; never silently test a previous run's cache.
const built = spawnSync(
  process.execPath,
  [
    '.yarn/releases/yarn-4.18.0.cjs',
    'exec',
    'tsc',
    '--ignoreConfig',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--rootDir',
    'src',
    '--outDir',
    '.cache/blindability-methodology/video-mom-test-core',
    'src/shared/shards/member-analysis/champion-pool/index.ts'
  ],
  { cwd: root, encoding: 'utf8' }
)
assert.equal(built.status, 0, built.stdout + built.stderr)
const core = require('../../.cache/blindability-methodology/video-mom-test-core/shared/shards/member-analysis/champion-pool/index.js')
function fixture() {
  const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']
  const scope = {
    source: 'SYNTHETIC',
    interactionPatch: '16.21',
    playRatePatch: '16.21',
    region: 'synthetic',
    queueId: 420,
    population: 'synthetic'
  }
  const blocks = ['matchup', 'synergy'].flatMap((mode) =>
    roles
      .filter((r) => mode === 'matchup' || r !== 'MID')
      .map((otherRole) => ({
        ownRole: 'MID',
        otherRole,
        mode,
        scope,
        targets: ['3', '4', '5'],
        targetPickRates: [0.2, 0.3, 0.5]
      }))
  )
  return {
    blocks,
    baselines: [1, 2].map((championId) => ({
      championId,
      role: 'MID',
      pickRate: 0.1,
      games: 10000
    })),
    pairSamples: blocks.flatMap((b) =>
      [1, 2].flatMap((selectedChampionId) =>
        b.targets.map((championId, j) => ({
          selectedChampionId,
          championId,
          mode: b.mode,
          otherRole: b.otherRole,
          games: 1000,
          reportedWinRate: 0.5,
          rawDeltaPp: selectedChampionId === 1 ? 0 : [-3, 0, 3][j]
        }))
      )
    )
  }
}
test('video MoM path retains full cohort and signed negative estimates without Bayesian replacement', () => {
  const result = calculateVideoMomExperiment(fixture(), { 1: 'SyntheticA', 2: 'SyntheticB' }, core)
  assert.equal(result.rows.length, 2)
  for (const row of result.rows) {
    assert.equal(row.matchupRoles, 5)
    assert.equal(row.synergyRoles, 4)
  }
  const flat = result.rows.find((r) => r.champion === '1')
  assert.equal(flat.boundaryBlocks.length, 9)
  assert(flat.estimates.every((b) => b.estimate.signedCorrectedVariancePp2 < 0 && b.sdPp === 0))
  assert(result.references.every((r) => r.candidateCount === 2 && r.finiteCount === 2))
  assert(result.evidence.unresolved.length > 0)
})
test('centred sampling noise and subtraction reproduce the declared finite-weight formula', () => {
  const r = calculateVideoMomExperiment(fixture(), {}, core)
  const e = r.rows.find((r) => r.champion === '2').estimates[0].estimate
  const a = [0.2, 0.3, 0.5],
    x = [-3, 0, 3],
    mean = 0.9
  const observed = a.reduce((s, w, i) => s + w * (x[i] - mean) ** 2, 0)
  const noise = a.reduce((s, w) => s + w * (1 - w) * 2.5, 0)
  assert(Math.abs(e.observedVariancePp2 - observed) < 1e-12)
  assert(Math.abs(e.signedCorrectedVariancePp2 - (observed - noise)) < 1e-12)
})
test('missing input is rejected rather than selectively removing a hero or role', () => {
  const d = fixture()
  d.pairSamples.pop()
  assert.throws(() => calculateVideoMomExperiment(d, {}, core), /Incomplete/)
})
test('duplicates, mixed scopes and missing role blocks fail closed', () => {
  for (const mutate of [
    (d) => d.pairSamples.push(d.pairSamples[0]),
    (d) => d.blocks.pop(),
    (d) => {
      d.blocks[0] = { ...d.blocks[0], scope: { ...d.blocks[0].scope, interactionPatch: '16.20' } }
    }
  ]) {
    const d = fixture()
    mutate(d)
    assert.throws(() => calculateVideoMomExperiment(d, {}, core))
  }
})
test('positive estimates use square root of difference, not difference of square roots', () => {
  const r = calculateVideoMomExperiment(fixture(), {}, core)
  const b = r.rows.find((r) => r.champion === '2').estimates[0]
  assert.equal(b.sdPp, Math.sqrt(b.estimate.observedVariancePp2 - b.estimate.samplingVariancePp2))
  assert.notEqual(b.sdPp, b.estimate.observedSdPp - Math.sqrt(b.estimate.samplingVariancePp2))
})
test('sample and binomial-plugin alternatives are explicit and do not mutate input', () => {
  const d = fixture(),
    before = structuredClone(d)
  const r = calculateVideoMomExperiment(d, {}, core, {
    noiseModel: 'binomial-proportion-plugin',
    varianceConvention: 'reliability-weighted-sample'
  })
  assert.equal(r.settings.noiseModel, 'binomial-proportion-plugin')
  assert.equal(r.settings.varianceConvention, 'reliability-weighted-sample')
  assert.deepEqual(d, before)
})

test('reference roster is independent of the display PR floor', () => {
  const d = fixture()
  d.baselines[1].pickRate = 0.001
  const r = calculateVideoMomExperiment(d, {}, core, { referenceChampionIds: ['1', '2'] })
  assert.equal(r.cohort.length, 2)
  assert.equal(r.rows.length, 1)
  assert(r.references.every((b) => b.candidateCount === 2 && b.finiteCount === 2))
  assert.equal(r.aggregateFirst.length, 1)
  assert.throws(() =>
    calculateVideoMomExperiment(d, {}, core, { referenceChampionIds: ['1', '3'] })
  )
})
