import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import type { MemberAnalysisMatchListScope } from '@main-window/shards/member-analysis/store'

export const MEMBER_ANALYSIS_MATCH_PAGE_SIZE = 25

export function resolveMatchListScope(
  sample: MemberAnalysisGame[],
  scope: MemberAnalysisMatchListScope | null,
  publishedGeneration: number
) {
  if (!scope) return { games: sample, expired: false, requested: sample.length }
  const expired = scope.status === 'expired' || scope.publishedGeneration !== publishedGeneration
  const ids = new Set(scope.gameIds)
  return {
    games: expired ? [] : sample.filter((game) => ids.has(game.gameId)),
    expired,
    requested: ids.size
  }
}

export function resolveMatchListPage(total: number, requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(total / MEMBER_ANALYSIS_MATCH_PAGE_SIZE))
  const page = Math.min(
    pageCount,
    Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1)
  )
  const start = (page - 1) * MEMBER_ANALYSIS_MATCH_PAGE_SIZE
  return { page, pageCount, start, end: Math.min(total, start + MEMBER_ANALYSIS_MATCH_PAGE_SIZE) }
}

export function matchListPageForGame(games: MemberAnalysisGame[], game: MemberAnalysisGame) {
  const index = games.indexOf(game)
  return index < 0 ? null : Math.floor(index / MEMBER_ANALYSIS_MATCH_PAGE_SIZE) + 1
}
