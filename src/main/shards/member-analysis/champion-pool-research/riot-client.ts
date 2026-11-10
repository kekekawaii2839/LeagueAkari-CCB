/** Main-process research transport only. No persistence, IPC, renderer or arbitrary URL surface. */
const PLATFORM_ROUTES = [
  'br1',
  'eun1',
  'euw1',
  'jp1',
  'kr',
  'la1',
  'la2',
  'me1',
  'na1',
  'oc1',
  'ph2',
  'ru',
  'sg2',
  'th2',
  'tr1',
  'tw2',
  'vn2'
] as const
const REGIONAL_ROUTES = ['americas', 'asia', 'europe', 'sea'] as const
export type RiotPlatformRoute = (typeof PLATFORM_ROUTES)[number]
export type RiotRegionalRoute = (typeof REGIONAL_ROUTES)[number]
type Route = RiotPlatformRoute | RiotRegionalRoute
type Method = 'leagueEntries' | 'matchIds' | 'matchDetail'
export type RiotResearchErrorCode =
  | 'invalid-input'
  | 'aborted'
  | 'network'
  | 'scheduler'
  | 'redirect'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'upstream'
  | 'invalid-response'

/** Never retains upstream error text, request options, response headers or an exception cause. */
export class RiotResearchError extends Error {
  constructor(
    readonly code: RiotResearchErrorCode,
    readonly status?: number
  ) {
    super(`Riot research request: ${code}`)
    this.name = 'RiotResearchError'
  }
}

interface ResponseLike {
  status: number
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}
export type RiotResearchFetch = (
  url: string,
  options: {
    method: 'GET'
    headers: Record<string, string>
    redirect: 'manual'
    signal?: AbortSignal
  }
) => Promise<ResponseLike>
export interface RiotResearchClientOptions {
  fetch?: RiotResearchFetch
  now?: () => number
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  /** At most three retries after the initial request. Default two. */
  max429Retries?: number
}
export interface RiotLeagueEntriesRequest {
  tier: 'DIAMOND' | 'EMERALD' | 'PLATINUM' | 'GOLD' | 'SILVER' | 'BRONZE' | 'IRON'
  division: 'I' | 'II' | 'III' | 'IV'
  page?: number
}
export interface RiotMatchIdsRequest {
  start?: number
  count?: number
  startTime?: number
  endTime?: number
}
interface WindowBudget {
  limit: number
  periodMs: number
  timestamps: number[]
  /** Conservative accounting for requests made by another consumer of this key. */
  debt: { count: number; expiresAt: number }[]
}
interface RouteState {
  app: Map<number, WindowBudget>
  methods: Map<Method, Map<number, WindowBudget>>
  blockedUntil: number
  tail: Promise<void>
}

function assertInput(valid: boolean): asserts valid {
  if (!valid) throw new RiotResearchError('invalid-input')
}
function checkAbort(signal?: AbortSignal) {
  if (signal?.aborted) throw new RiotResearchError('aborted')
}
async function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  checkAbort(signal)
  if (!signal) return operation
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new RiotResearchError('aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
async function defaultSleep(milliseconds: number, signal?: AbortSignal) {
  checkAbort(signal)
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer)
      reject(new RiotResearchError('aborted'))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, milliseconds)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
function newWindow(limit: number, periodMs: number): WindowBudget {
  return { limit, periodMs, timestamps: [], debt: [] }
}
function parseBudgets(value: string | null): Map<number, number> {
  const result = new Map<number, number>()
  for (const part of (value ?? '').split(',').slice(0, 8)) {
    const match = /^\s*(\d+)\s*:\s*(\d+(?:\.\d+)?)\s*$/.exec(part)
    if (!match) continue
    const limit = Number(match[1]),
      periodMs = Number(match[2]) * 1000
    if (
      Number.isSafeInteger(limit) &&
      limit > 0 &&
      Number.isSafeInteger(periodMs) &&
      periodMs >= 1 &&
      periodMs <= 86_400_000
    ) {
      result.set(periodMs, Math.min(result.get(periodMs) ?? Infinity, limit))
    }
  }
  return result
}
function activeCount(window: WindowBudget, now: number) {
  window.timestamps = window.timestamps.filter((timestamp) => timestamp > now - window.periodMs)
  window.debt = window.debt.filter((item) => item.expiresAt > now)
  return window.timestamps.length + window.debt.reduce((sum, item) => sum + item.count, 0)
}

