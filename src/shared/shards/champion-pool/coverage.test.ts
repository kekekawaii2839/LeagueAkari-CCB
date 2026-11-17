import { describe, expect, it } from 'vitest'

import {
  type PoolCell,
  type PoolTarget,
  evaluateTarget,
  summarizeCoverage,
  topThreeZ
} from './coverage'

const cell = (
  id: number,
  deltaPp: number | null,
  state: PoolCell['state'] = deltaPp === null ? 'missing' : 'available'
): PoolCell => ({ championId: id, deltaPp, games: deltaPp === null ? null : 50, state })
describe('pool target coverage', () => {
  it('standardizes the best three against the full column population, not the pool', () => {
    const result = topThreeZ(
      [cell(1, 4), cell(2, 3), cell(3, 2), cell(4, -2)],
      [-2, 0, 2, 3, 4],
      5,
      true
    )
    const mean = 1.4,
      sd = Math.sqrt(
        ((-2 - mean) ** 2 + (0 - mean) ** 2 + (2 - mean) ** 2 + (3 - mean) ** 2 + (4 - mean) ** 2) /
          5
      )
    expect(result.score).toBeCloseTo((3 - mean) / sd)
    expect(result.count).toBe(3)
    expect(topThreeZ([cell(1, 4)], [-2, 0, 2, 3, 4], 5, true).count).toBe(1)
    expect(topThreeZ([cell(1, null, 'unavailable'), cell(2, 2)], [0, 2, 4], 3, true).count).toBe(1)
  })
  it('keeps incomplete, missing and degenerate top-three scores unknown', () => {
    expect(topThreeZ([cell(1, 2)], [], 3, false)).toMatchObject({ score: null, reason: 'pending' })
    expect(topThreeZ([cell(1, 2), cell(2, null)], [0, 1, 2], 3, true)).toMatchObject({
      score: null,
      reason: 'missing-pool'
    })
    expect(topThreeZ([cell(1, 2)], [2, 2, 2], 3, true)).toMatchObject({
      score: null,
      reason: 'zero-variance'
    })
    expect(topThreeZ([cell(1, 2)], [2], 3, true)).toMatchObject({
      score: null,
      reason: 'insufficient-reference'
    })
    expect(topThreeZ([cell(1, null, 'unavailable')], [1, 2], 2, true)).toMatchObject({
      score: null,
      reason: 'no-picks'
    })
    expect(topThreeZ([cell(1, 1)], [1, 2, 3], 3, true).score).toBeLessThan(0)
  })
  it('does not count occupied heroes or missing answers as losses', () => {
    expect(evaluateTarget([cell(1, null, 'unavailable')]).status).toBe('not-applicable')
    expect(evaluateTarget([cell(1, null, 'unavailable'), cell(2, -1)]).status).toBe('uncovered')
    expect(evaluateTarget([cell(1, -1), cell(2, null)]).status).toBe('unknown')
    expect(evaluateTarget([cell(1, 0), cell(2, null)])).toMatchObject({
      status: 'covered',
      complete: false,
      bestDeltaPp: 0
    })
    expect(evaluateTarget([cell(2, 1), cell(1, 1)]).bestChampionId).toBe(1)
  })
  it('retains unknown PR in denominator', () => {
    const targets = [
      ['covered', 0.2],
      ['unknown', 0.6],
      ['uncovered', 0.2],
      ['not-applicable', 0.1]
    ].map(([status, pickRate]) => ({ status, pickRate })) as PoolTarget[]
    expect(summarizeCoverage(targets)).toMatchObject({ total: 3, covered: 0.2, unknown: 0.6 })
    expect(summarizeCoverage([]).covered).toBeNull()
  })
})
