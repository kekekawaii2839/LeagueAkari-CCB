import type {
  MemberAnalysisMatchDetails,
  MemberAnalysisMatchOverview,
  MemberAnalysisResult
} from '@shared/shards/member-analysis'
import { describe, expect, test, vi } from 'vitest'

import { MemberMatchDetailsCache } from './member-match-details-cache'

type Result = MemberAnalysisResult<MemberAnalysisMatchDetails | null>
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
function deferred() {
  let resolve: (result: Result) => void = () => {}
  const promise = new Promise<Result>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}
describe('publication-bound local match details cache', () => {
  test('starts a backwards-mounted page in explicit visible order with only two reads in flight', async () => {
    const pending = new Map<number, ReturnType<typeof deferred>>()
    const read = vi.fn((id: number) => {
      const value = deferred()
      pending.set(id, value)
      return value.promise
    })
    const cache = new MemberMatchDetailsCache(read)
    cache.setGeneration(1)
    cache.setPageOrder([17, 3, 29])
    const leases = [29, 3, 17].map((id) => cache.acquire(1, id))
    expect(read).not.toHaveBeenCalled()
    await tick()
    expect(read.mock.calls.map(([id]) => id)).toEqual([17, 3])
    pending.get(17)!.resolve({ ok: true, value: null })
    await tick()
    expect(read.mock.calls.map(([id]) => id)).toEqual([17, 3, 29])
    leases.forEach((lease) => lease.release())
    pending.forEach((value) => value.resolve({ ok: true, value: null }))
    await tick()
  })
  test('cancels an unstarted page before its microtask and does not carry ordering into a new publication', async () => {
    const read = vi.fn(async (_id: number): Promise<Result> => ({ ok: true, value: null }))
    const cache = new MemberMatchDetailsCache(read)
    cache.setGeneration(1)
    cache.setPageOrder([50, 7])
    const old = [7, 50].map((id) => cache.acquire(1, id))
    old.forEach((lease) => lease.release())
    cache.setGeneration(2)
    cache.setPageOrder([4, 91])
    const current = [91, 4].map((id) => cache.acquire(2, id))
    await Promise.all(current.map((lease) => lease.promise))
    expect(read.mock.calls.map(([id]) => id)).toEqual([4, 91])
    expect((await old[0].promise).status).toBe('cancelled')
    current.forEach((lease) => lease.release())
  })
  test('coalesces summary and expanded detail leases without cancelling the remaining consumer', async () => {
    const pending = deferred()
    const read = vi.fn(() => pending.promise)
    const cache = new MemberMatchDetailsCache(read)
    const summary = cache.acquire(1, 11)
    const detail = cache.acquire(1, 11)
    summary.release()
    await tick()
    expect(read).toHaveBeenCalledTimes(1)
    pending.resolve({ ok: true, value: null })
    expect((await detail.promise).status).toBe('unavailable')
    detail.release()
  })
  test('bounds current-page work and local IPC concurrency to two', async () => {
    const pending: ReturnType<typeof deferred>[] = []
    const read = vi.fn(() => {
      const d = deferred()
      pending.push(d)
      return d.promise
    })
    const cache = new MemberMatchDetailsCache(read)
    const leases = Array.from({ length: 25 }, (_, i) => cache.acquire(1, i + 1))
    await tick()
    expect(read).toHaveBeenCalledTimes(2)
    expect((await cache.acquire(1, 26).promise).status).toBe('cancelled')
    pending[0].resolve({ ok: true, value: null })
    await tick()
    expect(read).toHaveBeenCalledTimes(3)
    leases.forEach((l) => l.release())
    pending.forEach((d) => d.resolve({ ok: true, value: null }))
    await tick()
    expect(read).toHaveBeenCalledTimes(3)
  })
  test('invalidates old publication promises and rejects late delivery', async () => {
    const pending = deferred()
    const read = vi.fn(() => pending.promise)
    const cache = new MemberMatchDetailsCache(read)
    const old = cache.acquire(1, 1)
    await tick()
    cache.setGeneration(2)
    expect((await old.promise).status).toBe('cancelled')
    pending.resolve({ ok: true, value: null })
    await tick()
    const next = cache.acquire(2, 1)
    expect((await next.promise).status).toBe('unavailable')
    expect(read).toHaveBeenCalledTimes(2)
    next.release()
  })
  test('caches unavailable results but an explicit retry reads IPC again', async () => {
    const read = vi.fn(async (): Promise<Result> => ({ ok: true, value: null }))
    const cache = new MemberMatchDetailsCache(read)
    const first = cache.acquire(1, 1)
    await first.promise
    first.release()
    const cached = cache.acquire(1, 1)
    expect(cached.settled).toEqual({ status: 'unavailable', value: null })
    await cached.promise
    cached.release()
    expect(read).toHaveBeenCalledTimes(1)
    const retried = cache.acquire(1, 1, true)
    expect(retried.settled).toBeUndefined()
    await retried.promise
    retried.release()
    expect(read).toHaveBeenCalledTimes(2)
  })
  test('publishes retry results to the remaining shared consumer', async () => {
    const pending = deferred()
    const read = vi.fn(async (): Promise<Result> => ({ ok: true, value: null }))
    const cache = new MemberMatchDetailsCache(read)
    const summaryDelivery = vi.fn()
    const detailDelivery = vi.fn()
    const summary = cache.acquire(1, 1, false, summaryDelivery)
    const detail = cache.acquire(1, 1, false, detailDelivery)
    await detail.promise
    read.mockImplementation(() => pending.promise)
    const retry = cache.acquire(1, 1, true)
    retry.release()
    summary.release()
    await tick()
    pending.resolve({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
    })
    await tick()
    expect(detailDelivery).toHaveBeenLastCalledWith({ status: 'error', value: null })
    expect(summaryDelivery).toHaveBeenCalledTimes(1)
    detail.release()
  })
  test('evicts settled least-recently-used data beyond fifty matches', async () => {
    const read = vi.fn(async (): Promise<Result> => ({ ok: true, value: null }))
    const cache = new MemberMatchDetailsCache(read)
    for (let id = 1; id <= 51; id++) {
      const lease = cache.acquire(1, id)
      await lease.promise
      lease.release()
    }
    const reread = cache.acquire(1, 1)
    await reread.promise
    reread.release()
    expect(read).toHaveBeenCalledTimes(52)
  })
})

