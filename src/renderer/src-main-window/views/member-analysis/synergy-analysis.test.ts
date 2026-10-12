import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { describe, expect, test } from 'vitest'

import { aggregateSynergy } from './analytics'
import {
  formatSynergyDifference,
  memberAppearances,
  presentSynergy,
  sharedHeroStats,
  sortSynergy,
  synergyDifferenceDomain
} from './synergy-analysis'

const game = (id: number, names: string[], win: boolean, side = 'Blue'): MemberAnalysisGame =>
  ({
    gameId: id,
    timestamp: id * 1000,
    date: '2026-01-' + String(id).padStart(2, '0'),
    win,
    side,
    players: names.map((player, i) => ({
      player,
      role: i === 0 ? 'TOP' : 'JUNGLE',
      champion: 'Garen'
    }))
  }) as MemberAnalysisGame
const fixture = () => [
  game(1, ['Member 1', 'Member 2'], true),
  game(2, ['Member 1', 'Member 2'], false, 'Red'),
  game(3, ['Member 1', 'Member 3'], true),
  game(4, ['Member 2', 'Member 3'], false)
]

describe('same-team evidence uses the existing sampled population', () => {
  test('baseline source includes joint games and counts an identity once per game', () => {
    const games = fixture()
    games[0].players.push({ ...games[0].players[0] })
    const appearances = memberAppearances(games)
    expect(appearances).toEqual([
      { player: 'Member 1', games: 3, wins: 2, winRate: 2 / 3 },
      { player: 'Member 2', games: 3, wins: 1, winRate: 1 / 3 },
      { player: 'Member 3', games: 2, wins: 1, winRate: 0.5 }
    ])
    const pair = aggregateSynergy(games).find(
      (e) => e.playerA === 'Member 1' && e.playerB === 'Member 2'
    )!
    expect(pair.baseline).toBe((appearances[0].winRate + appearances[1].winRate) / 2)
    expect(appearances[0].games - pair.games).toBe(1)
  })
  test('presentation preserves scores and supports side coverage, exact intervals and recent evidence', () => {
    const edges = aggregateSynergy(fixture()),
      rows = presentSynergy(edges),
      pair = rows.find((e) => e.playerA === 'Member 1' && e.playerB === 'Member 2')!
    for (let i = 0; i < edges.length; i++) expect(rows[i]).toMatchObject(edges[i])
    expect(pair.blue).toEqual({ games: 1, wins: 1 })
    expect(pair.red).toEqual({ games: 1, wins: 0 })
    expect(pair.commonRoles).toEqual({ roleA: 'TOP', roleB: 'JUNGLE', games: 2 })
    expect(pair.recentGames.map((g) => g.gameId)).toEqual([2, 1])
    expect([pair.dateFrom, pair.dateTo]).toEqual(['2026-01-01', '2026-01-02'])
    expect(pair.interval!.low).toBeLessThan(pair.winRate)
    expect(pair.interval!.high).toBeGreaterThan(pair.winRate)
    expect(pair.adjustedDifference).toBe(0)
  })
  test('sorting is explicit, stable for ties, non-mutating, and every pair shares the same domain', () => {
    const edges = aggregateSynergy(fixture()),
      original = edges.map((e) => e.key)
    expect(sortSynergy(edges, 'sample')[0].games).toBe(2)
    expect(sortSynergy(edges, 'deviation').map((e) => Math.abs(e.adjustedDifference))).toEqual(
      [...edges.map((e) => Math.abs(e.adjustedDifference))].sort((a, b) => b - a)
    )
    expect(edges.map((e) => e.key)).toEqual(original)
    expect(sortSynergy([edges[0], edges[0]], 'sample')).toEqual([edges[0], edges[0]])
    const extreme = { ...edges[0], adjustedDifference: -0.27 }
    expect(synergyDifferenceDomain([...edges, extreme])).toBeCloseTo(0.3)
    expect(formatSynergyDifference(1e-16)).toBe('0.0')
    expect(formatSynergyDifference(-1e-16)).toBe('0.0')
    expect(formatSynergyDifference(-0.125)).toBe('−12.5')
    expect(formatSynergyDifference(Number.NaN)).toBe('—')
  })
  test('empty and single-match populations do not invent sample or missing role evidence', () => {
    expect(memberAppearances([])).toEqual([])
    expect(presentSynergy([])).toEqual([])
    const [row] = presentSynergy(aggregateSynergy([game(1, ['Member 1', 'Member 2'], false)]))
    expect(row.games).toBe(1)
    expect(row.wins).toBe(0)
    expect(row.winRate).toBe(0)
    expect(row.red).toEqual({ games: 0, wins: 0 })
    expect(row.interval!.low).toBe(0)
    const empty = presentSynergy([{ ...row, gamesList: [] }])[0]
    expect(empty.commonRoles).toBeNull()
    expect(empty.dateFrom).toBeNull()
  })
})

