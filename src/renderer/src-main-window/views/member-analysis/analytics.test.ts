import type {
  MemberAnalysisFilters,
  MemberAnalysisGame,
  MemberAnalysisPlayerGame
} from '@shared/shards/member-analysis'
import { performance } from 'node:perf_hooks'
import { describe, expect, test } from 'vitest'

import {
  aggregateChampions,
  aggregateConversion,
  aggregateEarlyBuckets,
  aggregateJungle,
  aggregatePairs,
  aggregateRoles,
  aggregateSynergy,
  buildGameSearchIndex,
  earlyGoldDiff,
  filterMemberAnalysisGames,
  laneGankDeathEvidence,
  selectMemberAnalysisSample
} from './analytics'

const player = (
  name: string,
  role: MemberAnalysisPlayerGame['role'],
  champion: string
): MemberAnalysisPlayerGame => ({
  player: name,
  role,
  champion,
  minutes: 30,
  kills: 4,
  deaths: 2,
  assists: 6,
  teamKills: 20,
  teamDeaths: 10,
  damage: 18000,
  damageShare: 0.2,
  gold: 12000,
  goldShare: 0.2,
  cs: 210,
  vision: 25,
  wardsPlaced: 8,
  wardsKilled: 3,
  controlWards: 2,
  damageTaken: 15000,
  takenShare: 0.2,
  damageMitigated: 8000,
  objectiveDamage: 3000,
  turretDamage: 2000,
  healTeammates: 0,
  shieldTeammates: 0,
  ccSeconds: 20,
  soloKills: 1,
  fbPart: true,
  ftPart: false,
  kp: 0.5,
  gd10: 100,
  gd15: 200,
  csd15: 5,
  xpd15: 100,
  damageDiff15: 500,
  soloDiff15: 1,
  counter: 0.05
})

const eventDecision: MemberAnalysisGame['eventDecision'] = {
  killEpisodes: 4,
  convertedKillEpisodes: 2,
  killToEpicEpisodes: 1,
  killToTowerEpisodes: 1,
  conversionDelayTotalSec: 60,
  conversionDelaySamples: 2,
  deathEpisodes: 2,
  highCostDeathEpisodes: 1,
  deathCostEpics: 1,
  deathCostTowers: 0,
  deathCostPlates: 0,
  deathCostPoints: 2,
  shutdownBountyLost: 0,
  objectivesTaken: 4,
  cleanObjectives: 2,
  wonFightObjectives: 1,
  evenFightObjectives: 0,
  lostFightObjectives: 0,
  objectiveFightSamples: 1,
  objectiveFightWins: 1,
  enemyObjectives: 2,
  tradedEnemyObjectives: 1,
  tradeDelayTotalSec: 40,
  tradeDelaySamples: 1
}

const game = (gameId: number, win: boolean, side: 'Blue' | 'Red'): MemberAnalysisGame => ({
  gameId,
  timestamp: 1_700_000_000_000 + gameId,
  date: '2026-01-01',
  patch: '26.1',
  side,
  win,
  duration: 1800,
  roster: 'Alice Bob Carol Dave Eve',
  dragon15Diff: 1,
  grub15Diff: 2,
  objectiveFight15Diff: 1,
  counterMean: 0.1,
  upperGold15: 500,
  botGold15: 300,
  gold20Diff: win ? 1500 : -500,
  tower20Diff: win ? 1 : -1,
  jungle: null,
  laneGankDeaths: null,
  eventDecision,
  players: [
    player('Alice', 'TOP', gameId === 1 ? 'Gwen' : 'Ornn'),
    player('Bob', 'JUNGLE', 'LeeSin'),
    player('Carol', 'MIDDLE', 'Ahri'),
    player('Dave', 'BOTTOM', 'Jinx'),
    player('Eve', 'UTILITY', 'Nautilus')
  ]
})

const games = [game(1, true, 'Blue'), game(2, false, 'Red')]

