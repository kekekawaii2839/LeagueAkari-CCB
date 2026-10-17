import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { describe, expect, test } from 'vitest'

import { aggregateRoles } from '../analytics'
import {
  type TrendInput,
  type TrendRequest,
  buildVersionTrend,
  comparePatch,
  parsePatch,
  trendMetrics,
  trendRequestKey,
  utcTimeBucket
} from './domain'

function player(name = 'Member A'): MemberAnalysisPlayerGame {
  return {
    player: name,
    role: 'UTILITY',
    champion: 'SyntheticChampion',
    minutes: 30,
    kills: 0,
    deaths: 0,
    assists: 10,
    teamKills: 20,
    teamDeaths: 4,
    damage: 3000,
    damageShare: 0.1,
    gold: 6000,
    goldShare: 0.1,
    cs: 20,
    vision: 60,
    wardsPlaced: 20,
    wardsKilled: 3,
    controlWards: 2,
    damageTaken: 3000,
    takenShare: 0.1,
    damageMitigated: 2000,
    objectiveDamage: 400,
    turretDamage: 100,
    healTeammates: 100,
    shieldTeammates: 100,
    ccSeconds: 20,
    soloKills: 0,
    fbPart: false,
    ftPart: false,
    kp: 0.5,
    gd10: -100,
    gd15: 0,
    csd15: 0,
    xpd15: 0,
    damageDiff15: 0,
    soloDiff15: 0,
    counter: null
  }
}
function game(
  gameId: number,
  patch = '15.15',
  change: Partial<MemberAnalysisGame> = {}
): MemberAnalysisGame {
  return {
    gameId,
    timestamp: gameId * 1000,
    date: '2026-01-01',
    patch,
    side: 'Blue',
    win: gameId % 2 === 1,
    duration: 1800,
    roster: 'Synthetic',
    metricSemantics: 'current-v5',
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    counterMean: null,
    upperGold15: 0,
    botGold15: 0,
    gold20Diff: 0,
    tower20Diff: 0,
    jungle: null,
    eventDecision: null,
    laneGankDeaths: { methodVersion: 1, status: 'available', events: [] },
    players: [player(), { ...player('Member B'), role: 'TOP' }],
    ...change
  }
}
function input(games: MemberAnalysisGame[]): TrendInput {
  return {
    generation: 4,
    identitiesGeneration: 4,
    configuredMemberIds: ['a', 'b', 'c', 'd', 'e'],
    games,
    identities: games.map((entry) => ({
      gameId: entry.gameId,
      members: entry.players.map((row, index) => ({
        memberId: index === 0 ? 'a' : 'b',
        player: row.player
      }))
    }))
  }
}
function request(change: Partial<TrendRequest> = {}): TrendRequest {
  return {
    axis: 'patch',
    timeBucket: 'day',
    memberId: 'a',
    role: 'UTILITY',
    metric: 'player:wcpm',
    champion: null,
    side: 'all',
    outcome: 'all',
    patchFrom: '',
    patchTo: '',
    dateFrom: '',
    dateTo: '',
    durationMin: null,
    durationMax: null,
    includeMemberIds: [],
    excludeMemberIds: [],
    completeness: 'all',
    ...change
  }
}

