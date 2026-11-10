import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { aggregateNativeMetric } from '@shared/shards/member-analysis/native-metrics'

// Match context of a combination, not a sum of the two members' contributions.
// Damage per death belongs to individual analysis and is intentionally absent.
export const combinationNativeMetricKeys = [
  'gameDuration',
  'bloodiness',
  'firstDragonTime',
  'firstTowerTime',
  'teamDragonsPG',
  'teamBaronsPG',
  'teamDragonSoulsPG',
  'teamElderDragonsPG'
] as const
export type CombinationNativeMetric = (typeof combinationNativeMetricKeys)[number]
export function aggregateCombinationNativeMetrics(games: MemberAnalysisGame[]) {
  const entries = combinationNativeMetricKeys.map(
    (key) => [key, aggregateNativeMetric(games, key)] as const
  )
  return {
    values: Object.fromEntries(entries.map(([key, result]) => [key, result.value])) as Record<
      CombinationNativeMetric,
      number | null
    >,
    samples: Object.fromEntries(entries.map(([key, result]) => [key, result.validGames])) as Record<
      CombinationNativeMetric,
      number
    >
  }
}