describe('member analysis Phase 4 anonymous golden metrics', () => {
  test('selects the latest sample by timestamp, not region-specific match identifiers', () => {
    const input = Array.from({ length: 25 }, (_, index) => ({
      ...game(1000 - index, true, 'Blue'),
      timestamp: index
    }))
    const filters: MemberAnalysisFilters = {
      outcome: 'all',
      patch: 'all',
      dateFrom: '',
      dateTo: '',
      durationMin: null,
      durationMax: null,
      participant: 'all',
      matchRole: 'all',
      champion: 'all',
      query: ''
    }
    const sample = selectMemberAnalysisSample(input, filters, 'all', 20).sample
    expect(sample.map((row) => row.timestamp)).toEqual(
      Array.from({ length: 20 }, (_, index) => 24 - index)
    )
    expect(input[0].timestamp).toBe(0)
  })
  test('keeps role and champion metrics aligned with the dashboard definitions', () => {
    const top = aggregateRoles(games).find((row) => row.player === 'Alice')!
    expect(top).toMatchObject({
      games: 2,
      wins: 1,
      winRate: 0.5,
      kda: 5,
      dpm: 600,
      gpm: 400,
      cspm: 7,
      gd15: 200,
      killsPG: 4,
      deathsPG: 2,
      damageShare: 0.2,
      damageConversion: 1,
      vspm: 25 / 30,
      objectiveDamagePM: 100,
      soloKillsPG: 1,
      fbRate: 1,
      dragon15: 1
    })
    expect(aggregateChampions(games).filter((row) => row.player === 'Alice')).toEqual([
      expect.objectContaining({ champion: 'Gwen', games: 1, winRate: 1, pickRate: 0.5 }),
      expect.objectContaining({ champion: 'Ornn', games: 1, winRate: 0, pickRate: 0.5 })
    ])
  })

  test('keeps pair, conversion and synergy semantics stable', () => {
    expect(aggregatePairs(games)).toHaveLength(9)
    expect(aggregatePairs(games)[0]).toMatchObject({
      sideLabel: '总计',
      games: 2,
      wins: 1,
      winRate: 0.5,
      gold20Diff: 500
    })
    expect(aggregateConversion(games)[0]).toMatchObject({
      killConversionRate: 0.5,
      highCostDeathRate: 0.5,
      cleanObjectiveRate: 0.5,
      crossMapTradeRate: 0.5,
      conversionDelaySec: 30
    })
    expect(aggregateConversion(games)[0]).toMatchObject({
      killToEpicRate: 0.25,
      killToTowerRate: 0.25,
      deathCostPointsPG: 2,
      objectiveFightSamples: 2,
      objectiveFightWins: 2,
      objectiveFightWinRate: 1,
      tradeDelaySec: 40
    })
    const earlyTrade = games.map((value) => ({
      ...value,
      eventDecision: { ...value.eventDecision, tradeDelayTotalSec: -30, tradeDelaySamples: 1 }
    }))
    expect(aggregateConversion(earlyTrade)[0].tradeDelaySec).toBe(-30)
    expect(aggregateSynergy(games)[0]).toMatchObject({
      games: 2,
      winRate: 0.5,
      baseline: 0.5,
      observedDifference: 0,
      shrinkageWeight: 0.2,
      adjustedDifference: 0
    })
  })

  test('keeps jungle and early-conversion definitions aligned with the dashboard', () => {
    const jungle = {
      player: 'Bob',
      champion: 'LeeSin',
      startCamp: 'red' as const,
      startCampSide: 'blue' as const,
      startCampOwn: true,
      level3Gank: true,
      level4Gank: false,
      topGanks: 2,
      midGanks: 1,
      botGanks: 0,
      topZoneWeight: 10,
      midZoneWeight: 5,
      botZoneWeight: 5,
      totalZoneWeight: 20,
      gotFirstDragon: true,
      dragons: 2,
      soloDragons: 1,
      firstDragonTimeSec: 360,
      voidgrubs: 3,
      firstVoidgrubTimeSec: 400,
      heralds: 1,
      firstHeraldTimeSec: 600,
      barons: 1,
      firstBaronTimeSec: 1300
    }
    const selected = games.map((value) => ({ ...value, jungle }))
    expect(aggregateJungle(selected)).toHaveLength(3)
    expect(aggregateJungle(selected)[0]).toMatchObject({
      sideLabel: '总计',
      games: 2,
      winRate: 0.5,
      startSamples: 2,
      ownershipSamples: 2,
      ownStartRate: 1,
      invadeStartRate: 0,
      level3GankRate: 1,
      topGanksPG: 2,
      topZoneRate: 0.5,
      firstDragonRate: 1,
      firstDragonSamples: 2,
      dragonsPG: 2,
      firstDragonTime: 360,
      gd15: 200,
      objectiveDamagePM: 100
    })
    expect(earlyGoldDiff(games[0], '15')).toBe(1000)
    expect(earlyGoldDiff(games[0], '20')).toBe(1500)

    const ownershipMissing = aggregateJungle([
      { ...games[0], jungle },
      { ...games[1], jungle: { ...jungle, startCampOwn: null } }
    ])[0]
    expect(ownershipMissing).toMatchObject({
      startSamples: 2,
      ownershipSamples: 1,
      ownStartRate: 1,
      invadeStartRate: 0
    })
    const addedCamps = aggregateJungle([
      { ...games[0], jungle: { ...jungle, startCamp: 'gromp' as const } },
      { ...games[1], jungle: { ...jungle, startCamp: 'krugs' as const } }
    ])[0]
    expect(addedCamps).toMatchObject({
      grompStartRate: 0.5,
      krugsStartRate: 0.5,
      redStartRate: 0,
      blueStartRate: 0,
      raptorsStartRate: 0,
      wolvesStartRate: 0
    })
    expect(
      aggregateEarlyBuckets(
        games.map((value) => ({ game: value, diff: earlyGoldDiff(value, '20')! }))
      )
    ).toContainEqual({ label: '+500 ~ +1500', games: 0, wins: 0, winRate: null })

    const incompleteFifteen = {
      ...games[0],
      players: games[0].players.map((row, index) => (index === 0 ? { ...row, gd15: null } : row))
    }
    expect(earlyGoldDiff(incompleteFifteen, '15')).toBeNull()

    const noDecisionWindows = {
      ...games[0],
      eventDecision: {
        ...games[0].eventDecision,
        killEpisodes: 0,
        convertedKillEpisodes: 0,
        killToEpicEpisodes: 0,
        killToTowerEpisodes: 0,
        conversionDelaySamples: 0,
        conversionDelayTotalSec: 0
      }
    }
    expect(aggregateConversion([noDecisionWindows])[0]).toMatchObject({
      killConversionRate: null,
      killToEpicRate: null,
      killToTowerRate: null,
      conversionDelaySec: null
    })
  })

  test('assigns exact early-gold boundaries to deterministic buckets', () => {
    const boundaries = [-3000, -1500, -500, 500, 1500, 3000].map((diff, index) => ({
      game: games[index % 2],
      diff
    }))
    expect(aggregateEarlyBuckets(boundaries).map((bucket) => bucket.games)).toEqual([
      0, 1, 1, 1, 1, 1, 1
    ])
  })

  test('aggregates auditable lane gank deaths into timestamp buckets', () => {
    const selected = games.map((value, index) => ({
      ...value,
      laneGankDeaths: {
        methodVersion: 1 as const,
        status: 'available' as const,
        events:
          index === 0
            ? [
                {
                  victimPlayer: 'Alice',
                  victimRole: 'TOP' as const,
                  victimChampion: 'Gwen',
                  enemyJunglerChampion: 'Vi',
                  timestampSec: 180,
                  lane: 'top' as const,
                  involvement: 'assist' as const
                },
                {
                  victimPlayer: 'Alice',
                  victimRole: 'TOP' as const,
                  victimChampion: 'Gwen',
                  enemyJunglerChampion: 'Vi',
                  timestampSec: 240,
                  lane: 'top' as const,
                  involvement: 'killer' as const
                }
              ]
            : []
      }
    }))
    const top = aggregateRoles(selected).find((row) => row.player === 'Alice')!
    expect(top).toMatchObject({
      laneGankEligibleGames: 2,
      laneGankDeaths: 2,
      laneGankDeathsPG: 1,
      laneGankBefore3: 0,
      laneGankMinute3: 1,
      laneGankMinute4: 1,
      laneGankMinute5To10: 0,
      laneGankMinute10To14: 0,
      laneGankAffectedGames: 1,
      laneGankAffectedRate: 0.5
    })
    expect(
      laneGankDeathEvidence(selected, 'Alice', 'TOP').map((event) => event.timestampSec)
    ).toEqual([180, 240])
    expect(aggregateRoles(selected).find((row) => row.role === 'JUNGLE')).toMatchObject({
      laneGankDeaths: null,
      laneGankDeathsPG: null
    })
  })

  test('preserves unavailable role and jungle metrics instead of fabricating zero', () => {
    const unavailablePlayers = games.map((value) => ({
      ...value,
      players: value.players.map((row) => ({
        ...row,
        kp: null,
        damageShare: null,
        goldShare: null,
        takenShare: null,
        gd10: null,
        gd15: null,
        csd15: null,
        xpd15: null,
        damageDiff15: null,
        soloDiff15: null
      }))
    }))
    expect(aggregateRoles(unavailablePlayers)[0]).toMatchObject({
      kp: null,
      damageShare: null,
      goldShare: null,
      damageConversion: null,
      gd15: null
    })

    const jungle = {
      player: 'Bob',
      champion: 'LeeSin',
      startCamp: null,
      startCampSide: null,
      startCampOwn: null,
      level3Gank: false,
      level4Gank: false,
      topGanks: 0,
      midGanks: 0,
      botGanks: 0,
      topZoneWeight: 0,
      midZoneWeight: 0,
      botZoneWeight: 0,
      totalZoneWeight: 0,
      gotFirstDragon: null,
      dragons: 0,
      soloDragons: 0,
      firstDragonTimeSec: null,
      voidgrubs: 0,
      firstVoidgrubTimeSec: null,
      heralds: 0,
      firstHeraldTimeSec: null,
      barons: 0,
      firstBaronTimeSec: null
    }
    expect(aggregateJungle([{ ...unavailablePlayers[0], jungle }])[0]).toMatchObject({
      ownStartRate: null,
      invadeStartRate: null,
      redStartRate: null,
      topZoneRate: null,
      firstDragonRate: null
    })
  })

  test('applies combined match filters without touching fixtures outside the test', () => {
    const selected = filterMemberAnalysisGames(games, {
      outcome: 'win',
      patch: '26.1',
      dateFrom: '',
      dateTo: '',
      durationMin: 20,
      durationMax: 40,
      participant: 'Alice',
      matchRole: 'TOP',
      champion: 'Gwen',
      query: 'alice'
    })
    expect(selected.map((row) => row.gameId)).toEqual([1])
  })

  test('applies global side filters before exactly one sample-size window and keeps all unbounded', () => {
    const large = Array.from({ length: 150 }, (_, index) => ({
      ...games[index % 2],
      gameId: 150 - index,
      side: (index % 2 ? 'Red' : 'Blue') as 'Blue' | 'Red'
    }))
    const defaults = {
      outcome: 'all' as const,
      patch: 'all',
      dateFrom: '',
      dateTo: '',
      durationMin: null,
      durationMax: null,
      participant: 'all',
      matchRole: 'all',
      champion: 'all',
      query: ''
    } satisfies MemberAnalysisFilters
    const blue100 = selectMemberAnalysisSample(large, defaults, 'Blue', 100)
    expect(blue100.globallyFiltered).toHaveLength(75)
    expect(blue100.sample).toHaveLength(75)
    expect(blue100.sample.every((game) => game.side === 'Blue')).toBe(true)
    expect(selectMemberAnalysisSample(large, defaults, 'all', 20).sample).toHaveLength(20)
    expect(selectMemberAnalysisSample(large, defaults, 'all', 50).sample).toHaveLength(50)
    expect(selectMemberAnalysisSample(large, defaults, 'all', 100).sample).toHaveLength(100)
    expect(selectMemberAnalysisSample(large, defaults, 'all', 'all').sample).toHaveLength(150)
  })

  test('builds a 10k-row search index without a long main-thread task', () => {
    const large = Array.from({ length: 10_000 }, (_, index) => ({
      ...games[index % 2],
      gameId: index + 1
    }))
    const started = performance.now()
    const index = buildGameSearchIndex(large)
    const elapsed = performance.now() - started
    expect(index).toHaveLength(10_000)
    expect(index[9999].search).toContain('alice')
    expect(elapsed).toBeLessThan(1000)
  })
})
