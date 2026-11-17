import {
  type PoolCatalog,
  type PoolCoverage,
  type PoolPreferences,
  type PoolReferenceProgress,
  type PoolResult,
  type PoolTarget,
  evaluateTarget,
  topThreeZ
} from '@shared/shards/champion-pool/coverage'
import { DRAFT_ROLES, type DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import { isAxiosError } from 'axios'
import { randomUUID } from 'node:crypto'

import { type CachedDataset, type CachedPair, normalizeHero, referenceIds } from './dataset'
import { type PoolPersistence, emptyPreferences } from './persistence'
import type { PoolSource } from './source'

const FRESH_FOR = 6 * 60 * 60 * 1000
const HERO_CONCURRENCY = 3
const REFERENCE_CHECKPOINT_SIZE = 8
export class ChampionPoolController {
  private _snapshot: CachedDataset | null = null
  private readonly _referenceValues = new WeakMap<CachedDataset, Map<string, number[]>>()
  private _active: { owner: number; id: string; abort: AbortController } | null = null
  private _completion: Promise<unknown> | null = null
  private _progress: PoolReferenceProgress | null = null
  private _cacheWarning = false
  private _preferences = emptyPreferences()
  constructor(
    private readonly _source: PoolSource,
    private readonly _now = Date.now,
    private readonly _storage?: PoolPersistence
  ) {}
  cancel(owner: number, id: string) {
    if (this._active?.owner === owner && this._active.id === id) this._active.abort.abort()
  }
  progress(owner: number, id: string) {
    return this._active?.owner === owner && this._active.id === id ? this._progress : null
  }
  async dispose() {
    this._active?.abort.abort()
    await this._completion?.catch(() => {})
    this._snapshot = null
  }
  async preferences(): Promise<PoolResult<PoolPreferences>> {
    try {
      return {
        status: 'ready',
        data: this._storage
          ? await this._storage.getPreferences()
          : structuredClone(this._preferences)
      }
    } catch {
      return { status: 'error', code: 'storage' }
    }
  }
  async savePool(role: DraftRole, championIds: number[]): Promise<PoolResult<PoolPreferences>> {
    try {
      this._preferences = this._storage
        ? await this._storage.savePool(role, championIds)
        : {
            ...this._preferences,
            lastRole: role,
            pools: { ...this._preferences.pools, [role]: [...championIds] }
          }
      return { status: 'ready', data: this._preferences }
    } catch {
      return { status: 'error', code: 'storage' }
    }
  }
  private async _run<T>(
    owner: number,
    id: string,
    work: (signal: AbortSignal) => Promise<T>
  ): Promise<PoolResult<T>> {
    if (this._active) return { status: 'error', code: 'busy' }
    const active = { owner, id, abort: new AbortController() }
    this._active = active
    try {
      const completion = work(active.abort.signal)
      this._completion = completion
      const data = await completion
      active.abort.signal.throwIfAborted()
      return { status: 'ready', data }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      const code = active.abort.signal.aborted
        ? 'cancelled'
        : isAxiosError(error) && error.response?.status === 429
          ? 'rate-limit'
          : message === 'expired'
            ? 'expired'
            : message === 'source-changed' || error instanceof SyntaxError
              ? 'source-changed'
              : message === 'storage'
                ? 'storage'
                : 'network'
      return { status: 'error', code }
    } finally {
      if (this._active === active) {
        this._active = null
        this._completion = null
        this._progress = null
      }
    }
  }
  private _catalog(snapshot: CachedDataset): PoolCatalog {
    return {
      datasetId: snapshot.id,
      role: snapshot.role,
      patch: snapshot.source.scope.patch,
      fetchedAt: new Date(snapshot.time).toISOString(),
      stale: this._now() - snapshot.time >= FRESH_FOR,
      champions: snapshot.source.baselines
        .filter((b) => b.role === snapshot.role && b.games > 0)
        .map((b) => ({
          id: b.championId,
          name: snapshot.source.slugs[String(b.championId)] || String(b.championId)
        }))
    }
  }
  private async _checkpoint(snapshot: CachedDataset) {
    if (!this._storage) return
    try {
      await this._storage.saveCache(snapshot)
      this._cacheWarning = false
    } catch {
      this._cacheWarning = true
    }
  }
  catalog(owner: number, id: string, role: DraftRole, refresh: boolean) {
    return this._run(owner, id, async (signal) => {
      if (!refresh) {
        if (this._snapshot?.role === role) return this._catalog(this._snapshot)
        try {
          const restored = await this._storage?.loadCache(role)
          if (restored) {
            signal.throwIfAborted()
            this._snapshot = restored
            return this._catalog(restored)
          }
        } catch {
          this._cacheWarning = true
        }
      }
      const source = await this._source.catalog(role, signal)
      signal.throwIfAborted()
      const next: CachedDataset = {
        schemaVersion: 1,
        method: 'raw-odds-residual-v1',
        id: randomUUID(),
        role,
        time: this._now(),
        source,
        heroes: []
      }
      await this._checkpoint(next)
      signal.throwIfAborted()
      this._snapshot = next
      return this._catalog(next)
    })
  }
  private _require(datasetId: string, championIds: number[]) {
    const snapshot = this._snapshot
    if (!snapshot || snapshot.id !== datasetId) throw new Error('expired')
    const catalog = this._catalog(snapshot)
    if (
      !championIds.length ||
      new Set(championIds).size !== championIds.length ||
      championIds.some((id) => !catalog.champions.some((c) => c.id === id))
    )
      throw new Error('source-changed')
    return snapshot
  }
  private async _hero(snapshot: CachedDataset, id: number, signal: AbortSignal) {
    signal.throwIfAborted()
    const reports = await this._source.reports(snapshot.source, snapshot.role, id, signal)
    signal.throwIfAborted()
    snapshot.heroes.push(normalizeHero(snapshot.source, snapshot.role, id, reports))
  }
  private async _loadHeroes(
    snapshot: CachedDataset,
    missing: number[],
    signal: AbortSignal,
    onComplete?: () => void
  ) {
    const stop = new AbortController()
    const workerSignal = AbortSignal.any([signal, stop.signal])
    let next = 0
    const workers = Array.from({ length: Math.min(HERO_CONCURRENCY, missing.length) }, async () => {
      while (next < missing.length) {
        await this._hero(snapshot, missing[next++], workerSignal)
        onComplete?.()
      }
    })
    try {
      await Promise.all(workers)
    } catch (error) {
      stop.abort()
      // Drain workers before checkpointing or allowing another operation to mutate the snapshot.
      await Promise.allSettled(workers)
      throw error
    }
  }
  private _coverage(snapshot: CachedDataset, championIds: number[]): PoolCoverage {
    const catalog = this._catalog(snapshot),
      reference = referenceIds(snapshot),
      referenceSet = new Set(reference),
      heroes = new Map(snapshot.heroes.map((hero) => [hero.id, hero])),
      completed = reference.filter((id) => heroes.has(id)).length,
      ready = completed === reference.length
    let refValues = this._referenceValues.get(snapshot)
    if (!refValues) {
      refValues = new Map()
      for (const hero of snapshot.heroes) {
        if (!referenceSet.has(hero.id)) continue
        for (const block of hero.blocks)
          for (const [targetId, delta] of block.pairs) {
            if (delta === null || hero.id === targetId) continue
            const key = `${block.mode}:${block.role}:${targetId}`
            const values = refValues.get(key)
            if (values) values.push(delta)
            else refValues.set(key, [delta])
          }
      }
      if (ready) this._referenceValues.set(snapshot, refValues)
    }
    const baselines = new Map(
      snapshot.source.baselines.map((baseline) => [
        `${baseline.role}:${baseline.championId}`,
        baseline
      ])
    )
    const poolCells = new Map<string, CachedPair>()
    for (const championId of championIds)
      for (const block of heroes.get(championId)?.blocks ?? [])
        for (const pair of block.pairs)
          poolCells.set(`${block.mode}:${block.role}:${pair[0]}:${championId}`, pair)
    const targets: PoolTarget[] = []
    for (const mode of ['matchup', 'synergy'] as const)
      for (const targetRole of DRAFT_ROLES) {
        if (mode === 'synergy' && targetRole === snapshot.role) continue
        for (const baseline of snapshot.source.baselines.filter((b) => b.role === targetRole)) {
          const targetId = baseline.championId,
            key = `${mode}:${targetRole}:${targetId}`
          const cells = championIds.map((championId) => {
            const pair = poolCells.get(`${key}:${championId}`),
              own = baselines.get(`${snapshot.role}:${championId}`)
            return {
              championId,
              deltaPp: pair?.[1] ?? null,
              games: pair?.[2] ?? null,
              ownWinRate: own && own.games > 0 ? own.reportedWinRate : null,
              targetWinRate: baseline.games > 0 ? baseline.reportedWinRate : null,
              pairWinRate: pair?.[3] ?? null,
              ownGames: own?.games ?? null,
              targetGames: baseline.games,
              state:
                championId === targetId
                  ? ('unavailable' as const)
                  : pair?.[1] !== null && pair?.[1] !== undefined
                    ? ('available' as const)
                    : ('missing' as const)
            }
          })
          targets.push({
            championId: targetId,
            name: snapshot.source.slugs[String(targetId)] || String(targetId),
            role: targetRole,
            mode,
            pickRate: baseline.pickRate,
            cells,
            ...evaluateTarget(cells),
            top3: topThreeZ(
              cells,
              refValues.get(key) || [],
              reference.length - Number(referenceSet.has(targetId)),
              ready
            )
          })
        }
      }
    return {
      datasetId: snapshot.id,
      role: snapshot.role,
      patch: catalog.patch,
      fetchedAt: catalog.fetchedAt,
      champions: championIds.map((id) => catalog.champions.find((c) => c.id === id)!),
      targets,
      method: snapshot.method,
      reference: { completed, total: reference.length },
      cacheWarning: this._cacheWarning
    }
  }
  coverage(owner: number, id: string, datasetId: string, championIds: number[]) {
    return this._run(owner, id, async (signal) => {
      const snapshot = this._require(datasetId, championIds)
      const missing = championIds.filter((heroId) => !snapshot.heroes.some((h) => h.id === heroId))
      const before = snapshot.heroes.length
      try {
        await this._loadHeroes(snapshot, missing, signal)
      } finally {
        if (snapshot.heroes.length !== before || this._cacheWarning)
          await this._checkpoint(snapshot)
      }
      signal.throwIfAborted()
      return this._coverage(snapshot, championIds)
    })
  }
  prepareReference(owner: number, id: string, datasetId: string, championIds: number[]) {
    return this._run(owner, id, async (signal) => {
      const snapshot = this._require(datasetId, championIds),
        expected = referenceIds(snapshot)
      const cached = new Set(snapshot.heroes.map((hero) => hero.id))
      const missing = expected.filter((heroId) => !cached.has(heroId))
      let completed = expected.length - missing.length
      this._progress = { completed, total: expected.length }
      for (let offset = 0; offset < missing.length; offset += REFERENCE_CHECKPOINT_SIZE) {
        const before = completed
        try {
          await this._loadHeroes(
            snapshot,
            missing.slice(offset, offset + REFERENCE_CHECKPOINT_SIZE),
            signal,
            () => {
              this._progress = { completed: ++completed, total: expected.length }
            }
          )
        } finally {
          if (completed !== before || this._cacheWarning) await this._checkpoint(snapshot)
        }
      }
      signal.throwIfAborted()
      return this._coverage(snapshot, championIds)
    })
  }
}
