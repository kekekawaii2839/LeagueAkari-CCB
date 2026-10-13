import { dialog } from 'electron'

import { AkariIpcError } from '../ipc'
import type { WindowManagerMain } from '../window-manager'
import type { SettingFactoryMainContext } from './context'
import type { SettingFactoryMain } from './index'
import type { SettingsJsonFileService } from './settings-json-file-service'

export class SettingFactoryIpcHandlers {
  constructor(
    private readonly context: SettingFactoryMainContext,
    private readonly settingFactory: SettingFactoryMain,
    private readonly settingsJsonFileService: SettingsJsonFileService
  ) {}

  register() {
    const { ipc, namespace } = this.context

    /**
     * 渲染进程请求获取设置项
     */
    ipc.onCall(
      namespace,
      'set',
      async (_, settingNamespace: string, key: string, newValue: any) => {
        this._assertGenericAccess(settingNamespace, key)
        await this.settingFactory.setSetting(settingNamespace, key, newValue)
      }
    )

    ipc.onCall(namespace, 'get', async (_, settingNamespace: string, key: string) => {
      this._assertGenericAccess(settingNamespace, key)
      return this.settingFactory.getSetting(settingNamespace, key)
    })

    ipc.onCall(namespace, 'getByPrefix', async (_, settingNamespace: string, keyPrefix: string) => {
      this._assertGenericAccess(settingNamespace, keyPrefix)
      return this.settingFactory.getSettingsByPrefix(settingNamespace, keyPrefix)
    })

    ipc.onCall(
      namespace,
      'removeByPrefix',
      async (_, settingNamespace: string, keyPrefix: string) => {
        this._assertGenericAccess(settingNamespace, keyPrefix)
        return this.settingFactory.removeSettingsByPrefix(settingNamespace, keyPrefix)
      }
    )

    ipc.onCall(namespace, 'exportSettingsToJsonFile', async () => {
      const result = await dialog.showSaveDialog(this._getMainWindow(), {
        defaultPath: 'league-akari-settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled) {
        return
      }

      const filePath = result.filePath
      return await this.settingsJsonFileService.writeSettingsToJsonFile(filePath)
    })

    ipc.onCall(namespace, 'importSettingsFromJsonFile', async () => {
      const result = await dialog.showOpenDialog(this._getMainWindow(), {
        defaultPath: 'league-akari-settings.json',
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })

      if (result.canceled) {
        return
      }

      const filePath = result.filePaths[0]
      return await this.settingsJsonFileService.readSettingsFromJsonFile(filePath)
    })
  }

  private _assertGenericAccess(settingNamespace: string, key: string) {
    // Feature configuration is reachable only through its sender/schema-validated IPC.
    // Check the storage key too: a nested namespace must not bypass the boundary.
    if (`${settingNamespace}/${key}`.startsWith('member-analysis-main/')) {
      throw new AkariIpcError(
        'Use member-analysis-main settings IPC for member analysis configuration',
        'ProtectedSettingsNamespace'
      )
    }
  }

  private _getMainWindow() {
    const windowManager = this.context.shared.manager.getInstance(
      'window-manager-main'
    ) as WindowManagerMain

    if (!windowManager || !windowManager.mainWindow.window) {
      throw new AkariIpcError('WindowManagerMain not found', 'WindowManagerMainNotFound')
    }

    return windowManager.mainWindow.window
  }
}
