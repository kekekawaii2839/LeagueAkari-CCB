import type { ChampionDataQuery } from '@shared/data-adapter/champion-data'
import type { OpggChampionCounter } from '@shared/types/opgg'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, expect, test, vi } from 'vitest'
import { createRenderer, shallowRef } from 'vue'

import { useCounterLaneKills } from './counter-lane-kills-controller'

const api = vi.hoisted(() => ({ loadLaneKillRate: vi.fn() }))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => api }))
vi.mock('@renderer-shared/shards/champion-data', () => ({ ChampionDataRenderer: class {} }))
const success = (data: number | null) => ({ status: 'success', effectiveSource: 'opgg', data })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function harness(enabled = false, count = 5) {
  const input = shallowRef({
    enabled,
    snapshot: {},
    championId: 266,
    query: {
      source: 'opgg',
      mode: 'ranked',
      position: 'top',
      patch: '16.22',
      region: 'global',
      tier: 'emerald_plus'
    } as ChampionDataQuery,
    counters: Array.from({ length: count }, (_, i) => ({
      champion_id: i + 1,
      play: 100,
      win: 50
    })) as OpggChampionCounter[]
  })
  let state!: ReturnType<typeof useCounterLaneKills>
  const renderer = createRenderer<any, any>({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText() {},
    setElementText() {},
    parentNode: () => null,
    nextSibling: () => null,
    patchProp() {},
    insert() {},
    remove() {}
  })
  const app = renderer.createApp({
    setup() {
      state = useCounterLaneKills(() => input.value)
      return () => null
    }
  })
  app.mount({})
  return { input, state, dispose: () => app.unmount() }
}
beforeEach(() => {
  api.loadLaneKillRate.mockReset().mockResolvedValue(success(0.6))
})

test('win-rate/default view makes no optional requests; known zero and unavailable snapshot rates are not refetched', async () => {
  const h = harness()
  try {
    expect(api.loadLaneKillRate).not.toHaveBeenCalled()
    h.input.value = {
      ...h.input.value,
      enabled: true,
      counters: [
        { champion_id: 1, play: 10, win: 5, lane_kill_rate: 0 },
        { champion_id: 2, play: 10, win: 5, lane_kill_rate: null }
      ]
    }
    await flushPromises()
    expect(api.loadLaneKillRate).not.toHaveBeenCalled()
    expect(h.state.loading.value).toBe(false)
  } finally {
    h.dispose()
  }
})
test('loads only on demand, caps concurrency at three and publishes one complete stable batch', async () => {
  const waiting = new Map<number, ReturnType<typeof deferred<ReturnType<typeof success>>>>()
  api.loadLaneKillRate.mockImplementation((_q, _own, id) => {
    const job = deferred<ReturnType<typeof success>>()
    waiting.set(id, job)
    return job.promise
  })
  const h = harness()
  try {
    h.input.value = { ...h.input.value, enabled: true }
    await flushPromises()
    expect([...waiting.keys()]).toEqual([1, 2, 3])
    expect(h.state.loading.value).toBe(true)
    expect(h.state.rates.value).toEqual({})
    waiting.get(2)!.resolve(success(0.4))
    await flushPromises()
    expect([...waiting.keys()]).toEqual([1, 2, 3, 4])
    waiting.get(3)!.resolve(success(0))
    await flushPromises()
    expect([...waiting.keys()]).toEqual([1, 2, 3, 4, 5])
    waiting.get(4)!.resolve(success(1))
    waiting.get(5)!.resolve(success(null))
    await flushPromises()
    expect(h.state.rates.value).toEqual({})
    waiting.get(1)!.resolve(success(0.6))
    await flushPromises()
    expect(h.state.rates.value).toEqual({ 1: 0.6, 2: 0.4, 3: 0, 4: 1, 5: null })
    expect(h.state.loading.value).toBe(false)
    for (const [query, championId, , options] of api.loadLaneKillRate.mock.calls) {
      expect(query).toEqual(h.input.value.query)
      expect(championId).toBe(266)
      expect(options.signal.aborted).toBe(false)
    }
    h.input.value = { ...h.input.value, enabled: false }
    await flushPromises()
    h.input.value = { ...h.input.value, enabled: true }
    await flushPromises()
    expect(api.loadLaneKillRate).toHaveBeenCalledTimes(5)
  } finally {
    h.dispose()
  }
})
test('partial failures do not destroy successes and explicit retry can recover them', async () => {
  api.loadLaneKillRate.mockImplementation(async (_q, _own, id) => {
    if (id === 2) throw Error('offline')
    return success(id === 1 ? 0 : 1)
  })
  const h = harness(true, 3)
  try {
    await flushPromises()
    expect(h.state.rates.value).toEqual({ 1: 0, 2: null, 3: 1 })
    expect(h.state.failed.value).toBe(true)
    api.loadLaneKillRate.mockResolvedValue(success(0.7))
    await h.state.retry()
    expect(h.state.failed.value).toBe(false)
    expect(h.state.rates.value).toEqual({ 1: 0.7, 2: 0.7, 3: 0.7 })
  } finally {
    h.dispose()
  }
})
test.each(['disabled', 'changed', 'disposed'] as const)(
  'cancels %s work, never schedules later opponents or publishes a stale reply',
  async (reason) => {
    const jobs: ReturnType<typeof deferred<ReturnType<typeof success>>>[] = []
    api.loadLaneKillRate.mockImplementation(() => {
      const job = deferred<ReturnType<typeof success>>()
      jobs.push(job)
      return job.promise
    })
    const h = harness(true, 5)
    try {
      expect(api.loadLaneKillRate).toHaveBeenCalledTimes(3)
      const oldSignals = api.loadLaneKillRate.mock.calls.map((call) => call[3].signal)
      if (reason === 'disabled') h.input.value = { ...h.input.value, enabled: false }
      if (reason === 'changed')
        h.input.value = {
          ...h.input.value,
          championId: 103,
          snapshot: {},
          query: { ...h.input.value.query, tier: 'diamond_plus' },
          counters: []
        }
      if (reason === 'disposed') h.dispose()
      await flushPromises()
      expect(oldSignals.every((signal) => signal.aborted)).toBe(true)
      jobs.forEach((job) => job.resolve(success(0.9)))
      await flushPromises()
      expect(api.loadLaneKillRate).toHaveBeenCalledTimes(3)
      expect(h.state.rates.value).toEqual({})
    } finally {
      if (reason !== 'disposed') h.dispose()
    }
  }
)
