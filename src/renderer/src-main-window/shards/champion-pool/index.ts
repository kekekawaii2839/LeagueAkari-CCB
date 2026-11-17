import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { Dep, Shard } from '@shared/akari-shard'
import {
  CHAMPION_POOL_NAMESPACE,
  type PoolCatalog,
  type PoolCoverage,
  type PoolPreferences,
  type PoolReferenceProgress,
  type PoolResult
} from '@shared/shards/champion-pool/coverage'
import type { DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'

@Shard(ChampionPoolRenderer.id)
export class ChampionPoolRenderer {
  static id = 'champion-pool-renderer'
  constructor(@Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer) {}
  getPreferences() {
    return this._ipc.call<PoolResult<PoolPreferences>>(CHAMPION_POOL_NAMESPACE, 'getPreferences')
  }
  savePool(role: DraftRole, championIds: number[]) {
    return this._ipc.call<PoolResult<PoolPreferences>>(CHAMPION_POOL_NAMESPACE, 'savePool', {
      role,
      championIds
    })
  }
  prepareReference(datasetId: string, championIds: number[], requestId: string) {
    return this._ipc.call<PoolResult<PoolCoverage>>(CHAMPION_POOL_NAMESPACE, 'prepareReference', {
      datasetId,
      championIds,
      requestId
    })
  }
  getReferenceProgress(requestId: string) {
    return this._ipc.call<PoolReferenceProgress | null>(
      CHAMPION_POOL_NAMESPACE,
      'getReferenceProgress',
      requestId
    )
  }
  getCatalog(role: DraftRole, refresh: boolean, requestId: string) {
    return this._ipc.call<PoolResult<PoolCatalog>>(CHAMPION_POOL_NAMESPACE, 'getCatalog', {
      role,
      refresh,
      requestId
    })
  }
  getCoverage(datasetId: string, championIds: number[], requestId: string) {
    return this._ipc.call<PoolResult<PoolCoverage>>(CHAMPION_POOL_NAMESPACE, 'getCoverage', {
      datasetId,
      championIds,
      requestId
    })
  }
  cancel(requestId: string) {
    return this._ipc.call<void>(CHAMPION_POOL_NAMESPACE, 'cancel', requestId)
  }
}