export class RiotResearchClient {
  // JS-private so accidental JSON serialization cannot expose the injected credential.
  #_apiKey: string
  private readonly _fetch: RiotResearchFetch
  private readonly _now: () => number
  private readonly _sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>
  private readonly _max429Retries: number
  private readonly _routes = new Map<Route, RouteState>()

  constructor(apiKey: string, options: RiotResearchClientOptions = {}) {
    assertInput(apiKey.length > 0 && apiKey.length <= 512 && !/[^\x21-\x7e]/.test(apiKey))
    this.#_apiKey = apiKey
    this._fetch = options.fetch ?? globalThis.fetch
    this._now = options.now ?? Date.now
    this._sleep = options.sleep ?? defaultSleep
    this._max429Retries = options.max429Retries ?? 2
    assertInput(
      Number.isInteger(this._max429Retries) && this._max429Retries >= 0 && this._max429Retries <= 3
    )
  }

  async getLeagueEntries(
    route: RiotPlatformRoute,
    request: RiotLeagueEntriesRequest,
    signal?: AbortSignal
  ): Promise<unknown[]> {
    assertInput(PLATFORM_ROUTES.includes(route))
    assertInput(
      ['DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON'].includes(request.tier)
    )
    assertInput(['I', 'II', 'III', 'IV'].includes(request.division))
    const page = request.page ?? 1
    assertInput(Number.isSafeInteger(page) && page > 0 && page <= 10000)
    const data = await this._request(
      route,
      'leagueEntries',
      `/lol/league/v4/entries/RANKED_SOLO_5x5/${request.tier}/${request.division}?page=${page}`,
      signal
    )
    if (!Array.isArray(data)) throw new RiotResearchError('invalid-response', 200)
    return data
  }

  async getMatchIds(
    route: RiotRegionalRoute,
    puuid: string,
    request: RiotMatchIdsRequest = {},
    signal?: AbortSignal
  ): Promise<string[]> {
    assertInput(REGIONAL_ROUTES.includes(route))
    assertInput(/^[A-Za-z0-9_-]{40,128}$/.test(puuid))
    const start = request.start ?? 0,
      count = request.count ?? 100
    assertInput(Number.isSafeInteger(start) && start >= 0 && start <= 1_000_000)
    assertInput(Number.isSafeInteger(count) && count >= 1 && count <= 100)
    for (const time of [request.startTime, request.endTime])
      assertInput(time === undefined || (Number.isSafeInteger(time) && time >= 0))
    assertInput(
      request.startTime === undefined ||
        request.endTime === undefined ||
        request.startTime < request.endTime
    )
    const query = new URLSearchParams({
      queue: '420',
      type: 'ranked',
      start: String(start),
      count: String(count)
    })
    if (request.startTime !== undefined) query.set('startTime', String(request.startTime))
    if (request.endTime !== undefined) query.set('endTime', String(request.endTime))
    const data = await this._request(
      route,
      'matchIds',
      `/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?${query}`,
      signal
    )
    if (
      !Array.isArray(data) ||
      data.length > count ||
      !data.every((id) => typeof id === 'string' && /^[A-Z0-9]+_\d+$/.test(id))
    ) {
      throw new RiotResearchError('invalid-response', 200)
    }
    return data
  }

  async getMatch(
    route: RiotRegionalRoute,
    matchId: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    assertInput(REGIONAL_ROUTES.includes(route))
    assertInput(/^[A-Z0-9]+_\d+$/.test(matchId))
    const data = await this._request(
      route,
      'matchDetail',
      `/lol/match/v5/matches/${matchId}`,
      signal
    )
    if (data === null || typeof data !== 'object' || Array.isArray(data))
      throw new RiotResearchError('invalid-response', 200)
    return data as Record<string, unknown>
  }

  private _state(route: Route) {
    let state = this._routes.get(route)
    if (!state) {
      state = {
        app: new Map([
          [1000, newWindow(20, 1000)],
          [120000, newWindow(100, 120000)]
        ]),
        methods: new Map(),
        blockedUntil: 0,
        tail: Promise.resolve()
      }
      this._routes.set(route, state)
    }
    return state
  }

