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
  const wins = payload.games.reduce((total, game) => total + Number(game.win), 0)
  return {
    gameCount: payload.games.length,
    playerCount: new Set(payload.games.flatMap((game) => game.players.map((row) => row.player)))
      .size,
    wins,
    winRate: payload.games.length === 0 ? 0 : wins / payload.games.length
  }
}
