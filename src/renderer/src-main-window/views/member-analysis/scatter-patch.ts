import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  type NativeMetric,
  aggregateNativeMetric,
  nativeMetricKeys
} from '@shared/shards/member-analysis/native-metrics'

import { aggregateRoles } from './analytics'
import { memberRoleEvidenceGames } from './evidence-selection'
import type { ScatterMetric } from './scatter-analysis'
import { comparePatch, parsePatch } from './version-trend/domain'

/** Current filtered/windowed population only. Build suffixes belong to the same
 * major.minor patch. Unknown versions remain an explicit, separate bucket.
 * ALL roles still produces separate member-role observations, never mixed roles.
 */
export function patchScatterRows(
  games: MemberAnalysisGame[],
  role: string,
  participant: string,
  xMetric: ScatterMetric,
  yMetric: ScatterMetric
) {
  const buckets = new Map<string, MemberAnalysisGame[]>()
  for (const game of games) {
    const parsed = parsePatch(game.patch)
    const patch = parsed ? `${parsed[0]}.${parsed[1]}` : ''
    const bucket = buckets.get(patch) ?? []
    bucket.push(game)
    buckets.set(patch, bucket)
  }
  return [...buckets]
    .sort(([a], [b]) => (a && b ? comparePatch(a, b) : a ? -1 : b ? 1 : 0))
    .flatMap(([patch, input]) =>
      aggregateRoles(input, role === 'ALL' ? 'all' : role, participant).map((row) => {
        const population = input.filter((game) =>
          game.players.some((entry) => entry.player === row.player && entry.role === row.role)
        )
        const native = Object.fromEntries(
          nativeMetricKeys.map((key) => [
            key,
            aggregateNativeMetric(population, key, row.player, row.role).value
          ])
        ) as Record<NativeMetric, number | null>
        const support = (key: ScatterMetric) =>
          (nativeMetricKeys as readonly string[]).includes(key)
            ? aggregateNativeMetric(population, key as NativeMetric, row.player, row.role)
                .validGames
            : memberRoleEvidenceGames(population, {
                player: row.player,
                role: row.role,
                metric: key as Exclude<ScatterMetric, NativeMetric>
              }).length
        return {
          ...row,
          ...native,
          patch,
          validX: support(xMetric),
          validY: support(yMetric),
          deaths: null,
          gameId: null,
          date: '',
          champion: '',
          result: ''
        }
      })
    )
}
