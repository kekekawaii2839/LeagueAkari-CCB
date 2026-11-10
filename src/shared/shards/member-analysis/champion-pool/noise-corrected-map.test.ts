import { describe, expect, it } from 'vitest'

import { type ScopedSpreadBlock, aggregateNoiseCorrectedAxes } from './noise-corrected-map'
import { type InteractionSpreadOptions, estimateInteractionSpread } from './sampling-noise'
import { DRAFT_ROLES } from './scoring'

const settings: InteractionSpreadOptions = {
  pickRateFloor: 0.005,
  pickRateWeighted: true,
  noiseModel: 'binomial-proportion-plugin',
  varianceConvention: 'meta-distribution'
}
const scope = {
  source: 'synthetic',
  interactionPatch: '16.21',
  playRatePatch: '16.21',
  region: 'test',
  queueId: 420,
  population: 'synthetic'
}
function estimate(signedVariance: number) {
  return estimateInteractionSpread(
    [-1, 1].map((s, i) => ({
      target: `Synthetic ${i}`,
      deltaPp: s * Math.sqrt(signedVariance + 1),
      games: 1251,
      reportedWinRate: 0.5,
      pickRate: 0.5
    })),
    settings
  )
}
function fixture(): ScopedSpreadBlock[] {
  return (['matchup', 'synergy'] as const).flatMap((mode) =>
    DRAFT_ROLES.filter((r) => mode === 'matchup' || r !== 'MID').map((otherRole) => ({
      ownRole: 'MID',
      champion: 'Synthetic champion',
      otherRole,
      mode,
      scope: { ...scope },
      settings: { ...settings },
      estimate: estimate(1)
    }))
  )
}

