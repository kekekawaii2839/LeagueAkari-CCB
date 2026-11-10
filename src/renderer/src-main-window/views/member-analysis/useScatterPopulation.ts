import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { type Ref, computed, getCurrentInstance, onBeforeUnmount, ref, watch } from 'vue'

import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import { hasScatterFilters, selectScatterPopulation } from './scatter-filters'
import { uiText } from './ui-text'
import type { TrendInput } from './version-trend/domain'

export function useScatterPopulation(games: Ref<MemberAnalysisGame[]>, active: Ref<boolean>) {
  const store = useMemberAnalysisStore()
  const api = getCurrentInstance()?.appContext.config.globalProperties.$akariManager?.getInstance(
    MemberAnalysisRenderer
  ) as MemberAnalysisRenderer | undefined
  const input = ref<TrendInput | null>(null)
  const loading = ref(false)
  const readError = ref(false)
  const enabled = computed(() => hasScatterFilters(store.scatterViewState.filters))
  const scope = computed(() =>
    JSON.stringify([
      store.overviewGeneration,
      store.overview?.publicationToken,
      store.settings?.members
    ])
  )
  let loadedScope = '',
    sequence = 0
  watch(
    [scope, active, enabled],
    async () => {
      const id = ++sequence
      loading.value = false
      readError.value = false
      if (!active.value || !enabled.value) return
      if (loadedScope === scope.value && input.value) return
      input.value = null
      const token = store.overview?.publicationToken
      const generation = store.overviewGeneration
      const currentScope = scope.value
      const slots = (store.settings?.members ?? []).map((_, index) => index + 1)
      if (!api || !token || !slots.length) {
        readError.value = true
        return
      }
      loading.value = true
      const current = () => sequence === id && active.value && scope.value === currentScope
      try {
        let cursor: string | null = null,
          configuration: string | null = null
        let configured: string[] = []
        const identities: TrendInput['identities'] = [],
          cursors = new Set<string>()
        do {
          const reply = await api.getPublishedMemberIdentities({
            publicationToken: token,
            memberSlots: slots,
            pageSize: 25,
            cursor
          })
          if (!current()) return
          if (!reply.ok) throw new Error('identity-read-failed')
          const page = reply.value
          if (
            page.publicationToken !== token ||
            (configuration && configuration !== page.configurationToken)
          )
            throw new Error('identity-scope-changed')
          if (
            configuration &&
            JSON.stringify(configured) !== JSON.stringify(page.configuredMemberIds)
          )
            throw new Error('identity-scope-changed')
          configuration = page.configurationToken
          configured = page.configuredMemberIds
          identities.push(
            ...page.games
              .filter((game) => game.status === 'available')
              .map((game) => ({ gameId: game.gameId, members: game.members }))
          )
          cursor = page.pagination.nextCursor
          if (cursor && cursors.has(cursor)) throw new Error('repeated-cursor')
          if (cursor) cursors.add(cursor)
        } while (cursor)
        if (!current()) return
        input.value = {
          generation,
          identitiesGeneration: generation,
          configuredMemberIds: configured,
          identities,
          games: []
        }
        loadedScope = currentScope
      } catch {
        if (current()) readError.value = true
      } finally {
        if (current()) loading.value = false
      }
    },
    { immediate: true }
  )
  onBeforeUnmount(() => {
    sequence++
  })
  const selection = computed(() => {
    if (!enabled.value) return { games: games.value, error: '', unresolved: 0 }
    if (readError.value) return { games: [], error: uiText('scatterIdentityFailed'), unresolved: 0 }
    if (!input.value || loadedScope !== scope.value) return { games: [], error: '', unresolved: 0 }
    try {
      return {
        ...selectScatterPopulation(
          { ...input.value, games: games.value },
          store.scatterViewState.filters,
          store.scatterViewState.roleFilter
        ),
        error: ''
      }
    } catch {
      return { games: [], error: uiText('scatterInvalidFilters'), unresolved: 0 }
    }
  })
  return { enabled, selection, loading }
}
