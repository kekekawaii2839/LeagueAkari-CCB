import type { MemberAnalysisGame, MemberAnalysisOverview } from '@shared/shards/member-analysis'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test } from 'vitest'
import { isProxy } from 'vue'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import { aggregateChampions, aggregateRoles, selectMemberAnalysisSample } from './analytics'
import { useMemberAnalysisData } from './useMemberAnalysisData'

function published(): MemberAnalysisOverview {
  const games = Array.from({ length: 60 }, (_, i) => ({
    gameId: i + 1,
    timestamp: i + 1,
    date: '2026-01-01',
    patch: '26.1',
    duration: 1800,
    win: i % 2 === 0,
    side: i % 2 === 0 ? 'Blue' : 'Red',
    roster: 'Synthetic',
    players: [
      {
        player: 'Synthetic#TEST_ONLY',
        role: 'MIDDLE',
        champion: 'Ahri',
        minutes: 30,
        kills: i === 0 ? null : 0,
        deaths: 0,
        assists: 0,
        damage: 0,
        gold: 0,
        teamKills: 0,
        teamDeaths: 0,
        damageShare: i % 2 === 0 ? 0 : null,
        goldShare: 0,
        kp: i % 3 === 0 ? null : 0,
        gd15: i % 3 === 0 ? null : 0
      }
    ]
  })) as MemberAnalysisGame[]
  return {
    contractVersion: 1,
    dataVersion: 5,
    generatedAt: 'Synthetic',
    firstRun: false,
    source: 'Synthetic',
    gameCount: games.length,
    playerCount: 1,
    collectionAudit: null,
    games,
    pagination: { nextCursor: null }
  }
}
describe('shared published analysis data', () => {
  beforeEach(() => setActivePinia(createPinia()))
  test('shares computed scope/results across consumers and skips semantic no-op queries and unrelated job state', () => {
    const store = useMemberAnalysisStore()
    store.overview = published()
    const first = useMemberAnalysisData(),
      second = useMemberAnalysisData()
    expect(first).toBe(second)
    const selection = first.selection.value,
      roles = first.roles.value,
      champions = first.champions.value
    store.filters.query = 'Synthetic'
    expect(first.selection.value).toBe(selection)
    expect(first.roles.value).toBe(roles)
    expect(first.champions.value).toBe(champions)
    store.loading = true
    store.job = { status: 'collecting' } as any
    expect(first.roles.value).toBe(roles)
    expect(first.champions.value).toBe(champions)
    expect(isProxy(first.games.value[0])).toBe(false)
  })
  test('new publication and identity-settings invalidation recompute; zero/null support and values equal canonical pure aggregation', () => {
    const store = useMemberAnalysisStore()
    const current = published()
    store.overview = current
    const data = useMemberAnalysisData()
    const previous = data.roles.value
    const expected = selectMemberAnalysisSample(
      current.games,
      store.filters,
      store.analysisSide,
      store.sampleSize
    ).sample
    expect(data.roles.value).toEqual(aggregateRoles(expected))
    expect(data.champions.value).toEqual(aggregateChampions(expected))
    store.overview = { ...published(), generatedAt: 'Updated' }
    expect(data.roles.value).not.toBe(previous)
    expect(data.roles.value).toEqual(previous)
    store.overview = null
    expect(data.games.value).toEqual([])
    expect(data.roles.value).toEqual([])
    store.overview = published()
    expect(data.roles.value).toEqual(previous)
  })
  test('changed filters, side, sample and grouped role conditions update the supported population', () => {
    const store = useMemberAnalysisStore()
    store.overview = published()
    const data = useMemberAnalysisData()
    expect(data.games.value).toHaveLength(50)
    store.sampleSize = 'all'
    expect(data.games.value).toHaveLength(60)
    store.analysisSide = 'Blue'
    expect(data.games.value).toHaveLength(30)
    store.filters.outcome = 'loss'
    expect(data.games.value).toHaveLength(0)
    store.analysisSide = 'Red'
    expect(data.games.value).toHaveLength(30)
    store.filters.matchRole = 'TOP'
    expect(data.games.value).toHaveLength(0)
    store.filters.matchRole = 'MIDDLE'
    expect(data.roles.value[0].games).toBe(30)
    store.filters.query = 'Not in the sample'
    expect(data.champions.value).toEqual([])
  })
})