describe('selected-pair hero usage', () => {
  const heroGame = (id: number, a: string | null, b: string | null, win: boolean) => {
    const g = game(id, ['Member 1', 'Member 2'], win)
    g.players[0].champion = a as string
    g.players[1].champion = b as string
    return g
  }
  const pair = (games: MemberAnalysisGame[]) =>
    aggregateSynergy(games).find((e) => e.playerA === 'Member 1' && e.playerB === 'Member 2')!
  test('counts each member and each oriented hero pair only in shared games', () => {
    const gs = [
      heroGame(1, 'Garen', 'Ahri', true),
      heroGame(2, 'Shen', 'Ahri', false),
      heroGame(3, 'Garen', 'Lux', false),
      game(4, ['Member 1', 'Member 3'], true)
    ]
    gs[3].players[0].champion = 'Ornn'
    const stats = sharedHeroStats(pair(gs))
    expect(stats.total).toBe(3)
    expect(stats.members.map((m) => m.available)).toEqual([3, 3])
    expect(stats.pairsAvailable).toBe(3)
    expect(
      stats.members[0].rows.map((r) => [r.champion, r.games, r.wins, r.share, r.winRate])
    ).toEqual([
      ['Garen', 2, 1, 2 / 3, 0.5],
      ['Shen', 1, 0, 1 / 3, 0]
    ])
    expect(stats.members[1].rows.map((r) => [r.champion, r.games, r.wins])).toEqual([
      ['Ahri', 2, 1],
      ['Lux', 1, 0]
    ])
    expect(stats.pairs.map((r) => [r.championA, r.championB, r.games, r.wins])).toEqual([
      ['Garen', 'Ahri', 1, 1],
      ['Shen', 'Ahri', 1, 0],
      ['Garen', 'Lux', 1, 0]
    ])
    expect(stats.members[0].rows.some((r) => r.champion === 'Ornn')).toBe(false)
    expect(stats.pairs.reduce((n, r) => n + r.games, 0)).toBe(3)
    expect(stats.pairs.every((r) => r.interval !== null)).toBe(true)
  })
  test('missing heroes keep an explicit bucket and full denominator instead of false named selections', () => {
    const stats = sharedHeroStats(
      pair([
        heroGame(1, 'Garen', 'Ahri', true),
        heroGame(2, null, 'Ahri', false),
        heroGame(3, 'Garen', '', false)
      ])
    )
    expect(stats.members.map((m) => m.available)).toEqual([2, 2])
    expect(stats.pairsAvailable).toBe(1)
    expect(stats.members[0].rows.find((r) => r.champion === null)?.games).toBe(1)
    expect(stats.members[0].rows.find((r) => r.champion === 'Garen')?.share).toBe(2 / 3)
    expect(stats.pairs.some((r) => r.championA === null)).toBe(true)
    expect(stats.pairs.some((r) => r.championB === null)).toBe(true)
    expect(stats.pairs.reduce((n, r) => n + r.share, 0)).toBeCloseTo(1)
  })
  test('reversed player-hero assignments remain distinct and zero wins remain numeric', () => {
    const stats = sharedHeroStats(
      pair([heroGame(1, 'Garen', 'Ahri', false), heroGame(2, 'Ahri', 'Garen', true)])
    )
    expect(stats.pairs).toHaveLength(2)
    expect(new Set(stats.pairs.map((r) => r.key)).size).toBe(2)
    expect(stats.pairs[0].winRate).toBe(0)
    expect(stats.pairs[1].winRate).toBe(1)
    expect(
      sharedHeroStats({
        ...pair([heroGame(1, 'Garen', 'Ahri', true)]),
        games: 0,
        gamesList: []
      }).members.every((m) => m.rows.length === 0)
    ).toBe(true)
  })
})
