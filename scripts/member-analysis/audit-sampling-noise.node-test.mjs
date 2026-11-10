import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSyntheticProfile,
  evaluateMonteCarloMoments,
  simulateConfiguration
} from './audit-sampling-noise.mjs'

/** Small independent reference for testing the audit itself. Product-core accuracy
 * is checked separately by running the CLI against its actually compiled module.
 */
function referenceEstimator(cells, options) {
  const total = cells.reduce((s, c) => s + c.pickRate, 0)
  const a = cells.map((c) => c.pickRate / total)
  const mean = cells.reduce((s, c, i) => s + a[i] * c.deltaPp, 0)
  const divisor =
    options.varianceConvention === 'meta-distribution' ? 1 : 1 - a.reduce((s, w) => s + w * w, 0)
  const observed = cells.reduce((s, c, i) => s + a[i] * (c.deltaPp - mean) ** 2, 0) / divisor
  const noise =
    cells.reduce(
      (s, c, i) =>
        s +
        (a[i] * (1 - a[i]) * 10000 * c.reportedWinRate * (1 - c.reportedWinRate)) / (c.games - 1),
      0
    ) / divisor
  const signed = observed - noise
  return {
    observedVariancePp2: observed,
    samplingVariancePp2: noise,
    signedCorrectedVariancePp2: signed,
    correctedSdPp: signed > 0 ? Math.sqrt(signed) : null,
    status: signed > 0 ? 'available' : 'noise-dominated'
  }
}

test('synthetic latent probabilities have the declared centered meta variance', () => {
  for (const sd of [0, 1.1, 2.2]) {
    const p = createSyntheticProfile('Synthetic', sd)
    const mean = p.cells.reduce((s, c) => s + c.pickRate * c.trueDeltaPp, 0)
    const variance = p.cells.reduce((s, c) => s + c.pickRate * (c.trueDeltaPp - mean) ** 2, 0)
    assert.ok(Math.abs(mean) < 1e-12)
    assert.ok(Math.abs(variance - sd * sd) < 1e-12)
    assert.ok(p.cells.every((c) => c.trueWinRate > 0 && c.trueWinRate < 1))
  }
})

test('a known-flat latent profile is not manufactured into a positive spread by clipping', () => {
  const result = simulateConfiguration(
    referenceEstimator,
    createSyntheticProfile('Synthetic flat', 0),
    0.1,
    {
      repetitions: 200
    }
  )
  assert.equal(result.knownTrueVariancePp2, 0)
  assert.equal(result.passed, true)
  assert.ok(result.noiseDominatedFraction > 0)
  assert.equal(
    result.sqrtMeanSignedCorrectedVariancePp,
    result.meanSignedCorrectedVariancePp2 < 0
      ? null
      : Math.sqrt(result.meanSignedCorrectedVariancePp2)
  )
})

test('fixed seed Monte Carlo is reproducible and uses signed variance unbiasedness', () => {
  const profile = createSyntheticProfile('Synthetic narrow', 1.1)
  const config = { repetitions: 200, seed: 20261108 }
  const first = simulateConfiguration(referenceEstimator, profile, 0.03, config)
  assert.deepEqual(first, simulateConfiguration(referenceEstimator, profile, 0.03, config))
  assert.equal(first.passed, true)
  assert.ok(first.observedRmsSdPp > first.knownTrueSdPp)
  assert.ok(first.noiseDominatedFraction > 0)
  assert.equal(first.mean95MonteCarloIntervalPp2.length, 2)
})

test('sample convention has its own known variance instead of silently reusing meta variance', () => {
  const profile = createSyntheticProfile('Synthetic', 1.1)
  const report = simulateConfiguration(referenceEstimator, profile, 0.1, {
    repetitions: 200,
    convention: 'reliability-weighted-sample'
  })
  assert.ok(report.knownTrueVariancePp2 > 1.1 ** 2)
  assert.equal(report.passed, true)
})

for (const value of [NaN, Infinity, undefined, null]) {
  test(`audit rejects nonfinite/missing corrected variance ${String(value)}`, () => {
    const bad = (cells, options) => ({
      ...referenceEstimator(cells, options),
      signedCorrectedVariancePp2: value
    })
    assert.throws(
      () =>
        simulateConfiguration(bad, createSyntheticProfile('Synthetic', 1.1), 0.1, {
          repetitions: 100
        }),
      /Nonfinite/
    )
  })
}

test('an estimator that skips noise subtraction fails the known-truth experiment', () => {
  const uncorrected = (cells, options) => {
    const result = referenceEstimator(cells, options)
    return {
      ...result,
      samplingVariancePp2: 0,
      signedCorrectedVariancePp2: result.observedVariancePp2,
      correctedSdPp: Math.sqrt(result.observedVariancePp2),
      status: 'available'
    }
  }
  const result = simulateConfiguration(
    uncorrected,
    createSyntheticProfile('Synthetic', 1.1),
    0.03,
    { repetitions: 200 }
  )
  assert.equal(result.passed, false)
})

test('negative corrected variance cannot masquerade as perfect zero-spread stability', () => {
  const clipped = (cells, options) => {
    const result = referenceEstimator(cells, options)
    return result.signedCorrectedVariancePp2 < 0
      ? { ...result, correctedSdPp: 0, status: 'available' }
      : result
  }
  assert.throws(
    () =>
      simulateConfiguration(clipped, createSyntheticProfile('Synthetic', 1.1), 0.03, {
        repetitions: 100
      }),
    /Nonpositive variance/
  )
})

test('an exact zero-noise-boundary estimate is unresolved and not accepted as known positive truth', () => {
  const zeroBoundary = () => ({
    observedVariancePp2: 1,
    samplingVariancePp2: 1,
    signedCorrectedVariancePp2: 0,
    correctedSdPp: null,
    status: 'noise-dominated'
  })
  const result = simulateConfiguration(
    zeroBoundary,
    createSyntheticProfile('Synthetic', 1.1),
    0.03,
    {
      repetitions: 100
    }
  )
  assert.equal(result.noiseDominatedFraction, 1)
  assert.equal(result.passed, false)
})

for (const field of ['observedVariancePp2', 'samplingVariancePp2']) {
  test(`audit also rejects NaN in ${field}`, () => {
    const bad = (cells, options) => ({ ...referenceEstimator(cells, options), [field]: NaN })
    assert.throws(
      () =>
        simulateConfiguration(bad, createSyntheticProfile('Synthetic', 1.1), 0.1, {
          repetitions: 100
        }),
      /Nonfinite/
    )
  })
}

test('Monte Carlo acceptance rejects invalid moments and substantial fixed bias', () => {
  assert.throws(
    () => evaluateMonteCarloMoments({ mean: NaN, sampleVariance: 1, repetitions: 100, truth: 1 }),
    /Nonfinite/
  )
  assert.throws(
    () => evaluateMonteCarloMoments({ mean: 1, sampleVariance: -1, repetitions: 100, truth: 1 }),
    /Invalid/
  )
  assert.equal(
    evaluateMonteCarloMoments({ mean: 2, sampleVariance: 0, repetitions: 1000, truth: 1 }).passed,
    false
  )
})
