import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { describe, expect, test } from 'vitest'

import { matchListPageForGame, resolveMatchListPage, resolveMatchListScope } from './match-list'

const games = Array.from({ length: 500 }, (_, i) => ({ gameId: i + 1 })) as MemberAnalysisGame[]
const scope = {
  sequence: 1,
  publishedGeneration: 2,
  source: 'Synthetic',
  gameIds: [1, 26, 500],
  status: 'active' as const
}

describe('bounded match rendering preserves exact dataset semantics', () => {
  test('uses only the requested IDs intersected with the current sample, never broadening it', () => {
    expect(resolveMatchListScope(games, scope, 2).games.map((g) => g.gameId)).toEqual([1, 26, 500])
    const narrowed = resolveMatchListScope(games.slice(0, 100), scope, 2)
    expect(narrowed.games.map((g) => g.gameId)).toEqual([1, 26])
    expect(narrowed.requested).toBe(3)
    expect(resolveMatchListScope(games, null, 2).games).toBe(games)
  })
  test('does not reuse old IDs as support for a new generation', () => {
    expect(resolveMatchListScope(games, scope, 3)).toMatchObject({
      games: [],
      expired: true,
      requested: 3
    })
    expect(resolveMatchListScope(games, { ...scope, status: 'expired' }, 2).games).toHaveLength(0)
  })
  test('bounds pages and finds boundary/last targets without truncating the sample', () => {
    expect(resolveMatchListPage(500, 1)).toEqual({ page: 1, pageCount: 20, start: 0, end: 25 })
    expect(resolveMatchListPage(500, 99)).toEqual({ page: 20, pageCount: 20, start: 475, end: 500 })
    expect(resolveMatchListPage(0, 99)).toEqual({ page: 1, pageCount: 1, start: 0, end: 0 })
    expect(matchListPageForGame(games, games[0])).toBe(1)
    expect(matchListPageForGame(games, games[25])).toBe(2)
    expect(matchListPageForGame(games, games[499])).toBe(20)
    expect(matchListPageForGame(games, { gameId: 500 } as MemberAnalysisGame)).toBeNull()
  })
})
