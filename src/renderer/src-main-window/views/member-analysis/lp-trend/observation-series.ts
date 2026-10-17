import {
  type QueueRank,
  RANK_TIERS,
  type RankValue,
  rankLabel
} from '@shared/shards/member-analysis/opponent-ranks'

const divisions = ['IV', 'III', 'II', 'I'] as const
export const MASTER_PROGRESS_BASE = 2800

// A display coordinate, NOT earned LP, an MMR estimate or a per-match reward.
export function rankProgressCoordinate(rank: RankValue): number | null {
  const points = rank.leaguePoints
  if (points === null || !Number.isFinite(points) || points < 0) return null
  const tier = RANK_TIERS.indexOf(rank.tier)
  if (tier >= 7) return MASTER_PROGRESS_BASE + points
  const division = divisions.indexOf(rank.division!)
  // Preserve transitional 100 LP observations. Never clamp or alter the stored fact.
  if (tier < 0 || division < 0 || points > 100) return null
  return tier * 400 + division * 100 + points
}

export interface RankObservationPoint {
  fetchedAt: string
  rank: QueueRank
}

export interface RankProgressPoint<T extends RankObservationPoint = RankObservationPoint> {
  x: number
  y: number | null
  observation: T
}

export function observationSeries<T extends RankObservationPoint>(observations: readonly T[]) {
  return observations
    .map((observation): RankProgressPoint<T> => ({
      x: Date.parse(observation.fetchedAt),
      y:
        observation.rank.status === 'ranked' ? rankProgressCoordinate(observation.rank.rank) : null,
      observation
    }))
    .filter((point) => Number.isFinite(point.x))
    .sort((a, b) => a.x - b.x)
}

export function rankProgressDomain(series: readonly (readonly RankProgressPoint[])[]) {
  // Always supply all configured members before a single-member display filter.
  let low = Infinity
  let high = -Infinity
  let from = Infinity
  let to = -Infinity
  for (const points of series)
    for (const point of points) {
      from = Math.min(from, point.x)
      to = Math.max(to, point.x)
      if (point.y === null) continue
      low = Math.min(low, point.y)
      high = Math.max(high, point.y)
    }
  if (!Number.isFinite(low)) return null
  const min =
    low < MASTER_PROGRESS_BASE
      ? Math.floor(low / 400) * 400
      : MASTER_PROGRESS_BASE + Math.floor((low - MASTER_PROGRESS_BASE) / 100) * 100
  return {
    min,
    max: Math.max(min + 100, Math.ceil(high / 100) * 100),
    from,
    to
  }
}

export function rankProgressTick(value: number): string {
  if (value >= MASTER_PROGRESS_BASE) return `${value - MASTER_PROGRESS_BASE} LP`
  if (value < 0 || value % 100 !== 0) return ''
  const divisionIndex = Math.floor(value / 100)
  return rankLabel({
    tier: RANK_TIERS[Math.floor(divisionIndex / 4)],
    division: divisions[divisionIndex % 4],
    leaguePoints: null
  })
}

export const rankTierBoundaries = RANK_TIERS.slice(0, 8).map((tier, index) => ({
  tier,
  value: index * 400
}))
