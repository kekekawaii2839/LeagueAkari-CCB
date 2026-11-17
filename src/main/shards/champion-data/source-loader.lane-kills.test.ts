import type { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { Qq101HttpApiAxiosHelper } from '@shared/http-api-axios-helper/qq101'
import { type OpggChampionBuildResponse, OpggChampionPositionName } from '@shared/types/opgg'
import { describe, expect, it, vi } from 'vitest'

import type { AkariLogger } from '../logger-factory'
import { ChampionDataMainSourceLoader } from './source-loader'

const query = {
  source: 'opgg',
  mode: 'ranked',
  position: 'top',
  patch: '16.22',
  region: 'global',
  tier: 'emerald_plus'
} as const
function setup(kills: number | null, deaths: number | null) {
  const getCounterStats = vi.fn(async () => ({
    data: {
      data: [
        { champion_id: 24, lane_kill: deaths, lane_death: 99 },
        { champion_id: 266, lane_kill: kills, lane_death: 99 }
      ],
      meta: { version: '16.22' }
    }
  }))
  const loader = new ChampionDataMainSourceLoader(
    {} as AkariLogger,
    { getCounterStats } as unknown as OpggHttpApiAxiosHelper,
    {} as Qq101HttpApiAxiosHelper
  )
  return { loader, getCounterStats }
}
describe('OP.GG matchup lane kill rate', () => {
  it('uses selected champion counts, not opponent counts or game wins; caches matching scope', async () => {
    const { loader, getCounterStats } = setup(6, 4)
    expect(await loader.loadLaneKillRate(query, 266, 24)).toBe(0.6)
    expect(await loader.loadLaneKillRate(query, 266, 24)).toBe(0.6)
    expect(getCounterStats).toHaveBeenCalledTimes(1)
    await loader.loadLaneKillRate({ ...query, tier: 'diamond_plus' }, 266, 24)
    expect(getCounterStats).toHaveBeenCalledTimes(2)
  })
  it.each([
    [0, 10, 0],
    [10, 0, 1],
    [0, 0, null],
    [null, 10, null],
    [10, null, null],
    [-1, 10, null],
    [NaN, 10, null]
  ])('preserves zero and unavailable counts (%s/%s)', async (kills, deaths, expected) => {
    const { loader } = setup(kills, deaths)
    expect(await loader.loadLaneKillRate(query, 266, 24)).toBe(expected)
  })
  it('does not fetch for jungle, another source, or another game mode', async () => {
    const { loader, getCounterStats } = setup(6, 4)
    expect(await loader.loadLaneKillRate({ ...query, position: 'jungle' }, 266, 24)).toBeNull()
    expect(await loader.loadLaneKillRate({ ...query, source: 'qq101' }, 266, 24)).toBeNull()
    expect(await loader.loadLaneKillRate({ ...query, mode: 'aram' }, 266, 24)).toBeNull()
    expect(getCounterStats).not.toHaveBeenCalled()
  })
  it('rejects cross-patch data and invalid IDs; propagates cancellation', async () => {
    const { loader, getCounterStats } = setup(6, 4)
    expect(await loader.loadLaneKillRate({ ...query, patch: '16.21' }, 266, 24)).toBeNull()
    await expect(loader.loadLaneKillRate(query, 0, 24)).rejects.toThrow('Invalid matchup')
    const abort = new AbortController()
    abort.abort()
    await expect(
      loader.loadLaneKillRate(query, 266, 24, { signal: abort.signal })
    ).rejects.toThrow()
    expect(getCounterStats).toHaveBeenCalledTimes(1)
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function buildResponse(): OpggChampionBuildResponse {
  const tier = { tier: 1, rank: 3, rank_prev: 3, rank_prev_patch: null }
  return {
    data: {
      summary: {
        id: 266,
        is_rotation: false,
        is_rip: false,
        roles: [],
        average_stats: { play: 100, win: 60, ban_rate: 0.1, tier_data: tier },
        positions: [
          {
            name: OpggChampionPositionName.Top,
            roles: [],
            stats: {
              play: 100,
              win_rate: 0.6,
              pick_rate: 0.1,
              role_rate: 1,
              ban_rate: 0.1,
              kda: 3,
              tier_data: tier,
              total_place: undefined as never,
              first_place: undefined as never
            },
            counters: [
              { champion_id: 24, play: 20, win: 4 },
              { champion_id: 99, play: 10, win: 3 }
            ]
          }
        ]
      },
      counters: [
        { champion_id: 24, play: 20, win: 4 },
        { champion_id: 39, play: 20, win: 12 },
        { champion_id: 777, play: 20, win: 10 },
        { champion_id: 86, play: 20, win: 4 }
      ],
      core_items: [],
      boots: [],
      starter_items: [],
      last_items: [],
      skill_masteries: [],
      skills: [],
      skill_evolves: []
    },
    meta: { version: '16.22', cached_at: new Date('2026-11-11T10:00:00Z') }
  }
}

function detailSetup(getCounterStats: ReturnType<typeof vi.fn>) {
  const response = buildResponse()
  const getChampion = vi.fn(async () => ({ data: response }))
  const getVersions = vi.fn(async () => ({ data: { data: ['16.21'] } }))
  const warn = vi.fn()
  const loader = new ChampionDataMainSourceLoader(
    { warn } as unknown as AkariLogger,
    { getCounterStats, getChampion, getVersions } as unknown as OpggHttpApiAxiosHelper,
    {} as Qq101HttpApiAxiosHelper
  )
  return { loader, response, getChampion, getVersions, warn }
}
describe('OP.GG detail critical path', () => {
  it('returns the full win-rate snapshot without starting optional per-opponent lane requests', async () => {
    const getCounterStats = vi.fn(() => new Promise(() => {}))
    const { loader, response } = detailSetup(getCounterStats)
    const result = await loader.loadDetails('opgg', query, 266)
    expect(getCounterStats).not.toHaveBeenCalled()
    expect(result?.summary.counterChampionIds).toEqual([24, 99])
    expect(result?.sections.matchups?.map((item) => item.championId)).toEqual([24, 39, 777, 86, 99])
    expect(result?.sections.matchups?.[4].performance).toMatchObject({
      games: 10,
      wins: 3,
      winRate: 0.3
    })
    expect(result?.sections.matchups?.every((item) => item.laneKillRate === undefined)).toBe(true)
    expect(response.data.counters).toHaveLength(4)
  })
  it('keeps the returned build patch authoritative for later optional requests', async () => {
    const getCounterStats = vi.fn()
    const { loader, getChampion } = detailSetup(getCounterStats)
    const signal = new AbortController().signal
    const result = await loader.loadDetails(
      'opgg',
      { ...query, source: undefined, patch: '16.21', region: 'kr', tier: 'diamond_plus' },
      266,
      { signal }
    )
    expect(getChampion).toHaveBeenCalledWith('kr', 'ranked', 266, 'top', {
      tier: 'diamond_plus',
      version: '16.21',
      targetChampionId: undefined,
      signal
    })
    expect(result?.metadata.patch).toBe('16.22')
    expect(getCounterStats).not.toHaveBeenCalled()
  })
  it('still rejects a canceled base detail and never starts supplementary requests', async () => {
    const getCounterStats = vi.fn()
    const { loader, getChampion } = detailSetup(getCounterStats)
    const pending = deferred<{ data: OpggChampionBuildResponse }>()
    getChampion.mockReturnValueOnce(pending.promise)
    const abort = new AbortController()
    const result = loader.loadDetails('opgg', query, 266, { signal: abort.signal })
    const rejected = expect(result).rejects.toThrow('synthetic cancel')
    abort.abort(new Error('synthetic cancel'))
    pending.resolve({ data: buildResponse() })
    await rejected
    expect(getCounterStats).not.toHaveBeenCalled()
  })
})
