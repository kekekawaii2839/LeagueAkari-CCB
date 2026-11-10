import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import { aggregateBans } from './ban-statistics'
import { isIdentifiedChampion } from './champion-pools'
import { memberOrder } from './visualization'

/** Ban incidence is match-wide within the role-eligible sample, never attributed to a role/player. */
export function aggregateChampionBanDetails(
  input: MemberAnalysisGame[],
  championId: number | null,
  role: string
) {
  const games = [...new Map(input.map((game) => [game.gameId, game])).values()].filter((game) =>
    game.players.some((row) => role === 'all' || row.role === role)
  )
  const knownId = championId !== null && Number.isSafeInteger(championId) && championId > 0
  return (['own', 'enemy', 'both'] as const).map((side) => {
    const result = aggregateBans(games, side)
    const count =
      knownId && result.validGames > 0
        ? (result.rows.find((row) => row.championId === championId)?.games ?? 0)
        : null
    return {
      side,
      games: count,
      validGames: result.validGames,
      scopeGames: games.length,
      rate: count === null ? null : count / result.validGames
    }
  })
}

/** Same public sample and local role as the list; one appearance per member/match. */
export function aggregateChampionMembers(
  input: MemberAnalysisGame[],
  champion: string,
  role: string,
  members: { gameName: string; tagLine: string }[] = []
) {
  const rows = new Map<string, { player: string; games: number; wins: number }>()
  for (const game of new Map(input.map((game) => [game.gameId, game])).values()) {
    const players = new Set(
      game.players
        .filter((row) => row.champion === champion && (role === 'all' || row.role === role))
        .map((row) => row.player)
        .filter((player) => typeof player === 'string' && player.trim())
    )
    for (const player of players) {
      const row = rows.get(player) ?? { player, games: 0, wins: 0 }
      row.games++
      row.wins += Number(game.win)
      rows.set(player, row)
    }
  }
  return memberOrder([...rows.keys()], members).map((player) => {
    const row = rows.get(player)!
    return { ...row, losses: row.games - row.wins, winRate: row.wins / row.games }
  })
}

export const LOCAL_TIER_MIN_GAMES = 5
// Frozen research approximation approved for the local experimental view.
// Ratios are 0–1. These are not OP.GG's disclosed formula or calibrated local strength.
export const LOCAL_TIER_Z_THRESHOLDS = [
  1.0896779694143466, 0.7358214070323733, 0.14122038570662537, -0.9086324054830011
] as const
export const LOCAL_TIER_OP_MIN_Z = 1.723324584676854
export const LOCAL_TIER_OP_MIN_GAP_Z = 0.5320278458965939
const tierRoles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
export type LocalTierRow = {
  key: string
  role: string
  champion: string
  championId: number | null
  games: number
  wins: number
  winRate: number
  pickRate: number
  bannedGames: number | null
  banRate: number | null
  score: number | null
  tier: number | null
  zScore: number | null
  unratedReason: 'low-sample' | 'unknown-champion' | 'missing-bans' | 'no-variation' | null
}

const compareScores = (a: LocalTierRow, b: LocalTierRow) =>
  Number(a.score === null) - Number(b.score === null) ||
  (b.score ?? -Infinity) - (a.score ?? -Infinity) ||
  b.games - a.games ||
  (a.championId ?? Infinity) - (b.championId ?? Infinity) ||
  a.key.localeCompare(b.key)

export type LocalTierResult = {
  rows: LocalTierRow[]
  games: number
  banGames: number
  missingBanGames: number
  unknownGames: number
  baseWinRate: number
}

/** Descriptive local ranking, not OP.GG's proprietary algorithm or a forecast.
 * Picks count own-team match incidence (not 10-player slots); all-role rates
 * may sum above 100%. Bans require both teams and cannot be assigned a role.
 * Duplicate input matches and mirrored bans count once. Missing champion ID
 * or ban coverage never becomes an observed zero or a fabricated tier.
 * Score = 100 * raw WR + 1.9 * ln(pick rate), standardized across eligible
 * champions in the selected role/sample with population SD. Frozen z cutoffs
 * yield unequal tiers; only a sufficiently separated top score may become OP.
 * Equal scores share a tier; zero variation (including a sole eligible row)
 * remains ungraded. The all-role view merges independently rated role rows,
 * never pools different roles into an unsupported cross-role score population.
 */
