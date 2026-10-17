import type {
  MemberAnalysisFilters,
  MemberAnalysisGame,
  MemberAnalysisPlayerGame
} from '@shared/shards/member-analysis'
import { normalizeRankedStats } from '@shared/shards/member-analysis/opponent-ranks'
import {
  performanceMetricKeys,
  playerPerformanceMetrics
} from '@shared/shards/member-analysis/performance-metrics'
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
import {
  earlyBucketLabel,
  earlyBucketMatches,
  earlyGroupMatches,
  earlyResultRows
} from './early-results'
import { eventGameCells, eventMetricCell, eventSections, eventSideGames } from './event-results'
import { type TeamLineup, buildPredictionDataset } from './prediction/model'
import { predictionObservations } from './prediction/observations'

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

test('query-time opponent ranks never enter historical prediction observations or metrics', () => {
  const original = game(1, true, 'Blue')
  const withSnapshot: MemberAnalysisGame = {
    ...original,
    opponentRanks: {
      version: 1,
      source: 'SGP leagues-ledge (current snapshot)',
      serverId: 'TEST',
      opponents: Array.from({ length: 5 }, (_, i) => ({
        slot: i + 1,
        role: null,
        champion: null,
        snapshot: normalizeRankedStats(
          {
            queues: [
              { queueType: 'RANKED_FLEX_SR', tier: 'CHALLENGER', rank: 'I', leaguePoints: 1000 },
              { queueType: 'RANKED_SOLO_5x5', tier: 'IRON', rank: 'IV', leaguePoints: -3 }
            ]
          },
          '2026-10-07T12:00:00.000Z'
        )
      }))
    }
  }
  const members = original.players.map((row) => row.player)
  expect(predictionObservations([withSnapshot], members)).toEqual(
    predictionObservations([original], members)
  )
  expect(playerPerformanceMetrics(withSnapshot, withSnapshot.players[0])).toEqual(
    playerPerformanceMetrics(original, original.players[0])
  )
})

test('projects individual match observations with role, member, champion and missingness', async () => {
  const { matchScatterRows } = await import('./scatter-analysis')
  const input = [game(1, true, 'Blue'), game(2, false, 'Red')]
  input[1].players[2].goldShare = null
  input[1].players[2].gd15 = null
  input[1].players[2].minutes = 0
  const rows = matchScatterRows(input, 'MIDDLE')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toMatchObject({
    gameId: 1,
    player: 'Carol',
    damageConversion: 1,
    dpm: 600,
    gpm: 400,
    cspm: 7,
    winRate: 1
  })
  expect(rows[1]).toMatchObject({
    gameId: 2,
    damageConversion: null,
    gd15: null,
    dpm: null,
    winRate: 0
  })
  expect(matchScatterRows(input, 'MIDDLE', 'Alice')).toEqual([])
  expect(matchScatterRows(input, 'MIDDLE', 'all', 'Gwen')).toEqual([])
  input[0].players[2].damageShare = 0
  expect(matchScatterRows(input, 'MIDDLE')[0].damageConversion).toBe(0)
})

