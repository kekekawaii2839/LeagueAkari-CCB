import { describe, expect, test } from 'vitest'

import type { ChampionAggregate } from './analytics'
import { buildChampionPools, sortChampionPools } from './champion-pools'

const configured = ['Member 2', 'Member 1', 'Member 3'].map((gameName) => ({
  gameName,
  tagLine: 'TESTONLY',
  serverId: 'TEST'
}))
function row(
  player: string,
  role: ChampionAggregate['role'],
  champion: string,
  games: number,
  wins = 0
): ChampionAggregate {
  return {
    player: player + '#TESTONLY',
    role,
    champion,
    games,
    wins,
    winRate: wins / games,
    pickRate: 0,
    blueGames: games,
    blueWins: wins,
    redGames: 0,
    redWins: 0,
    performance: {} as ChampionAggregate['performance']
  }
}
const observations = [
  row('Member 1', 'TOP', 'Garen', 10, 8),
  row('Member 1', 'TOP', 'Shen', 2, 1),
  row('Member 2', 'TOP', 'Garen', 4, 4),
  row('Member 2', 'JUNGLE', 'Vi', 3, 2),
  row('Member 3', 'TOP', 'Garen', 4, 0),
  row('Member 3', 'JUNGLE', 'Vi', 1, 0),
  row('Member 3', 'JUNGLE', 'LeeSin', 1, 1),
  row('Member 3', 'JUNGLE', 'Graves', 1, 1),
  row('Member 3', 'JUNGLE', 'Viego', 1, 1)
]
describe('champion pool matrix', () => {
  test('uses configured member order, sums role-specific samples and counts all champions', () => {
    const matrix = buildChampionPools(observations, configured)
    expect(matrix.map((m) => m.player)).toEqual([
      'Member 2#TESTONLY',
      'Member 1#TESTONLY',
      'Member 3#TESTONLY'
    ])
    expect(matrix[1].pools.TOP).toMatchObject({ games: 12, heroCount: 2, unidentifiedGames: 0 })
    expect(matrix[2].pools.JUNGLE?.heroCount).toBe(4)
    expect(matrix[2].pools.JUNGLE?.rows.slice(0, 3)).toHaveLength(3)
    expect(matrix[1].pools.TOP?.rows[0]).toMatchObject({ champion: 'Garen', games: 10, wins: 8 })
  })
  test('sorts whole rows by one role, with configured order as the tie-breaker', () => {
    const matrix = buildChampionPools(observations, configured)
    const sorted = sortChampionPools(matrix, {
      role: 'TOP',
      metric: 'games',
      direction: 'descending'
    })
    expect(sorted.map((m) => m.player)).toEqual([
      'Member 1#TESTONLY',
      'Member 2#TESTONLY',
      'Member 3#TESTONLY'
    ])
    expect(sorted[2].pools.JUNGLE?.heroCount).toBe(4)
    expect(matrix.map((m) => m.player)).toEqual([
      'Member 2#TESTONLY',
      'Member 1#TESTONLY',
      'Member 3#TESTONLY'
    ])
    expect(sortChampionPools(matrix, null)).toBe(matrix)
  })
  test('supports both directions and treats no role appearances as a true zero', () => {
    const matrix = buildChampionPools(observations, configured)
    expect(
      sortChampionPools(matrix, { role: 'JUNGLE', metric: 'heroes', direction: 'descending' }).map(
        (m) => m.player
      )
    ).toEqual(['Member 3#TESTONLY', 'Member 2#TESTONLY', 'Member 1#TESTONLY'])
    expect(
      sortChampionPools(matrix, { role: 'JUNGLE', metric: 'games', direction: 'ascending' }).map(
        (m) => m.player
      )
    ).toEqual(['Member 1#TESTONLY', 'Member 2#TESTONLY', 'Member 3#TESTONLY'])
  })
  test('keeps unidentified games in sample denominators, but does not call them another champion', () => {
    const matrix = buildChampionPools(
      [...observations, row('Member 1', 'JUNGLE', '', 30)],
      configured
    )
    expect(matrix[1].pools.JUNGLE).toMatchObject({ games: 30, heroCount: 0, unidentifiedGames: 30 })
    for (const direction of ['ascending', 'descending'] as const) {
      expect(
        sortChampionPools(matrix, { role: 'JUNGLE', metric: 'heroes', direction }).at(-1)?.player
      ).toBe('Member 1#TESTONLY')
    }
  })
  test('does not mutate input rows, discard zero win rates or impose a low-sample cutoff', () => {
    const before = structuredClone(observations)
    const matrix = buildChampionPools(observations, configured)
    expect(matrix[2].pools.JUNGLE?.rows.find((r) => r.champion === 'Vi')).toMatchObject({
      games: 1,
      wins: 0,
      winRate: 0
    })
    expect(observations).toEqual(before)
  })
})
