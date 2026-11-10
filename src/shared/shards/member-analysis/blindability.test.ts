import { describe, expect, it } from 'vitest'

import { binomialRateVariancePp2, calculateBlindability, expectedPairWinRate } from './blindability'
import type { BlindabilityCell, BlindabilityProfile } from './blindability'

const scope = {
  source: 'synthetic',
  patch: '16.21',
  region: 'test',
  queue: '420',
  rank: 'test',
  role: 'SUP'
}
const options = { pickRateFloor: 0, pickRateWeighted: false }
const cell = (
  key: string,
  deltaPp: number | null,
  overrides: Partial<BlindabilityCell> = {}
): BlindabilityCell => ({
  key,
  deltaPp,
  games: 1000,
  samplingVariancePp2: 1,
  pickRate: 0.5,
  ...overrides
})
function calculate(
  matchup: BlindabilityCell[],
  overrides = options,
  universe = matchup.map((c) => c.key)
) {
  const profile: BlindabilityProfile = { scope, champion: 'Synthetic A', matchup, synergy: [] }
  return calculateBlindability(profile, { matchup: universe, synergy: [] }, overrides)
}

describe('independent blindability prototype (synthetic inputs only)', () => {
  it('combines strengths in odds space, reverses opponents but not allies', () => {
    expect(expectedPairWinRate(0.52, 0.52, 'synergy')).toBeCloseTo(0.5399361022)
    expect(expectedPairWinRate(0.52, 0.52, 'matchup')).toBeCloseTo(0.5)
    expect(expectedPairWinRate(0.6, 0.4, 'synergy')).toBeCloseTo(0.5)
    expect(() => expectedPairWinRate(0, 0.5, 'synergy')).toThrow()
  })
  it('uses proportion variance, not variance of a win count', () => {
    expect(binomialRateVariancePp2(50, 100)).toBeCloseTo(2500 / 99)
    expect(binomialRateVariancePp2(0, 1)).toBeNull()
    expect(binomialRateVariancePp2(0, 0)).toBeNull()
    expect(() => binomialRateVariancePp2(101, 100)).toThrow()
  })
  it('uses an observed-minus-expected probability difference, not a difference of odds', () => {
    const expected = expectedPairWinRate(2 / 3, 1 / 3, 'matchup')
    expect(expected).toBeCloseTo(0.8, 12)
    expect(100 * (0.75 - expected)).toBeCloseTo(-5, 12)
  })
  it('does not automatically remove rank selection advantage from equal-strength marginals', () => {
    // Synthetic no-champion-effect population: each selected-rank player wins
    // 52% against a mixed-rank field. The neutral odds baseline is still 50%.
    const expected = expectedPairWinRate(0.52, 0.52, 'matchup')
    expect(100 * (0.52 - expected)).toBeCloseTo(2, 12)
  })
  it('passes observed noncomplementarity through to the sum of reciprocal residuals', () => {
    const forward = expectedPairWinRate(0.54, 0.49, 'matchup')
    const reverse = expectedPairWinRate(0.49, 0.54, 'matchup')
    expect(forward + reverse).toBeCloseTo(1, 12)
    const forwardObserved = 0.55,
      reverseObserved = 0.53
    expect(100 * (forwardObserved - forward + (reverseObserved - reverse))).toBeCloseTo(
      100 * (forwardObserved + reverseObserved - 1),
      12
    )
  })
  it('ignores a common row shift but not target-dependent shifts in spread', () => {
    const original = calculate([cell('x', -2), cell('y', 2)]).matchup
    const constantShift = calculate([cell('x', 1), cell('y', 5)]).matchup
    const varyingShift = calculate([cell('x', 0), cell('y', 6)]).matchup
    expect(original.observedSdPp).toBe(constantShift.observedSdPp)
    expect(original.observedSdPp).not.toBe(varyingShift.observedSdPp)
  })
  it('subtracts finite-sample measurement noise from observed sample variance', () => {
    const result = calculate([cell('x', -3), cell('y', 3)]).matchup
    expect(result.status).toBe('available')
    expect(result.observedSdPp).toBeCloseTo(Math.sqrt(18))
    expect(result.correctedSdPp).toBeCloseTo(Math.sqrt(17))
    expect(result.meanDeltaPp).toBe(0)
    expect(result.weightedCoverage).toBe(1)
  })
  it('separates stability from mean strength', () => {
    const weak = calculate([cell('x', -5), cell('y', -5)]).matchup
    const strong = calculate([cell('x', 5), cell('y', 5)]).matchup
    expect(weak.correctedSdPp).toBe(strong.correctedSdPp)
    expect(weak.meanDeltaPp).toBe(-5)
    expect(strong.meanDeltaPp).toBe(5)
    expect(weak.noiseFloor).toBe(true)
  })
  it('weights by population pick rate, never observation count', () => {
    const cells = [cell('x', -3, { pickRate: 0.75, games: 50 }), cell('y', 3, { pickRate: 0.25 })]
    const result = calculate(cells, { ...options, pickRateWeighted: true }).matchup
    expect(result.meanDeltaPp).toBeCloseTo(-1.5)
    expect(result.effectiveSlots).toBeCloseTo(1.6)
    expect(result.correctedSdPp).toBeCloseTo(Math.sqrt(17))
  })
  it('filters on an explicit pick-rate floor, including the boundary', () => {
    const result = calculate([cell('x', -3, { pickRate: 0.01 }), cell('y', 3, { pickRate: 0.1 })], {
      ...options,
      pickRateFloor: 0.1
    }).matchup
    expect(result.eligibleSlots).toBe(1)
    expect(result.correctedSdPp).toBeNull()
    expect(result.status).toBe('insufficient')
  })
  it('does not turn missing data or zero games into a neutral interaction', () => {
    const result = calculate([cell('x', null), cell('y', 0, { games: 0 }), cell('z', 0)]).matchup
    expect(result.observedSlots).toBe(1)
    expect(result.weightedCoverage).toBeCloseTo(1 / 3)
    expect(result.correctedSdPp).toBeNull()
  })
  it('marks a top-N response partial instead of treating it as the full matrix', () => {
    const result = calculate([cell('x', -3), cell('y', 3)], options, ['x', 'y', 'missing']).matchup
    expect(result.status).toBe('partial')
    expect(result.weightedCoverage).toBeNull()
    expect(result.eligibleSlots).toBe(3)
  })
  it('refuses noise correction when delta uncertainty is unknown', () => {
    const result = calculate([cell('x', -3, { samplingVariancePp2: null }), cell('y', 3)]).matchup
    expect(result.observedSdPp).not.toBeNull()
    expect(result.correctedSdPp).toBeNull()
    expect(result.status).toBe('partial')
  })
  it('keeps matchup and synergy distinct and preserves version/source', () => {
    const result = calculateBlindability(
      {
        scope,
        champion: 'Synthetic A',
        matchup: [cell('x', -3), cell('y', 3)],
        synergy: [cell('z', 0), cell('w', 0)]
      },
      { matchup: ['x', 'y'], synergy: ['z', 'w'] },
      options
    )
    expect(result.scope).toEqual(scope)
    expect(result.matchup.correctedSdPp).toBeGreaterThan(result.synergy.correctedSdPp!)
    expect(calculate([]).synergy.correctedSdPp).toBeNull()
  })
  it('rejects duplicates, invalid values and implicit scope', () => {
    expect(() => calculate([cell('x', 1), cell('x', 2)])).toThrow()
    expect(() => calculate([cell('x', Number.NaN)])).toThrow()
    expect(() => calculate([cell('x', 1, { samplingVariancePp2: -1 })])).toThrow()
    expect(() => calculate([], { ...options, pickRateFloor: 2 })).toThrow()
    expect(() =>
      calculateBlindability(
        { scope: { ...scope, source: '' }, champion: 'Synthetic A', matchup: [], synergy: [] },
        { matchup: [], synergy: [] },
        options
      )
    ).toThrow()
  })
})