const complete = (id: number) =>
  ({
    serverId: 'SYNTHETIC',
    summary: {
      source: 'sgp',
      gameId: id,
      data: { json: { gameId: id, participants: [], teams: [] } }
    },
    details: {
      source: 'sgp',
      gameId: id,
      data: { json: { gameId: id, frames: [{ timestamp: 0 }] } }
    }
  }) as unknown as MemberAnalysisMatchDetails
const summaryOnly = (id: number): MemberAnalysisMatchOverview => {
  const { serverId, summary } = complete(id)
  return { serverId, summary }
}

describe('one scheduler with distinct overview/full readiness', () => {
  test('requests only overview for a collapsed page in view order with a shared two-read/25-game budget', async () => {
    const pending: ReturnType<typeof deferred>[] = []
    const full = vi.fn(async (): Promise<Result> => ({ ok: true, value: null }))
    const overview = vi.fn((_id: number) => {
      const d = deferred()
      pending.push(d)
      return d.promise
    })
    const cache = new MemberMatchDetailsCache(full, overview)
    cache.setGeneration(1)
    cache.setPageOrder([19, 3, ...Array.from({ length: 23 }, (_, i) => 100 + i)])
    const ids = [19, 3, ...Array.from({ length: 23 }, (_, i) => 100 + i)]
    const leases = ids
      .slice()
      .reverse()
      .map((id) => cache.acquireOverview(1, id))
    await tick()
    expect(overview.mock.calls.map((args) => args[0])).toEqual([19, 3])
    expect(full).not.toHaveBeenCalled()
    expect((await cache.acquire(1, 999).promise).status).toBe('cancelled')
    leases.forEach((lease) => lease.release())
    pending.forEach((d) => d.resolve({ ok: true, value: null }))
    await tick()
    expect(overview).toHaveBeenCalledTimes(2)
  })
  test('promotes both unstarted tiers into one full request and derives stable overview without a timeline', async () => {
    const value = complete(1)
    const full = vi.fn(async (): Promise<Result> => ({ ok: true, value }))
    const overview = vi.fn(async () => ({ ok: true as const, value: summaryOnly(1) }))
    const cache = new MemberMatchDetailsCache(full, overview)
    const a = cache.acquireOverview(1, 1),
      b = cache.acquire(1, 1),
      c = cache.acquire(1, 1)
    expect((await b.promise).value).toBe(value)
    expect((await c.promise).value).toBe(value)
    const projected = (await a.promise).value!
    expect(projected).toEqual(summaryOnly(1))
    expect(projected).not.toHaveProperty('details')
    const hit = cache.acquireOverview(1, 1)
    expect(hit.settled?.value).toBe(projected)
    expect(full).toHaveBeenCalledTimes(1)
    expect(overview).not.toHaveBeenCalled()
    ;[a, b, c, hit].forEach((lease) => lease.release())
  })
  test('an overview hit is never full readiness; expansion coalesces and full failure preserves the overview', async () => {
    const value = summaryOnly(2)
    const full = vi.fn(async (): Promise<Result> => ({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
    }))
    const overview = vi.fn(async () => ({ ok: true as const, value }))
    const cache = new MemberMatchDetailsCache(full, overview)
    const a = cache.acquireOverview(1, 2)
    await a.promise
    const b = cache.acquire(1, 2),
      c = cache.acquire(1, 2)
    expect(b.settled).toBeUndefined()
    expect((await b.promise).status).toBe('error')
    await c.promise
    expect(cache.acquireOverview(1, 2).settled?.value).toBe(value)
    expect(overview).toHaveBeenCalledTimes(1)
    expect(full).toHaveBeenCalledTimes(1)
    ;[a, b, c].forEach((lease) => lease.release())
  })
  test('a failed promoted full read still lets its summary waiter use the overview route', async () => {
    const full = vi.fn(async (): Promise<Result> => ({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
    }))
    const overview = vi.fn(async () => ({ ok: true as const, value: summaryOnly(3) }))
    const cache = new MemberMatchDetailsCache(full, overview)
    const a = cache.acquireOverview(1, 3),
      b = cache.acquire(1, 3)
    expect((await b.promise).status).toBe('error')
    expect((await a.promise).status).toBe('ready')
    expect(full).toHaveBeenCalledTimes(1)
    expect(overview).toHaveBeenCalledTimes(1)
    a.release()
    b.release()
  })
  test.each(['unavailable', 'error'] as const)(
    'new overview %s never falls back, including a retry after a cached full result',
    async (status) => {
      const full = vi.fn(async (): Promise<Result> => ({ ok: true, value: complete(4) }))
      const overview = vi.fn(async () =>
        status === 'error'
          ? {
              ok: false as const,
              error: { code: 'INTERNAL_ERROR' as const, message: 'Synthetic', retryable: true }
            }
          : { ok: true as const, value: null }
      )
      const cache = new MemberMatchDetailsCache(full, overview)
      const a = cache.acquire(1, 4)
      await a.promise
      const b = cache.acquireOverview(1, 4, true)
      expect((await b.promise).status).toBe(status)
      const c = cache.acquireOverview(1, 4)
      expect(c.settled?.status).toBe(status)
      expect(full).toHaveBeenCalledTimes(1)
      expect(overview).toHaveBeenCalledTimes(1)
      ;[a, b, c].forEach((lease) => lease.release())
    }
  )
  test('both tiers for the same25 IDs still count as25 pending games and never exceed two IPC calls', async () => {
    const pending: ReturnType<typeof deferred>[] = []
    const full = vi.fn(() => {
      const d = deferred()
      pending.push(d)
      return d.promise
    })
    const overview = vi.fn(async () => ({ ok: true as const, value: null }))
    const cache = new MemberMatchDetailsCache(full, overview)
    const leases = Array.from({ length: 25 }, (_, i) => [
      cache.acquireOverview(1, i + 1),
      cache.acquire(1, i + 1)
    ]).flat()
    await tick()
    expect(full).toHaveBeenCalledTimes(2)
    expect(overview).not.toHaveBeenCalled()
    expect((await cache.acquireOverview(1, 26).promise).status).toBe('cancelled')
    leases.forEach((lease) => lease.release())
    pending.forEach((d) => d.resolve({ ok: true, value: null }))
    await tick()
    expect(full).toHaveBeenCalledTimes(2)
  })
})

test('a full refresh updates both the cached overview settled value and the promise seen by a returning page', async () => {
  const full = vi.fn(async (): Promise<Result> => ({ ok: true, value: complete(41) }))
  const overview = vi.fn(async () => ({ ok: true as const, value: summaryOnly(41) }))
  const cache = new MemberMatchDetailsCache(full, overview)
  const original = cache.acquireOverview(1, 41)
  const old = (await original.promise).value
  const detail = cache.acquire(1, 41)
  await detail.promise
  const returning = cache.acquireOverview(1, 41)
  expect(returning.settled?.value).not.toBe(old)
  expect((await returning.promise).value).toBe(returning.settled?.value)
  ;[original, detail, returning].forEach((lease) => lease.release())
})
