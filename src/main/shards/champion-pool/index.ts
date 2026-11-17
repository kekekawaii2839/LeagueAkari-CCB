import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import { CHAMPION_POOL_NAMESPACE } from '@shared/shards/champion-pool/coverage'
import { DRAFT_ROLES } from '@shared/shards/member-analysis/champion-pool/scoring'
import { app } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'

import { AkariIpcMain } from '../ipc'
import { NetworkMain } from '../network'
import { ChampionPoolController } from './controller'
import { ChampionPoolPersistence } from './persistence'
import { LolalyticsPoolSource } from './source'

const requestId = z.string().uuid()
const catalogInput = z
  .object({ requestId, role: z.enum(DRAFT_ROLES), refresh: z.boolean() })
  .strict()
const coverageInput = z
  .object({
    requestId,
    datasetId: z.string().uuid(),
    championIds: z
      .array(z.number().int().positive())
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length)
  })
  .strict()

@Shard(ChampionPoolMain.id)
export class ChampionPoolMain implements IAkariShardInitDispose {
  static id = CHAMPION_POOL_NAMESPACE
  private readonly _controller: ChampionPoolController
  private readonly _storage: ChampionPoolPersistence
  constructor(
    private readonly _ipc: AkariIpcMain,
    network: NetworkMain
  ) {
    this._storage = new ChampionPoolPersistence(join(app.getPath('userData'), 'champion-pool'))
    this._controller = new ChampionPoolController(
      new LolalyticsPoolSource(network.createAxiosClient()),
      Date.now,
      this._storage
    )
  }
  async onInit() {
    this._ipc.onCall(ChampionPoolMain.id, 'getPreferences', () => this._controller.preferences())
    this._ipc.onCall(ChampionPoolMain.id, 'savePool', async (_event, input: unknown) => {
      const value = z
        .object({
          role: z.enum(DRAFT_ROLES),
          championIds: z
            .array(z.number().int().positive())
            .refine((ids) => new Set(ids).size === ids.length)
        })
        .strict()
        .parse(input)
      const result = await this._controller.savePool(value.role, value.championIds)
      if (result.status === 'ready') {
        this._ipc.sendEvent(ChampionPoolMain.id, 'pool-changed')
      }
      return result
    })
    this._ipc.onCall(ChampionPoolMain.id, 'prepareReference', (event, input: unknown) => {
      const value = coverageInput.parse(input)
      return this._controller.prepareReference(
        event.sender.id,
        value.requestId,
        value.datasetId,
        value.championIds
      )
    })
    this._ipc.onCall(ChampionPoolMain.id, 'getReferenceProgress', (event, id: unknown) =>
      this._controller.progress(event.sender.id, requestId.parse(id))
    )
    this._ipc.onCall(ChampionPoolMain.id, 'getCatalog', (event, input: unknown) => {
      const value = catalogInput.parse(input)
      return this._controller.catalog(event.sender.id, value.requestId, value.role, value.refresh)
    })
    this._ipc.onCall(ChampionPoolMain.id, 'getCoverage', (event, input: unknown) => {
      const value = coverageInput.parse(input)
      return this._controller.coverage(
        event.sender.id,
        value.requestId,
        value.datasetId,
        value.championIds
      )
    })
    this._ipc.onCall(ChampionPoolMain.id, 'cancel', (event, id: unknown) =>
      this._controller.cancel(event.sender.id, requestId.parse(id))
    )
  }
  async onDispose() {
    await this._controller.dispose()
    await this._storage.flush()
  }
}
