import { isEligibleMemberAnalysisGame } from './eligibility'
import type { MemberAnalysisPayload } from './schemas'

export interface MemberAnalysisSummary {
  gameCount: number
  playerCount: number
  wins: number
  winRate: number
}

export function summarizeMemberAnalysisPayload(
  payload: MemberAnalysisPayload
): MemberAnalysisSummary {
  const games = payload.games.filter(isEligibleMemberAnalysisGame)
  const wins = games.reduce((total, game) => total + Number(game.win), 0)
  return {
    gameCount: games.length,
    playerCount: new Set(games.flatMap((game) => game.players.map((row) => row.player))).size,
    wins,
    winRate: games.length === 0 ? 0 : wins / games.length
  }
}