test('all expanded per-game metrics agree with one-game aggregate definitions', () => {
  const input = game(1, true, 'Blue')
  const aggregate = aggregateRoles([input])
  for (const player of input.players) {
    const projected = playerPerformanceMetrics(input, player)
    const expected = aggregate.find(
      (row) => row.player === player.player && row.role === player.role
    )!
    for (const key of performanceMetricKeys) {
      expect(projected[key], `${player.role}: ${key}`).toEqual(expected[key])
    }
  }
})
test('prediction includes all five role slots but excludes short matches and unknown members', () => {
  const input = [
    game(1, true, 'Blue'),
    { ...game(2, false, 'Blue'), duration: 899 },
    { ...game(3, true, 'Blue'), duration: 900 }
  ]
  const members = input[0].players.map((row) => row.player)
  const observations = predictionObservations(input, members)
  expect(observations).toHaveLength(10)
  expect(new Set(observations.map((row) => row.role)).size).toBe(5)
  expect(new Set(observations.map((row) => row.gameId))).toEqual(new Set([1, 3]))
  expect(predictionObservations(input, ['Unknown synthetic member'])).toEqual([])
  input[0].players[0].teamKills = 0
  input[0].players[0].teamDeaths = 0
  input[0].players[0].gold = 0
  const projected = playerPerformanceMetrics(input[0], input[0].players[0])
  expect(projected.killShare).toBeNull()
  expect(projected.deathShare).toBeNull()
  expect(projected.damagePerGold).toBeNull()
})

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
      eventDecision: { ...value.eventDecision!, tradeDelayTotalSec: -30, tradeDelaySamples: 1 }
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
        ...games[0].eventDecision!,
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

  test('keeps same-day lane-gank evidence grouped by newest match then event time, with stable ties', () => {
    const event = (timestampSec: number, enemyJunglerChampion = 'Vi') => ({
      victimPlayer: 'Alice',
      victimRole: 'TOP' as const,
      victimChampion: 'Gwen',
      enemyJunglerChampion,
      timestampSec,
      lane: 'top' as const,
      involvement: 'assist' as const
    })
    const newer = {
      ...game(2, true, 'Blue'),
      laneGankDeaths: {
        methodVersion: 1 as const,
        status: 'available' as const,
        events: [event(700), event(600, 'Vi'), event(600, 'Sejuani')]
      }
    }
    const older = {
      ...game(1, false, 'Red'),
      laneGankDeaths: {
        methodVersion: 1 as const,
        status: 'available' as const,
        events: [event(650), event(180)]
      }
    }
    const snapshot = JSON.stringify([older, newer])
    const evidence = laneGankDeathEvidence([older, newer], 'Alice', 'TOP')
    expect(evidence.map(({ gameId, timestampSec }) => [gameId, timestampSec])).toEqual([
      [2, 600],
      [2, 600],
      [2, 700],
      [1, 180],
      [1, 650]
    ])
    expect(evidence.slice(0, 2).map((row) => row.enemyJunglerChampion)).toEqual(['Vi', 'Sejuani'])
    expect(evidence.map((row) => row.gameTimestamp)).toEqual([
      newer.timestamp,
      newer.timestamp,
      newer.timestamp,
      older.timestamp,
      older.timestamp
    ])
    expect(JSON.stringify([older, newer])).toBe(snapshot)
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

  test('excludes games under 15 minutes before recent-N selection, even with relaxed filters', () => {
    const defaults: MemberAnalysisFilters = {
      outcome: 'all',
      patch: 'all',
      dateFrom: '',
      dateTo: '',
      durationMin: 0,
      durationMax: null,
      participant: 'all',
      matchRole: 'all',
      champion: 'all',
      query: ''
    }
    const eligible = Array.from({ length: 25 }, (_, i) => ({
      ...game(i + 1, true, 'Blue'),
      duration: i === 0 ? 900 : 901
    }))
    const short = [0, 600, 899, 899.99].map((duration, i) => ({
      ...game(100 + i, false, 'Blue'),
      duration
    }))
    const selection = selectMemberAnalysisSample([...eligible, ...short], defaults, 'all', 20)
    expect(selection.globallyFiltered).toHaveLength(25)
    expect(selection.sample).toHaveLength(20)
    expect(selection.sample.every((row) => row.duration >= 900)).toBe(true)
    expect(selection.sample.map((row) => row.gameId)).toEqual(
      Array.from({ length: 20 }, (_, i) => 25 - i)
    )
    expect(
      filterMemberAnalysisGames([...eligible, ...short], defaults).some(
        (row) => row.duration === 900
      )
    ).toBe(true)
    expect(filterMemberAnalysisGames(short, defaults)).toEqual([])
    expect(filterMemberAnalysisGames(eligible, { ...defaults, durationMax: 14 })).toEqual([])
    expect(filterMemberAnalysisGames(eligible, { ...defaults, durationMin: 15.01 })).toHaveLength(
      24
    )
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

test('prediction side scope applies to profiles, training and exact lineup history; combined keeps both sides', () => {
  const input = Array.from({ length: 40 }, (_, index) => {
    const match = game(index + 1, index % 2 === 0, index % 2 === 0 ? 'Blue' : 'Red')
    match.players.forEach((player) => {
      player.gold = index % 2 === 0 ? 10000 : 20000
    })
    return match
  })
  input.push({ ...game(41, true, 'Blue'), duration: 899 })
  const members = input[0].players.map((player) => player.player)
  const lineup = Object.fromEntries(
    input[0].players.map((player) => [player.role, player.player])
  ) as TeamLineup
  const combined = predictionObservations(input, members)
  expect(predictionObservations(input, members, 'all')).toEqual(combined)
  expect(combined).toHaveLength(200)
  for (const side of ['Blue', 'Red'] as const) {
    const scoped = predictionObservations(input, members, side)
    expect(scoped).toHaveLength(100)
    expect(
      scoped.every((row) => input.find((game) => game.gameId === row.gameId)!.side === side)
    ).toBe(true)
    const dataset = buildPredictionDataset(scoped, lineup)
    expect(dataset.lineupHistory).toHaveLength(20)
    expect(dataset.rows).toHaveLength(15)
    expect(dataset.rows.every((row) => row.y === Number(side === 'Blue'))).toBe(true)
    expect(dataset.profiles.every((profile) => profile.history.length === 20)).toBe(true)
    expect(
      dataset.profiles.every((profile) =>
        profile.history.every((row) => row.win === (side === 'Blue'))
      )
    ).toBe(true)
  }
  expect(buildPredictionDataset(combined, lineup).lineupHistory).toHaveLength(40)
  expect(buildPredictionDataset(combined, lineup).rows).toHaveLength(35)
  expect(predictionObservations([input[0]], members, 'Red')).toEqual([])
})

describe('event result presentation and matching games', () => {
  const metric = eventSections[0].metrics[0]
  test('keeps each side denominator and per-match evidence consistent without mutating observations', () => {
    const sample = [game(401, true, 'Blue'), game(402, false, 'Red'), game(403, true, 'Blue')]
    const before = structuredClone(sample)
    const rows = aggregateConversion(sample)
    for (const row of rows) {
      const selected = eventSideGames(sample, row.sideLabel)
      expect(eventMetricCell(metric, row, selected)).toEqual({
        value: '50.0%',
        sample: `${selected.length * 2} / ${selected.length * 4} 次`,
        missing: false
      })
      const cells = eventGameCells(metric, selected)
      expect([...cells.keys()]).toEqual(selected.map((g) => g.gameId))
      expect([...cells.values()].every((cell) => cell.sample === '2 / 4 次')).toBe(true)
    }
    expect(sample).toEqual(before)
  })
  test('distinguishes zero results from no event windows and missing observations', () => {
    const observed = structuredClone(game(404, false, 'Blue'))
    observed.eventDecision!.convertedKillEpisodes = 0
    expect(eventMetricCell(metric, aggregateConversion([observed])[0], [observed]).value).toBe(
      '0.0%'
    )
    observed.eventDecision!.killEpisodes = 0
    expect(eventMetricCell(metric, aggregateConversion([observed])[0], [observed])).toMatchObject({
      value: '—',
      sample: '无击杀窗口',
      missing: false
    })
    // Defensive rendering of legacy/malformed missingness, not a new source contract.
    const missing = structuredClone(game(405, true, 'Red'))
    missing.eventDecision = null
    const sample = [observed, missing]
    expect(eventMetricCell(metric, aggregateConversion(sample)[0], sample)).toMatchObject({
      value: '—',
      sample: '无击杀窗口 · 有效 1/2 场',
      missing: false
    })
  })
  test('delay sample counts come from delay records rather than converted episodes', () => {
    const sample = structuredClone(game(406, true, 'Blue'))
    sample.eventDecision!.convertedKillEpisodes = 4
    sample.eventDecision!.conversionDelaySamples = 1
    const delay = eventSections[0].metrics[3]
    expect(eventMetricCell(delay, aggregateConversion([sample])[0], [sample])).toMatchObject({
      value: '60.00 秒',
      sample: '延迟记录 1 次'
    })
    sample.eventDecision!.conversionDelaySamples = 0
    expect(eventMetricCell(delay, aggregateConversion([sample])[0], [sample])).toMatchObject({
      value: '—',
      sample: '无延迟记录'
    })
  })
  test('preserves signed extreme trade delay and weighted totals', () => {
    const sample = structuredClone(game(407, true, 'Red'))
    sample.eventDecision!.tradeDelayTotalSec = -123456
    sample.eventDecision!.tradeDelaySamples = 2
    expect(
      eventMetricCell(eventSections[3].metrics[1], aggregateConversion([sample])[0], [sample]).value
    ).toBe('−61728.0 秒')
  })
})

describe('early result groups and evidence', () => {
  test('exact -500 and +500 boundaries retain the original bins and matching games', () => {
    const diffs = [-3001, -3000, -1500, -500, 0, 499, 500, 1500, 3000]
    const sample = diffs.map((diff, i) => {
      const g = structuredClone(game(500 + i, i % 2 === 0, 'Blue'))
      g.players.forEach((p, j) => (p.gd15 = j === 0 ? diff : 0))
      return g
    })
    const rows = earlyResultRows(sample, '15')
    expect(rows.filter((r) => earlyGroupMatches(r.diff, 'behind')).map((r) => r.diff)).toEqual([
      -3001, -3000, -1500
    ])
    expect(rows.filter((r) => earlyGroupMatches(r.diff, 'neutral')).map((r) => r.diff)).toEqual([
      -500, 0, 499
    ])
    expect(rows.filter((r) => earlyGroupMatches(r.diff, 'ahead')).map((r) => r.diff)).toEqual([
      500, 1500, 3000
    ])
    for (const bucket of aggregateEarlyBuckets(rows)) {
      const selected = rows.filter((row) => earlyBucketMatches(row, bucket.label))
      expect(selected.length).toBe(bucket.games)
      expect(selected.filter((row) => row.game.win).length).toBe(bucket.wins)
    }
    expect(earlyBucketLabel('−500 ~ +500')).toBe('−500 ≤ 差值 < +500')
  })
  test('excludes incomplete economy and inapplicable 20-minute observations, not zero economy', () => {
    const complete = structuredClone(game(601, true, 'Blue'))
    complete.players.forEach((p) => (p.gd15 = 0))
    complete.gold20Diff = 0
    const missing = structuredClone(complete)
    missing.gameId = 602
    missing.players[2].gd15 = null
    missing.gold20Diff = null as unknown as number
    const short = structuredClone(complete)
    short.gameId = 603
    short.duration = 1199
    expect(earlyResultRows([complete, missing, short], '15').map((r) => r.game.gameId)).toEqual([
      601, 603
    ])
    expect(earlyResultRows([complete, missing, short], '20').map((r) => r.diff)).toEqual([0])
    expect(
      aggregateEarlyBuckets(earlyResultRows([complete], '20'))
        .filter((b) => b.games === 0)
        .every((b) => b.winRate === null)
    ).toBe(true)
  })
})

test('missing raw values use only matching exposure and preserve true zero', () => {
  const sample = [game(9001, true, 'Blue'), game(9002, false, 'Red')]
  sample[0].players[0].damage = null
  sample[0].players[0].shieldTeammates = null
  sample[0].players[0].soloKills = null
  sample[1].players[0].damage = 0
  sample[1].players[0].shieldTeammates = 0
  sample[1].players[0].soloKills = 0
  const row = aggregateRoles(sample, 'TOP')[0]
  expect(row.dpm).toBe(0)
  expect(row.shieldPM).toBe(0)
  expect(row.soloKillsPG).toBe(0)
  sample[1].players[0].damage = null
  expect(aggregateRoles(sample, 'TOP')[0].dpm).toBeNull()
  expect(aggregateRoles(sample, 'TOP')[0].kda).not.toBeNull()
})
test('missing timeline remains absent in pairs, events and prediction observations', async () => {
  const sample = game(9003, true, 'Blue')
  sample.upperGold15 = sample.botGold15 = sample.gold20Diff = null
  sample.dragon15Diff = sample.grub15Diff = sample.objectiveFight15Diff = null
  sample.eventDecision = null
  expect(aggregatePairs([sample])[0].upperGold15).toBeNull()
  expect(earlyGoldDiff(sample, '20')).toBeNull()
  expect(aggregateConversion([sample])[0].deathCostPointsPG).toBeNull()
  sample.players[0].damage = null
  sample.players[0].fbPart = null
  const { predictionObservations } = await import('./prediction/observations')
  const { performanceMetricKeys } =
    await import('@shared/shards/member-analysis/performance-metrics')
  const observation = predictionObservations([sample])[0]
  expect(observation.metrics[performanceMetricKeys.indexOf('dpm')]).toBeNull()
  expect(observation.metrics[performanceMetricKeys.indexOf('fbRate')]).toBeNull()
  expect(observation.metrics[performanceMetricKeys.indexOf('dragon15')]).toBeNull()
})

test('damage conversion uses paired shares, not unrelated valid populations', () => {
  const sample = [game(9010, true, 'Blue'), game(9011, false, 'Red'), game(9012, true, 'Blue')]
  sample[0].players[0].damageShare = 0.9
  sample[0].players[0].goldShare = null
  sample[1].players[0].damageShare = null
  sample[1].players[0].goldShare = 0.8
  sample[2].players[0].damageShare = 0.2
  sample[2].players[0].goldShare = 0.1
  expect(aggregateRoles(sample, 'TOP')[0].damageConversion).toBe(2)
  sample[2].players[0].goldShare = 0
  expect(aggregateRoles(sample, 'TOP')[0].damageConversion).toBeNull()
  sample[2].players[0].goldShare = 0.1
  sample[2].players[0].damageShare = 0
  expect(aggregateRoles(sample, 'TOP')[0].damageConversion).toBe(0)
  sample[2].players[0].damageShare = null
  expect(aggregateRoles(sample, 'TOP')[0].damageConversion).toBeNull()
})
