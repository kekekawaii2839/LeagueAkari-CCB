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
import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

export type MemberAnalysisViewState =
  'feature-disabled' | 'first-run' | 'loading' | 'empty' | 'error' | 'ready'

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
  const job = ref<MemberAnalysisJob | null>(null)
  const storageStatus = ref<MemberAnalysisStorageStatus | null>(null)
  const cleanupPreview = ref<MemberAnalysisCleanupPreview | null>(null)
  const sampleSize = ref<20 | 50 | 100 | 'all'>(50)
  const analysisSide = ref<'all' | 'Blue' | 'Red'>('all')
  const sideBreakdown = ref(false)
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
    job,
    storageStatus,
    cleanupPreview,
    sampleSize,
    analysisSide,
    sideBreakdown,
    filters,
    viewState,
    resetFilters
  }
})