describe('independent role-balanced noise-corrected axes', () => {
  it('averages signed variances before the square root, not role SDs', () => {
    const blocks = fixture()
    blocks[0].estimate = estimate(4)
    const r = aggregateNoiseCorrectedAxes('MID', blocks)
    expect(r.matchup.meanSignedCorrectedVariancePp2).toBeCloseTo(1.6)
    expect(r.matchup.correctedRmsSpreadPp).toBeCloseTo(Math.sqrt(1.6))
    expect(r.matchup.correctedRmsSpreadPp).not.toBeCloseTo(1.2)
    expect(r.synergy.correctedRmsSpreadPp).toBeCloseTo(1)
  })
  it('includes negative block estimates without clipping, dropping, or changing role weights', () => {
    const blocks = fixture()
    blocks[0].estimate = estimate(-0.5)
    const r = aggregateNoiseCorrectedAxes('MID', blocks)
    expect(r.matchup.status).toBe('available')
    expect(r.matchup.usableRoles).toBe(5)
    expect(r.matchup.meanSignedCorrectedVariancePp2).toBeCloseTo(0.7)
    expect(r.matchup.noiseDominatedRoles).toEqual(['TOP'])
  })
  it('keeps unresolved whole axes signed and never invents a zero-spread point', () => {
    const blocks = fixture()
    for (const b of blocks.filter((b) => b.mode === 'synergy')) b.estimate = estimate(-0.5)
    const r = aggregateNoiseCorrectedAxes('MID', blocks)
    expect(r.matchup.status).toBe('available')
    expect(r.synergy.status).toBe('noise-dominated')
    expect(r.synergy.meanSignedCorrectedVariancePp2).toBeCloseTo(-0.5)
    expect(r.synergy.correctedRmsSpreadPp).toBeNull()
  })
  it('does not classify an exact zero-variance axis boundary as perfect stability', () => {
    const blocks = fixture()
    blocks
      .filter((b) => b.mode === 'synergy')
      .forEach((b, i) => {
        b.estimate = estimate(i === 0 ? 3 : -1)
      })
    const r = aggregateNoiseCorrectedAxes('MID', blocks)
    expect(r.synergy.meanSignedCorrectedVariancePp2).toBe(0)
    expect(r.synergy.status).toBe('noise-dominated')
    expect(r.synergy.correctedRmsSpreadPp).toBeNull()
  })
  it('does not average only surviving roles when a block or target is missing', () => {
    const missing = fixture().slice(1)
    expect(aggregateNoiseCorrectedAxes('MID', missing).matchup.status).toBe('incomplete')
    const blocks = fixture()
    blocks[0].estimate = { ...blocks[0].estimate, status: 'partial', weightedCoverage: 0.9 }
    const r = aggregateNoiseCorrectedAxes('MID', blocks)
    expect(r.matchup.meanSignedCorrectedVariancePp2).toBeNull()
    expect(r.matchup.missingOrPartialRoles).toEqual(['TOP'])
  })
  it('rejects source, settings, estimator, and role mixing', () => {
    for (const mutate of [
      (b: ScopedSpreadBlock) => {
        b.scope = { ...b.scope, interactionPatch: '16.22' }
      },
      (b: ScopedSpreadBlock) => {
        b.settings = { ...b.settings, pickRateFloor: 0.01 }
      },
      (b: ScopedSpreadBlock) => {
        b.estimate = { ...b.estimate, varianceConvention: 'reliability-weighted-sample' }
      },
      (b: ScopedSpreadBlock) => {
        b.ownRole = 'TOP'
      },
      (b: ScopedSpreadBlock) => {
        b.champion = 'Another synthetic champion'
      }
    ]) {
      const rows = fixture()
      mutate(rows[1])
      expect(() => aggregateNoiseCorrectedAxes('MID', rows)).toThrow()
    }
  })
  it('rejects duplicate roles, impossible same-role synergy and nonfinite/decomposition errors', () => {
    const rows = fixture()
    expect(() => aggregateNoiseCorrectedAxes('MID', [...rows, rows[0]])).toThrow()
    const bad = fixture()
    bad[5].otherRole = 'MID'
    expect(() => aggregateNoiseCorrectedAxes('MID', bad)).toThrow()
    for (const variance of [NaN, Infinity, 100]) {
      const b = fixture()
      b[0].estimate = { ...b[0].estimate, signedCorrectedVariancePp2: variance }
      expect(() => aggregateNoiseCorrectedAxes('MID', b)).toThrow()
    }
  })
  it('retains complete provenance and does not mutate caller estimates', () => {
    const blocks = fixture(),
      before = structuredClone(blocks),
      result = aggregateNoiseCorrectedAxes('MID', blocks)
    expect(blocks).toEqual(before)
    expect(result.scope).toEqual(scope)
    expect(Object.isFrozen(result.scope)).toBe(true)
    expect(result.method).toBe('conditional-role-balanced-rms-mom-v1')
  })
  it('preserves exact MoM expectation even for perfectly shared errors across role blocks', () => {
    let expectedAxisVariance = 0
    const choose = [1, 2, 1]
    for (let a = 0; a <= 2; a++)
      for (let b = 0; b <= 2; b++) {
        const probability =
          choose[a] * 0.25 ** a * 0.75 ** (2 - a) * choose[b] * 0.75 ** b * 0.25 ** (2 - b)
        const e = estimateInteractionSpread(
          [
            {
              target: 'A',
              deltaPp: 100 * (a / 2 - 0.5),
              games: 2,
              reportedWinRate: a / 2,
              pickRate: 0.5
            },
            {
              target: 'B',
              deltaPp: 100 * (b / 2 - 0.5),
              games: 2,
              reportedWinRate: b / 2,
              pickRate: 0.5
            }
          ],
          settings
        )
        const rows = fixture().map((row) => ({ ...row, estimate: e }))
        const result = aggregateNoiseCorrectedAxes('MID', rows)
        expectedAxisVariance += probability * result.matchup.meanSignedCorrectedVariancePp2!
        expect(result.matchup.meanSignedCorrectedVariancePp2).toBe(
          result.synergy.meanSignedCorrectedVariancePp2
        )
      }
    expect(expectedAxisVariance).toBeCloseTo(625, 10)
  })
})
