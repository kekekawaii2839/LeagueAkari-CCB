import type { DraftRole, InteractionMode } from '../member-analysis/champion-pool/scoring'

export const CHAMPION_POOL_NAMESPACE = 'champion-pool-main'
export interface PoolChampion {
  id: number
  name: string
}
export interface PoolCatalog {
  datasetId: string
  role: DraftRole
  patch: string
  fetchedAt: string
  champions: PoolChampion[]
  stale?: boolean
}
export interface PoolPreferences {
  lastRole: DraftRole
  pools: Record<DraftRole, number[]>
}
export interface PoolReferenceProgress {
  completed: number
  total: number
}
export interface PoolTopThree {
  score: number | null
  reason:
    'pending' | 'missing-pool' | 'insufficient-reference' | 'zero-variance' | 'no-picks' | null
  count: number
  referenceCount: number
  referenceTotal: number
  meanPp: number | null
  sdPp: number | null
}
export interface PoolCell {
  championId: number
  deltaPp: number | null
  games: number | null
  state: 'available' | 'missing' | 'unavailable'
  /** Source-reported rates (0..1), independent of residual estimability. Old caches may omit them. */
  ownWinRate?: number | null
  targetWinRate?: number | null
  /** Pair win rate from this pool champion's report/perspective, never reconstructed from delta. */
  pairWinRate?: number | null
  ownGames?: number | null
  targetGames?: number | null
}
export interface PoolTarget {
  championId: number
  name: string
  role: DraftRole
  mode: InteractionMode
  pickRate: number
  cells: PoolCell[]
  bestChampionId: number | null
  bestDeltaPp: number | null
  status: 'covered' | 'uncovered' | 'unknown' | 'not-applicable'
  complete: boolean
  top3?: PoolTopThree
}
export interface PoolCoverage {
  datasetId: string
  role: DraftRole
  patch: string
  fetchedAt: string
  champions: PoolChampion[]
  targets: PoolTarget[]
  method: 'raw-odds-residual-v1'
  reference?: PoolReferenceProgress
  cacheWarning?: boolean
}
export type PoolErrorCode =
  'network' | 'rate-limit' | 'source-changed' | 'expired' | 'cancelled' | 'busy' | 'storage'
export type PoolResult<T> = { status: 'ready'; data: T } | { status: 'error'; code: PoolErrorCode }

/** Independent population-SD definition: mean of the pool's best k column z-scores.
 * A completed source scan may contain non-estimable pairs; counts retain that missingness.
 */
export function topThreeZ(
  pool: PoolCell[],
  reference: readonly number[],
  referenceTotal: number,
  ready: boolean
): PoolTopThree {
  const eligible = pool.filter((c) => c.state !== 'unavailable')
  const values = eligible
    .filter((c) => c.state === 'available' && c.deltaPp !== null)
    .map((c) => c.deltaPp!)
  const meanPp = reference.length ? reference.reduce((a, b) => a + b, 0) / reference.length : null
  const sdPp =
    meanPp === null
      ? null
      : Math.sqrt(reference.reduce((s, v) => s + (v - meanPp) ** 2, 0) / reference.length)
  const reason: PoolTopThree['reason'] = !ready
    ? 'pending'
    : !eligible.length
      ? 'no-picks'
      : values.length !== eligible.length
        ? 'missing-pool'
        : reference.length < 2
          ? 'insufficient-reference'
          : sdPp === null || sdPp <= 1e-12
            ? 'zero-variance'
            : null
  const best = values.sort((a, b) => b - a).slice(0, 3)
  return {
    score: reason ? null : (best.reduce((a, b) => a + b, 0) / best.length - meanPp!) / sdPp!,
    reason,
    count: Math.min(3, eligible.length),
    referenceCount: reference.length,
    referenceTotal,
    meanPp,
    sdPp
  }
}

/** A missing answer is not evidence that the entire pool has no answer. */
export function evaluateTarget(cells: PoolCell[]) {
  const eligible = cells.filter((c) => c.state !== 'unavailable')
  const known = eligible.filter((c) => c.state === 'available' && c.deltaPp !== null)
  const best = [...known].sort((a, b) => b.deltaPp! - a.deltaPp! || a.championId - b.championId)[0]
  const complete = known.length === eligible.length
  const status: PoolTarget['status'] = !eligible.length
    ? 'not-applicable'
    : best && best.deltaPp! >= 0
      ? 'covered'
      : complete
        ? 'uncovered'
        : 'unknown'
  return {
    bestChampionId: best?.championId ?? null,
    bestDeltaPp: best?.deltaPp ?? null,
    status,
    complete
  }
}

/** PR denominator includes unknown targets. Not-applicable mirrors are excluded explicitly. */
export function summarizeCoverage(targets: readonly PoolTarget[]) {
  const eligible = targets.filter((t) => t.status !== 'not-applicable')
  const weight = eligible.reduce((s, t) => s + t.pickRate, 0)
  const share = (status: PoolTarget['status']) =>
    weight > 0
      ? eligible.filter((t) => t.status === status).reduce((s, t) => s + t.pickRate, 0) / weight
      : null
  return { total: eligible.length, covered: share('covered'), unknown: share('unknown') }
}
