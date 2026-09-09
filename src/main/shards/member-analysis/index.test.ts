import { describe, expect, test, vi } from 'vitest'

import { MemberAnalysisMain } from './index'

vi.mock('@main/shards/ipc', () => ({ AkariIpcMain: class {} }))
vi.mock('@main/shards/logger-factory', () => ({ LoggerFactoryMain: class {} }))
vi.mock('@main/shards/setting-factory', () => ({ SettingFactoryMain: class {} }))
vi.mock('@main/shards/window-manager', () => ({ WindowManagerMain: class {} }))
vi.mock('@main/shards/riot-client', () => ({ RiotClientMain: class {} }))
vi.mock('@main/shards/sgp', () => ({ SgpMain: class {} }))
vi.mock('electron', () => ({ app: { getPath: vi.fn(), isPackaged: false } }))

describe('MemberAnalysisMain degraded lifecycle', () => {
  test('does not reject core setup when feature-owned initialization fails', async () => {
    const shard = new MemberAnalysisMain(
      {} as any,
      {
        create: () => {
          throw new Error('synthetic logger initialization failure')
        }
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    )

    await expect(shard.onInit()).resolves.toBeUndefined()
    expect(shard.runtime.initialized).toBe(false)
    expect(shard.runtime.degradedReason).toContain('synthetic logger initialization failure')
  })
})
