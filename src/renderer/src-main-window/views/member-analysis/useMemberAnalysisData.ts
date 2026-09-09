import { computed } from 'vue'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import {
  aggregateChampions,
  aggregateConversion,
  aggregateJungle,
  aggregatePairs,
  aggregateRoles,
  aggregateSynergy,
  selectMemberAnalysisSample
} from './analytics'

export function useMemberAnalysisData() {
  const store = useMemberAnalysisStore()
  const selection = computed(() =>
    selectMemberAnalysisSample(
      store.overview?.games ?? [],
      store.filters,
      store.analysisSide,
      store.sampleSize
    )
  )
  const sampleGames = computed(() => selection.value.sample)
  return {
    games: sampleGames,
    windowGames: sampleGames,
    roles: computed(() =>
      aggregateRoles(sampleGames.value, store.filters.matchRole, store.filters.participant)
    ),
    champions: computed(() =>
      aggregateChampions(sampleGames.value, store.filters.matchRole, store.filters.participant)
    ),
    pairs: computed(() =>
      aggregatePairs(
        sampleGames.value,
        1,
        'all',
        store.filters.matchRole,
        store.filters.participant
      )
    ),
    jungle: computed(() =>
      store.filters.matchRole !== 'all' && store.filters.matchRole !== 'JUNGLE'
        ? []
        : aggregateJungle(sampleGames.value, 'all', store.filters.participant)
    ),
    conversion: computed(() => aggregateConversion(sampleGames.value)),
    synergy: computed(() => {
      return aggregateSynergy(sampleGames.value).filter(
        (row) =>
          store.filters.participant === 'all' ||
          row.playerA === store.filters.participant ||
          row.playerB === store.filters.participant
      )
    })
  }
}
