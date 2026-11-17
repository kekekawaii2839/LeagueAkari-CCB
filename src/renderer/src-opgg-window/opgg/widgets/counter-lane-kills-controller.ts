import { useInstance } from '@renderer-shared/shards'
import { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import type { ChampionDataQuery } from '@shared/data-adapter/champion-data'
import type { OpggChampionCounter } from '@shared/types/opgg'
import { onActivated, onDeactivated, onScopeDispose, ref, shallowRef, watch } from 'vue'

type LaneKillRequest = {
  enabled: boolean
  snapshot: object
  championId: number
  query: ChampionDataQuery
  counters: readonly OpggChampionCounter[]
}

/** Optional enrichment never blocks opening a detail. Publish each bounded batch atomically. */
export function useCounterLaneKills(request: () => LaneKillRequest | null) {
  const api = useInstance(ChampionDataRenderer)
  const rates = shallowRef<Record<number, number | null>>({})
  const loading = ref(false)
  const failed = ref(false)
  let generation = 0
  let controller: AbortController | null = null
  let active = true
  let currentSnapshot: object | null = null
  let currentKey: string | null = null
  let completed: {
    snapshot: object
    key: string
    rates: Record<number, number | null>
    failed: boolean
  } | null = null

  function cancel() {
    generation++
    controller?.abort()
    controller = null
    loading.value = false
  }
  async function load(input: LaneKillRequest | null, refresh = false) {
    cancel()
    if (!input) {
      rates.value = {}
      failed.value = false
      currentSnapshot = null
      currentKey = null
      return
    }
    const key = JSON.stringify([
      input.championId,
      input.query,
      input.counters.map((c) => [c.champion_id, c.lane_kill_rate])
    ])
    if (currentSnapshot !== input.snapshot || currentKey !== key) {
      rates.value = {}
      failed.value = false
      currentSnapshot = input.snapshot
      currentKey = key
    }
    if (!input.enabled || !active) return
    if (!refresh && completed?.snapshot === input.snapshot && completed.key === key) {
      rates.value = completed.rates
      failed.value = completed.failed
      return
    }
    const ownGeneration = generation
    const abort = new AbortController()
    controller = abort
    const unique = new Map<number, OpggChampionCounter>()
    for (const counter of input.counters) {
      if (!unique.has(counter.champion_id) || counter.lane_kill_rate !== undefined)
        unique.set(counter.champion_id, counter)
    }
    const missing = [...unique.values()].filter((c) => c.lane_kill_rate === undefined)
    if (!missing.length) return
    loading.value = true
    failed.value = false
    const nextRates: Record<number, number | null> = {}
    let next = 0
    let failures = 0
    await Promise.all(
      Array.from({ length: Math.min(3, missing.length) }, async () => {
        while (next < missing.length && !abort.signal.aborted) {
          const id = missing[next++].champion_id
          try {
            const result = await api.loadLaneKillRate(input.query, input.championId, id, {
              signal: abort.signal
            })
            if (abort.signal.aborted) return
            if (result.status === 'success' && result.effectiveSource === 'opgg')
              nextRates[id] = result.data
            else {
              nextRates[id] = null
              failures++
            }
          } catch {
            if (abort.signal.aborted) return
            nextRates[id] = null
            failures++
          }
        }
      })
    )
    if (ownGeneration !== generation || abort.signal.aborted) return
    completed = { snapshot: input.snapshot, key, rates: nextRates, failed: failures > 0 }
    rates.value = nextRates
    failed.value = failures > 0
    loading.value = false
    controller = null
  }
  watch(
    request,
    (input) => {
      void load(input)
    },
    { immediate: true }
  )
  onDeactivated(() => {
    active = false
    cancel()
  })
  onActivated(() => {
    if (!active) {
      active = true
      void load(request())
    }
  })
  onScopeDispose(cancel)
  return { rates, loading, failed, retry: () => load(request(), true) }
}
