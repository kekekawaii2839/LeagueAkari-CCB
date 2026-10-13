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
import { computed, reactive, ref } from 'vue'

export type MemberAnalysisViewState =
  'feature-disabled' | 'first-run' | 'loading' | 'empty' | 'error' | 'ready'

export interface MemberAnalysisMatchNavigation {
  sequence: number
  gameId: number
  source: string
}

export function resolveMemberAnalysisViewState(input: {
  loading: boolean
  settings: MemberAnalysisSettings | null
  overview: MemberAnalysisOverview | null
  error: MemberAnalysisError | null
}): MemberAnalysisViewState {
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
  let matchNavigationSequence = 0
  function navigateToMatch(gameId: number, source: string) {
    matchNavigationFeedback.value = ''
    matchNavigation.value = { sequence: ++matchNavigationSequence, gameId, source }
  }
  function cancelMatchNavigation() {
    matchNavigation.value = null
    matchNavigationFeedback.value = ''
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
    navigateToMatch,
    cancelMatchNavigation,
    scatterViewState,
    predictionViewState,
    championViewState,
    filters,
    viewState,
    resetFilters
  }
})
