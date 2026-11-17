import { CHAMPION_POOL_NAMESPACE } from '@shared/shards/champion-pool/coverage'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, test, vi } from 'vitest'

import { ChampionPoolMain } from './index'

const mocks = vi.hoisted(() => ({ savePool: vi.fn(), preferences: vi.fn() }))
vi.mock('../network', () => ({ NetworkMain: class {} }))
vi.mock('../ipc', () => ({ AkariIpcMain: class {} }))
vi.mock('electron', () => ({ app: { getPath: () => join(tmpdir(), 'akari-synthetic-pool-test') } }))
vi.mock('./persistence', () => ({ ChampionPoolPersistence: class {} }))
vi.mock('./source', () => ({ LolalyticsPoolSource: class {} }))
vi.mock('./controller', () => ({
  ChampionPoolController: class {
    savePool = mocks.savePool
    preferences = mocks.preferences
  }
}))
beforeEach(() => vi.clearAllMocks())
test('notifies all registered renderers only after a successful saved pool, keeping the domain result intact', async () => {
  const handlers = new Map<string, (...args: any[]) => any>()
  const ipc = {
    onCall: (_namespace: string, name: string, handler: (...args: any[]) => any) =>
      handlers.set(name, handler),
    sendEvent: vi.fn()
  }
  const shard = new ChampionPoolMain(ipc as any, { createAxiosClient: vi.fn() } as any)
  await shard.onInit()
  const success = { status: 'ready', data: { lastRole: 'MID', pools: { MID: [103] } } }
  mocks.savePool.mockResolvedValueOnce(success)
  const handler = handlers.get('savePool')!
  expect(await handler({}, { role: 'MID', championIds: [103] })).toBe(success)
  expect(ipc.sendEvent).toHaveBeenCalledExactlyOnceWith(CHAMPION_POOL_NAMESPACE, 'pool-changed')
  mocks.savePool.mockResolvedValueOnce({ status: 'error', code: 'storage' })
  expect(await handler({}, { role: 'MID', championIds: [] })).toEqual({
    status: 'error',
    code: 'storage'
  })
  expect(ipc.sendEvent).toHaveBeenCalledTimes(1)
  await expect(handler({}, { role: 'MID', championIds: [103, 103] })).rejects.toThrow()
  expect(mocks.savePool).toHaveBeenCalledTimes(2)
})
