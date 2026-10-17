import type { ProfileIconLookup } from './profile-icon-lookup'

export interface CurrentProfileIconSource {
  session(): string | null
  ready(serverId: string): boolean
  query(serverId: string, puuids: string[], signal: AbortSignal): Promise<unknown[]>
}
/** Main-only, exact-identity SGP lookup. No names, arbitrary URLs or renderer IO. */
export class CurrentProfileIcons {
  private _session: string | null = null
  private _disposed = false
  private _active = 0
  private readonly _cache = new Map<string, { icon: number | null; expires: number }>()
  private readonly _pending = new Map<string, Promise<number | null>>()
  private readonly _controllers = new Set<AbortController>()
  constructor(
    private readonly _source: CurrentProfileIconSource,
    private readonly _now = () => Date.now()
  ) {}
  clear() {
    for (const controller of this._controllers) controller.abort()
    this._cache.clear()
    this._pending.clear()
    this._session = null
  }
  dispose() {
    this._disposed = true
    this.clear()
  }
  async resolve(
    lookups: ProfileIconLookup[],
    assertCurrent: () => void
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>(),
      session = this._source.session()
    if (this._disposed || !session) return result
    if (session !== this._session) {
      this.clear()
      this._session = session
    }
    const key = (row: ProfileIconLookup) => JSON.stringify([row.serverId, row.puuid])
    const unique = [...new Map(lookups.map((row) => [key(row), row])).values()]
    const missing = new Map<string, ProfileIconLookup[]>()
    const waiting: Promise<void>[] = []
    for (const row of unique) {
      const cached = this._cache.get(key(row))
      if (cached && cached.expires > this._now()) {
        this._cache.delete(key(row))
        this._cache.set(key(row), cached)
        if (cached.icon !== null) result.set(row.identity, cached.icon)
      } else if (this._pending.has(key(row))) {
        waiting.push(
          this._pending.get(key(row))!.then((icon) => {
            if (icon !== null) result.set(row.identity, icon)
          })
        )
      } else if (this._source.ready(row.serverId)) {
        const group = missing.get(row.serverId) ?? []
        group.push(row)
        missing.set(row.serverId, group)
      }
    }
    const jobs = [...missing].flatMap(([serverId, rows]) =>
      Array.from({ length: Math.ceil(rows.length / 20) }, (_, i) => ({
        serverId,
        rows: rows.slice(i * 20, i * 20 + 20)
      }))
    )
    const controller = new AbortController()
    this._controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 3000)
    const cancelled = new Promise<null>((resolve) =>
      controller.signal.addEventListener('abort', () => resolve(null), { once: true })
    )
    let index = 0
    try {
      const run = async () => {
        while (index < jobs.length && !controller.signal.aborted) {
          if (this._active >= 2) return // never queue an unbounded UI/network workload
          const job = jobs[index++]
          this._active++
          try {
            const pending = Promise.race([
              (async () =>
                this._source.query(
                  job.serverId,
                  job.rows.map((row) => row.puuid),
                  controller.signal
                ))().catch(() => null),
              cancelled
            ])
            for (const row of job.rows) {
              const entry: Promise<number | null> = pending
                .then((response) => {
                  const matches = Array.isArray(response)
                    ? response.filter((value: any) => value && value.puuid === row.puuid)
                    : []
                  const icon = matches.length === 1 ? (matches[0] as any).profileIconId : null
                  return Number.isSafeInteger(icon) && icon >= 0 ? (icon as number) : null
                })
                .finally(() => {
                  if (this._pending.get(key(row)) === entry) this._pending.delete(key(row))
                })
              this._pending.set(key(row), entry)
            }
            const response = await pending
            assertCurrent()
            if (this._disposed || this._source.session() !== session || this._session !== session)
              return
            for (const row of job.rows) {
              const matches = Array.isArray(response)
                ? response.filter((value: any) => value && value.puuid === row.puuid)
                : []
              const icon = matches.length === 1 ? (matches[0] as any).profileIconId : null
              const valid = Number.isSafeInteger(icon) && icon >= 0 ? (icon as number) : null
              this._cache.delete(key(row))
              this._cache.set(key(row), {
                icon: valid,
                expires: this._now() + (valid === null ? 30000 : 300000)
              })
              while (this._cache.size > 256) this._cache.delete(this._cache.keys().next().value!)
              if (valid !== null) result.set(row.identity, valid)
            }
          } finally {
            this._active--
          }
        }
      }
      await Promise.all([run(), run(), ...waiting])
      assertCurrent()
      return this._source.session() === session && this._session === session ? result : new Map()
    } finally {
      clearTimeout(timer)
      controller.abort()
      this._controllers.delete(controller)
    }
  }
}
