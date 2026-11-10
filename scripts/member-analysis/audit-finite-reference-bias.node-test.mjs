import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createCohort,
  exactAvailableRoleCounterexample,
  exactNonlinearCounterexample,
  sharedBaselineCounterexamples,
  simulateFinitePipeline
} from './audit-finite-reference-bias.mjs'

function referenceEstimate(cells) {
  const W = cells.reduce((s, c) => s + c.pickRate, 0),
    a = cells.map((c) => c.pickRate / W)
  const mean = cells.reduce((s, c, i) => s + a[i] * c.deltaPp, 0)
  const variance = cells.reduce((s, c, i) => s + a[i] * (c.deltaPp - mean) ** 2, 0)
  const noise = cells.reduce(
    (s, c, i) =>
      s + (a[i] * (1 - a[i]) * 10000 * c.reportedWinRate * (1 - c.reportedWinRate)) / (c.games - 1),
    0
  )
  const signed = variance - noise
  return {
    observedVariancePp2: variance,
    samplingVariancePp2: noise,
    signedCorrectedVariancePp2: signed,
    correctedSdPp: signed > 0 ? Math.sqrt(signed) : null
  }
}
function referenceScore(_role, blocks) {
  const rows = new Map()
  for (const b of blocks) {
    const xs = b.spreadsPp.filter((x) => x !== null),
      mean = xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null
    const sd =
      xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : 0
    const denominator = sd < 1e-9 ? 1 : sd
    b.champions.forEach((champion, i) => {
      const row = rows.get(champion) ?? { champion, matchup: [], synergy: [] }
      const v = b.spreadsPp[i]
      if (v !== null && mean !== null) row[b.mode].push(-(v - mean) / denominator)
      rows.set(champion, row)
    })
  }
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  return [...rows.values()]
    .filter((r) => r.matchup.length + r.synergy.length)
    .map((r) => ({
      champion: r.champion,
      matchupMean: avg(r.matchup),
      synergyMean: avg(r.synergy),
      matchupRoles: r.matchup.length,
      synergyRoles: r.synergy.length
    }))
}

test('exact signed-unbiased counterexample separates sqrt/drop and sqrt/clip bias', () => {
  const r = exactNonlinearCounterexample()
  assert.equal(r.meanSignedVariance, r.truthVariance)
  assert.equal(r.positiveOnlyRetention, 0.5)
  assert.equal(r.meanSdConditionalOnRetention, Math.sqrt(2))
  assert.ok(r.meanClippedSd < r.truthSd)
})

test('available-role/reference changes can move an exactly average hero above reference', () => {
  const r = exactAvailableRoleCounterexample(referenceScore)
  assert.ok(r.trueEqualTwoRoleScores.every((x) => Math.abs(x.score) < 1e-12))
  const changed = r.oneUnavailableRoleScores.find((x) => x.hero === 'Synthetic 0')
  assert.ok(changed.score > 1)
  assert.equal(changed.roles, 1)
  assert.ok(
    r.oneUnavailableRoleScores.some((x) => x.hero !== 'Synthetic 0' && Math.abs(x.score) > 0)
  )
})

test('exact shared-baseline covariance cancels common shifts instead of diagonal subtraction', () => {
  const r = sharedBaselineCounterexamples()
  assert.ok(r.commonShift.trueAcrossCellSamplingVariancePp2 < 1e-20)
  assert.ok(r.commonShift.incorrectlyIndependentDiagonalNoisePp2 > 10)
  assert.ok(r.commonShift.wrongSignedVarianceAfterDiagonalSubtractionPp2 < 0)
  assert.ok(
    r.varyingOpponentBaselines.diagonalOnlyNoiseVariancePp2 >
      r.varyingOpponentBaselines.exactCenteredAcrossCellNoiseVariancePp2
  )
})

test('known cohort has twenty heroes, nine blocks and valid probabilities without real names', () => {
  const c = createCohort()
  assert.equal(c.length, 9)
  assert.ok(c.every((b) => b.heroes.length === 20))
  assert.ok(
    c.every((b) =>
      b.heroes.every((h) => h.cells.every((x) => x.trueWinRate > 0 && x.trueWinRate < 1))
    )
  )
  assert.equal(new Set(c[0].heroes.map((h) => h.group)).size, 4)
})

test('full synthetic pipeline reports retained quality together with full-candidate coverage', () => {
  const config = { repetitions: 3, seed: 20261109, heterogeneous: true }
  const r = simulateFinitePipeline(referenceEstimate, referenceScore, config)
  assert.deepEqual(r, simulateFinitePipeline(referenceEstimate, referenceScore, config))
  assert.equal(r.rawBlockZ.retainedAxisFraction, 1)
  assert.equal(r.rawBlockZ.completeNineRoleRowFraction, 1)
  assert.ok(r.referenceSelection.meanFiniteHeroesPerBlock < 20)
  assert.ok(
    r.momFiniteOnlyBlockZ.retainedAxisFraction > 0 &&
      r.momFiniteOnlyBlockZ.retainedAxisFraction <= 1
  )
  assert.ok(r.momFiniteOnlyBlockZ.completeNineRoleRowFraction < 1)
  assert.equal(r.referenceSelection.groupCoverage.length, 4)
  assert.ok(Number.isFinite(r.momFiniteOnlyBlockZ.rmseOnRetainedAxes))
})

test('constant sample sizes do not produce a spurious sample-count correlation', () => {
  const r = simulateFinitePipeline(referenceEstimate, referenceScore, {
    repetitions: 2,
    heterogeneous: false
  })
  assert.equal(r.rawBlockZ.scoreVsLogSampleCountCorrelation, null)
  assert.equal(r.momFiniteOnlyBlockZ.scoreVsLogSampleCountCorrelation, null)
})

test('audit rejects NaN estimates instead of dropping them as unavailable', () => {
  const bad = (c) => ({ ...referenceEstimate(c), signedCorrectedVariancePp2: NaN })
  assert.throws(() => simulateFinitePipeline(bad, referenceScore, { repetitions: 2 }), /Nonfinite/)
})

test('audit rejects NaN scorer outputs and false perfect-zero conversions', () => {
  const bad = (_r, b) => referenceScore(_r, b).map((r, i) => (i ? r : { ...r, matchupMean: NaN }))
  assert.throws(
    () => simulateFinitePipeline(referenceEstimate, bad, { repetitions: 2 }),
    /Nonfinite/
  )
  const clipped = (c) => {
    const r = referenceEstimate(c)
    return r.signedCorrectedVariancePp2 <= 0 ? { ...r, correctedSdPp: 0 } : r
  }
  assert.throws(
    () => simulateFinitePipeline(clipped, referenceScore, { repetitions: 2 }),
    /clipped/
  )
})

test('simulation configuration fails closed', () => {
  assert.throws(
    () => simulateFinitePipeline(referenceEstimate, referenceScore, { repetitions: 1 }),
    /Invalid/
  )
  assert.throws(
    () => simulateFinitePipeline(referenceEstimate, referenceScore, { seed: NaN }),
    /Invalid/
  )
})
