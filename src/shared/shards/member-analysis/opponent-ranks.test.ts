import { describe, expect, test } from 'vitest'

import {
  type OpponentRanks,
  OpponentRanksSchema,
  normalizeRankedStats,
  opponentRankAverage,
  rankOrder,
  unavailableRank
} from './opponent-ranks'

const time = '2026-10-07T12:00:00.000Z'
function syntheticOpponentRanks(): OpponentRanks {
  return {
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
            {
              queueType: 'RANKED_SOLO_5x5',
              tier: 'GOLD',
              rank: ['IV', 'III', 'II', 'I', 'I'][i],
              leaguePoints: 0
            },
            { queueType: 'RANKED_FLEX_SR', tier: 'NONE' }
          ]
        },
        time
      )
    }))
  }
}
describe('current opponent rank contract', () => {
  test('keeps queues, zero LP, missing LP, unranked and provisional distinct', () => {
    const value = syntheticOpponentRanks()
    expect(value.opponents[0].snapshot.solo).toEqual({
      status: 'ranked',
      rank: { tier: 'GOLD', division: 'IV', leaguePoints: 0 }
    })
    expect(value.opponents[0].snapshot.flex.status).toBe('unranked')
    const other = normalizeRankedStats(
      {
        queues: [
          { queueType: 'RANKED_FLEX_SR', tier: 'MASTER', rank: 'I' },
          { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II', provisionalGamesRemaining: 1 }
        ]
      },
      time
    )
    expect(other.flex).toEqual({
      status: 'ranked',
      rank: { tier: 'MASTER', division: null, leaguePoints: null }
    })
    expect(other.solo.status).toBe('provisional')
  })
  test('never fills absent current rank with highest or previous-season rank', () => {
    const partial = normalizeRankedStats(
      {
        queues: [
          { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 'invalid' },
          { queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'III', leaguePoints: 0 }
        ]
      },
      time
    )
    expect(partial.solo.status).toBe('missing')
    expect(partial.flex.status).toBe('ranked')
    expect(
      normalizeRankedStats(
        { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I', leaguePoints: -3 }] },
        time
      ).flex
    ).toMatchObject({ status: 'ranked', rank: { leaguePoints: -3 } })
    const result = normalizeRankedStats(
      {
        queues: [
          {
            queueType: 'RANKED_SOLO_5x5',
            highestTier: 'CHALLENGER',
            previousSeasonEndTier: 'MASTER'
          }
        ],
        highestPreviousSeasonEndTier: 'CHALLENGER'
      },
      time
    )
    expect(result.solo.status).toBe('missing')
    expect(result.flex.status).toBe('missing')
    expect(normalizeRankedStats({}, time)).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-response',
      fetchedAt: null
    })
    expect(
      normalizeRankedStats(
        { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'FUTURE', rank: 'I' }] },
        time
      ).flex.status
    ).toBe('missing')
  })
  test('ambiguous queues and invalid divisions stay missing; team mean uses available ranked opponents', () => {
    const queues = [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I' }]
    expect(normalizeRankedStats({ queues: [...queues, ...queues] }, time).flex.status).toBe(
      'missing'
    )
    expect(normalizeRankedStats({ queues: [{ ...queues[0], rank: 'V' }] }, time).flex.status).toBe(
      'missing'
    )
    const ranks = syntheticOpponentRanks()
    expect(opponentRankAverage(ranks, 'solo')).toEqual({
      score: 13.8,
      count: 5,
      rank: { tier: 'GOLD', division: 'II', leaguePoints: null }
    })
    expect(opponentRankAverage(ranks, 'flex')).toBeNull()
    ranks.opponents[0].snapshot = {
      ...ranks.opponents[0].snapshot,
      status: 'stale',
      reason: 'network-error'
    }
    expect(opponentRankAverage(ranks, 'solo')).toMatchObject({ score: 14.25, count: 4 })
    expect(rankOrder({ tier: 'EMERALD', division: 'IV', leaguePoints: 0 })).toBeGreaterThan(
      rankOrder({ tier: 'PLATINUM', division: 'I', leaguePoints: 100 })
    )
  })
  test('averages divisions, preserves fractional means and handles top tiers', () => {
    const ranks = syntheticOpponentRanks()
    for (const opponent of ranks.opponents)
      opponent.snapshot.solo = { status: 'unranked', rank: null }
    const set = (
      i: number,
      tier: 'SILVER' | 'GOLD' | 'MASTER' | 'CHALLENGER',
      division: 'IV' | 'I' | null
    ) => {
      ranks.opponents[i].snapshot.solo = {
        status: 'ranked',
        rank: { tier, division, leaguePoints: 99 }
      }
    }
    expect(opponentRankAverage(undefined, 'solo')).toBeNull()
    expect(opponentRankAverage(ranks, 'solo')).toBeNull()
    set(0, 'SILVER', 'IV')
    expect(opponentRankAverage(ranks, 'solo')).toMatchObject({ score: 8, count: 1 })
    set(1, 'GOLD', 'IV')
    expect(opponentRankAverage(ranks, 'solo')).toEqual({
      score: 10,
      count: 2,
      rank: { tier: 'SILVER', division: 'II', leaguePoints: null }
    })
    set(0, 'SILVER', 'I')
    expect(opponentRankAverage(ranks, 'solo')).toMatchObject({
      score: 11.5,
      rank: { tier: 'GOLD', division: 'IV' }
    })
    set(0, 'MASTER', null)
    set(1, 'CHALLENGER', null)
    expect(opponentRankAverage(ranks, 'solo')).toMatchObject({
      score: 29,
      rank: { tier: 'GRANDMASTER', division: null }
    })
    set(0, 'CHALLENGER', null)
    expect(opponentRankAverage(ranks, 'solo')).toMatchObject({
      score: 30,
      rank: { tier: 'CHALLENGER', division: null }
    })
    ranks.opponents[0].snapshot.solo = { status: 'provisional', rank: null }
    ranks.opponents[1].snapshot = unavailableRank('network-error', time)
    expect(opponentRankAverage(ranks, 'solo')).toBeNull()
  })
  test('validates five distinct anonymous slots and failure provenance', () => {
    const ranks = syntheticOpponentRanks()
    expect(OpponentRanksSchema.safeParse(ranks).success).toBe(true)
    ranks.opponents[0].slot = 2
    expect(OpponentRanksSchema.safeParse(ranks).success).toBe(false)
    expect(unavailableRank('cross-region', time)).toMatchObject({
      status: 'unavailable',
      reason: 'cross-region',
      fetchedAt: null
    })
  })
})
