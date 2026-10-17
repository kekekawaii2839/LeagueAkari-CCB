import { useInstance } from '@renderer-shared/shards'
import type {
  MemberAnalysisMatchDetails,
  MemberAnalysisMatchOverview
} from '@shared/shards/member-analysis'
import { computed, onActivated, onBeforeUnmount, onDeactivated, shallowRef, watch } from 'vue'

import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import {
  type MatchLease,
  type MatchRead,
  MemberMatchDetailsCache,
  matchOverviewProjection
} from './member-match-details-cache'

const caches = new WeakMap<ReturnType<typeof useMemberAnalysisStore>, MemberMatchDetailsCache>()

function useDetailsCache() {
  const store = useMemberAnalysisStore()
  let cache = caches.get(store)
  if (!cache) {
    const renderer = useInstance(MemberAnalysisRenderer)
    cache = new MemberMatchDetailsCache(
      (id) => renderer.getMatchDetails(id),
      (id) => renderer.getMatchOverview(id)
    )
    caches.set(store, cache)
  }
  return { store, cache }
}

export function useMemberMatchDetailsPageOrder(
  ids: () => readonly number[],
  enabled: () => boolean
) {
  const { store, cache } = useDetailsCache()
  const update = () => {
    cache.setGeneration(store.overviewGeneration)
    cache.setPageOrder(enabled() ? ids() : [])
  }
  watch([ids, enabled, () => store.overviewGeneration], update, { immediate: true, flush: 'sync' })
  onActivated(update)
  onDeactivated(() => cache.setPageOrder([]))
  onBeforeUnmount(() => cache.setPageOrder([]))
}

export function useMemberMatchDetails(gameId: () => number, enabled: () => boolean) {
  return useMatchRead<MemberAnalysisMatchDetails>(
    gameId,
    enabled,
    () => 'full',
    (cache, generation, id, retry, deliver) => cache.acquire(generation, id, retry, deliver)
  )
}

export function useMemberMatchOverview(gameId: () => number, enabled: () => boolean) {
  const store = useMemberAnalysisStore()
  // Only explicitly absent capability means an old Main. An error or null
  // from the new API never retries through the expensive full-data route.
  const kind = () =>
    store.capabilities
      ? store.capabilities.methods.includes('getMatchOverview')
        ? ('overview' as const)
        : ('full' as const)
      : null
  return useMatchRead<MemberAnalysisMatchOverview>(
    gameId,
    enabled,
    kind,
    (cache, generation, id, retry, deliver) => {
      if (kind() === 'overview') return cache.acquireOverview(generation, id, retry, deliver)
      const project = (
        result: MatchRead<MemberAnalysisMatchDetails>
      ): MatchRead<MemberAnalysisMatchOverview> =>
        result.status === 'ready'
          ? { status: 'ready', value: matchOverviewProjection(result.value) }
          : result
      const lease = cache.acquire(generation, id, retry, (result) => deliver(project(result)))
      return {
        promise: lease.promise.then(project),
        settled: lease.settled ? project(lease.settled) : undefined,
        release: lease.release
      }
    }
  )
}

function useMatchRead<T>(
  gameId: () => number,
  enabled: () => boolean,
  kind: () => 'full' | 'overview' | null,
  acquire: (
    cache: MemberMatchDetailsCache,
    generation: number,
    id: number,
    retry: boolean,
    deliver: (result: MatchRead<T>) => void
  ) => MatchLease<T>
) {
  const { store, cache } = useDetailsCache()
  const state = shallowRef<MatchRead<T>>({ status: 'cancelled', value: null })
  const loading = shallowRef(false)
  const routeActive = shallowRef(true)
  let lease: MatchLease<T> | null = null
  let delivery = 0
  let currentId = gameId()
  let currentGeneration = store.overviewGeneration
  let currentKind = kind()
  function load(retry = false) {
    const token = ++delivery
    lease?.release()
    lease = null
    const id = gameId()
    const generation = store.overviewGeneration
    // Hidden tab panes stay mounted. Keep their settled snapshot so returning
    // does not tear down/recreate all ten-player rosters. Publication or row
    // changes must still remove the old snapshot, even while hidden.
    if (retry || id !== currentId || generation !== currentGeneration || kind() !== currentKind) {
      state.value = { status: 'cancelled', value: null }
    }
    currentKind = kind()
    currentId = id
    currentGeneration = generation
    loading.value = false
    cache!.setGeneration(store.overviewGeneration)
    if (!enabled() || !routeActive.value || kind() === null) return
    loading.value = true
    const deliver = (result: MatchRead<T>) => {
      if (token !== delivery) return
      state.value = result
      loading.value = false
    }
    lease = acquire(cache, generation, id, retry, deliver)
    // A cache hit is already final: do not insert a transient loading render
    // and wait a microtask to restore exactly the same object.
    if (lease.settled) deliver(lease.settled)
    void lease.promise.then(deliver)
  }
  watch(
    [gameId, enabled, kind, () => routeActive.value, () => store.overviewGeneration],
    () => load(),
    {
      immediate: true,
      flush: 'sync'
    }
  )
  onBeforeUnmount(() => {
    delivery++
    lease?.release()
  })
  onDeactivated(() => {
    routeActive.value = false
  })
  onActivated(() => {
    routeActive.value = true
  })
  return {
    match: computed(() => state.value.value),
    error: computed(() => state.value.status === 'error'),
    loading,
    load: () => load(true)
  }
}
