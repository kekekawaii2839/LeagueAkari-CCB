import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import type { SettingFactoryMainContext } from './context'
import { SettingsJsonFileService } from './settings-json-file-service'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
vi.mock('node:original-fs', async () => ({ default: await import('node:fs') }))
vi.mock('../storage', () => ({ StorageMain: { LEAGUE_AKARI_DB_CURRENT_VERSION: 15 } }))
vi.mock('../storage/entities/Settings', () => ({ Setting: class {} }))

function harness() {
  const manager = {
    find: vi.fn(async () => [
      {
        key: 'member-analysis-main/members',
        value: [{ serverId: 'SYNTHETIC', gameName: 'Synthetic', tagLine: 'TEST' }]
      },
      { key: 'member-analysis-main/enabled', value: true },
      { key: 'member-analysis-main-other/enabled', value: true },
      { key: 'auto-select-main/enabled', value: false }
    ]),
    save: vi.fn(async () => undefined)
  }
  const restart = vi.fn()
  const service = new SettingsJsonFileService({
    storage: { dataSource: { manager } },
    shared: { global: { restart } }
  } as unknown as SettingFactoryMainContext)
  return { service, manager, restart }
}
describe('generic settings transfer boundary', () => {
  test('omits private member configuration while retaining all other namespaces', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'akari-synthetic-settings-export-'))
    try {
      const { service } = harness()
      const file = join(directory, 'settings.json')
      await service.writeSettingsToJsonFile(file)
      const result = JSON.parse(await readFile(file, 'utf8'))
      expect(result.data).toEqual([
        { key: 'member-analysis-main-other/enabled', value: true },
        { key: 'auto-select-main/enabled', value: false }
      ])
      expect(result.type).toBe('league-akari-settings')
      expect(result.databaseVersion).toBe(15)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
  test('rejects legacy mixed bundles atomically before write or restart; normal bundles still import', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'akari-synthetic-settings-import-'))
    try {
      const { service, manager, restart } = harness()
      const file = join(directory, 'settings.json')
      const upstream = { key: 'auto-select-main/enabled', value: true }
      await writeFile(
        file,
        JSON.stringify({
          type: 'league-akari-settings',
          databaseVersion: 15,
          data: [upstream, { key: 'member-analysis-main/enabled', value: false }]
        })
      )
      await expect(service.readSettingsFromJsonFile(file)).rejects.toMatchObject({
        code: 'ProtectedSettingsNamespace'
      })
      expect(manager.save).not.toHaveBeenCalled()
      expect(restart).not.toHaveBeenCalled()
      await writeFile(
        file,
        JSON.stringify({ type: 'league-akari-settings', databaseVersion: 14, data: [upstream] })
      )
      await service.readSettingsFromJsonFile(file)
      expect(manager.save).toHaveBeenCalledWith(expect.anything(), [upstream])
      expect(restart).toHaveBeenCalledOnce()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
