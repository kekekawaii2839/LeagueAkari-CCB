import { describe, expect, it } from 'vitest'

import {
  type OpggChampionBuildResponse,
  type OpggChampionPosition,
  OpggChampionPositionName,
  type OpggChampionPositionStats,
  type OpggChampionsResponse
} from '../../../types/opgg'
import { adaptOpggLaneStatistics } from './opgg-lane'
import { scoreScopedBlindability } from './scoring'

const options = {
  role: 'SUP' as const,
  region: 'synthetic-region',
  tier: 'synthetic-tier',
  expectedPatch: '16.21'
}
const cachedAt = new Date('2026-01-01T00:00:00Z')
const ids = [900001, 900002, 900003]

function position(
  play: number,
  rate: number,
  name = OpggChampionPositionName.Support
): OpggChampionPosition {
  return {
    name,
    // The legacy provider type declares impossible never fields not present in real responses.
    stats: {
      play,
      win_rate: rate,
      pick_rate: 0.99,
      role_rate: 1,
      ban_rate: 0,
      kda: 1,
      tier_data: { tier: 1, rank: 1, rank_prev: 1, rank_prev_patch: null }
    } as OpggChampionPositionStats,
    roles: [],
    counters: []
  }
}

function roster(): OpggChampionsResponse {
  return {
    meta: { version: '16.21', cached_at: cachedAt, match_count: 999999999 },
    data: ids.map((id, i) => ({
      id,
      is_rotation: false,
      is_rip: false,
      average_stats: null,
      positions: [position([100, 200, 300][i], [0.6, 0.4, 0.5][i])],
      roles: []
    }))
  }
}

function detail(id: number, counters: [number, number, number][] = []): OpggChampionBuildResponse {
  const hero = roster().data.find((h) => h.id === id)
  return {
    meta: { version: '16.21', cached_at: cachedAt },
    data: {
      summary: {
        id,
        is_rotation: false,
        is_rip: false,
        average_stats: null,
        positions: hero?.positions ?? [position(100, 0.5)],
        roles: []
      },
      core_items: [],
      boots: [],
      starter_items: [],
      last_items: [],
      skill_masteries: [],
      skills: [],
      skill_evolves: [],
      counters: counters.map(([champion_id, play, win]) => ({ champion_id, play, win }))
    }
  }
}

