import { describe, expect, it, vi } from 'vitest'

import { RiotResearchClient, RiotResearchError, type RiotResearchFetch } from './riot-client'

const secret = 'synthetic-credential-only'
const league = { tier: 'DIAMOND', division: 'I' } as const
function response(status = 200, payload: unknown = [], headers: Record<string, string> = {}) {
  const normalized = new Map(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  )
  return {
    status,
    headers: { get: (name: string) => normalized.get(name.toLowerCase()) ?? null },
    json: vi.fn(async () => payload)
  }
}
function harness(fetcher: RiotResearchFetch = async () => response(), max429Retries = 2) {
  let time = 0
  const sleeps: number[] = [],
    starts: { route: string; time: number }[] = []
  const fetch = vi.fn<RiotResearchFetch>(async (url, options) => {
    starts.push({ route: new URL(url).hostname.split('.')[0], time })
    return fetcher(url, options)
  })
  const client = new RiotResearchClient(secret, {
    fetch,
    now: () => time,
    sleep: async (milliseconds, signal) => {
      if (signal?.aborted) throw new Error('aborted')
      sleeps.push(milliseconds)
      time += milliseconds
    },
    max429Retries
  })
  return { client, fetch, sleeps, starts, now: () => time }
}

describe('main-only Riot research transport, synthetic requests', () => {
  it('constructs only fixed official HTTPS endpoints with header authentication and no redirects', async () => {
    const h = harness(async (url) =>
      response(
        200,
        url.includes('/ids?')
          ? ['EUW1_123']
          : url.includes('/matches/EUW1_')
            ? { metadata: { matchId: 'EUW1_123' } }
            : []
      )
    )
    await h.client.getLeagueEntries('euw1', { ...league, page: 2 })
    await h.client.getMatchIds('europe', 'a'.repeat(78), {
      start: 5,
      count: 10,
      startTime: 100,
      endTime: 200
    })
    await h.client.getMatch('europe', 'EUW1_123')
    const calls = h.fetch.mock.calls
    expect(calls[0][0]).toBe(
      'https://euw1.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/DIAMOND/I?page=2'
    )
    const ids = new URL(calls[1][0])
    expect(ids.hostname).toBe('europe.api.riotgames.com')
    expect(Object.fromEntries(ids.searchParams)).toEqual({
      queue: '420',
      type: 'ranked',
      start: '5',
      count: '10',
      startTime: '100',
      endTime: '200'
    })
    expect(calls[2][0]).toBe('https://europe.api.riotgames.com/lol/match/v5/matches/EUW1_123')
    expect(
      calls.every(
        ([, options]) => options.redirect === 'manual' && options.headers['X-Riot-Token'] === secret
      )
    ).toBe(true)
    expect(calls.every(([url]) => !url.includes(secret))).toBe(true)
    expect(JSON.stringify(h.client)).not.toContain(secret)
  })

  it('rejects arbitrary routes, path injection and invalid request ranges before transport', async () => {
    const h = harness()
    await expect(h.client.getLeagueEntries('evil.invalid' as 'euw1', league)).rejects.toMatchObject(
      { code: 'invalid-input' }
    )
    await expect(
      h.client.getLeagueEntries('euw1', { ...league, tier: '../secret' as 'DIAMOND' })
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.client.getLeagueEntries('euw1', { ...league, page: 0 })).rejects.toMatchObject({
      code: 'invalid-input'
    })
    await expect(h.client.getMatchIds('europe', '../secret')).rejects.toMatchObject({
      code: 'invalid-input'
    })
    await expect(
      h.client.getMatchIds('europe', 'a'.repeat(78), { count: 101 })
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(
      h.client.getMatchIds('europe', 'a'.repeat(78), { startTime: 200, endTime: 100 })
    ).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(h.client.getMatch('europe', 'https://evil.invalid')).rejects.toMatchObject({
      code: 'invalid-input'
    })
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it('enforces both the 20-per-second and 100-per-120-second windows without real waits', async () => {
    const h = harness()
    for (let i = 0; i < 101; i++) await h.client.getLeagueEntries('euw1', league)
    expect(h.starts[19].time).toBe(0)
    expect(h.starts[20].time).toBe(1000)
    expect(h.starts[99].time).toBe(4000)
    expect(h.starts[100].time).toBe(120000)
  })

  it('keeps full routing values independent', async () => {
    const h = harness()
    for (let i = 0; i < 20; i++) await h.client.getLeagueEntries('euw1', league)
    await h.client.getLeagueEntries('na1', league)
    expect(h.starts[20]).toEqual({ route: 'na1', time: 0 })
    await h.client.getLeagueEntries('euw1', league)
    expect(h.starts[21]).toEqual({ route: 'euw1', time: 1000 })
  })

  it('does not relax local budgets when the server advertises higher app limits', async () => {
    const h = harness(async () => response(200, [], { 'X-App-Rate-Limit': '10000:1,1000000:120' }))
    for (let i = 0; i < 101; i++) await h.client.getLeagueEntries('euw1', league)
    expect(h.starts[20].time).toBe(1000)
    expect(h.starts[100].time).toBe(120000)
  })

  it('learns stricter app and method budgets without coupling different method windows', async () => {
    const h = harness(async (url) =>
      response(200, url.includes('/ids?') ? [] : [], { 'X-Method-Rate-Limit': '1:10' })
    )
    await h.client.getLeagueEntries('euw1', league)
    await h.client.getLeagueEntries('euw1', league)
    expect(h.starts.map((s) => s.time)).toEqual([0, 10000])
    const stricter = harness(async () => response(200, [], { 'X-App-Rate-Limit': '1:5' }))
    await stricter.client.getLeagueEntries('euw1', league)
    await stricter.client.getLeagueEntries('euw1', league)
    expect(stricter.starts.map((s) => s.time)).toEqual([0, 5000])
    const regional = harness(async (url) =>
      response(200, url.includes('/ids?') ? [] : {}, { 'X-Method-Rate-Limit': '1:10' })
    )
    await regional.client.getMatchIds('europe', 'a'.repeat(78))
    await regional.client.getMatch('europe', 'EUW1_123')
    expect(regional.starts.map((s) => s.time)).toEqual([0, 0])
  })

  it('conservatively accounts for other consumers seen in server counters', async () => {
    const h = harness(async () =>
      response(200, [], { 'X-App-Rate-Limit': '100:120', 'X-App-Rate-Limit-Count': '100:120' })
    )
    await h.client.getLeagueEntries('euw1', league)
    await h.client.getLeagueEntries('euw1', league)
    expect(h.starts.map((s) => s.time)).toEqual([0, 120000])
  })

  it('honors Retry-After seconds and performs only a bounded number of 429 retries', async () => {
    const h = harness(async () => response(429, { sensitive: secret }, { 'Retry-After': '3' }), 1)
    await expect(h.client.getLeagueEntries('euw1', league)).rejects.toMatchObject({
      code: 'rate-limited',
      status: 429
    })
    expect(h.fetch).toHaveBeenCalledTimes(2)
    expect(h.starts.map((s) => s.time)).toEqual([0, 3000])
    expect(h.sleeps).toEqual([3000])
  })

  it('supports Retry-After dates and preserves route cooldown after exhausting retries', async () => {
    let n = 0
    const h = harness(
      async () =>
        ++n <= 2 ? response(429, {}, { 'Retry-After': new Date(10000).toUTCString() }) : response(),
      1
    )
    await expect(h.client.getLeagueEntries('euw1', league)).rejects.toMatchObject({
      code: 'rate-limited'
    })
    await h.client.getLeagueEntries('euw1', league)
    expect(h.starts.map((s) => s.time)).toEqual([0, 10000, 11000])
  })

  it('uses conservative fallback for missing or malformed limit headers', async () => {
    let n = 0
    const h = harness(async () =>
      ++n === 1
        ? response(429, {}, { 'Retry-After': 'not-a-date', 'X-App-Rate-Limit': 'garbage' })
        : response()
    )
    await h.client.getLeagueEntries('euw1', league)
    expect(h.sleeps).toEqual([120000])
  })

  it('never reads error bodies or leaks transport exception details', async () => {
    const upstream = response(401, { message: secret })
    const h = harness(async () => upstream)
    try {
      await h.client.getLeagueEntries('euw1', league)
      expect.fail('expected rejection')
    } catch (error) {
      expect(error).toBeInstanceOf(RiotResearchError)
      expect(error).toMatchObject({ code: 'unauthorized', status: 401 })
      expect(JSON.stringify(error)).not.toContain(secret)
      expect(String(error)).not.toContain(secret)
    }
    expect(upstream.json).not.toHaveBeenCalled()
    const network = harness(async () => {
      throw new Error(`transport accidentally includes ${secret}`)
    })
    await expect(network.client.getLeagueEntries('euw1', league)).rejects.toMatchObject({
      code: 'network',
      message: 'Riot research request: network'
    })
  })

  it('refuses redirects and validates successful payload containers', async () => {
    const redirected = harness(async () => response(302))
    await expect(redirected.client.getLeagueEntries('euw1', league)).rejects.toMatchObject({
      code: 'redirect',
      status: 302
    })
    expect(redirected.fetch).toHaveBeenCalledTimes(1)
    await expect(
      harness(async () => response(200, {})).client.getLeagueEntries('euw1', league)
    ).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(
      harness(async () => response(200, ['not a match id'])).client.getMatchIds(
        'europe',
        'a'.repeat(78)
      )
    ).rejects.toMatchObject({ code: 'invalid-response' })
    await expect(
      harness(async () => response(200, [])).client.getMatch('europe', 'EUW1_123')
    ).rejects.toMatchObject({ code: 'invalid-response' })
  })

  it('aborts before dispatch, during transport, and while queued behind another request', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    const h = harness()
    await expect(h.client.getLeagueEntries('euw1', league, cancelled.signal)).rejects.toMatchObject(
      { code: 'aborted' }
    )
    expect(h.fetch).not.toHaveBeenCalled()
    let finish!: (value: ReturnType<typeof response>) => void
    const pending = harness(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const first = pending.client.getLeagueEntries('euw1', league)
    await vi.waitFor(() => expect(pending.fetch).toHaveBeenCalledTimes(1))
    const queuedAbort = new AbortController()
    const queued = pending.client.getLeagueEntries('euw1', league, queuedAbort.signal)
    queuedAbort.abort()
    await expect(queued).rejects.toMatchObject({ code: 'aborted' })
    finish(response())
    await first
    expect(pending.fetch).toHaveBeenCalledTimes(1)
    const activeAbort = new AbortController()
    const active = pending.client.getLeagueEntries('na1', league, activeAbort.signal)
    await vi.waitFor(() => expect(pending.fetch).toHaveBeenCalledTimes(2))
    activeAbort.abort()
    await expect(active).rejects.toMatchObject({ code: 'aborted' })
  })

  it('cancels an active rate-limit sleep without dispatching another request', async () => {
    const fetch = vi.fn<RiotResearchFetch>(async () => response())
    const sleeping = vi.fn(
      async (_milliseconds: number, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        })
    )
    const client = new RiotResearchClient(secret, { fetch, now: () => 0, sleep: sleeping })
    for (let i = 0; i < 20; i++) await client.getLeagueEntries('euw1', league)
    const controller = new AbortController()
    const pending = client.getLeagueEntries('euw1', league, controller.signal)
    await vi.waitFor(() => expect(sleeping).toHaveBeenCalledTimes(1))
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(fetch).toHaveBeenCalledTimes(20)
  })
})