describe('version trend source populations', () => {
  test('time bins use true millisecond timestamps, UTC days, Monday weeks and calendar months', () => {
    expect(utcTimeBucket(Date.parse('2026-03-01T23:59:59.999Z'), 'day')).toEqual({
      key: '2026-03-01',
      startMs: Date.parse('2026-03-01T00:00:00Z'),
      endMs: Date.parse('2026-03-02T00:00:00Z')
    })
    expect(utcTimeBucket(Date.parse('2026-03-01T23:59:59.999Z'), 'week')?.key).toBe('2026-02-23')
    expect(utcTimeBucket(Date.parse('2026-03-02T00:00:00Z'), 'week')?.key).toBe('2026-03-02')
    expect(utcTimeBucket(Date.parse('2024-02-29T12:00:00Z'), 'month')).toEqual({
      key: '2024-02',
      startMs: Date.parse('2024-02-01T00:00:00Z'),
      endMs: Date.parse('2024-03-01T00:00:00Z')
    })
    expect(utcTimeBucket(0, 'day')).toBeNull()
    expect(utcTimeBucket(Number.NaN, 'day')).toBeNull()
  })
  test('axis switching preserves eligibility, filters, weighted formulas and exact support subsets', () => {
    const games = [game(1, '15.15'), game(2, '15.16'), game(3, '15.17')]
    games[0].timestamp = Date.parse('2026-03-01T10:00:00Z')
    games[1].timestamp = Date.parse('2026-03-01T14:00:00Z')
    games[2].timestamp = Date.parse('2026-03-03T10:00:00Z')
    games.forEach((entry) => {
      entry.date = new Date(entry.timestamp).toISOString().slice(0, 10)
    })
    games[0].players[0] = { ...player(), wardsKilled: 2, minutes: 20 }
    games[1].players[0] = { ...player(), wardsKilled: null, minutes: 60 }
    const data = input(games)
    const version = buildVersionTrend(data, request({ includeMemberIds: ['b'] }))
    const time = buildVersionTrend(data, request({ axis: 'time', includeMemberIds: ['b'] }))
    expect(time.selectedGames).toBe(version.selectedGames)
    expect(time.points.flatMap((point) => point.gameIds)).toEqual(
      version.points.flatMap((point) => point.gameIds)
    )
    expect(time.points.flatMap((point) => point.validGameIds)).toEqual(
      version.points.flatMap((point) => point.validGameIds)
    )
    expect(time.points[0]).toMatchObject({
      bucketKey: '2026-03-01',
      patch: null,
      patches: ['15.15', '15.16'],
      value: 0.1,
      denominator: 20,
      games: 2,
      validGames: 1,
      observedFromMs: games[0].timestamp,
      observedToMs: games[1].timestamp
    })
    expect(time.points[1].connectPrevious).toBe(false)
    expect(time.requestKey).not.toBe(version.requestKey)
    const filtered = buildVersionTrend(
      data,
      request({ axis: 'time', patchFrom: '15.16', completeness: 'metric-known' })
    )
    expect(filtered.points.flatMap((point) => point.gameIds)).toEqual([3])
  })
  test('missing timestamps are counted, never replaced with synthetic midnight observations', () => {
    const games = [
      game(1, '15.15', { timestamp: 0 }),
      game(2, '15.16', { timestamp: Date.parse('2026-01-01T12:34:56Z') })
    ]
    const data = input(games)
    expect(buildVersionTrend(data, request())).toMatchObject({
      selectedGames: 2,
      unknownTimestampGames: 1
    })
    const result = buildVersionTrend(data, request({ axis: 'time' }))
    expect(result).toMatchObject({ selectedGames: 1, unknownTimestampGames: 1 })
    expect(result.points[0].gameIds).toEqual([2])
    expect(result.points[0].observedFromMs).toBe(games[1].timestamp)
    expect(() => buildVersionTrend(data, request({ timeBucket: 'hour' as 'day' }))).toThrow(
      'invalid-axis'
    )
  })
  test('uses integer patch tuples and canonicalizes build versions without inventing empty patch points', () => {
    expect(parsePatch('15.24.123.9')).toEqual([15, 24])
    expect(parsePatch('unknown')).toBeNull()
    expect(comparePatch('15.9', '15.15')).toBeLessThan(0)
    const result = buildVersionTrend(
      input([
        game(1, '15.24'),
        game(2, '15.9'),
        game(3, '15.15.1'),
        game(4, '15.16'),
        game(5, '16.1')
      ]),
      request()
    )
    expect(result.points.map((point) => point.patch)).toEqual([
      '15.9',
      '15.15',
      '15.16',
      '15.24',
      '16.1'
    ])
    expect(result.points.map((point) => point.connectPrevious)).toEqual([
      false,
      false,
      true,
      false,
      false
    ])
  })
  test('keeps minute-weighted ratios, exact support IDs, real zero and missing distinct', () => {
    const games = [game(1), game(2), game(3), game(4, '15.16')]
    games[0].players[0] = { ...player(), wardsKilled: 2, minutes: 20 }
    games[1].players[0] = { ...player(), wardsKilled: 12, minutes: 60 }
    games[2].players[0] = { ...player(), wardsKilled: null, minutes: 10 }
    games[3].players[0] = { ...player(), wardsKilled: 0 }
    const points = buildVersionTrend(input(games), request()).points
    expect(points[0].value).toBe(14 / 80)
    expect(points[0].value).toBe(aggregateRoles(games.slice(0, 3), 'UTILITY', 'Member A')[0].wcpm)
    expect(points[0]).toMatchObject({
      validGames: 2,
      games: 3,
      numerator: 14,
      denominator: 80,
      validGameIds: [1, 2],
      gameIds: [1, 2, 3]
    })
    expect(points[1].value).toBe(0)
  })
  test('does not turn all-missing or zero aggregate exposure into zero observations', () => {
    const games = [game(1), game(2, '15.16'), game(3, '15.17')]
    games[0].players[0].wardsKilled = null
    games[1].players[0].minutes = 0
    const points = buildVersionTrend(input(games), request()).points
    expect(points[0]).toMatchObject({ value: null, validGames: 0 })
    expect(points[1]).toMatchObject({ value: null, validGames: 1, denominator: 0 })
    expect(points[2].connectPrevious).toBe(false)
  })
  test('preserves aggregate KDA rather than averaging single-game KDA', () => {
    const games = [game(1), game(2)]
    games[1].players[0] = { ...player(), kills: 0, assists: 0, deaths: 10 }
    expect(buildVersionTrend(input(games), request({ metric: 'player:kda' })).points[0].value).toBe(
      1
    )
  })
  test('counts observed zero-event games in non-jungle gank denominators', () => {
    const games = [game(1), game(2)]
    games[1].laneGankDeaths = null
    expect(
      buildVersionTrend(input(games), request({ metric: 'player:laneGankDeathsPG' })).points[0]
    ).toMatchObject({ value: 0, validGames: 1, validGameIds: [1], denominator: 1 })
    expect(
      buildVersionTrend(input(games), request({ metric: 'player:laneGankEligibleGames' })).points[0]
    ).toMatchObject({ value: 1, numerator: 1, denominator: null })
  })
  test('AND inclusion is supported even when it does not reduce current fixed-roster data', () => {
    const data = input([game(1), game(2)])
    expect(buildVersionTrend(data, request({ includeMemberIds: ['b'] })).selectedGames).toBe(2)
    expect(buildVersionTrend(data, request({ includeMemberIds: ['b', 'c'] })).selectedGames).toBe(0)
    expect(buildVersionTrend(data, request({ excludeMemberIds: ['b'] })).selectedGames).toBe(0)
    expect(() =>
      buildVersionTrend(data, request({ includeMemberIds: ['b'], excludeMemberIds: ['b'] }))
    ).toThrow('invalid-selection')
    expect(() => buildVersionTrend(data, request({ excludeMemberIds: ['a'] }))).toThrow(
      'invalid-selection'
    )
  })
  test('uses verified per-game associations across renames, never same-name fallback', () => {
    const games = [game(1), game(2)]
    games[1].players[0].player = 'Renamed A'
    const data = input(games)
    expect(buildVersionTrend(data, request()).selectedGames).toBe(2)
    data.identities = data.identities.slice(0, 1)
    expect(buildVersionTrend(data, request())).toMatchObject({
      selectedGames: 1,
      unresolvedIdentityGames: 1
    })
    expect(() => buildVersionTrend({ ...data, identitiesGeneration: 3 }, request())).toThrow(
      'stale-identities'
    )
  })
  test('subject hero and role are not satisfied by another member', () => {
    const games = [game(1)]
    games[0].players[1].champion = 'OtherChampion'
    expect(
      buildVersionTrend(input(games), request({ champion: 'OtherChampion' })).selectedGames
    ).toBe(0)
    expect(buildVersionTrend(input(games), request({ role: 'TOP' })).selectedGames).toBe(0)
  })
  test('keeps eligibility and method boundaries explicit and does not modify sources', () => {
    const games = [
      game(1),
      game(2, 'unknown'),
      game(3, '15.16', { metricSemantics: 'legacy-unknown' }),
      game(4, '15.17', { duration: 899 })
    ]
    const before = structuredClone(games)
    expect(buildVersionTrend(input(games), request())).toMatchObject({
      selectedGames: 1,
      unknownPatchGames: 1,
      legacyGames: 1
    })
    expect(games).toEqual(before)
  })
  test('validates ranges, rejects game ambiguity and canonicalizes set conditions', () => {
    const data = input([game(1)])
    expect(() => buildVersionTrend(data, request({ patchFrom: '15.24', patchTo: '15.9' }))).toThrow(
      'invalid-patch-range'
    )
    expect(() => buildVersionTrend(data, request({ durationMin: 40, durationMax: 20 }))).toThrow(
      'invalid-duration-range'
    )
    expect(() =>
      buildVersionTrend(
        { ...data, identities: [...data.identities, data.identities[0]] },
        request()
      )
    ).toThrow('ambiguous-game')
    expect(trendRequestKey(request({ includeMemberIds: ['c', 'b', 'b'] }))).toBe(
      trendRequestKey(request({ includeMemberIds: ['b', 'c'] }))
    )
    expect(new Set(trendMetrics.map((metric) => metric.key)).size).toBe(trendMetrics.length)
  })
  test('win rate includes wins and Wilson uncertainty while arbitrary means do not get a fake interval', () => {
    const data = input([game(1), game(2)])
    expect(buildVersionTrend(data, request({ metric: 'player:winRate' })).points[0]).toMatchObject({
      value: 0.5,
      wins: 1,
      denominator: 2
    })
    expect(
      buildVersionTrend(data, request({ metric: 'player:winRate' })).points[0].interval
    ).not.toBeNull()
    expect(buildVersionTrend(data, request()).points[0].interval).toBeNull()
  })
  test('jungle rates preserve known false starts and weighted zone populations', () => {
    const games = [game(1), game(2), game(3)]
    for (const entry of games) {
      entry.players[0].role = 'JUNGLE'
      entry.jungle = {
        player: 'Member A',
        champion: 'SyntheticChampion',
        startCamp: 'red',
        startCampSide: 'blue',
        startCampOwn: false,
        level3Gank: false,
        level4Gank: null,
        topGanks: 0,
        midGanks: 0,
        botGanks: 0,
        topZoneWeight: entry.gameId === 1 ? 1 : 9,
        midZoneWeight: 0,
        botZoneWeight: 0,
        totalZoneWeight: entry.gameId === 1 ? 10 : 30,
        gotFirstDragon: false,
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
    }
    games[2].jungle = null
    const data = input(games)
    expect(
      buildVersionTrend(data, request({ role: 'JUNGLE', metric: 'jungle:ownStartRate' })).points[0]
    ).toMatchObject({ value: 0, validGames: 2, denominator: 2 })
    expect(
      buildVersionTrend(data, request({ role: 'JUNGLE', metric: 'jungle:topZoneRate' })).points[0]
    ).toMatchObject({
      value: 10 / 40,
      validGameIds: [1, 2],
      denominator: 40,
      denominatorUnit: 'weight'
    })
    expect(
      buildVersionTrend(data, request({ role: 'JUNGLE', metric: 'jungle:level4GankRate' }))
        .points[0].value
    ).toBeNull()
    expect(
      buildVersionTrend(data, request({ role: 'JUNGLE', metric: 'player:laneGankDeathsPG' }))
        .points[0].value
    ).toBeNull()
  })
  test('team event ratios use total windows rather than an average of game percentages', () => {
    const games = [game(1), game(2), game(3)]
    const event: NonNullable<MemberAnalysisGame['eventDecision']> = {
      killEpisodes: 2,
      convertedKillEpisodes: 2,
      killToEpicEpisodes: 1,
      killToTowerEpisodes: 1,
      conversionDelayTotalSec: 30,
      conversionDelaySamples: 1,
      deathEpisodes: 0,
      highCostDeathEpisodes: 0,
      deathCostEpics: 0,
      deathCostTowers: 0,
      deathCostPlates: 0,
      deathCostPoints: 0,
      shutdownBountyLost: 0,
      objectivesTaken: 0,
      cleanObjectives: 0,
      wonFightObjectives: 0,
      evenFightObjectives: 0,
      lostFightObjectives: 0,
      objectiveFightSamples: 0,
      objectiveFightWins: 0,
      enemyObjectives: 0,
      tradedEnemyObjectives: 0,
      tradeDelayTotalSec: -10,
      tradeDelaySamples: 1
    }
    games[0].eventDecision = event
    games[1].eventDecision = { ...event, killEpisodes: 8, convertedKillEpisodes: 0 }
    const data = input(games)
    expect(
      buildVersionTrend(data, request({ metric: 'team:killConversionRate' })).points[0]
    ).toMatchObject({
      value: 0.2,
      numerator: 2,
      denominator: 10,
      validGameIds: [1, 2],
      interval: null
    })
    expect(buildVersionTrend(data, request({ metric: 'team:tradeDelaySec' })).points[0].value).toBe(
      -10
    )
    expect(
      buildVersionTrend(data, request({ metric: 'team:objectiveFightWinRate' })).points[0].value
    ).toBeNull()
  })
})

test('excludes every cross-region game-id collision but retains independent reliable observations', () => {
  const collision = game(1, '15.15', { win: true })
  const otherRegionCollision = game(1, '15.16', { win: false })
  const reliable = game(2, '15.17', { win: true })
  const data = input([collision, otherRegionCollision, reliable])
  // Main refuses the ambiguous projections instead of picking either server.
  data.identities = data.identities.filter((identity) => identity.gameId === 2)
  const before = structuredClone(data)
  const result = buildVersionTrend(data, request({ metric: 'player:winRate' }))
  expect(result).toMatchObject({
    selectedGames: 1,
    unresolvedIdentityGames: 2,
    unknownPatchGames: 0
  })
  expect(result.points).toHaveLength(1)
  expect(result.points[0]).toMatchObject({
    bucketKey: '15.17',
    gameIds: [2],
    validGameIds: [2],
    value: 1,
    games: 1
  })
  expect(data).toEqual(before)
  // Even a plausible identity for one colliding row cannot choose its server.
  data.identities.unshift(input([collision]).identities[0])
  expect(buildVersionTrend(data, request({ metric: 'player:winRate' })).points).toEqual(
    result.points
  )
  expect(
    buildVersionTrend({ ...data, games: [collision, otherRegionCollision] }, request())
  ).toMatchObject({ selectedGames: 0, unresolvedIdentityGames: 2, points: [] })
})

test('synthetic stage timings preserve a 5000-game result across identical requests', () => {
  const dataset = input(
    Array.from({ length: 5000 }, (_, index) => game(index + 1, `15.${1 + (index % 24)}`))
  )
  const start = performance.now()
  const copied = structuredClone(dataset)
  const cloneMs = performance.now() - start
  const computeStart = performance.now()
  const first = buildVersionTrend(copied, request())
  const coldComputeMs = performance.now() - computeStart
  const againStart = performance.now()
  const second = buildVersionTrend(copied, request())
  const repeatedComputeMs = performance.now() - againStart
  expect(second).toEqual(first)
  expect(first.selectedGames).toBe(5000)
  process.stdout.write(
    JSON.stringify({
      syntheticStageTimings: {
        games: 5000,
        buckets: first.points.length,
        cloneMs,
        coldComputeMs,
        repeatedComputeMs
      }
    }) + '\n'
  )
})