describe('OP.GG same-position raw interaction adapter (synthetic provider payloads)', () => {
  it('uses exact counter wins in the selected hero direction and preserves rounded single rates', () => {
    const input = roster()
    input.data[0].positions![0].stats.win_rate = 0.600001
    const result = adaptOpggLaneStatistics(
      input,
      [
        detail(ids[0], [
          [ids[1], 100, 50],
          [ids[2], 10, 0]
        ])
      ],
      options
    )
    const odds = 0.600001 / 0.399999 / (0.4 / 0.6)
    expect(result.block.rawPp[0][1]).toBeCloseTo(100 * (0.5 - odds / (1 + odds)))
    expect(result.block.rawPp[0][2]).toBeCloseTo(-60.0001)
    expect(result.baselines[0].reportedWinRate).toBe(0.600001)
    expect(result.baselines[0]).not.toHaveProperty('wins')
    expect(result.coverage.baselineWinRates).toContain('no-integer-wins-inferred')
  })

  it('normalizes PR using listed same-role play, never provider pick_rate or meta.match_count', () => {
    const result = adaptOpggLaneStatistics(roster(), [], options)
    expect(result.block.championPickRates).toEqual([1 / 6, 1 / 3, 1 / 2])
    expect(result.block.targetPickRates).toEqual([1 / 6, 1 / 3, 1 / 2])
    expect(result.coverage.listedRolePlay).toBe(600)
    expect(result.coverage.population).toBe('supplier-listed-champion-role-rows-only')
    expect(result.block.scope).toEqual({
      source: 'opgg-champion-api-ranked-lane-summary',
      interactionPatch: '16.21',
      playRatePatch: '16.21',
      region: 'synthetic-region',
      queueId: 420,
      population: 'synthetic-tier'
    })
    expect(result.coverage.scopeEvidence).toContain('declared-by-caller')
  })

  it('leaves missing details, missing reverse pairs, zero games and self mirrors unavailable', () => {
    const result = adaptOpggLaneStatistics(
      roster(),
      [
        detail(ids[0], [
          [ids[0], 2, 1],
          [ids[1], 100, 50],
          [ids[2], 0, 0]
        ])
      ],
      options
    )
    expect(result.block.rawPp[0][0]).toBeNull()
    expect(result.block.rawPp[1][0]).toBeNull()
    expect(result.block.rawPp[0][2]).toBeNull()
    expect(result.coverage.missingDetailChampionIds).toEqual([ids[1], ids[2]])
    expect(result.coverage.possibleDirectedNonMirrorPairs).toBe(6)
    expect(result.coverage.reportedDirectedNonMirrorPairs).toBe(2)
    expect(result.coverage.usableDeltaPairs).toBe(1)
    expect(result.coverage.unavailableDeltaPairs).toBe(5)
    expect(result.coverage.zeroSamplePairs).toBe(1)
    expect(result.coverage.mirrorEntriesExcluded).toBe(1)
  })

  it('records targets outside the listed role population instead of silently merging them', () => {
    const result = adaptOpggLaneStatistics(roster(), [detail(ids[0], [[999999, 10, 4]])], options)
    expect(result.coverage.omittedTargetPairs).toEqual([
      { championId: ids[0], targetChampionId: 999999 }
    ])
    expect(result.coverage.reportedDirectedNonMirrorPairs).toBe(0)
    expect(result.block.targets).toEqual(ids.map(String))
  })

  it('does not invent shrinkage or present a single position as nine complete blocks', () => {
    const details = ids.map((id, i) =>
      detail(
        id,
        ids
          .filter((other) => other !== id)
          .map((other, j) => [other, 20, 5 + i + j] as [number, number, number])
      )
    )
    const result = adaptOpggLaneStatistics(roster(), details, options)
    expect(result.coverage.usableDeltaPairs).toBe(6)
    expect(result.coverage.singleRoleOnly).toBe(true)
    expect(result.coverage.shrinkageAvailable).toBe(false)
    expect(result.block.shrunkPp.every((row) => row.every((v) => v === null))).toBe(true)
    const raw = scoreScopedBlindability('SUP', [result.block], {
      shrinkAlpha: 0,
      pickRateFloor: 0,
      pickRateWeighted: true
    })
    expect(raw.rows.every((row) => row.matchupRoles === 1 && row.synergyRoles === 0)).toBe(true)
    expect(raw.rows.every((row) => row.aggregate !== null)).toBe(true)
    const shrunk = scoreScopedBlindability('SUP', [result.block], {
      shrinkAlpha: 0.8,
      pickRateFloor: 0,
      pickRateWeighted: true
    })
    expect(shrunk.rows.every((row) => row.aggregate === null)).toBe(true)
  })

  it('preserves unknown odds baselines and an empty population instead of adding priors', () => {
    const input = roster()
    input.data[0].positions![0].stats.win_rate = 1
    const result = adaptOpggLaneStatistics(input, [detail(ids[0], [[ids[1], 10, 8]])], options)
    expect(result.block.rawPp[0][1]).toBeNull()
    expect(result.coverage.positiveSamplePairs).toBe(1)
    expect(result.coverage.usableDeltaPairs).toBe(0)
    input.data = []
    const empty = adaptOpggLaneStatistics(input, [], options)
    expect(empty.coverage.listedRolePlay).toBe(0)
    expect(empty.block.championPickRates).toEqual([])
    expect(empty.block.rawPp).toEqual([])
  })

  it('checks all response patches and requires explicit caller scope', () => {
    const wrongRoster = roster()
    wrongRoster.meta.version = '16.22'
    const wrongDetail = detail(ids[0])
    wrongDetail.meta.version = '16.22'
    expect(() => adaptOpggLaneStatistics(wrongRoster, [], options)).toThrow(/patch/)
    expect(() => adaptOpggLaneStatistics(roster(), [wrongDetail], options)).toThrow(/patch/)
    expect(() => adaptOpggLaneStatistics(roster(), [], { ...options, region: '' })).toThrow(
      /Explicit/
    )
    expect(() => adaptOpggLaneStatistics(roster(), [], { ...options, tier: '' })).toThrow(
      /Explicit/
    )
    expect(() =>
      adaptOpggLaneStatistics(roster(), [], { ...options, expectedPatch: '16.21.1' })
    ).toThrow(/Explicit/)
  })

  it('rejects duplicate details, counter slots and roster rows', () => {
    expect(() =>
      adaptOpggLaneStatistics(roster(), [detail(ids[0]), detail(ids[0])], options)
    ).toThrow(/duplicate/)
    expect(() =>
      adaptOpggLaneStatistics(
        roster(),
        [
          detail(ids[0], [
            [ids[1], 10, 5],
            [ids[1], 20, 10]
          ])
        ],
        options
      )
    ).toThrow(/duplicate/)
    const duplicate = roster()
    duplicate.data.push(duplicate.data[0])
    expect(() => adaptOpggLaneStatistics(duplicate, [], options)).toThrow(/duplicate/)
  })

  it('rejects illegal counts, ratios, outside-population details and wrong positions', () => {
    for (const [play, win] of [
      [-1, 0],
      [3, 4],
      [3, -1],
      [3.5, 1],
      [3, 1.5],
      [Number.NaN, 0]
    ]) {
      expect(() =>
        adaptOpggLaneStatistics(roster(), [detail(ids[0], [[ids[1], play, win]])], options)
      ).toThrow(/counts/)
    }
    const badRate = roster()
    badRate.data[0].positions![0].stats.win_rate = 1.01
    expect(() => adaptOpggLaneStatistics(badRate, [], options)).toThrow(/statistics/)
    expect(() => adaptOpggLaneStatistics(roster(), [detail(999999)], options)).toThrow(/outside/)
    const wrong = detail(ids[0])
    wrong.data.summary.positions![0].name = OpggChampionPositionName.Mid
    expect(() => adaptOpggLaneStatistics(roster(), [wrong], options)).toThrow(/position/)
  })
})
