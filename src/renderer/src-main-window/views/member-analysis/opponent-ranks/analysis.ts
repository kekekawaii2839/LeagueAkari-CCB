import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { isEligibleMemberAnalysisGame } from '@shared/shards/member-analysis/eligibility'
import {
  RANK_TIERS,
  type RankQueue,
  opponentRankAverage
} from '@shared/shards/member-analysis/opponent-ranks'

import { wilsonInterval } from '../visualization'

export function summarizeOpponentRanks(games: MemberAnalysisGame[], queue: RankQueue) {
  games = games.filter(isEligibleMemberAnalysisGame)
  const rows = RANK_TIERS.map((tier) => ({
    tier,
    appearances: 0,
    games: 0,
    wins: 0,
    winRate: null as number | null,
    interval: null as ReturnType<typeof wilsonInterval>
  }))
  const byTier = new Map(rows.map((row) => [row.tier, row]))
  let ranked = 0,
    unranked = 0,
    provisional = 0,
    missing = 0,
    paused = 0,
    stale = 0,
    notLoaded = 0,
    ratedGames = 0,
    partialGames = 0
  const fetched: string[] = []
  for (const game of games) {
    if (!game.opponentRanks) {
      notLoaded += 5
      continue
    }
    for (const { snapshot } of game.opponentRanks.opponents) {
      if (snapshot.fetchedAt) fetched.push(snapshot.fetchedAt)
      if (snapshot.status === 'stale') {
        stale++
        continue
      }
      if (snapshot.status !== 'ok') {
        if (snapshot.reason === 'network-paused') paused++
        else missing++
        continue
      }
      const value = snapshot[queue]
      if (value.status === 'ranked') {
        ranked++
        byTier.get(value.rank.tier)!.appearances++
      } else if (value.status === 'unranked') unranked++
      else if (value.status === 'provisional') provisional++
      else missing++
    }
    const average = opponentRankAverage(game.opponentRanks, queue)
    if (average) {
      ratedGames++
      if (average.count < 5) partialGames++
      const row = byTier.get(average.rank.tier)!
      row.games++
      row.wins += Number(game.win)
    }
  }
  for (const row of rows) {
    row.winRate = row.games ? row.wins / row.games : null
    row.interval = wilsonInterval(row.wins, row.games)
  }
  fetched.sort()
  return {
    rows: rows.reverse(),
    ranked,
    unranked,
    provisional,
    missing,
    paused,
    stale,
    notLoaded,
    ratedGames,
    partialGames,
    totalGames: games.length,
    appearances: games.length * 5,
    firstFetchedAt: fetched[0] ?? null,
    lastFetchedAt: fetched.at(-1) ?? null
  }
}
