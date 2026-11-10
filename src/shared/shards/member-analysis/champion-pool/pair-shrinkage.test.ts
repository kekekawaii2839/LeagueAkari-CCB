import { describe, expect, it } from 'vitest'

import { estimateRolePairShrinkage, shrinkInteractionBlock } from './pair-shrinkage'
import { scoreBlindability } from './scoring'
import type { ScopedInteractionBlock } from './scoring'

const cells = () => [
  { key: 'low', deltaPp: 8, games: 50 },
  { key: 'high', deltaPp: 8, games: 50000 },
  { key: 'negative', deltaPp: -8, games: 50000 },
  { key: 'zero', deltaPp: 0, games: 2000 }
]
describe('independent pair shrinkage, synthetic inputs', () => {
  it('shrinks low-N more than high-N without reversing signs', () => {
    const r = estimateRolePairShrinkage(cells()),
      a = r.cells.find((c) => c.key === 'low')!,
      b = r.cells.find((c) => c.key === 'high')!
    expect(a.shrinkWeight).toBeLessThan(b.shrinkWeight)
    expect(a.shrunkDeltaPp).toBeGreaterThan(0)
    expect(b.shrunkDeltaPp).toBeLessThan(8)
    expect(r.cells.find((c) => c.key === 'negative')!.shrunkDeltaPp).toBeLessThan(0)
    expect(r.cells.find((c) => c.key === 'zero')!.shrunkDeltaPp).toBe(0)
  })
  it('uses the normal-normal posterior mean and dimensional variance correctly', () => {
    const r = estimateRolePairShrinkage(cells())
    for (const c of r.cells) {
      const t = r.fit.priorVariancePp2,
        v = 2500 / c.games
      expect(c.shrunkDeltaPp).toBeCloseTo((t / (t + v)) * c.rawDeltaPp, 12)
      expect(c.modelPosteriorVariancePp2).toBeCloseTo((t * v) / (t + v), 12)
    }
  })
  it('globally minimizes the declared discrete working objective and exposes boundaries', () => {
    const r = estimateRolePairShrinkage(cells())
    expect(r.fit.negativeLogLikelihood).toBe(Math.min(...r.fit.objective))
    const flat = estimateRolePairShrinkage(cells().map((c) => ({ ...c, deltaPp: 0 })))
    expect(flat.fit.atZeroBoundary).toBe(true)
    expect(flat.cells.every((c) => c.shrunkDeltaPp === 0)).toBe(true)
    expect(estimateRolePairShrinkage(cells(), [0, 0.01]).fit.atUpperGridBoundary).toBe(true)
  })
  it('preserves reciprocal effects with equal sample sizes under the shared zero prior', () => {
    const r = estimateRolePairShrinkage([
      { key: 'AB', deltaPp: 3, games: 500 },
      { key: 'BA', deltaPp: -3, games: 500 },
      { key: 'C', deltaPp: 1, games: 1000 }
    ])
    expect(r.cells[0].shrunkDeltaPp).toBe(-r.cells[1].shrunkDeltaPp)
    // Does not silently repair a supplier nonreciprocity gap.
    const q = estimateRolePairShrinkage([
      { key: 'AB', deltaPp: 3, games: 500 },
      { key: 'BA', deltaPp: -2.9, games: 500 },
      { key: 'C', deltaPp: 1, games: 1000 }
    ])
    expect(q.cells[0].shrunkDeltaPp + q.cells[1].shrunkDeltaPp).toBeGreaterThan(0)
  })
  it('is permutation invariant and leaves raw values untouched', () => {
    const a = cells(),
      before = structuredClone(a)
    expect(estimateRolePairShrinkage(a)).toEqual(estimateRolePairShrinkage([...a].reverse()))
    expect(a).toEqual(before)
  })
  it('half-weighted identical reverse reports do not double their likelihood evidence', () => {
    const a = cells(),
      b = a.flatMap((c) => [
        { ...c, key: c.key + '1', fitWeight: 0.5 },
        { ...c, key: c.key + '2', fitWeight: 0.5 }
      ])
    const x = estimateRolePairShrinkage(a),
      y = estimateRolePairShrinkage(b)
    expect(x.fit.tauPp).toBe(y.fit.tauPp)
    expect(x.fit.fitWeightSum).toBe(y.fit.fitWeightSum)
  })
  it('fails closed on missing, duplicate, zero-N and nonfinite inputs', () => {
    for (const v of [NaN, Infinity, 101])
      expect(() => estimateRolePairShrinkage(cells().map((c) => ({ ...c, deltaPp: v })))).toThrow()
    expect(() => estimateRolePairShrinkage(cells().map((c) => ({ ...c, games: 0 })))).toThrow()
    expect(() => estimateRolePairShrinkage([...cells(), cells()[0]])).toThrow()
    expect(() => estimateRolePairShrinkage(cells(), [0.1, 1])).toThrow()
    expect(() => estimateRolePairShrinkage(cells(), [0, 1, 1])).toThrow()
  })
  it('fills pairs without imputing missing cells or subtracting row noise again', () => {
    const block: ScopedInteractionBlock = {
      mode: 'matchup',
      ownRole: 'MID',
      otherRole: 'MID',
      champions: ['A', 'B', 'C'],
      targets: ['A', 'B', 'C'],
      championPickRates: [0.3, 0.3, 0.4],
      targetPickRates: [0.3, 0.3, 0.4],
      rawPp: [
        [null, 3, -2],
        [-3, null, 1],
        [2, -1, null]
      ],
      shrunkPp: Array.from({ length: 3 }, () => [null, null, null]),
      scope: {
        source: 'synthetic',
        interactionPatch: 'test',
        playRatePatch: 'test',
        region: 'synthetic',
        population: 'synthetic',
        queueId: 420
      }
    }
    const before = structuredClone(block),
      counts = [
        [0, 50, 500],
        [50, 0, 5000],
        [500, 5000, 0]
      ]
    const r = shrinkInteractionBlock(block, counts)
    expect(block).toEqual(before)
    expect(r.model.fit.fitWeightSum).toBe(3)
    expect(r.block.shrunkPp[0][0]).toBeNull()
    expect(r.block.shrunkPp[0][1]).toBe(-r.block.shrunkPp[1][0]!)
    const score = scoreBlindability('MID', [r.block], {
      shrinkAlpha: 0.8,
      pickRateFloor: 0,
      pickRateWeighted: true
    })
    expect(score.length).toBe(3)
    expect(score.every((r) => r.matchupRoles === 1)).toBe(true)
    expect(() =>
      shrinkInteractionBlock(block, [
        [0, 0, 500],
        [50, 0, 5000],
        [500, 5000, 0]
      ])
    ).toThrow()
    expect(() => shrinkInteractionBlock(block, [[0]])).toThrow()
    const impossible = structuredClone(block),
      impossibleCounts = structuredClone(counts)
    impossible.rawPp[0][0] = 0
    impossibleCounts[0][0] = 100
    expect(() => shrinkInteractionBlock(impossible, impossibleCounts)).toThrow(/duplicate-hero/)
  })
  it('reduces cell MSE in a predeclared heterogeneous-N exact-binomial synthetic control', () => {
    let seed = 20261109
    const uniform = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    const truths = [-4, -2, -1, 0, 0, 0, 1, 2, 4],
      sizes = [40, 400, 4000]
    let rawError = 0,
      shrunkError = 0,
      mixedError = 0,
      count = 0
    for (let repetition = 0; repetition < 32; repetition++) {
      const observations = Array.from({ length: 96 }, (_, i) => {
        const theta = truths[Math.floor(uniform() * truths.length)],
          games = sizes[i % 3]
        let wins = 0
        for (let j = 0; j < games; j++) if (uniform() < 0.5 + theta / 100) wins++
        return { key: String(i), games, deltaPp: 100 * (wins / games - 0.5), theta }
      })
      const result = estimateRolePairShrinkage(observations),
        byKey = new Map(result.cells.map((c) => [c.key, c]))
      expect(result.fit.atUpperGridBoundary).toBe(false)
      for (const o of observations) {
        const c = byKey.get(o.key)!
        rawError += (o.deltaPp - o.theta) ** 2
        shrunkError += (c.shrunkDeltaPp - o.theta) ** 2
        mixedError += (0.8 * c.shrunkDeltaPp + 0.2 * o.deltaPp - o.theta) ** 2
        count++
      }
    }
    expect(count).toBe(3072)
    expect(shrunkError).toBeLessThan(rawError)
    expect(mixedError).toBeLessThan(rawError)
  })
})
