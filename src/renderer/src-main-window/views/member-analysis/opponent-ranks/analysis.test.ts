// sort-imports-ignore
import '../test-i18n'

import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  type OpponentRanks,
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { describe, expect, test } from 'vitest'

import { summarizeOpponentRanks } from './analysis'
import { queueRankText } from './format'

function game(win: boolean, tier = 'GOLD'): MemberAnalysisGame {
  const ranks: OpponentRanks = {
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
            { queueType: 'RANKED_FLEX_SR', tier, rank: 'IV', leaguePoints: 0 },
            { queueType: 'RANKED_SOLO_5x5', tier: 'NONE' }
          ]
        },
        '2026-10-07T12:00:00.000Z'
      )
    }))
  }
  return { win, duration: 1800, opponentRanks: ranks } as MemberAnalysisGame
}
describe('opponent rank descriptive grouping', () => {
  test('network-protection skips are not counted as attempted query failures', () => {
    const value = game(true)
    value.opponentRanks!.opponents[0].snapshot = unavailableRank(
      'network-error',
      '2026-10-07T13:00:00.000Z'
    )
    value.opponentRanks!.opponents[1].snapshot = unavailableRank(
      'network-paused',
      '2026-10-07T13:00:00.000Z'
    )
    expect(summarizeOpponentRanks([value], 'flex')).toMatchObject({
      ranked: 3,
      missing: 1,
      paused: 1,
      ratedGames: 1,
      partialGames: 1
    })
    expect(queueRankText(value.opponentRanks!.opponents[1].snapshot, 'flex')).toBe('未获取')
  })
  test('excludes short games while retaining the exact 15-minute boundary', () => {
    const short = { ...game(true), duration: 899 }
    const boundary = { ...game(false), duration: 900 }
    expect(summarizeOpponentRanks([short, boundary], 'flex')).toMatchObject({
      totalGames: 1,
      ratedGames: 1,
      ranked: 5
    })
  })
  test('counts appearances separately from averaged team matches; never merges queues', () => {
    const stats = summarizeOpponentRanks([game(true), game(false), game(true, 'SILVER')], 'flex')
    expect(stats.ranked).toBe(15)
    expect(stats.ratedGames).toBe(3)
    expect(stats.rows.find((row) => row.tier === 'GOLD')).toMatchObject({
      appearances: 10,
      games: 2,
      wins: 1,
      winRate: 0.5
    })
    expect(stats.rows.find((row) => row.tier === 'GOLD')!.interval!.low).toBeCloseTo(0.0945, 3)
    const solo = summarizeOpponentRanks([game(true)], 'solo')
    expect(solo.unranked).toBe(5)
    expect(solo.ratedGames).toBe(0)
    expect(solo.rows.every((row) => row.winRate === null && row.interval === null)).toBe(true)
  })
  test('bins once by rounded average tier, not individual ranks', () => {
    const value = game(true, 'SILVER')
    const opponents = value.opponentRanks!.opponents
    opponents[0].snapshot.flex = {
      status: 'ranked',
      rank: { tier: 'GOLD', division: 'IV', leaguePoints: null }
    }
    for (let i = 2; i < 5; i++) opponents[i].snapshot.flex = { status: 'unranked', rank: null }
    let stats = summarizeOpponentRanks([value], 'flex')
    expect(stats).toMatchObject({ ranked: 2, unranked: 3, ratedGames: 1, partialGames: 1 })
    expect(stats.rows.find((row) => row.tier === 'SILVER')).toMatchObject({ games: 1, wins: 1 })
    expect(stats.rows.find((row) => row.tier === 'GOLD')).toMatchObject({
      appearances: 1,
      games: 0
    })
    opponents[1].snapshot.flex = {
      status: 'ranked',
      rank: { tier: 'SILVER', division: 'I', leaguePoints: 0 }
    }
    stats = summarizeOpponentRanks([value], 'flex')
    expect(stats.rows.find((row) => row.tier === 'GOLD')).toMatchObject({ games: 1, wins: 1 })
  })
  test('partially missing, stale, provisional and legacy snapshots remain explicit and excluded individually from averages', () => {
    const partial = game(true),
      stale = game(false),
      provisional = game(true),
      legacy = game(false)
    partial.opponentRanks!.opponents[0].snapshot = unavailableRank(
      'rate-limited',
      '2026-10-07T13:00:00.000Z'
    )
    stale.opponentRanks!.opponents[0].snapshot.status = 'stale'
    stale.opponentRanks!.opponents[0].snapshot.reason = 'network-error'
    provisional.opponentRanks!.opponents[0].snapshot.flex = { status: 'provisional', rank: null }
    delete legacy.opponentRanks
    const stats = summarizeOpponentRanks([partial, stale, provisional, legacy], 'flex')
    expect(stats).toMatchObject({
      ranked: 12,
      missing: 1,
      stale: 1,
      provisional: 1,
      notLoaded: 5,
      ratedGames: 3,
      partialGames: 3,
      appearances: 20
    })
    expect(
      stats.ranked +
        stats.missing +
        stats.stale +
        stats.provisional +
        stats.unranked +
        stats.notLoaded
    ).toBe(20)
    expect(queueRankText(stale.opponentRanks!.opponents[0].snapshot, 'flex')).toContain('旧快照')
    expect(queueRankText(game(true).opponentRanks!.opponents[0].snapshot, 'flex')).toContain('0 LP')
  })
})
