import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import { aggregateEarlyBuckets, earlyGoldDiff } from './analytics'

export type EarlyGroup = 'all' | 'behind' | 'neutral' | 'ahead'
export const earlyGroups: { key: EarlyGroup; label: string; boundary: string }[] = [
  { key: 'all', label: '全部', boundary: '' },
  { key: 'behind', label: '落后', boundary: '< −500' },
  { key: 'neutral', label: '接近持平', boundary: '−500 ≤ 差值 < +500' },
  { key: 'ahead', label: '领先', boundary: '≥ +500' }
]
export const earlyGroupMatches = (diff: number, group: EarlyGroup) =>
  group === 'all' ||
  (group === 'behind' ? diff < -500 : group === 'ahead' ? diff >= 500 : diff >= -500 && diff < 500)

export function earlyResultRows(games: MemberAnalysisGame[], timing: '15' | '20') {
  return games
    .map((game) => ({ game, diff: earlyGoldDiff(game, timing) }))
    .filter((row): row is { game: MemberAnalysisGame; diff: number } => row.diff !== null)
}
export const earlyBucketMatches = (
  row: { game: MemberAnalysisGame; diff: number },
  label: string
) => aggregateEarlyBuckets([row]).some((bucket) => bucket.label === label && bucket.games > 0)

// Only clarify existing inclusive/exclusive boundaries; the calculation and stored labels stay unchanged.
export const earlyBucketLabel = (label: string) =>
  label.includes(' ~ ') ? label.replace(' ~ ', ' ≤ 差值 < ') : label
