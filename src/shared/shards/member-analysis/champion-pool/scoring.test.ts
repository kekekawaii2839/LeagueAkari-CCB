import { describe, expect, it } from 'vitest'

import {
  DRAFT_ROLES,
  type InteractionBlock,
  scoreBlindability,
  scoreScopedBlindability
} from './scoring'

const settings = { shrinkAlpha: 0, pickRateFloor: 0, pickRateWeighted: false }
const block = (overrides: Partial<InteractionBlock> = {}): InteractionBlock => ({
  mode: 'matchup',
  ownRole: 'SUP',
  otherRole: 'MID',
  champions: ['Synthetic A', 'Synthetic B', 'Synthetic C'],
  championPickRates: [0.4, 0.3, 0.3],
  targets: ['Target A', 'Target B', 'Target C'],
  targetPickRates: [0.5, 0.3, 0.2],
  rawPp: [
    [-1, 0, 1],
    [-2, 0, 2],
    [-4, 0, 4]
  ],
  shrunkPp: [
    [-1, 0, 1],
    [-3, 0, 3],
    [-9, 0, 9]
  ],
  ...overrides
})

describe('current blindability scoring, independently implemented', () => {
  it('retains separate interaction/play-rate periods and rejects mixed data scopes', () => {
    const scope = {
      source: 'synthetic',
      interactionPatch: '16.1-16.4',
      playRatePatch: '16.16',
      region: 'synthetic',
      queueId: 420,
      population: 'synthetic'
    }
    const a = { ...block(), scope }
    const b = { ...block({ mode: 'synergy', otherRole: 'TOP' }), scope: { ...scope } }
    const result = scoreScopedBlindability('SUP', [a, b], settings)
    expect(result.scope).toEqual(scope)
    expect(Object.isFrozen(result.scope)).toBe(true)
    for (const mutation of [
      { source: 'other' },
      { interactionPatch: '16.21' },
      { playRatePatch: '16.21' },
      { region: 'other' },
      { queueId: 440 },
      { population: 'unknown' }
    ]) {
      expect(() =>
        scoreScopedBlindability('SUP', [a, { ...b, scope: { ...scope, ...mutation } }], settings)
      ).toThrow('Cannot mix dataset sources or sampling scopes')
    }
    expect(() => scoreScopedBlindability('SUP', [], settings)).toThrow()
    expect(() =>
      scoreScopedBlindability('SUP', [{ ...a, scope: { ...scope, source: '' } }], settings)
    ).toThrow()
  })
  it('filters displayed own champions after standardization, retaining pool exceptions', () => {
    const b = block({ championPickRates: [0.8, 0.15, 0.05] })
    const complete = scoreBlindability('SUP', [b], settings)
    const filtered = scoreBlindability('SUP', [b], { ...settings, pickRateFloor: 0.1 })
    expect(filtered.map((r) => r.champion)).toEqual(['Synthetic A', 'Synthetic B'])
    expect(filtered[0].aggregate).toBe(complete[0].aggregate)
    expect(
      scoreBlindability('SUP', [b], { ...settings, pickRateFloor: 0.1 }, ['Synthetic C'])
    ).toHaveLength(3)
  })
  it('uses reverse sample-SD z within a role block', () => {
    const rows = scoreBlindability('SUP', [block()], settings)
    expect(rows.map((r) => r.champion)).toEqual(['Synthetic A', 'Synthetic B', 'Synthetic C'])
    const center = 7 / 3
    const sd = Math.sqrt(7 / 3)
    expect(rows[0].aggregate).toBeCloseTo((center - 1) / sd)
    expect(rows[2].aggregate).toBeCloseTo((center - 4) / sd)
    expect(rows[0].blocks[0].sdPp).toBe(1)
  })
  it('omits wholly unscorable rows even when included in a pool', () => {
    const unavailable = block({ rawPp: Array.from({ length: 3 }, () => [null, null, null]) })
    expect(scoreBlindability('SUP', [unavailable], settings)).toEqual([])
    expect(scoreBlindability('SUP', [unavailable], settings, ['Synthetic A'])).toEqual([])
  })
  it('keeps a scored single-axis row without inventing a missing second axis', () => {
    const rows = scoreBlindability('SUP', [block({ mode: 'synergy', otherRole: 'TOP' })], settings)
    expect(rows).toHaveLength(3)
    expect(rows[0].matchupMean).toBeNull()
    expect(rows[0].synergyMean).not.toBeNull()
    expect(rows[0].aggregate).toBe(rows[0].synergyMean)
  })
  it('mixes matrices BEFORE measuring spread', () => {
    const rows = scoreBlindability(
      'SUP',
      [
        block({
          rawPp: [
            [-1, 0, 1],
            [-2, 0, 2],
            [-4, 0, 4]
          ],
          shrunkPp: [
            [1, 0, -1],
            [-3, 0, 3],
            [-9, 0, 9]
          ]
        })
      ],
      { ...settings, shrinkAlpha: 0.5 }
    )
    expect(rows.find((r) => r.champion === 'Synthetic A')!.blocks[0].sdPp).toBe(0)
  })
  it('does not require the unused matrix at an alpha endpoint', () => {
    const unknown = Array.from({ length: 3 }, () => [null, null, null])
    expect(
      scoreBlindability('SUP', [block({ shrunkPp: unknown })], settings)[0].aggregate
    ).not.toBeNull()
    expect(
      scoreBlindability('SUP', [block({ shrunkPp: unknown })], { ...settings, shrinkAlpha: 0.8 })
    ).toEqual([])
  })
  it('uses reliability-weighted sample variance, not population variance', () => {
    const row = scoreBlindability('SUP', [block()], { ...settings, pickRateWeighted: true })[0]
    const weights = [0.5, 0.3, 0.2],
      values = [-1, 0, 1]
    const mu = -0.3
    const variance =
      values.reduce((sum, v, i) => sum + weights[i] * (v - mu) ** 2, 0) /
      (1 - weights.reduce((sum, w) => sum + w * w, 0))
    expect(row.blocks[0].sdPp).toBeCloseTo(Math.sqrt(variance))
  })
  it('requires three eligible columns, while a row can have two finite cells', () => {
    const missing = block({
      rawPp: [
        [null, 0, 1],
        [null, null, 2],
        [-4, 0, 4]
      ]
    })
    const rows = scoreBlindability('SUP', [missing], settings)
    expect(rows.find((r) => r.champion === 'Synthetic A')!.aggregate).not.toBeNull()
    expect(rows.find((r) => r.champion === 'Synthetic B')).toBeUndefined()
    expect(scoreBlindability('SUP', [block()], { ...settings, pickRateFloor: 0.3 })).toEqual([])
  })
  it('falls back to equal weights when every eligible pick rate is zero', () => {
    expect(
      scoreBlindability('SUP', [block({ targetPickRates: [0, 0, 0] })], {
        ...settings,
        pickRateWeighted: true
      })
    ).toEqual(scoreBlindability('SUP', [block({ targetPickRates: [0, 0, 0] })], settings))
  })
  it('keeps equal spreads neutral instead of fabricating a ranking', () => {
    const rows = scoreBlindability(
      'SUP',
      [
        block({
          rawPp: [
            [-1, 0, 1],
            [-1, 0, 1],
            [-1, 0, 1]
          ]
        })
      ],
      settings
    )
    expect(rows.every((r) => r.aggregate === 0)).toBe(true)
  })
  it('averages nine position scores, not the two axis scores equally', () => {
    const blocks = DRAFT_ROLES.map((otherRole) => block({ otherRole }))
    blocks.push(
      ...DRAFT_ROLES.filter((r) => r !== 'SUP').map((otherRole) =>
        block({
          mode: 'synergy',
          otherRole,
          rawPp: [
            [0, 0, 0],
            [-3, 0, 3],
            [-4, 0, 4]
          ]
        })
      )
    )
    const row = scoreBlindability('SUP', blocks, settings)[0]
    expect(row.matchupRoles).toBe(5)
    expect(row.synergyRoles).toBe(4)
    expect(row.aggregate).toBeCloseTo((5 * row.matchupMean! + 4 * row.synergyMean!) / 9)
    expect(row.aggregate).not.toBeCloseTo((row.matchupMean! + row.synergyMean!) / 2, 5)
  })
  it('averages only available blocks and treats ADC plus SUP as the lane', () => {
    const row = scoreBlindability('SUP', [block({ otherRole: 'ADC' }), block()], settings)[0]
    expect(row.matchupRoles).toBe(2)
    expect(row.laneMatchup).not.toBeNull()
    expect(row.outOfLaneMatchup).not.toBeNull()
    expect(row.synergyMean).toBeNull()
    expect(row.aggregate).toBe(row.matchupMean)
  })
  it('rejects duplicate blocks, invalid shapes, invalid rates and wrong roles', () => {
    expect(() => scoreBlindability('SUP', [block(), block()], settings)).toThrow()
    expect(() => scoreBlindability('SUP', [block({ rawPp: [] })], settings)).toThrow()
    expect(() =>
      scoreBlindability('SUP', [block({ targetPickRates: [-1, 0, 1] })], settings)
    ).toThrow()
    expect(() => scoreBlindability('SUP', [block({ ownRole: 'TOP' })], settings)).toThrow()
    expect(() => scoreBlindability('SUP', [block()], { ...settings, shrinkAlpha: 2 })).toThrow()
  })
})
