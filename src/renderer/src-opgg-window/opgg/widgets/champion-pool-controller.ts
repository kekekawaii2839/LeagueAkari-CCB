import { useInstance } from '@renderer-shared/shards'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import {
  CHAMPION_POOL_NAMESPACE,
  type PoolPreferences,
  type PoolResult
} from '@shared/shards/champion-pool/coverage'
import type { DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import { type Ref, computed, onScopeDispose, shallowRef } from 'vue'

const POSITION_ROLES: Readonly<Record<string, DraftRole>> = {
  top: 'TOP',
  jungle: 'JUNGLE',
  mid: 'MID',
  adc: 'ADC',
  support: 'SUP'
}

/** Only the saved roster is shared: matchup metrics remain owned by the data window. */
export function useChampionPool(position: Readonly<Ref<string>>, mode: Readonly<Ref<string>>) {
  const ipc = useInstance(AkariIpcRenderer)
  const preferences = shallowRef<PoolPreferences | null>(null)
  const status = shallowRef<'loading' | 'ready' | 'error'>('loading')
  let generation = 0
  let disposed = false
  async function refresh() {
    const request = ++generation
    try {
      const result = await ipc.call<PoolResult<PoolPreferences>>(
        CHAMPION_POOL_NAMESPACE,
        'getPreferences'
      )
      if (disposed || request !== generation) return
      preferences.value = result.status === 'ready' ? result.data : null
      status.value = result.status === 'ready' ? 'ready' : 'error'
    } catch {
      if (disposed || request !== generation) return
      preferences.value = null
      status.value = 'error'
    }
  }
  const stop = ipc.onEvent(CHAMPION_POOL_NAMESPACE, 'pool-changed', refresh)
  onScopeDispose(() => {
    disposed = true
    stop()
  })
  void refresh()
  const role = computed(() =>
    ['ranked', 'classic'].includes(mode.value) ? POSITION_ROLES[position.value] : undefined
  )
  const championIds = computed(
    () => new Set(role.value ? (preferences.value?.pools[role.value] ?? []) : [])
  )
  return { championIds, status, role, refresh }
}
