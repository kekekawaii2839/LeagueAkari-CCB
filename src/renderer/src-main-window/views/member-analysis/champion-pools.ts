import type { MemberAnalysisSettings } from '@shared/shards/member-analysis'

import type { ChampionAggregate } from './analytics'
import { memberOrder } from './visualization'

export const championPoolRoles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
export type ChampionPoolRole = (typeof championPoolRoles)[number]
export type ChampionPoolSort = {
  role: ChampionPoolRole
  metric: 'games' | 'heroes'
  direction: 'ascending' | 'descending'
}
export type ChampionPool = {
  key: string
  player: string
  role: ChampionPoolRole
  games: number
  heroCount: number
  unidentifiedGames: number
  rows: ChampionAggregate[]
}
export type ChampionPoolMember = {
  player: string
  pools: Partial<Record<ChampionPoolRole, ChampionPool>>
}

export function isIdentifiedChampion(name: string) {
  return !['', '-1', 'unknown', '未知', '未知英雄'].includes(name.trim().toLowerCase())
}

export function buildChampionPools(
  rows: ChampionAggregate[],
  members: MemberAnalysisSettings['members']
): ChampionPoolMember[] {
  const players = new Map<string, ChampionPoolMember>()
  for (const row of rows) {
    if (!championPoolRoles.includes(row.role as ChampionPoolRole)) continue
    const role = row.role as ChampionPoolRole
    const member: ChampionPoolMember = players.get(row.player) ?? { player: row.player, pools: {} }
    const pool: ChampionPool = member.pools[role] ?? {
      key: `${row.player}|${role}`,
      player: row.player,
      role,
      games: 0,
      heroCount: 0,
      unidentifiedGames: 0,
      rows: []
    }
    pool.rows.push(row)
    pool.games += row.games
    if (!isIdentifiedChampion(row.champion)) pool.unidentifiedGames += row.games
    member.pools[role] = pool
    players.set(row.player, member)
  }
  for (const member of players.values()) {
    for (const pool of Object.values(member.pools)) {
      pool.rows.sort(
        (a, b) => b.games - a.games || b.winRate - a.winRate || a.champion.localeCompare(b.champion)
      )
      pool.heroCount = new Set(
        pool.rows.filter((r) => isIdentifiedChampion(r.champion)).map((r) => r.champion)
      ).size
    }
  }
  const order = memberOrder([...players.keys()], members)
  return order.map((player) => players.get(player)!)
}

export function sortChampionPools(members: ChampionPoolMember[], sort: ChampionPoolSort | null) {
  if (!sort) return members
  const indexed = members.map((member, index) => ({ member, index }))
  const value = (member: ChampionPoolMember) => {
    const pool = member.pools[sort.role]
    // No appearances is a real zero. An incomplete identity count is not a complete pool size.
    if (sort.metric === 'heroes' && pool?.unidentifiedGames) return null
    return sort.metric === 'games' ? (pool?.games ?? 0) : (pool?.heroCount ?? 0)
  }
  indexed.sort((a, b) => {
    const av = value(a.member),
      bv = value(b.member)
    if (av === null || bv === null) {
      if (av === null && bv !== null) return 1
      if (bv === null && av !== null) return -1
      return a.index - b.index
    }
    return (sort.direction === 'descending' ? bv - av : av - bv) || a.index - b.index
  })
  return indexed.map(({ member }) => member)
}
