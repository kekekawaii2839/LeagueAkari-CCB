import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

export type BanSide = 'own' | 'enemy' | 'both'
export function aggregateBans(games: MemberAnalysisGame[], side: BanSide) {
  const counts = new Map<number, number>()
  let validGames = 0
  for (const game of games) {
    const own = game.bans?.own,
      enemy = game.bans?.enemy
    if (side === 'both' ? own == null || enemy == null : game.bans?.[side] == null) continue
    validGames++
    const ids = side === 'both' ? [...own!, ...enemy!] : game.bans![side]!
    // Per-match incidence, not share of ban slots; mirrored bans count once.
    for (const id of new Set(ids)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return {
    validGames,
    missingGames: games.length - validGames,
    rows: [...counts]
      .map(([championId, games]) => ({ championId, games, rate: games / validGames }))
      .sort((a, b) => b.games - a.games || a.championId - b.championId)
  }
}
