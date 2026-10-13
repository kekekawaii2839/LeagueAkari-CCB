import { describe, expect, test, vi } from 'vitest'

import type { SettingFactoryMainContext } from './context'
import type { SettingFactoryMain } from './index'
import { SettingFactoryIpcHandlers } from './ipc-handlers'
import type { SettingsJsonFileService } from './settings-json-file-service'

vi.mock('electron', () => ({ dialog: {} }))

function harness() {
  const calls = new Map<string, (...args: any[]) => any>()
  const context = {
    namespace: 'setting-factory-main',
    ipc: { onCall: (_: string, name: string, fn: (...args: any[]) => any) => calls.set(name, fn) }
  } as unknown as SettingFactoryMainContext
  const factory = {
    setSetting: vi.fn(async () => undefined),
    getSetting: vi.fn(async () => 'upstream'),
    getSettingsByPrefix: vi.fn(async () => []),
    removeSettingsByPrefix: vi.fn(async () => 2)
  }
  new SettingFactoryIpcHandlers(
    context,
    factory as unknown as SettingFactoryMain,
    {} as SettingsJsonFileService
  ).register()
  return { calls, factory }
}
describe('generic member configuration isolation', () => {
  test.each(['set', 'get', 'getByPrefix', 'removeByPrefix'])(
    '%s rejects private and nested member namespaces for every caller',
    async (name) => {
      const { calls, factory } = harness()
      for (const sender of [{}, { main: true }]) {
        for (const namespace of ['member-analysis-main', 'member-analysis-main/nested']) {
          await expect(
            calls.get(name)!({ sender }, namespace, 'enabled', false)
          ).rejects.toMatchObject({ code: 'ProtectedSettingsNamespace' })
        }
      }
      for (const method of Object.values(factory)) expect(method).not.toHaveBeenCalled()
    }
  )
  test('retains normal upstream and similarly named namespaces', async () => {
    const { calls, factory } = harness()
    const sender = { sender: {} }
    for (const namespace of ['auto-select-main', 'member-analysis-main-other']) {
      await calls.get('set')!(sender, namespace, 'enabled', true)
      expect(await calls.get('get')!(sender, namespace, 'enabled')).toBe('upstream')
      expect(await calls.get('getByPrefix')!(sender, namespace, '')).toEqual([])
      expect(await calls.get('removeByPrefix')!(sender, namespace, '')).toBe(2)
      expect(factory.setSetting).toHaveBeenCalledWith(namespace, 'enabled', true)
    }
  })
})
