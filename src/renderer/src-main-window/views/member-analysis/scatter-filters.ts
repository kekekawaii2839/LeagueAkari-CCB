import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import { type TrendInput, type TrendRequest, filterVersionTrendGames } from './version-trend/domain'

export type ScatterFilters = Pick<
  TrendRequest,
  | 'memberId'
  | 'champion'
  | 'side'
  | 'outcome'
  | 'patchFrom'
  | 'patchTo'
  | 'dateFrom'
  | 'dateTo'
  | 'durationMin'
  | 'durationMax'
  | 'includeMemberIds'
  | 'excludeMemberIds'
  | 'completeness'
>
export const defaultScatterFilters = (): ScatterFilters => ({
  memberId: 'all',
  champion: null,
  side: 'all',
  outcome: 'all',
  patchFrom: '',
  patchTo: '',
  dateFrom: '',
  dateTo: '',
  durationMin: null,
  durationMax: null,
  includeMemberIds: [],
  excludeMemberIds: [],
  completeness: 'all'
})
export const hasScatterFilters = (filters: ScatterFilters) =>
  JSON.stringify(filters) !== JSON.stringify(defaultScatterFilters())

/** Reuse trend's identity-aware selection and validation. Reattach the original
 * per-game player labels only after stable member-slot identity was resolved.
 * Completeness for a two-axis comparison is checked against BOTH coordinates
 * later, before aggregation, rather than an arbitrary single trend metric.
 */
export function selectScatterPopulation(input: TrendInput, filters: ScatterFilters, role: string) {
  const selected = new Map<number, Set<string>>()
  const identities = new Map(input.identities.map((identity) => [identity.gameId, identity]))
  const ids =
    filters.memberId === 'all'
      ? input.configuredMemberIds.filter((id) => !filters.excludeMemberIds.includes(id))
      : [filters.memberId]
  const unresolved = new Set<number>()
  for (const memberId of ids) {
    const result = filterVersionTrendGames(input, {
      ...filters,
      memberId,
      role: role === 'ALL' ? 'all' : (role as TrendRequest['role']),
      axis: 'patch',
      timeBucket: 'week',
      metric: 'player:winRate',
      completeness: 'all'
    })
    for (const game of result.games) {
      const label = identities
        .get(game.gameId)
        ?.members.find((row) => row.memberId === memberId)?.player
      if (!label) continue
      const players = selected.get(game.gameId) ?? new Set<string>()
      players.add(label)
      selected.set(game.gameId, players)
    }
  }
  const games: MemberAnalysisGame[] = []
  for (const game of input.games) {
    const players = selected.get(game.gameId)
    if (players)
      games.push({ ...game, players: game.players.filter((row) => players.has(row.player)) })
    if (!identities.has(game.gameId)) unresolved.add(game.gameId)
  }
  return { games, unresolved: unresolved.size }
}
