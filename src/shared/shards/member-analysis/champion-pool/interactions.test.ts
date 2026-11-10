import { describe, expect, it } from 'vitest'

import { type ChampionPoolMatch, InteractionAccumulator } from './interactions'
import { DRAFT_ROLES, scoreBlindability, scoreScopedBlindability } from './scoring'

const scope = { patch: '16.21', region: 'synthetic', queueId: 420, population: 'synthetic' }
function match(id: string, winner: 100 | 200, rotation = 0): ChampionPoolMatch {
  return {
    ...scope,
    matchId: id,
    participants: ([100, 200] as const).flatMap((team) =>
      DRAFT_ROLES.map((role, i) => ({
        team,
        role,
        champion: `Synthetic ${role} ${(team / 100 + rotation + i) % 6}`,
        win: team === winner
      }))
    )
  }
}

describe('raw match to interaction statistics', () => {
  it('snapshots and freezes sampling scope instead of retaining caller mutations', () => {
    const mutableScope = { ...scope }
    const acc = new InteractionAccumulator(mutableScope)
    acc.add(match('synthetic-1', 100))
    mutableScope.patch = '16.22'
    expect(acc.add({ ...match('synthetic-2', 100), patch: '16.22' })).toBe('outside-scope')
    expect(acc.scope.patch).toBe('16.21')
    expect(Object.isFrozen(acc.scope)).toBe(true)
    expect(acc.matchCount).toBe(1)
  })
  it('rejects absent win flags before they can poison counts with NaN', () => {
    const acc = new InteractionAccumulator(scope),
      bad = match('synthetic-1', 100)
    bad.participants
      .filter((p) => p.team === 100)
      .forEach((p) => {
        p.win = undefined as unknown as boolean
      })
    expect(() => acc.add(bad)).toThrow('Invalid complete ranked match')
    expect(acc.matchCount).toBe(0)
    expect(acc.estimates()).toEqual([])
  })
  it('counts both directed matchup perspectives and same-team pairs exactly once', () => {
    const acc = new InteractionAccumulator(scope)
    expect(acc.add(match('synthetic-1', 100))).toBe('added')
    const pairs = acc.estimates()
    expect(pairs.filter((p) => p.mode === 'matchup')).toHaveLength(50)
    expect(pairs.filter((p) => p.mode === 'synergy')).toHaveLength(40)
    expect(pairs.every((p) => p.games === 1)).toBe(true)
    expect(pairs.reduce((sum, p) => sum + p.wins, 0)).toBe(45)
    expect(pairs.every((p) => p.deltaPp === null)).toBe(true)
  })
  it('deduplicates and never mixes versions, regions, queues or populations', () => {
    const acc = new InteractionAccumulator(scope)
    acc.add(match('synthetic-1', 100))
    expect(acc.add(match('synthetic-1', 100))).toBe('duplicate')
    for (const change of [
      { patch: '16.22' },
      { region: 'another' },
      { queueId: 440 },
      { population: 'unknown' }
    ])
      expect(acc.add({ ...match('synthetic-2', 100), ...change })).toBe('outside-scope')
    expect(acc.matchCount).toBe(1)
  })
  it('computes baselines from the accumulated single-champion win rates', () => {
    const acc = new InteractionAccumulator(scope)
    acc.add(match('synthetic-1', 100))
    acc.add(match('synthetic-2', 200))
    expect(
      acc
        .estimates()
        .every((p) => p.observedWinRate === 0.5 && p.expectedWinRate === 0.5 && p.deltaPp === 0)
    ).toBe(true)
  })
  it('rejects incomplete matches before changing any statistics', () => {
    const acc = new InteractionAccumulator(scope),
      bad = match('synthetic-1', 100)
    bad.participants.pop()
    expect(() => acc.add(bad)).toThrow()
    expect(acc.matchCount).toBe(0)
    expect(acc.add(match('synthetic-1', 100))).toBe('added')
  })
  it('can run the raw-only chain, but never invents a shrunk matrix', () => {
    const acc = new InteractionAccumulator(scope)
    for (let i = 0; i < 6; i++) {
      acc.add(match(`synthetic-${2 * i}`, 100, i))
      acc.add(match(`synthetic-${2 * i + 1}`, 200, i))
    }
    const blocks = acc.rawBlocks('SUP')
    expect(blocks).toHaveLength(9)
    expect(
      blocks.every((b) => Math.abs(b.targetPickRates.reduce((s, p) => s + p, 0) - 1) < 1e-12)
    ).toBe(true)
    expect(blocks.every((b) => b.shrunkPp.every((r) => r.every((v) => v === null)))).toBe(true)
    const raw = scoreBlindability('SUP', blocks, {
      shrinkAlpha: 0,
      pickRateFloor: 0,
      pickRateWeighted: true
    })
    expect(raw.length).toBe(6)
    expect(raw.every((r) => r.aggregate === 0)).toBe(true)
    const scoped = scoreScopedBlindability('SUP', acc.scopedRawBlocks('SUP', 'synthetic'), {
      shrinkAlpha: 0,
      pickRateFloor: 0,
      pickRateWeighted: true
    })
    expect(scoped.scope).toEqual({
      source: 'synthetic',
      interactionPatch: '16.21',
      playRatePatch: '16.21',
      region: 'synthetic',
      queueId: 420,
      population: 'synthetic'
    })
    expect(scoped.rows).toEqual(raw)
    expect(
      scoreBlindability('SUP', blocks, {
        shrinkAlpha: 0.8,
        pickRateFloor: 0,
        pickRateWeighted: true
      }).every((r) => r.aggregate === null)
    ).toBe(true)
  })
})
