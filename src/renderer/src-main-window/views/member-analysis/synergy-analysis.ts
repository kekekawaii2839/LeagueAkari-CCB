import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'

import type { SynergyAggregate } from './analytics'
import { formatSigned, wilsonInterval } from './visualization'

export type SynergySort = 'sample' | 'deviation'
export type MemberAppearance = { player: string; games: number; wins: number; winRate: number }
export type SynergyPresentation = SynergyAggregate & {
  interval: ReturnType<typeof wilsonInterval>
  commonRoles: {
    roleA: MemberAnalysisPlayerGame['role']
    roleB: MemberAnalysisPlayerGame['role']
    games: number
  } | null
  blue: { games: number; wins: number }
  red: { games: number; wins: number }
  dateFrom: string | null
  dateTo: string | null
  recentGames: MemberAnalysisGame[]
}

// Same sampled population and per-match distinct identities as aggregateSynergy.
export function memberAppearances(games: MemberAnalysisGame[]): MemberAppearance[] {
  const counts = new Map<string, { games: number; wins: number }>()
  for (const game of games) {
    for (const player of new Set(game.players.map((p) => p.player))) {
      const count = counts.get(player) ?? { games: 0, wins: 0 }
      count.games++
      count.wins += Number(game.win)
      counts.set(player, count)
    }
  }
  return [...counts].map(([player, count]) => ({
    player,
    ...count,
    winRate: count.wins / count.games
  }))
}

export function presentSynergy(edges: SynergyAggregate[]): SynergyPresentation[] {
  return edges.map((edge) => {
    const roles = new Map<string, NonNullable<SynergyPresentation['commonRoles']>>()
    const blue = { games: 0, wins: 0 },
      red = { games: 0, wins: 0 }
    const dates: string[] = []
    for (const game of edge.gamesList) {
      const a = game.players.find((p) => p.player === edge.playerA)
      const b = game.players.find((p) => p.player === edge.playerB)
      if (a && b) {
        const key = a.role + '|' + b.role
        const count = roles.get(key) ?? { roleA: a.role, roleB: b.role, games: 0 }
        count.games++
        roles.set(key, count)
      }
      const side = game.side === 'Blue' ? blue : red
      side.games++
      side.wins += Number(game.win)
      if (game.date) dates.push(game.date)
    }
    dates.sort()
    return {
      ...edge,
      interval: wilsonInterval(edge.wins, edge.games),
      commonRoles: [...roles.values()].sort((a, b) => b.games - a.games)[0] ?? null,
      blue,
      red,
      dateFrom: dates[0] ?? null,
      dateTo: dates.at(-1) ?? null,
      recentGames: [...edge.gamesList].sort(
        (a, b) => b.timestamp - a.timestamp || b.gameId - a.gameId
      )
    }
  })
}

export function sortSynergy<T extends SynergyAggregate>(edges: T[], sort: SynergySort): T[] {
  return [...edges].sort((a, b) =>
    sort === 'sample'
      ? b.games - a.games
      : Math.abs(b.adjustedDifference) - Math.abs(a.adjustedDifference)
  )
}

// A shared zero-centred domain; focus does not rescale the remaining rows.
export function synergyDifferenceDomain(edges: SynergyAggregate[]): number {
  const maximum = Math.max(
    0,
    ...edges.map((e) => Math.abs(e.adjustedDifference)).filter(Number.isFinite)
  )
  return Math.max(0.1, Math.ceil(maximum / 0.05) * 0.05)
}

// Suppress a signed zero after display rounding, without changing the underlying score.
export function formatSynergyDifference(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return Math.round(Math.abs(value) * 1000) === 0 ? '0.0' : formatSigned(value * 100, 1)
}

export type SharedHeroRow = {
  roles: { role: string | null; games: number }[]
  champion: string | null
  games: number
  wins: number
  share: number
  winRate: number
  interval: ReturnType<typeof wilsonInterval>
}
export type SharedHeroPairRow = Omit<SharedHeroRow, 'champion' | 'roles'> & {
  rolePairs: { roleA: string | null; roleB: string | null; games: number }[]
  key: string
  championA: string | null
  championB: string | null
}
export type SharedHeroStats = {
  total: number
  members: { player: string; available: number; rows: SharedHeroRow[] }[]
  pairsAvailable: number
  pairs: SharedHeroPairRow[]
}

// Only selected-pair games. Missing identities/hero fields remain explicit buckets;
// their matches are not dropped from the shared-sample denominator.
export function sharedHeroStats(edge: SynergyAggregate): SharedHeroStats {
  const maps = [
    new Map<string | null, { games: number; wins: number; roles: Map<string | null, number> }>(),
    new Map<string | null, { games: number; wins: number; roles: Map<string | null, number> }>()
  ]
  const pairs = new Map<
    string,
    {
      key: string
      championA: string | null
      championB: string | null
      games: number
      wins: number
      rolePairs: Map<string, { roleA: string | null; roleB: string | null; games: number }>
    }
  >()
  const available = [0, 0]
  let pairsAvailable = 0
  const names = [edge.playerA, edge.playerB]
  for (const game of edge.gamesList) {
    const gameRoles = names.map(
      (player) => game.players.find((p) => p.player === player)?.role ?? null
    )
    const heroes = names.map((player, i) => {
      const value = game.players.find((p) => p.player === player)?.champion
      const champion = typeof value === 'string' && value.trim() ? value.trim() : null
      if (champion !== null) available[i]++
      const count = maps[i].get(champion) ?? { games: 0, wins: 0, roles: new Map() }
      count.games++
      count.wins += Number(game.win)
      count.roles.set(gameRoles[i], (count.roles.get(gameRoles[i]) ?? 0) + 1)
      maps[i].set(champion, count)
      return champion
    })
    const key = JSON.stringify(heroes)
    const pair = pairs.get(key) ?? {
      key,
      championA: heroes[0],
      championB: heroes[1],
      games: 0,
      wins: 0,
      rolePairs: new Map()
    }
    pair.games++
    pair.wins += Number(game.win)
    const roleKey = JSON.stringify(gameRoles)
    const rolePair = pair.rolePairs.get(roleKey) ?? {
      roleA: gameRoles[0],
      roleB: gameRoles[1],
      games: 0
    }
    rolePair.games++
    pair.rolePairs.set(roleKey, rolePair)
    pairs.set(key, pair)
    if (heroes.every((hero) => hero !== null)) pairsAvailable++
  }
  const values = (count: { games: number; wins: number }) => ({
    games: count.games,
    wins: count.wins,
    share: edge.games > 0 ? count.games / edge.games : 0,
    winRate: count.wins / count.games,
    interval: wilsonInterval(count.wins, count.games)
  })
  return {
    total: edge.games,
    members: names.map((player, i) => ({
      player,
      available: available[i],
      rows: [...maps[i]]
        .map(([champion, count]) => ({
          champion,
          ...values(count),
          roles: [...count.roles]
            .map(([role, games]) => ({ role, games }))
            .sort((a, b) => b.games - a.games)
        }))
        .sort((a, b) => b.games - a.games)
    })),
    pairsAvailable,
    pairs: [...pairs.values()]
      .map((count) => ({
        key: count.key,
        championA: count.championA,
        championB: count.championB,
        ...values(count),
        rolePairs: [...count.rolePairs.values()].sort((a, b) => b.games - a.games)
      }))
      .sort((a, b) => b.games - a.games)
  }
}
