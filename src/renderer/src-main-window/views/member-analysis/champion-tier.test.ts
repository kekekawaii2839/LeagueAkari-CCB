import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { describe, expect, it } from 'vitest'

import { selectMemberAnalysisSample } from './analytics'
import {
  aggregateChampionBanDetails,
  aggregateChampionMembers,
  aggregateChampionTiers
} from './champion-tier'

function game(
  id: number,
  win = true,
  bans: MemberAnalysisGame['bans'] = { own: [1], enemy: [1, 2] }
) {
  return {
    gameId: id,
    win,
    bans,
    players: [
      { champion: 'Alpha', role: 'TOP' },
      { champion: 'Beta', role: 'MIDDLE' }
    ]
  } as unknown as MemberAnalysisGame
}
const ids: Record<string, number> = { Alpha: 1, Beta: 2 }
const resolve = (name: string) => ids[name] ?? null

describe('local champion tiers', () => {
  function population(wins: number[], role = 'TOP', offset = 0) {
    return wins.flatMap((count, hero) =>
      Array.from({ length: 20 }, (_, index) => ({
        ...game(offset * 20 + hero * 20 + index, index < count, { own: [], enemy: [] }),
        players: [{ champion: `Hero${offset + hero + 1}`, role }]
      }))
    ) as MemberAnalysisGame[]
  }
  const populationId = (name: string) => Number(name.replace('Hero', '')) || null

  it('uses raw win rate and logarithmic pick rate without the old prior or ban weight', () => {
    const data = Array.from({ length: 100 }, (_, index) => ({
      ...game(index, index < 6 || (index >= 10 && index < 54), { own: [], enemy: [] }),
      players: [{ champion: index < 10 ? 'Alpha' : 'Beta', role: 'TOP' }]
    })) as MemberAnalysisGame[]
    const result = aggregateChampionTiers(data, 'TOP', resolve)
    expect(result.baseWinRate).toBe(0.5)
    expect(result.banGames).toBe(100)
    expect(result.rows[0]).toMatchObject({
      champion: 'Alpha',
      key: 'TOP:Alpha',
      role: 'TOP',
      games: 10,
      wins: 6,
      tier: 2
    })
    expect(result.rows[0].score).toBeCloseTo(60 + 1.9 * Math.log(0.1))
    expect(result.rows[0].zScore).toBeCloseTo(1)
    expect(result.rows[1].score).toBeCloseTo(100 * (44 / 90) + 1.9 * Math.log(0.9))
    expect(result.rows[1].tier).toBe(5)
    const banned = data.map((row) => ({ ...row, bans: { own: [1], enemy: [] } }))
    expect(aggregateChampionTiers(banned, 'TOP', resolve).rows.map((row) => row.score)).toEqual(
      result.rows.map((row) => row.score)
    )
  })

  it('leaves zero variation and a sole eligible champion ungraded rather than forcing tiers', () => {
    for (const count of [1, 2, 5, 21]) {
      const data = population(Array(count).fill(10))
      const result = aggregateChampionTiers(data, 'TOP', populationId)
      expect(result.rows).toHaveLength(count)
      expect(
        result.rows.every(
          (row) =>
            row.tier === null &&
            row.zScore === null &&
            row.unratedReason === 'no-variation' &&
            row.score !== null
        )
      ).toBe(true)
      expect(aggregateChampionTiers([...data].reverse(), 'TOP', populationId)).toEqual(result)
    }
  })

  it('promotes only a separated top outlier to OP without forcing any other tier to exist', () => {
    const result = aggregateChampionTiers(population([20, 10, 10, 10, 10]), 'TOP', populationId)
    expect(result.rows[0]).toMatchObject({ champion: 'Hero1', tier: 0, zScore: 2 })
    expect(result.rows.slice(1).map((row) => row.tier)).toEqual([4, 4, 4, 4])
    for (const row of result.rows.slice(1)) expect(row.zScore).toBeCloseTo(-0.5)
    const tiedTop = aggregateChampionTiers(
      population([20, 20, 10, 10, 10, 10, 10]),
      'TOP',
      populationId
    )
    expect(tiedTop.rows[0].tier).toBe(tiedTop.rows[1].tier)
    expect(tiedTop.rows.every((row) => row.tier !== 0)).toBe(true)
  })

  it('preserves same-score ties, population z-scale and deterministic input order', () => {
    const data = population([20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 0])
    const result = aggregateChampionTiers(data, 'TOP', populationId)
    expect(new Set(result.rows.map((row) => row.tier))).toEqual(new Set([1, 2, 3, 4, 5]))
    expect(result.rows.reduce((sum, row) => sum + row.zScore!, 0)).toBeCloseTo(0)
    expect(
      result.rows.reduce((sum, row) => sum + row.zScore! ** 2, 0) / result.rows.length
    ).toBeCloseTo(1)
    expect(aggregateChampionTiers([...data].reverse(), 'TOP', populationId).rows).toEqual(
      result.rows
    )
  })

  it('all roles merges independent role rows, preserving a champion in multiple roles', () => {
    const top = population([20, 10, 10, 10, 10])
    const mid = population([0, 10, 10, 10, 10], 'MIDDLE', 5).map((row) => ({
      ...row,
      players: row.players.map((p) => ({
        ...p,
        champion: `Hero${Number(p.champion.replace('Hero', '')) - 5}`
      }))
    }))
    const data = [...top, ...mid]
    const result = aggregateChampionTiers(data, 'all', populationId)
    expect(result.games).toBe(200)
    expect(result.rows).toHaveLength(10)
    expect(new Set(result.rows.map((row) => row.key)).size).toBe(10)
    expect(result.rows.find((row) => row.key === 'TOP:Hero1')?.tier).toBe(0)
    expect(result.rows.find((row) => row.key === 'MIDDLE:Hero1')?.tier).toBe(5)
    for (const role of ['TOP', 'MIDDLE']) {
      expect(
        result.rows.filter((row) => row.role === role).sort((a, b) => a.key.localeCompare(b.key))
      ).toEqual(
        aggregateChampionTiers(data, role, populationId).rows.sort((a, b) =>
          a.key.localeCompare(b.key)
        )
      )
    }
  })

  it('low sample and unknown identities never change the eligible score population', () => {
    const data = population([20, 10, 10, 10, 10])
    const extra = population([10], 'TOP', 5).slice(0, 4)
    const unknown = population([10], 'TOP', 6)
    const result = aggregateChampionTiers([...data, ...extra, ...unknown], 'TOP', (name) =>
      name === 'Hero7' ? null : populationId(name)
    )
    const baseline = aggregateChampionTiers(data, 'TOP', populationId)
    for (const row of result.rows.filter((row) => row.tier !== null)) {
      const original = baseline.rows.find((candidate) => candidate.champion === row.champion)!
      expect(row.tier).toBe(original.tier)
      expect(row.zScore).toBeCloseTo(original.zScore!)
    }
    expect(result.rows.find((row) => row.champion === 'Hero6')).toMatchObject({
      score: null,
      tier: null,
      unratedReason: 'low-sample'
    })
    expect(result.rows.find((row) => row.champion === 'Hero7')).toMatchObject({
      banRate: null,
      score: null,
      tier: null,
      unratedReason: 'unknown-champion'
    })
  })

  it('filters the patch before the recent window and recomputes scores, bans and eligibility', () => {
    const old = population([20, 16, 12, 8, 4]).map((row, index) => ({
      ...row,
      patch: '16.20',
      timestamp: 1000 + (index % 20) * 5 + Math.floor(index / 20),
      duration: 1800,
      date: '2026-10-01'
    }))
    const latest = population([20, 10, 10], 'TOP', 100).map((row, index) => ({
      ...row,
      patch: '16.21',
      timestamp: 2000 + index,
      duration: 1800,
      date: '2026-10-20',
      bans: { own: [1], enemy: [] }
    }))
    const filters = {
      patch: '16.20',
      outcome: 'all' as const,
      participant: 'all',
      matchRole: 'all' as const,
      champion: 'all',
      query: '',
      dateFrom: '',
      dateTo: '',
      durationMin: null,
      durationMax: null
    }
    const selected = selectMemberAnalysisSample([...old, ...latest], filters, 'all', 50).sample
    expect(selected).toHaveLength(50)
    expect(selected.every((row) => row.patch === '16.20')).toBe(true)
    const result = aggregateChampionTiers(selected, 'TOP', populationId)
    expect(result.games).toBe(50)
    expect(result.rows).toHaveLength(5)
    expect(result.rows.every((row) => row.games === 10 && row.banRate === 0)).toBe(true)
    expect(aggregateChampionBanDetails(selected, 1, 'TOP')[2]).toMatchObject({
      games: 0,
      validGames: 50,
      scopeGames: 50
    })
    const empty = selectMemberAnalysisSample(
      [...old, ...latest],
      { ...filters, patch: '16.19' },
      'all',
      50
    ).sample
    expect(aggregateChampionTiers(empty, 'all', populationId).rows).toEqual([])
  })

  it('sorts valid negative scores before unavailable rows', () => {
    const data = population([0, 0, 1])
    const low = population([20], 'TOP', 3).slice(0, 4)
    const rows = aggregateChampionTiers([...data, ...low], 'TOP', populationId).rows
    expect(rows.slice(0, 3).every((row) => row.score !== null)).toBe(true)
    expect(rows.some((row) => row.score !== null && row.score < 0)).toBe(true)
    expect(rows.at(-1)).toMatchObject({ champion: 'Hero4', score: null })
  })

  it('keeps ban sides and partial denominators distinct, deduplicates mirrored bans, and never fabricates unknown IDs', () => {
    const first = game(1, true, { own: [1, 1], enemy: [1] })
    const partial = game(2, false, { own: [], enemy: null })
    const unrelated = {
      ...game(3),
      players: [{ champion: 'Beta', role: 'MIDDLE' }]
    } as MemberAnalysisGame
    expect(aggregateChampionBanDetails([first, first, partial, unrelated], 1, 'TOP')).toEqual([
      { side: 'own', games: 1, validGames: 2, scopeGames: 2, rate: 0.5 },
      { side: 'enemy', games: 1, validGames: 1, scopeGames: 2, rate: 1 },
      { side: 'both', games: 1, validGames: 1, scopeGames: 2, rate: 1 }
    ])
    expect(aggregateChampionBanDetails([partial], 1, 'TOP')).toEqual([
      { side: 'own', games: 0, validGames: 1, scopeGames: 1, rate: 0 },
      { side: 'enemy', games: null, validGames: 0, scopeGames: 1, rate: null },
      { side: 'both', games: null, validGames: 0, scopeGames: 1, rate: null }
    ])
    expect(
      aggregateChampionBanDetails([first], null, 'TOP').every(
        (row) => row.games === null && row.rate === null
      )
    ).toBe(true)
  })
  it('counts champion appearances per member, deduplicates matches/players, filters roles, and follows configured order', () => {
    const first = {
      ...game(1),
      players: [
        { player: 'A#TESTONLY', champion: 'Alpha', role: 'TOP' },
        { player: 'A#TESTONLY', champion: 'Alpha', role: 'TOP' },
        { player: 'B#TESTONLY', champion: 'Alpha', role: 'MIDDLE' }
      ]
    } as MemberAnalysisGame
    const second = {
      ...game(2, false),
      players: [
        { player: 'A#TESTONLY', champion: 'Alpha', role: 'MIDDLE' },
        { player: 'B#TESTONLY', champion: 'Beta', role: 'TOP' }
      ]
    } as MemberAnalysisGame
    expect(
      aggregateChampionMembers([first, first, second], 'Alpha', 'all', [
        { gameName: 'B', tagLine: 'TESTONLY' },
        { gameName: 'A', tagLine: 'TESTONLY' }
      ])
    ).toEqual([
      { player: 'B#TESTONLY', games: 1, wins: 1, losses: 0, winRate: 1 },
      { player: 'A#TESTONLY', games: 2, wins: 1, losses: 1, winRate: 0.5 }
    ])
    expect(aggregateChampionMembers([first, second], 'Alpha', 'TOP')).toEqual([
      { player: 'A#TESTONLY', games: 1, wins: 1, losses: 0, winRate: 1 }
    ])
    expect(aggregateChampionMembers([first, second], 'Missing', 'all')).toEqual([])
    expect(aggregateChampionMembers([game(3)], 'Alpha', 'all')).toEqual([])
  })
  it('uses own-team incidence, deduplicates input and mirrored bans, and keeps exact raw rates', () => {
    const result = aggregateChampionTiers([game(1), game(1), game(2, false)], 'all', resolve)
    expect(result.games).toBe(2)
    expect(result.banGames).toBe(2)
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0]).toMatchObject({
      games: 2,
      wins: 1,
      winRate: 0.5,
      pickRate: 1,
      bannedGames: 2,
      banRate: 1,
      tier: null
    })
    expect(result.rows.reduce((sum, row) => sum + row.pickRate, 0)).toBe(2)
  })
  it('restricts champion picks by role without pretending bans have a role', () => {
    const result = aggregateChampionTiers([game(1), game(2)], 'TOP', resolve)
    expect(result.rows.map((row) => row.champion)).toEqual(['Alpha'])
    expect(result.rows[0].banRate).toBe(1)
    expect(aggregateChampionTiers([game(1)], 'JUNGLE', resolve).rows).toEqual([])
  })
  it('does not fabricate zero bans or a tier for unknown IDs or missing ban records', () => {
    const result = aggregateChampionTiers(
      Array.from({ length: 10 }, (_, index) => game(index, true, undefined)),
      'TOP',
      () => null
    )
    expect(result.rows[0]).toMatchObject({
      banRate: null,
      bannedGames: null,
      tier: null,
      score: null
    })
    const missing = game(20)
    delete missing.bans
    expect(aggregateChampionTiers([missing], 'all', resolve).banGames).toBe(0)
    const missingData = Array.from({ length: 6 }, (_, index) => {
      const row = game(index)
      delete row.bans
      return row
    })
    expect(aggregateChampionTiers(missingData, 'TOP', resolve).rows[0]).toMatchObject({
      games: 6,
      championId: 1,
      banRate: null,
      tier: null,
      score: null
    })
    expect(aggregateChampionTiers([], 'all', resolve)).toMatchObject({
      rows: [],
      games: 0,
      baseWinRate: 0
    })
  })
  it('keeps minimum samples and does not invent a tier without score variation', () => {
    const data = Array.from({ length: 10 }, (_, index) =>
      game(index, index < 6, { own: [], enemy: [] })
    )
    const result = aggregateChampionTiers(data, 'TOP', resolve)
    expect(result.rows[0]).toMatchObject({
      winRate: 0.6,
      pickRate: 1,
      banRate: 0,
      score: 60,
      tier: null,
      unratedReason: 'no-variation'
    })
    expect(aggregateChampionTiers(data.slice(0, 4), 'TOP', resolve).rows[0].tier).toBeNull()
  })
})
