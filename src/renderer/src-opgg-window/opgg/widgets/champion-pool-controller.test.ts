import type { PoolPreferences, PoolResult } from '@shared/shards/champion-pool/coverage'
import { CHAMPION_POOL_NAMESPACE } from '@shared/shards/champion-pool/coverage'
import { beforeEach, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import { useChampionPool } from './champion-pool-controller'

const ipc = vi.hoisted(() => ({ call: vi.fn(), onEvent: vi.fn(), stop: vi.fn() }))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => ipc }))
vi.mock('@renderer-shared/shards/ipc', () => ({ AkariIpcRenderer: class {} }))
const saved = (): PoolResult<PoolPreferences> => ({
  status: 'ready',
  data: {
    lastRole: 'MID',
    pools: { TOP: [24], JUNGLE: [64], MID: [103, 61], ADC: [222], SUP: [89] }
  }
})
const settle = async () => {
  await Promise.resolve()
  await nextTick()
}
beforeEach(() => {
  vi.clearAllMocks()
  ipc.onEvent.mockReturnValue(ipc.stop)
  ipc.call.mockResolvedValue(saved())
})

test('reads only saved roster through IPC, maps all five roles, and does not reuse lastRole for non-lane modes', async () => {
  const scope = effectScope(),
    position = ref('top'),
    mode = ref('ranked')
  const pool = scope.run(() => useChampionPool(position, mode))!
  await settle()
  expect(ipc.call).toHaveBeenCalledWith(CHAMPION_POOL_NAMESPACE, 'getPreferences')
  for (const [lane, id] of [
    ['top', 24],
    ['jungle', 64],
    ['mid', 103],
    ['adc', 222],
    ['support', 89]
  ] as const) {
    position.value = lane
    expect(pool.championIds.value.has(id)).toBe(true)
  }
  position.value = 'none'
  expect(pool.championIds.value.size).toBe(0)
  position.value = 'mid'
  mode.value = 'aram'
  expect(pool.role.value).toBeUndefined()
  mode.value = 'classic'
  expect([...pool.championIds.value]).toEqual([103, 61])
  scope.stop()
  expect(ipc.stop).toHaveBeenCalledOnce()
})

test('pool-changed refresh wins over stale opening request; late completion after disposal is ignored', async () => {
  let first!: (value: PoolResult<PoolPreferences>) => void
  ipc.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        first = resolve
      })
  )
  const scope = effectScope()
  const pool = scope.run(() => useChampionPool(ref('mid'), ref('ranked')))!
  const changed = ipc.onEvent.mock.calls[0][2]
  expect(ipc.onEvent.mock.calls[0].slice(0, 2)).toEqual([CHAMPION_POOL_NAMESPACE, 'pool-changed'])
  await changed()
  expect([...pool.championIds.value]).toEqual([103, 61])
  const old = saved()
  if (old.status === 'ready') old.data.pools.MID = [55]
  first(old)
  await settle()
  expect([...pool.championIds.value]).toEqual([103, 61])
  let late!: (value: PoolResult<PoolPreferences>) => void
  ipc.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        late = resolve
      })
  )
  const pending = pool.refresh()
  scope.stop()
  late(old)
  await pending
  expect([...pool.championIds.value]).toEqual([103, 61])
})

test('read failures do not masquerade as a configured empty pool and can be retried', async () => {
  ipc.call.mockResolvedValueOnce({ status: 'error', code: 'storage' })
  const scope = effectScope()
  const pool = scope.run(() => useChampionPool(ref('mid'), ref('ranked')))!
  await settle()
  expect(pool.status.value).toBe('error')
  expect(pool.championIds.value.size).toBe(0)
  await pool.refresh()
  expect(pool.status.value).toBe('ready')
  expect([...pool.championIds.value]).toEqual([103, 61])
  ipc.call.mockRejectedValueOnce(new Error('transport'))
  await pool.refresh()
  expect(pool.status.value).toBe('error')
  expect(pool.championIds.value.size).toBe(0)
  scope.stop()
})
