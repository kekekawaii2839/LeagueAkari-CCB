import type {
  MemberAnalysisCapabilities,
  MemberAnalysisCleanupPreview,
  MemberAnalysisError,
  MemberAnalysisFilters,
  MemberAnalysisJob,
  MemberAnalysisOverview,
  MemberAnalysisSettings,
  MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'
import type { PerformanceMetric } from '@shared/shards/member-analysis/performance-metrics'
import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'

export type MemberAnalysisViewState =
  'feature-disabled' | 'first-run' | 'loading' | 'empty' | 'error' | 'ready'

export type MemberAnalysisPredictionTaskStatus =
  'idle' | 'running' | 'completed' | 'unavailable' | 'failed'

export interface MemberAnalysisMatchNavigation {
  sequence: number
  gameId: number
  source: string
}

export interface MemberAnalysisMatchListScope {
  sequence: number
  publishedGeneration: number
  source: string
  gameIds: readonly number[]
  status: 'active' | 'expired'
}

export type MemberAnalysisMatchListScopeError =
  'empty' | 'invalid' | 'ambiguous' | 'missing' | 'stale'

export function resolveMemberAnalysisViewState(input: {
  loading: boolean
  settings: MemberAnalysisSettings | null
  overview: MemberAnalysisOverview | null
  error: MemberAnalysisError | null
}): MemberAnalysisViewState {
  // A background read must not tear down the already-readable page tree.
  // Explicit disable still wins, including when stale data remains in memory.
  if (input.settings && !input.settings.enabled) return 'feature-disabled'
  if (input.settings?.enabled && input.overview && !input.overview.firstRun)
    return input.overview.gameCount === 0 ? 'empty' : 'ready'
  if (input.loading) return 'loading'
  if (input.error) return 'error'
  if (!input.settings?.enabled) return 'feature-disabled'
  if (!input.overview || input.overview.firstRun) return 'first-run'
  if (input.overview.gameCount === 0) return 'empty'
  return 'ready'
}

export const useMemberAnalysisStore = defineStore('shard:member-analysis-renderer', () => {
  const loading = ref(true)
  const capabilities = ref<MemberAnalysisCapabilities | null>(null)
  const settings = ref<MemberAnalysisSettings | null>(null)
  const overview = ref<MemberAnalysisOverview | null>(null)
  const overviewGeneration = ref(0)
  const error = ref<MemberAnalysisError | null>(null)
  const settingsDrawerVisible = ref(false)
  const settingsFocus = ref<'collection' | 'members' | null>(null)
  const job = ref<MemberAnalysisJob | null>(null)
  const storageStatus = ref<MemberAnalysisStorageStatus | null>(null)
  const cleanupPreview = ref<MemberAnalysisCleanupPreview | null>(null)
  const sampleSize = ref<20 | 50 | 100 | 'all'>(50)
  const analysisSide = ref<'all' | 'Blue' | 'Red'>('all')
  const sideBreakdown = ref(false)
  const matchNavigation = ref<MemberAnalysisMatchNavigation | null>(null)
  const matchNavigationFeedback = ref('')
  const matchListScope = ref<MemberAnalysisMatchListScope | null>(null)
  const matchListScopeError = ref<MemberAnalysisMatchListScopeError | null>(null)
  let matchNavigationSequence = 0
  let matchListScopeSequence = 0
  watch(
    overview,
    () => {
      overviewGeneration.value++
      if (matchListScope.value)
        matchListScope.value = { ...matchListScope.value, status: 'expired' }
    },
    { flush: 'sync' }
  )
  function navigateToMatch(gameId: number, source: string) {
    clearMatchListScope()
    matchNavigationFeedback.value = ''
    matchNavigation.value = { sequence: ++matchNavigationSequence, gameId, source }
  }
  function cancelMatchNavigation() {
    matchNavigation.value = null
    matchNavigationFeedback.value = ''
  }
  function clearMatchListScope() {
    matchListScope.value = null
    matchListScopeError.value = null
  }
  function navigateToMatches(
    gameIds: readonly number[],
    source: string,
    publishedGeneration: number
  ): boolean {
    const reject = (reason: MemberAnalysisMatchListScopeError) => {
      matchListScopeError.value = reason
      return false
    }
    if (!gameIds.length) return reject('empty')
    if (!source.trim() || gameIds.some((id) => !Number.isSafeInteger(id) || id <= 0))
      return reject('invalid')
    if (
      !overview.value ||
      overview.value.firstRun ||
      overviewGeneration.value !== publishedGeneration
    )
      return reject('stale')
    const requested = new Set(gameIds)
    const counts = new Map<number, number>()
    for (const game of overview.value.games)
      if (requested.has(game.gameId)) counts.set(game.gameId, (counts.get(game.gameId) ?? 0) + 1)
    if ([...requested].some((id) => (counts.get(id) ?? 0) > 1)) return reject('ambiguous')
    if ([...requested].some((id) => !counts.has(id))) return reject('missing')
    cancelMatchNavigation()
    matchListScopeError.value = null
    matchListScope.value = {
      sequence: ++matchListScopeSequence,
      publishedGeneration,
      source: source.trim(),
      gameIds: Object.freeze([...requested]),
      status: 'active'
    }
    return true
  }
  // Session-only controls; no player data or view choices are written to disk.
  const scatterViewState = reactive({
    matchMode: false,
    perMember: false,
    hiddenMembersByRole: {} as Record<string, string[]>,
    xMetric: 'damageConversion' as PerformanceMetric,
    yMetric: 'winRate' as PerformanceMetric,
    roleFilter: 'MIDDLE'
  })
  const predictionViewState = reactive({
    side: 'all' as 'all' | 'Blue' | 'Red',
    lineup: { TOP: '', JUNGLE: '', MIDDLE: '', BOTTOM: '', UTILITY: '' }
  })
  const predictionTaskStatus = ref<MemberAnalysisPredictionTaskStatus>('idle')
  const championViewState = reactive({
    sort: null as {
      role: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY'
      metric: 'games' | 'heroes'
      direction: 'ascending' | 'descending'
    } | null
  })
  const filters = reactive<MemberAnalysisFilters>({
    outcome: 'all',
    patch: 'all',
    dateFrom: '',
    dateTo: '',
    durationMin: null,
    durationMax: null,
    participant: 'all',
    matchRole: 'all',
    champion: 'all',
    query: ''
  })
  const viewState = computed(() =>
    resolveMemberAnalysisViewState({
      loading: loading.value,
      settings: settings.value,
      overview: overview.value,
      error: error.value
    })
  )

  const resetFilters = () => {
    Object.assign(filters, {
      outcome: 'all',
      patch: 'all',
      dateFrom: '',
      dateTo: '',
      durationMin: null,
      durationMax: null,
      participant: 'all',
      matchRole: 'all',
      champion: 'all',
      query: ''
    } satisfies MemberAnalysisFilters)
  }

  return {
    loading,
    capabilities,
    settings,
    overview,
    overviewGeneration,
    error,
    settingsDrawerVisible,
    settingsFocus,
    job,
    storageStatus,
    cleanupPreview,
    sampleSize,
    analysisSide,
    sideBreakdown,
    matchNavigation,
    matchNavigationFeedback,
    matchListScope,
    matchListScopeError,
    navigateToMatches,
    clearMatchListScope,
    navigateToMatch,
    cancelMatchNavigation,
    scatterViewState,
    predictionViewState,
    predictionTaskStatus,
    championViewState,
    filters,
    viewState,
    resetFilters
  }
})
