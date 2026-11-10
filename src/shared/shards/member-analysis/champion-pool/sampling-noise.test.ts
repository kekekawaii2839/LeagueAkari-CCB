import { describe, expect, it } from 'vitest'

import {
  type InteractionSpreadCell,
  type InteractionSpreadOptions,
  estimateInteractionSpread,
  pairRateSamplingVariancePp2
} from './sampling-noise'

const options: InteractionSpreadOptions = {
  pickRateFloor: 0,
  pickRateWeighted: true,
  noiseModel: 'binomial-proportion-plugin',
  varianceConvention: 'meta-distribution'
}
const cell = (
  target: string,
  deltaPp: number | null,
  overrides: Partial<InteractionSpreadCell> = {}
): InteractionSpreadCell => ({
  target,
  deltaPp,
  games: 2501,
  reportedWinRate: 0.5,
  pickRate: 0.5,
  ...overrides
})

describe('conditional method-of-moments interaction spread', () => {
  it('uses sampling variance of a proportion, not binomial win-count variance', () => {
    expect(pairRateSamplingVariancePp2(0.5, 101, 'binomial-proportion-plugin')).toBe(25)
    expect(pairRateSamplingVariancePp2(0.5, 1, 'binomial-proportion-plugin')).toBeNull()
    expect(pairRateSamplingVariancePp2(0.5, 0, 'maximum-binomial-variance')).toBeNull()
    expect(pairRateSamplingVariancePp2(0.2, 100, 'maximum-binomial-variance')).toBe(25)
  })
  it('subtracts the noise contribution of centering, rather than mean cell noise', () => {
    const r = estimateInteractionSpread([cell('A', -3), cell('B', 3)], options)
    expect(r.observedVariancePp2).toBe(9)
    expect(r.samplingVariancePp2).toBe(0.5)
    expect(r.signedCorrectedVariancePp2).toBe(8.5)
    expect(r.correctedSdPp).toBeCloseTo(Math.sqrt(8.5))
    expect(r.status).toBe('available')
  })
  it('explicitly separates meta-distribution from weighted sample convention', () => {
    const rows = [cell('A', -3), cell('B', 3)]
    const r = estimateInteractionSpread(rows, {
      ...options,
      varianceConvention: 'reliability-weighted-sample'
    })
    expect(r.observedVariancePp2).toBe(18)
    expect(r.samplingVariancePp2).toBe(1)
    expect(r.signedCorrectedVariancePp2).toBe(17)
  })
  it('handles unequal pick rates and unequal cell sampling variances analytically', () => {
    const rows = [
      cell('A', -2, { pickRate: 0.75, games: 101 }),
      cell('B', 6, { pickRate: 0.25, games: 1001 })
    ]
    const r = estimateInteractionSpread(rows, options)
    expect(r.meanDeltaPp).toBe(0)
    expect(r.observedVariancePp2).toBe(12)
    expect(r.samplingVariancePp2).toBe(5.15625)
    const s = estimateInteractionSpread(rows, {
      ...options,
      varianceConvention: 'reliability-weighted-sample'
    })
    expect(s.observedVariancePp2).toBe(32)
    expect(s.samplingVariancePp2).toBe(13.75)
  })
  it('retains signed noise-dominated variance instead of declaring perfect stability', () => {
    const r = estimateInteractionSpread([cell('A', 0), cell('B', 0)], options)
    expect(r.signedCorrectedVariancePp2).toBe(-0.5)
    expect(r.correctedSdPp).toBeNull()
    expect(r.status).toBe('noise-dominated')
    const boundary = estimateInteractionSpread(
      [cell('A', -0.5, { games: 5001 }), cell('B', 0.5, { games: 5001 })],
      options
    )
    expect(boundary.signedCorrectedVariancePp2).toBe(0)
    expect(boundary.correctedSdPp).toBeNull()
  })
  it('does not silently omit an unknown cell or fabricate its delta', () => {
    const r = estimateInteractionSpread(
      [
        cell('A', -3, { pickRate: 0.4 }),
        cell('B', 3, { pickRate: 0.4 }),
        cell('C', null, { pickRate: 0.2, games: 0, reportedWinRate: null })
      ],
      options
    )
    expect(r.status).toBe('partial')
    expect(r.eligibleTargets).toBe(3)
    expect(r.observedTargets).toBe(2)
    expect(r.weightedCoverage).toBeCloseTo(0.8)
  })
  it('preserves observed spread when one-game noise is not estimable', () => {
    const r = estimateInteractionSpread([cell('A', -3, { games: 1 }), cell('B', 3)], options)
    expect(r.observedSdPp).toBe(3)
    expect(r.noiseEstimableTargets).toBe(1)
    expect(r.correctedSdPp).toBeNull()
    expect(r.status).toBe('partial')
  })
  it('filters target pick rates before weighting and ignores zero-weight targets', () => {
    const rows = [
      cell('A', -3, { pickRate: 0.45 }),
      cell('B', 3, { pickRate: 0.45 }),
      cell('C', 100, { pickRate: 0.001 }),
      cell('D', 100, { pickRate: 0 })
    ]
    const r = estimateInteractionSpread(rows, { ...options, pickRateFloor: 0.005 })
    expect(r.observedTargets).toBe(2)
    expect(r.observedSdPp).toBe(3)
  })
  it('unweighted settings actually treat eligible targets equally', () => {
    const r = estimateInteractionSpread(
      [cell('A', -3, { pickRate: 0.9 }), cell('B', 3, { pickRate: 0.1 })],
      { ...options, pickRateWeighted: false }
    )
    expect(r.observedSdPp).toBe(3)
    expect(r.effectiveTargets).toBe(2)
  })
  it('returns insufficient when no cross-target spread can be measured', () => {
    expect(estimateInteractionSpread([], options).status).toBe('insufficient')
    expect(estimateInteractionSpread([cell('A', 3)], options).correctedSdPp).toBeNull()
    expect(
      estimateInteractionSpread([cell('A', null, { games: 0 })], options).weightedCoverage
    ).toBe(0)
  })
  it('maximum-binomial model is sensitivity analysis, not an estimated confidence bound', () => {
    const rows = [cell('A', -3, { reportedWinRate: 0.1 }), cell('B', 3, { reportedWinRate: 0.9 })]
    const a = estimateInteractionSpread(rows, options)
    const b = estimateInteractionSpread(rows, {
      ...options,
      noiseModel: 'maximum-binomial-variance'
    })
    expect(b.samplingVariancePp2!).toBeGreaterThan(a.samplingVariancePp2!)
    expect(b.assumptions).toBe('fixed-baselines-fixed-pick-rates-independent-pair-errors')
  })
  it('never mutates caller data or rewrites individual interactions as shrinkage', () => {
    const rows = [cell('A', -3), cell('B', 3)],
      before = structuredClone(rows)
    estimateInteractionSpread(rows, options)
    expect(rows).toEqual(before)
  })
  it('recovers known latent variance in exact binomial expectation, not just Monte Carlo', () => {
    const choose = (n: number, k: number) => {
      let c = 1
      for (let i = 1; i <= k; i++) c = (c * (n - i + 1)) / i
      return c
    }
    for (const varianceConvention of [
      'meta-distribution',
      'reliability-weighted-sample'
    ] as const) {
      let mass = 0,
        correctedExpectation = 0,
        rawExpectation = 0
      for (let w1 = 0; w1 <= 3; w1++)
        for (let w2 = 0; w2 <= 5; w2++) {
          const probability =
            choose(3, w1) *
            0.3 ** w1 *
            0.7 ** (3 - w1) *
            choose(5, w2) *
            0.7 ** w2 *
            0.3 ** (5 - w2)
          const r = estimateInteractionSpread(
            [
              cell('A', 100 * (w1 / 3 - 0.5), { games: 3, reportedWinRate: w1 / 3, pickRate: 0.3 }),
              cell('B', 100 * (w2 / 5 - 0.5), { games: 5, reportedWinRate: w2 / 5, pickRate: 0.7 })
            ],
            { ...options, varianceConvention }
          )
          mass += probability
          correctedExpectation += probability * r.signedCorrectedVariancePp2!
          rawExpectation += probability * r.observedVariancePp2!
        }
      const trueVariance =
        varianceConvention === 'meta-distribution' ? 0.3 * 0.7 * 40 ** 2 : 40 ** 2 / 2
      expect(mass).toBeCloseTo(1, 12)
      expect(correctedExpectation).toBeCloseTo(trueVariance, 8)
      expect(rawExpectation).toBeGreaterThan(trueVariance)
    }
  })
  it('rejects duplicate, nonfinite, impossible, and invalid-option inputs', () => {
    expect(() => estimateInteractionSpread([cell('A', 3), cell('A', 4)], options)).toThrow()
    for (const mutation of [
      { deltaPp: NaN },
      { games: -1 },
      { games: 1.5 },
      { reportedWinRate: 1.01 },
      { pickRate: Infinity }
    ]) {
      expect(() => estimateInteractionSpread([cell('A', 3, mutation)], options)).toThrow()
    }
    expect(() => estimateInteractionSpread([], { ...options, pickRateFloor: NaN })).toThrow()
  })
})
