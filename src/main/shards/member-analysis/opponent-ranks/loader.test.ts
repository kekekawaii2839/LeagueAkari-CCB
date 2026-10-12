import {
  type PlayerRankSnapshot,
  normalizeRankedStats
} from '@shared/shards/member-analysis/opponent-ranks'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { OpponentRankLoader, type RankGameTarget } from './loader'

const target = (serverId = 'TEST', gameId = 1): RankGameTarget => ({
  serverId,
  gameId,
  opponents: Array.from({ length: 5 }, (_, i) => ({
    puuid: `synthetic-enemy-${i}`,
    role: null,
    champion: null
  }))
})
const limits = {
  requests: 300,
  milliseconds: 90_000,
  spacing: 0,
  timeout: 5_000,
  retries: 0,
  retryDelay: 0
}
function harness() {
  const cache = new Map<string, PlayerRankSnapshot>()
  const sgp = {
    state: {
      isTokenReady: true,
      availability: { sgpServerId: 'TEST', serversSupported: { common: true } }
    },
    api: {
      leaguesLedge: {
        getRankedStatsByPuuid: vi.fn(async (_puuid: string, _options: unknown) => ({
          data: {
            queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'III', leaguePoints: 0 }]
          }
        }))
      }
    }
  }
  const repository = {
    readPlayer: vi.fn((server: string, puuid: string) => cache.get(`${server}:${puuid}`) ?? null),
    writePlayer: vi.fn((server: string, puuid: string, value: PlayerRankSnapshot) => {
      cache.set(`${server}:${puuid}`, value)
    }),
    readGame: vi.fn(),
    prune: vi.fn()
  }
  return { cache, sgp, repository, loader: new OpponentRankLoader(sgp as any, repository as any) }
}
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
describe('main-only opponent rank collection', () => {
  test('a response slower than the old 5-second deadline succeeds under the new default', async () => {
    vi.useFakeTimers()
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(new Error('synthetic timeout')), milliseconds)
      return controller.signal
    })
    const h = harness(),
      game = target()
    game.opponents.slice(1).forEach((opponent) => {
      opponent.puuid = null
    })
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockImplementation(
      (_puuid, options) =>
        new Promise((resolve, reject) => {
          setTimeout(() => resolve({ data: { queues: [] } }), 6000)
          ;(options as { signal: AbortSignal }).signal.addEventListener(
            'abort',
            () => reject(new Error('synthetic timeout')),
            { once: true }
          )
        })
    )
    const pending = h.loader.load([game], new AbortController().signal, vi.fn())
    await vi.advanceTimersByTimeAsync(6000)
    const result = await pending
    expect(result[0].ranks.opponents[0].snapshot.status).toBe('ok')
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(1)
  })
  test('fully cached history yields to cancellation without flooding progress events', async () => {
    const h = harness()
    await h.loader.load([target()], new AbortController().signal, vi.fn(), limits)
    const controller = new AbortController(),
      progress = vi.fn()
    const timer = setTimeout(() => controller.abort(new Error('cancelled')), 0)
    try {
      await expect(
        h.loader.load(
          Array.from({ length: 50 }, (_, index) => target('TEST', index)),
          controller.signal,
          progress,
          limits
        )
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(controller.signal.aborted).toBe(true)
      expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
      expect(progress.mock.calls.length).toBeLessThan(25)
    } finally {
      clearTimeout(timer)
    }
  })
  test('deduplicates across matches and reuses a 24-hour queue-preserving cache', async () => {
    const h = harness()
    const result = await h.loader.load(
      [target(), target('TEST', 2)],
      new AbortController().signal,
      vi.fn(),
      limits
    )
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
    expect(result[1].ranks.opponents[0].snapshot.flex).toMatchObject({
      status: 'ranked',
      rank: { leaguePoints: 0 }
    })
    expect(JSON.stringify(result.map((game) => game.ranks))).not.toContain('synthetic-enemy')
    await h.loader.load([target()], new AbortController().signal, vi.fn(), limits)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
    const request = h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mock.calls[0][1] as Record<
      string,
      unknown
    >
    expect(Object.keys(request).sort()).toEqual(['__sgpServerId', 'retry', 'signal'])
    expect(request.retry).toBe(false)
  })
  test.each([
    [
      'cross-region',
      (h: ReturnType<typeof harness>) => {
        h.sgp.state.availability.sgpServerId = 'OTHER'
      }
    ],
    [
      'disconnected',
      (h: ReturnType<typeof harness>) => {
        h.sgp.state.availability.sgpServerId = ''
      }
    ],
    [
      'unsupported',
      (h: ReturnType<typeof harness>) => {
        h.sgp.state.availability.serversSupported.common = false
      }
    ],
    [
      'auth-unavailable',
      (h: ReturnType<typeof harness>) => {
        h.sgp.state.isTokenReady = false
      }
    ]
  ] as const)('reports %s without issuing a request', async (reason, configure) => {
    const h = harness()
    configure(h)
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), limits)
    expect(result[0].ranks.opponents.every((opponent) => opponent.snapshot.reason === reason)).toBe(
      true
    )
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).not.toHaveBeenCalled()
  })
  test('rate-limit circuit stops subsequent queries and retains explicitly stale facts', async () => {
    const h = harness()
    h.cache.set(
      'TEST:synthetic-enemy-0',
      normalizeRankedStats(
        { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV' }] },
        new Date(Date.now() - 2 * 86400_000).toISOString()
      )
    )
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockRejectedValue({ response: { status: 429 } })
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), limits)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(1)
    expect(result[0].ranks.opponents[0].snapshot).toMatchObject({
      status: 'stale',
      reason: 'rate-limited',
      flex: { status: 'ranked' }
    })
    expect(result[0].ranks.opponents[1].snapshot).toMatchObject({
      status: 'unavailable',
      reason: 'rate-limited',
      fetchedAt: null
    })
  })
  test('request budget remains explicit and continues from cached identities on next refresh', async () => {
    const h = harness()
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      requests: 2
    })
    expect(result[0].ranks.opponents.map(({ snapshot }) => snapshot.reason)).toEqual([
      null,
      null,
      'budget-exhausted',
      'budget-exhausted',
      'budget-exhausted'
    ])
    await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      requests: 2
    })
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(4)
  })
  test('prioritizes oldest uncovered matches and resumes immediately across small-budget refreshes', async () => {
    const h = harness()
    const newest = target('TEST', 3),
      middle = target('TEST', 2),
      oldest = target('TEST', 1)
    for (const game of [newest, middle, oldest])
      game.opponents.forEach((opponent, i) => {
        opponent.puuid = `synthetic-${game.gameId}-${i}`
      })
    const saved = new Map<number, any>()
    h.repository.readGame.mockImplementation((_server: string, id: number) => saved.get(id))
    for (let run = 0; run < 3; run++) {
      const results = await h.loader.load(
        [newest, middle, oldest],
        new AbortController().signal,
        vi.fn(),
        { ...limits, requests: 5 }
      )
      expect(results.map((game) => game.gameId)).toEqual([3, 2, 1])
      results.forEach((game) => saved.set(game.gameId, game.ranks))
      expect(
        results.filter((game) =>
          game.ranks.opponents.every(({ snapshot }) => snapshot.status === 'ok')
        )
      ).toHaveLength(run + 1)
    }
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mock.calls[0][0]).toBe('synthetic-1-0')
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(15)
    h.cache.clear()
    const result = await h.loader.load(
      [newest, middle, oldest],
      new AbortController().signal,
      vi.fn(),
      limits
    )
    expect(
      result.every((game) => game.ranks.opponents.every(({ snapshot }) => snapshot.status === 'ok'))
    ).toBe(true)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(15)
  })
  test('fills only missing slots in a saved game, even after the volatile player cache is gone', async () => {
    const h = harness(),
      game = target()
    const first = await h.loader.load([game], new AbortController().signal, vi.fn(), {
      ...limits,
      requests: 2
    })
    h.repository.readGame.mockReturnValue(first[0].ranks)
    h.cache.clear()
    const second = await h.loader.load([game], new AbortController().signal, vi.fn(), {
      ...limits,
      requests: 3
    })
    expect(second[0].ranks.opponents.every(({ snapshot }) => snapshot.status === 'ok')).toBe(true)
    expect(second[0].ranks.opponents.slice(0, 2)).toEqual(first[0].ranks.opponents.slice(0, 2))
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
  })
  test('does not overwrite a successful per-match query time when the player has a newer rank', async () => {
    const h = harness(),
      game = target()
    const first = await h.loader.load([game], new AbortController().signal, vi.fn(), limits)
    h.repository.readGame.mockReturnValue(first[0].ranks)
    const later = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'I' }] },
      new Date(Date.now() + 1000).toISOString()
    )
    h.cache.set('TEST:synthetic-enemy-0', later)
    const second = await h.loader.load([game], new AbortController().signal, vi.fn(), limits)
    expect(second).toEqual(first)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
  })
  test('schema failures, duplicate identities and cancellation never fabricate ranks', async () => {
    const h = harness()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockResolvedValue({ data: {} } as any)
    const invalid = await h.loader.load([target()], new AbortController().signal, vi.fn(), limits)
    expect(invalid[0].ranks.opponents[0].snapshot.reason).toBe('invalid-response')
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(1)
    const duplicate = target()
    duplicate.opponents[1].puuid = duplicate.opponents[0].puuid
    const result = await h.loader.load([duplicate], new AbortController().signal, vi.fn(), limits)
    expect(
      result[0].ranks.opponents
        .slice(0, 2)
        .every(({ snapshot }) => snapshot.reason === 'identity-missing')
    ).toBe(true)
    const controller = new AbortController()
    const pending = harness()
    pending.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockImplementation(async () => {
      controller.abort(new Error('cancelled'))
      throw new Error('private remote error')
    })
    await expect(
      pending.loader.load([target()], controller.signal, vi.fn(), limits)
    ).rejects.toThrow('cancelled')
    expect(pending.repository.writePlayer).not.toHaveBeenCalled()
  })
  test('actual in-flight timeout stops a stalled endpoint', async () => {
    const h = harness()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockImplementation(
      (_puuid, options) =>
        new Promise((_, reject) => {
          const signal = (options as { signal: AbortSignal }).signal
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        })
    )
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      timeout: 10
    })
    expect(result[0].ranks.opponents.map(({ snapshot }) => snapshot.reason)).toEqual([
      'network-error',
      'network-error',
      'network-error',
      'network-paused',
      'network-paused'
    ])
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(3)
  })
  test('recovers a transient failure with bounded retries without marking the whole batch failed', async () => {
    const h = harness()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockRejectedValueOnce(
      new Error('synthetic timeout')
    )
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      retries: 2
    })
    expect(result[0].ranks.opponents.every(({ snapshot }) => snapshot.status === 'ok')).toBe(true)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(6)
  })
  test('an exhausted single opponent does not stop others; immediate manual refresh retries its failed cache', async () => {
    const h = harness()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid
      .mockRejectedValueOnce(new Error('synthetic network failure'))
      .mockRejectedValueOnce(new Error('synthetic network failure'))
      .mockRejectedValueOnce(new Error('synthetic network failure'))
    const result = await h.loader.load(
      [target(), target('TEST', 2)],
      new AbortController().signal,
      vi.fn(),
      { ...limits, retries: 2 }
    )
    expect(result[0].ranks.opponents[0].snapshot.reason).toBe('network-error')
    expect(
      result[0].ranks.opponents.slice(1).every(({ snapshot }) => snapshot.status === 'ok')
    ).toBe(true)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(7)
    const refreshed = await h.loader.load([target()], new AbortController().signal, vi.fn(), limits)
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(8)
    expect(refreshed[0].ranks.opponents.every(({ snapshot }) => snapshot.status === 'ok')).toBe(
      true
    )
  })
  test('success resets the consecutive-failure circuit; HTTP 503 retries but HTTP 404 does not', async () => {
    const h = harness()
    const call = h.sgp.api.leaguesLedge.getRankedStatsByPuuid
    call.mockRejectedValueOnce({ response: { status: 503 } })
    const recovered = await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      retries: 2
    })
    expect(recovered[0].ranks.opponents[0].snapshot.status).toBe('ok')
    expect(call).toHaveBeenCalledTimes(6)
    const other = harness()
    other.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockImplementation(async (puuid) => {
      if (puuid.endsWith('0') || puuid.endsWith('2') || puuid.endsWith('4'))
        throw new Error('synthetic timeout')
      return { data: { queues: [] } }
    })
    const result = await other.loader.load(
      [target()],
      new AbortController().signal,
      vi.fn(),
      limits
    )
    expect(
      result[0].ranks.opponents.every(({ snapshot }) => snapshot.reason !== 'network-paused')
    ).toBe(true)
    expect(other.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
    const missing = harness()
    missing.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockRejectedValueOnce({
      response: { status: 404 }
    })
    await missing.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      retries: 2
    })
    expect(missing.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(5)
  })
  test('persistent outages have a strict attempt bound and distinguish unattempted opponents', async () => {
    const h = harness()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockRejectedValue(new Error('synthetic timeout'))
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      retries: 2
    })
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(9)
    expect(result[0].ranks.opponents.map(({ snapshot }) => snapshot.reason)).toEqual([
      'network-error',
      'network-error',
      'network-error',
      'network-paused',
      'network-paused'
    ])
    expect(h.repository.writePlayer).toHaveBeenCalledTimes(3)
  })
  test('all retry attempts share the request/time budget, with no near-deadline fake timeouts', async () => {
    const h = harness()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockRejectedValue(new Error('synthetic timeout'))
    const result = await h.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      retries: 2,
      requests: 2
    })
    expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(2)
    expect(result[0].ranks.opponents.map(({ snapshot }) => snapshot.reason)).toEqual([
      'network-error',
      'budget-exhausted',
      'budget-exhausted',
      'budget-exhausted',
      'budget-exhausted'
    ])
    const deadline = harness()
    const noTime = await deadline.loader.load([target()], new AbortController().signal, vi.fn(), {
      ...limits,
      milliseconds: 1
    })
    expect(deadline.sgp.api.leaguesLedge.getRankedStatsByPuuid).not.toHaveBeenCalled()
    expect(
      noTime[0].ranks.opponents.every(({ snapshot }) => snapshot.reason === 'budget-exhausted')
    ).toBe(true)
  })
  test('backoff remains immediately cancellable and never retries after cancellation', async () => {
    const h = harness(),
      controller = new AbortController()
    h.sgp.api.leaguesLedge.getRankedStatsByPuuid.mockRejectedValue(new Error('synthetic timeout'))
    const timer = setTimeout(() => controller.abort(), 15)
    try {
      await expect(
        h.loader.load([target()], controller.signal, vi.fn(), {
          ...limits,
          retries: 2,
          retryDelay: 1000
        })
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(h.sgp.api.leaguesLedge.getRankedStatsByPuuid).toHaveBeenCalledTimes(1)
      expect(h.repository.writePlayer).not.toHaveBeenCalled()
    } finally {
      clearTimeout(timer)
    }
  })
})
