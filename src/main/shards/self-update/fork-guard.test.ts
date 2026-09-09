import { describe, expect, test, vi } from 'vitest'

import { SelfUpdateIpcHandlers } from './ipc-handlers'
import { SelfUpdateExecutor } from './update-executor'

vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: vi.fn(() => '') },
  Notification: class {
    show() {}
  },
  shell: { openPath: vi.fn() }
}))
vi.mock('@main/i18n', () => ({ i18next: { t: (key: string) => key } }))
vi.mock('@resources/LA_ICON.ico?asset', () => ({ default: 'icon' }))
vi.mock('@resources/akari-updater.exe?asset', () => ({ default: 'updater' }))
vi.mock('node:original-fs', async () => {
  const fs = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { default: fs, ...fs }
})

function createGuardHarness() {
  const handlers = new Map<string, (...args: any[]) => any>()
  const setUpdateProgressInfo = vi.fn()
  const context = {
    namespace: 'self-update-main',
    settings: { autoCheckUpdates: true, autoDownloadUpdates: true, ignoreVersion: null },
    state: { releaseInfo: null, updateProgressInfo: null, setUpdateProgressInfo },
    logger: { info: vi.fn(), warn: vi.fn() },
    ipc: {
      onCall: (_namespace: string, name: string, handler: (...args: any[]) => any) =>
        handlers.set(name, handler),
      sendEvent: vi.fn()
    }
  } as any
  const executor = new SelfUpdateExecutor(context)
  const controller = { checkLatestRelease: vi.fn() }
  const uninstaller = { uninstallApp: vi.fn() }
  new SelfUpdateIpcHandlers(context, executor, uninstaller as any, controller as any).register()
  return { context, controller, executor, handlers }
}

describe('fork official updater hard guard', () => {
  test('rejects renderer update IPC even when legacy auto-update settings are true', async () => {
    const { controller, handlers } = createGuardHarness()
    await expect(handlers.get('checkUpdates')!({})).resolves.toEqual({
      result: 'failed',
      reason: 'platform-unsupported'
    })
    await expect(handlers.get('startUpdate')!({})).resolves.toEqual({
      result: 'failed',
      reason: 'platform-unsupported'
    })
    expect(controller.checkLatestRelease).not.toHaveBeenCalled()
  })

  test('does not execute a prepared official update task on quit', async () => {
    const { executor } = createGuardHarness()
    const preparedUpdate = vi.fn(async () => {})
    ;(executor as any)._updateOnQuitFn = preparedUpdate

    await executor.runUpdateOnQuit()

    expect(preparedUpdate).not.toHaveBeenCalled()
  })
})