  private async _reserve(state: RouteState, method: Method, signal?: AbortSignal) {
    checkAbort(signal)
    for (;;) {
      const now = this._now()
      const windows = [...state.app.values(), ...(state.methods.get(method)?.values() ?? [])]
      let wait = Math.max(0, state.blockedUntil - now)
      for (const window of windows) {
        if (activeCount(window, now) >= window.limit) {
          const nextExpiry = Math.min(
            ...window.timestamps.map((timestamp) => timestamp + window.periodMs),
            ...window.debt.map((item) => item.expiresAt)
          )
          wait = Math.max(wait, nextExpiry - now)
        }
      }
      if (wait <= 0) {
        for (const window of windows) window.timestamps.push(now)
        return
      }
      try {
        // Native setTimeout overflows above its signed 32-bit delay range.
        // Chunking a very long server cooldown never permits an earlier request.
        await this._sleep(Math.min(wait, 2_147_483_647), signal)
      } catch {
        throw new RiotResearchError(signal?.aborted ? 'aborted' : 'scheduler')
      }
      checkAbort(signal)
    }
  }

  private _updateBudgets(state: RouteState, method: Method, headers: ResponseLike['headers']) {
    const now = this._now()
    let methodWindows = state.methods.get(method)
    if (!methodWindows) {
      methodWindows = new Map()
      state.methods.set(method, methodWindows)
    }
    for (const [prefix, windows] of [
      ['X-App', state.app],
      ['X-Method', methodWindows]
    ] as const) {
      for (const [period, limit] of parseBudgets(headers.get(`${prefix}-Rate-Limit`))) {
        const current = windows.get(period)
        if (current) current.limit = Math.min(current.limit, limit)
        else windows.set(period, { ...newWindow(limit, period), timestamps: [now] })
      }
      for (const [period, count] of parseBudgets(headers.get(`${prefix}-Rate-Limit-Count`))) {
        const window = windows.get(period)
        if (!window) continue
        const additional = count - activeCount(window, now)
        if (additional > 0) window.debt.push({ count: additional, expiresAt: now + period })
      }
    }
  }

  private async _request(
    route: Route,
    method: Method,
    path: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    const state = this._state(route)
    // Serialize a route through response headers so a newly learned tighter method
    // budget takes effect before the next request. Other routing values stay independent.
    const operation = state.tail.then(() => this._attempt(state, route, method, path, signal))
    state.tail = operation.then(
      () => {},
      () => {}
    )
    return abortable(operation, signal)
  }

  private async _attempt(
    state: RouteState,
    route: Route,
    method: Method,
    path: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      checkAbort(signal)
      await this._reserve(state, method, signal)
      checkAbort(signal)
      let response: ResponseLike
      try {
        response = await abortable(
          this._fetch(`https://${route}.api.riotgames.com${path}`, {
            method: 'GET',
            redirect: 'manual',
            headers: { 'X-Riot-Token': this.#_apiKey, Accept: 'application/json' },
            signal
          }),
          signal
        )
      } catch {
        throw new RiotResearchError(signal?.aborted ? 'aborted' : 'network')
      }
      checkAbort(signal)
      this._updateBudgets(state, method, response.headers)
      const status = response.status
      if (status >= 300 && status < 400) throw new RiotResearchError('redirect', status)
      if (status === 429) {
        const value = response.headers.get('Retry-After')
        const seconds = value === null || value.trim() === '' ? NaN : Number(value)
        const date = value === null ? NaN : Date.parse(value)
        const delay =
          Number.isFinite(seconds) && seconds >= 0
            ? seconds * 1000
            : Number.isFinite(date)
              ? date - this._now()
              : 120000
        state.blockedUntil = Math.max(state.blockedUntil, this._now() + Math.max(1000, delay))
        if (attempt >= this._max429Retries) throw new RiotResearchError('rate-limited', status)
        continue
      }
      if (status !== 200) {
        const code =
          status === 401
            ? 'unauthorized'
            : status === 403
              ? 'forbidden'
              : status === 404
                ? 'not-found'
                : 'upstream'
        throw new RiotResearchError(code, status)
      }
      try {
        return await abortable(response.json(), signal)
      } catch {
        throw new RiotResearchError(signal?.aborted ? 'aborted' : 'invalid-response', status)
      }
    }
  }
}
