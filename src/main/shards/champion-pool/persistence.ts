import type { PoolPreferences } from '@shared/shards/champion-pool/coverage'
import { DRAFT_ROLES, type DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { z } from 'zod'

import type { CachedDataset } from './dataset'
import { POOL_SOURCE_FILTER } from './source'

const MAX_CACHE = 4 * 1024 * 1024
const MAX_JSON = 64 * 1024 * 1024
const ids = z.array(z.number().int().positive()).refine((v) => new Set(v).size === v.length)
const preferencesSchema = z
  .object({
    schemaVersion: z.literal(1),
    lastRole: z.enum(DRAFT_ROLES),
    pools: z.object({ TOP: ids, JUNGLE: ids, MID: ids, ADC: ids, SUP: ids }).strict()
  })
  .strict()
const scope = z
  .object({
    source: z.literal('lolalytics'),
    patch: z.string().regex(/^\d+\.\d+$/),
    tier: z.literal(POOL_SOURCE_FILTER.tier),
    region: z.literal(POOL_SOURCE_FILTER.region),
    queueId: z.literal(420)
  })
  .strict()
const rate = z.number().min(0).max(1)
const baseline = z
  .object({
    scope,
    championId: z.number().int().positive(),
    role: z.enum(DRAFT_ROLES),
    games: z.number().int().nonnegative(),
    reportedWinRate: rate.nullable(),
    pickRate: rate,
    pickRateDenominator: z.literal('same-role-games'),
    reportedWinRatePrecisionPp: z.number().nullable().optional(),
    populationWinRate: rate.nullable().optional()
  })
  .strict()
const pair = z.tuple([
  z.number().int().positive(),
  z.number().min(-100).max(100).nullable(),
  z.number().int().nonnegative(),
  rate.nullable().optional()
])
const hero = z
  .object({
    id: z.number().int().positive(),
    blocks: z
      .array(
        z
          .object({
            mode: z.enum(['matchup', 'synergy']),
            role: z.enum(DRAFT_ROLES),
            pairs: z.array(pair).max(300)
          })
          .strict()
      )
      .length(9)
  })
  .strict()
const datasetSchema = z
  .object({
    schemaVersion: z.literal(1),
    method: z.literal('raw-odds-residual-v1'),
    id: z.string().uuid(),
    role: z.enum(DRAFT_ROLES),
    time: z.number().int().nonnegative(),
    source: z
      .object({
        scope,
        baselines: z.array(baseline).max(1500),
        slugs: z.record(z.string(), z.string().max(100))
      })
      .strict(),
    heroes: z.array(hero).max(300)
  })
  .strict()
export function emptyPreferences(): PoolPreferences {
  return { lastRole: 'MID', pools: { TOP: [], JUNGLE: [], MID: [], ADC: [], SUP: [] } }
}
function storageError() {
  return new Error('storage')
}
export interface PoolPersistence {
  getPreferences(): Promise<PoolPreferences>
  savePool(role: DraftRole, championIds: number[]): Promise<PoolPreferences>
  loadCache(role: DraftRole): Promise<CachedDataset | null>
  saveCache(value: CachedDataset): Promise<void>
}
/** Fixed userData paths. Five current+previous 4MiB files, one queued temp: <45MiB.
 * Version 1 accepts legacy three-item pairs and additive source-rate fourth items.
 * Missing source rates stay unknown until explicit refresh; future versions fail closed.
 * Preferences are independent of disposable cache; malformed preferences are never overwritten.
 */
export class ChampionPoolPersistence implements PoolPersistence {
  private _tail: Promise<unknown> = Promise.resolve()
  private _ready: Promise<void> | null = null
  private _canonical: string | null = null
  constructor(private readonly _root: string) {}
  async flush() {
    await this._tail.catch(() => {})
  }
  private _queue<T>(work: () => Promise<T>): Promise<T> {
    const result = this._tail.catch(() => {}).then(work)
    this._tail = result
    return result
  }
  private async _rootReady() {
    if (!this._ready) this._ready = this._initializeRoot()
    await this._ready
    const stat = await fs.lstat(this._root)
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await fs.realpath(this._root)) !== this._canonical
    )
      throw storageError()
  }
  private async _initializeRoot() {
    await fs.mkdir(this._root, { recursive: true })
    const stat = await fs.lstat(this._root)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw storageError()
    this._canonical = await fs.realpath(this._root)
    // Main is a single-instance shard. Sweep only our exact crash-orphan names once,
    // before opening any new temp file; never recursively delete or follow a link.
    const temporary =
      /^\.(?:preferences\.json|cache-emerald_plus-all-(?:TOP|JUNGLE|MID|ADC|SUP)\.json\.gz(?:\.previous)?)\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/i
    for (const entry of await fs.readdir(this._root, { withFileTypes: true })) {
      if (!temporary.test(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue
      await fs.unlink(join(this._root, entry.name))
    }
  }
  private async _read(file: string, limit: number): Promise<Buffer | null> {
    try {
      await this._rootReady()
      const path = join(this._root, file),
        stat = await fs.lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size > limit)
        throw storageError()
      const value = await fs.readFile(path)
      await this._rootReady()
      if (value.length > limit) throw storageError()
      return value
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw storageError()
    }
  }
  private async _write(file: string, value: Buffer) {
    await this._rootReady()
    const target = join(this._root, file),
      temp = join(this._root, `.${file}.${randomUUID()}.tmp`)
    try {
      const s = await fs.lstat(target)
      if (s.isSymbolicLink() || !s.isFile() || s.nlink > 1) throw storageError()
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw storageError()
    }
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    try {
      handle = await fs.open(temp, 'wx', 0o600)
      await handle.writeFile(value)
      await handle.sync()
      await handle.close()
      handle = undefined
      await this._rootReady()
      await fs.rename(temp, target)
    } catch {
      throw storageError()
    } finally {
      await handle?.close().catch(() => {})
      await fs.unlink(temp).catch(() => {})
    }
  }
  async getPreferences() {
    await this._rootReady()
    const bytes = await this._read('preferences.json', 64 * 1024)
    if (!bytes) return emptyPreferences()
    try {
      const { schemaVersion: _, ...value } = preferencesSchema.parse(
        JSON.parse(bytes.toString('utf8'))
      )
      return value
    } catch {
      throw storageError()
    }
  }
  savePool(role: DraftRole, championIds: number[]) {
    return this._queue(async () => {
      const previous = await this.getPreferences()
      const next = preferencesSchema.parse({
        schemaVersion: 1,
        ...previous,
        lastRole: role,
        pools: { ...previous.pools, [role]: championIds }
      })
      await this._write('preferences.json', Buffer.from(JSON.stringify(next)))
      const { schemaVersion: _, ...value } = next
      return value
    })
  }
  private _decode(bytes: Buffer, role: DraftRole) {
    const parsed = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_JSON }).toString('utf8'))
    if (parsed.schemaVersion !== 1) throw new Error('unsupported-cache')
    const value = datasetSchema.parse(parsed)
    if (
      value.role !== role ||
      value.source.baselines.length === 0 ||
      new Set(value.heroes.map((h) => h.id)).size !== value.heroes.length
    )
      throw storageError()
    const baselineKeys = new Set<string>()
    for (const b of value.source.baselines) {
      const key = `${b.role}:${b.championId}`
      if (baselineKeys.has(key) || JSON.stringify(b.scope) !== JSON.stringify(value.source.scope))
        throw storageError()
      baselineKeys.add(key)
    }
    if (DRAFT_ROLES.some((r) => !value.source.baselines.some((b) => b.role === r)))
      throw storageError()
    for (const h of value.heroes) {
      if (!baselineKeys.has(`${role}:${h.id}`)) throw storageError()
      const keys = new Set<string>()
      for (const b of h.blocks) {
        const k = `${b.mode}:${b.role}`
        if (
          keys.has(k) ||
          (b.mode === 'synergy' && b.role === role) ||
          new Set(b.pairs.map((p) => p[0])).size !== b.pairs.length ||
          b.pairs.some(
            (p) =>
              (p[1] !== null && (p[0] === h.id || p[2] <= 0)) ||
              (p[3] !== undefined && p[3] !== null && p[2] <= 0)
          )
        )
          throw storageError()
        keys.add(k)
      }
    }
    return value as CachedDataset
  }
  async loadCache(role: DraftRole) {
    await this._rootReady()
    const file = `cache-emerald_plus-all-${role}.json.gz`
    for (const name of [file, `${file}.previous`]) {
      try {
        const bytes = await this._read(name, MAX_CACHE)
        if (bytes) return this._decode(bytes, role)
      } catch (e) {
        if (e instanceof Error && e.message === 'unsupported-cache') throw storageError()
      }
    }
    return null
  }
  saveCache(value: CachedDataset) {
    return this._queue(async () => {
      const json = JSON.stringify(value)
      if (Buffer.byteLength(json) > MAX_JSON) throw storageError()
      const bytes = gzipSync(json)
      if (bytes.length > MAX_CACHE) throw storageError()
      // Validate before publication, including cross-scope and normalized matrix integrity.
      this._decode(bytes, value.role)
      const file = `cache-emerald_plus-all-${value.role}.json.gz`,
        previous = await this._read(file, MAX_CACHE)
      if (previous) {
        let old: CachedDataset | null = null
        try {
          old = this._decode(previous, value.role)
        } catch (e) {
          if (e instanceof Error && e.message === 'unsupported-cache') throw storageError()
        }
        if (old && old.id !== value.id) await this._write(`${file}.previous`, previous)
      }
      await this._write(file, bytes)
    })
  }
}
