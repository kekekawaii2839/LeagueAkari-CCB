import { describe, expect, it } from 'vitest'

import {
  type InteractionBlock,
  type PrecomputedSpreadBlock,
  scoreBlindability,
  scoreBlindabilityFromSpreads,
  standardizeBlindabilitySpreads
} from './scoring'

function block(overrides: Partial<PrecomputedSpreadBlock> = {}): PrecomputedSpreadBlock {
  return {
    ownRole: 'MID',
    otherRole: 'TOP',
    mode: 'matchup',
    champions: ['A', 'B', 'C'],
    championPickRates: [0.5, 0.3, 0.2],
    spreadsPp: [1, 2, 4],
    ...overrides
  }
}
describe('source-compatible scoring from precomputed SDs', () => {
  it('reports actual finite normalization subset and uses reverse sample-z', () => {
    const s = standardizeBlindabilitySpreads([1, 2, 4, null])
    expect(s.candidateCount).toBe(4)
    expect(s.finiteCount).toBe(3)
    expect(s.meanSdPp).toBeCloseTo(7 / 3)
    expect(s.sampleSdOfSdPp).toBeCloseTo(Math.sqrt(7 / 3))
    expect(s.zScores[0]).toBeCloseTo((7 / 3 - 1) / Math.sqrt(7 / 3))
    expect(s.zScores[3]).toBeNull()
    expect(s.zScores.slice(0, 3).reduce<number>((a, b) => a + b!, 0)).toBeCloseTo(0)
  })
  it('shares exactly the same post-SD calculations as the original matrix scorer', () => {
    const b = block(),
      matrix: InteractionBlock = {
        ...b,
        targets: ['X', 'Y', 'Z'],
        targetPickRates: [0.4, 0.3, 0.3],
        rawPp: b.spreadsPp.map((s) => (s === null ? [null, null, null] : [-s, 0, s])),
        shrunkPp: Array.from({ length: 3 }, () => [null, null, null])
      }
    expect(scoreBlindabilityFromSpreads('MID', [b], 0)).toEqual(
      scoreBlindability('MID', [matrix], {
        shrinkAlpha: 0,
        pickRateFloor: 0,
        pickRateWeighted: false
      })
    )
  })
  it('standardizes roles separately before averaging, not an overall RMS or global recentering', () => {
    const a = block(),
      b = block({ mode: 'synergy', otherRole: 'JUNGLE', spreadsPp: [4, 2, null] })
    const scores = scoreBlindabilityFromSpreads('MID', [a, b], 0)
    const x = standardizeBlindabilitySpreads(a.spreadsPp).zScores
    const y = standardizeBlindabilitySpreads(b.spreadsPp).zScores
    for (const row of scores) {
      const i = a.champions.indexOf(row.champion)
      expect(row.matchupMean).toBe(x[i])
      expect(row.synergyMean).toBe(y[i])
    }
    const partial = scores.find((r) => r.champion === 'C')!
    expect(partial.synergyRoles).toBe(0)
    expect(partial.synergyMean).toBeNull()
  })
  it('keeps null blocks unscored and averages available blocks with explicit coverage', () => {
    const a = block(),
      b = block({ otherRole: 'JUNGLE', spreadsPp: [null, 3, 1] })
    const scores = scoreBlindabilityFromSpreads('MID', [a, b], 0)
    const aa = scores.find((r) => r.champion === 'A')!,
      bb = scores.find((r) => r.champion === 'B')!
    expect(aa.matchupRoles).toBe(1)
    expect(aa.blocks[1].z).toBeNull()
    expect(aa.matchupMean).toBe(aa.blocks[0].z)
    expect(bb.matchupRoles).toBe(2)
    expect(bb.matchupMean).toBeCloseTo((bb.blocks[0].z! + bb.blocks[1].z!) / 2)
  })
  it('does own display filtering after normalization and retains pool exceptions', () => {
    const b = block({ championPickRates: [0.8, 0.15, 0.05] }),
      all = scoreBlindabilityFromSpreads('MID', [b], 0)
    const filtered = scoreBlindabilityFromSpreads('MID', [b], 0.1)
    expect(filtered).toHaveLength(2)
    expect(filtered[0].matchupMean).toBe(all[0].matchupMean)
    expect(scoreBlindabilityFromSpreads('MID', [b], 0.1, ['C'])).toHaveLength(3)
  })
  it('exposes degenerate references rather than calling their fallback ordinary z', () => {
    const one = standardizeBlindabilitySpreads([null, 2, null])
    expect(one.finiteCount).toBe(1)
    expect(one.fallbackDenominatorUsed).toBe(true)
    expect(one.zScores).toEqual([null, -0, null])
    const none = standardizeBlindabilitySpreads([null, null])
    expect(none.zScores).toEqual([null, null])
    expect(standardizeBlindabilitySpreads([1, 1, 1]).fallbackDenominatorUsed).toBe(true)
  })
  it('omits wholly unscorable rows, even if in pool', () => {
    expect(
      scoreBlindabilityFromSpreads('MID', [block({ spreadsPp: [null, null, null] })], 0, ['A'])
    ).toEqual([])
  })
  it('rejects malformed SDs, roster, display settings, and duplicate/wrong role blocks', () => {
    for (const v of [NaN, Infinity, -1, 201])
      expect(() => standardizeBlindabilitySpreads([1, v])).toThrow()
    expect(() => scoreBlindabilityFromSpreads('MID', [block({ spreadsPp: [1] })], 0)).toThrow()
    expect(() =>
      scoreBlindabilityFromSpreads('MID', [block({ champions: ['A', 'A', 'C'] })], 0)
    ).toThrow()
    expect(() => scoreBlindabilityFromSpreads('MID', [block(), block()], 0)).toThrow()
    expect(() =>
      scoreBlindabilityFromSpreads('MID', [block({ mode: 'synergy', otherRole: 'MID' })], 0)
    ).toThrow()
    expect(() => scoreBlindabilityFromSpreads('MID', [block()], NaN)).toThrow()
  })
})
