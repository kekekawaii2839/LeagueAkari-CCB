import { expectedPairWinRate } from '@shared/shards/member-analysis/blindability'
import type { LolalyticsPairReport } from '@shared/shards/member-analysis/champion-pool/lolalytics'
import {
  DRAFT_ROLES,
  type DraftRole,
  type InteractionMode
} from '@shared/shards/member-analysis/champion-pool/scoring'

import type { SourceCatalog } from './source'

export type CachedPair = [
  targetId: number,
  deltaPp: number | null,
  games: number,
  reportedWinRate?: number | null
]
export interface CachedHero {
  id: number
  blocks: { mode: InteractionMode; role: DraftRole; pairs: CachedPair[] }[]
}
export interface CachedDataset {
  schemaVersion: 1
  method: 'raw-odds-residual-v1'
  id: string
  role: DraftRole
  time: number
  source: SourceCatalog
  heroes: CachedHero[]
}
export function referenceIds(dataset: Pick<CachedDataset, 'source' | 'role'>) {
  return dataset.source.baselines
    .filter(
      (b) =>
        b.role === dataset.role &&
        b.games > 0 &&
        b.reportedWinRate !== null &&
        b.reportedWinRate > 0 &&
        b.reportedWinRate < 1
    )
    .map((b) => b.championId)
}
/** Same odds residual as the existing adapter, preserving the bounded source-reported pair rate alongside residuals. */
export function normalizeHero(
  source: SourceCatalog,
  role: DraftRole,
  id: number,
  reports: LolalyticsPairReport[]
): CachedHero {
  const baseline = new Map(source.baselines.map((b) => [`${b.role}:${b.championId}`, b]))
  const own = baseline.get(`${role}:${id}`)
  if (!own || reports.length !== 9) throw new Error('source-changed')
  const seen = new Set<string>()
  const blocks = reports.map((report) => {
    const key = `${report.mode}:${report.otherRole}`
    if (
      report.championId !== id ||
      report.ownRole !== role ||
      !DRAFT_ROLES.includes(report.otherRole) ||
      !['matchup', 'synergy'].includes(report.mode) ||
      (report.mode === 'synergy' && report.otherRole === role) ||
      seen.has(key) ||
      (['source', 'patch', 'tier', 'region', 'queueId'] as const).some(
        (k) => report.scope[k] !== source.scope[k]
      )
    )
      throw new Error('source-changed')
    seen.add(key)
    const targets = new Set<number>()
    const pairs: CachedPair[] = report.pairs.map((pair) => {
      if (
        targets.has(pair.championId) ||
        !Number.isSafeInteger(pair.championId) ||
        pair.championId <= 0 ||
        !Number.isSafeInteger(pair.games) ||
        pair.games < 0 ||
        (pair.reportedWinRate !== null &&
          (!Number.isFinite(pair.reportedWinRate) ||
            pair.reportedWinRate < 0 ||
            pair.reportedWinRate > 1))
      )
        throw new Error('source-changed')
      targets.add(pair.championId)
      const target = baseline.get(`${report.otherRole}:${pair.championId}`)
      const a = own.reportedWinRate,
        b = target?.reportedWinRate
      const delta =
        pair.championId === id ||
        pair.games === 0 ||
        pair.reportedWinRate === null ||
        own.games === 0 ||
        !target ||
        target.games === 0 ||
        a === null ||
        a <= 0 ||
        a >= 1 ||
        b === undefined ||
        b === null ||
        b <= 0 ||
        b >= 1
          ? null
          : 100 * (pair.reportedWinRate - expectedPairWinRate(a, b, report.mode))
      return [pair.championId, delta, pair.games, pair.games > 0 ? pair.reportedWinRate : null]
    })
    return { mode: report.mode, role: report.otherRole, pairs }
  })
  return { id, blocks }
}