export function aggregateChampionTiers(
  input: MemberAnalysisGame[],
  role: string,
  championId: (name: string) => number | null
): LocalTierResult {
  // Published renderer games have unique gameIds: main rejects cross-server
  // ambiguity before publication, and does not expose server identifiers here.
  const games = [...new Map(input.map((game) => [game.gameId, game])).values()].filter((game) =>
    game.players.some((row) => role === 'all' || row.role === role)
  )
  const bans = aggregateBans(games, 'both')
  const banned = new Map(bans.rows.map((row) => [row.championId, row]))
  const baseWinRate = games.length ? games.filter((game) => game.win).length / games.length : 0
  if (role === 'all') {
    const groups = tierRoles.map((group) => aggregateChampionTiers(games, group, championId))
    return {
      rows: groups
        .flatMap((group) => group.rows)
        .sort((a, b) => (a.tier ?? 6) - (b.tier ?? 6) || compareScores(a, b)),
      games: games.length,
      banGames: bans.validGames,
      missingBanGames: bans.missingGames,
      unknownGames: games.filter((game) =>
        game.players.some((row) => !isIdentifiedChampion(row.champion))
      ).length,
      baseWinRate
    }
  }
  const rows = new Map<string, { champion: string; games: number; wins: number }>()
  let unknownGames = 0
  for (const game of games) {
    const matching = game.players.filter((row) => role === 'all' || row.role === role)
    if (matching.some((row) => !isIdentifiedChampion(row.champion))) unknownGames++
    for (const champion of new Set(
      matching.map((row) => row.champion).filter(isIdentifiedChampion)
    )) {
      const row = rows.get(champion) ?? { champion, games: 0, wins: 0 }
      row.games++
      row.wins += Number(game.win)
      rows.set(champion, row)
    }
  }
  const result: LocalTierRow[] = [...rows.values()].map((row) => {
    const id = championId(row.champion)
    const knownId = id !== null && Number.isSafeInteger(id) && id > 0 ? id : null
    const bannedGames =
      knownId !== null && bans.validGames > 0 ? (banned.get(knownId)?.games ?? 0) : null
    const banRate = bannedGames !== null ? bannedGames / bans.validGames : null
    const pickRate = row.games / games.length
    const unratedReason =
      row.games < LOCAL_TIER_MIN_GAMES
        ? 'low-sample'
        : knownId === null
          ? 'unknown-champion'
          : banRate === null
            ? 'missing-bans'
            : null
    const score =
      unratedReason === null ? 100 * (row.wins / row.games) + 1.9 * Math.log(pickRate) : null
    return {
      ...row,
      key: `${role}:${row.champion}`,
      role,
      championId: knownId,
      winRate: row.wins / row.games,
      pickRate,
      bannedGames,
      banRate,
      score,
      tier: null,
      zScore: null,
      unratedReason
    }
  })
  result.sort(compareScores)
  const eligible = result.filter((row) => row.score !== null)
  const mean = eligible.reduce((sum, row) => sum + row.score!, 0) / (eligible.length || 1)
  const variance =
    eligible.reduce((sum, row) => sum + (row.score! - mean) ** 2, 0) / (eligible.length || 1)
  const deviation = Math.sqrt(variance)
  if (deviation > 0 && eligible.some((row) => row.score !== eligible[0].score)) {
    for (const row of eligible) {
      row.zScore = (row.score! - mean) / deviation
      const band = LOCAL_TIER_Z_THRESHOLDS.findIndex((threshold) => row.zScore! >= threshold)
      row.tier = band < 0 ? 5 : band + 1
    }
    if (
      eligible.length > 1 &&
      eligible[0].zScore! >= LOCAL_TIER_OP_MIN_Z &&
      (eligible[0].score! - eligible[1].score!) / deviation >= LOCAL_TIER_OP_MIN_GAP_Z
    ) {
      eligible[0].tier = 0
    }
  } else {
    for (const row of eligible) row.unratedReason = 'no-variation'
  }
  return {
    rows: result,
    games: games.length,
    banGames: bans.validGames,
    missingBanGames: bans.missingGames,
    unknownGames,
    baseWinRate
  }
}
