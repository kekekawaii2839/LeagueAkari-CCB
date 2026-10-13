import { computed, toRaw } from 'vue'

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

const sharedData = new WeakMap<
  ReturnType<typeof useMemberAnalysisStore>,
  ReturnType<typeof createData>
>()

function createData(store: ReturnType<typeof useMemberAnalysisStore>) {
  let previousOverview: typeof store.overview = null
  let previousSelection: ReturnType<typeof selectMemberAnalysisSample> | null = null
  const sameGames = (
    left: ReturnType<typeof selectMemberAnalysisSample>['sample'],
    right: ReturnType<typeof selectMemberAnalysisSample>['sample']
  ) => left.length === right.length && left.every((game, index) => game === right[index])
  const selection = computed(() => {
    const overview = store.overview
    // Published overviews are replaced atomically by the renderer loader, not
    // edited in place. Track the publication and controls once; pure analyzers
    // must not subscribe to every property of thousands of reactive rows.
    const current = selectMemberAnalysisSample(
      toRaw(overview?.games ?? []),
      store.filters,
      store.analysisSide,
      store.sampleSize
    )
    if (
      previousOverview === overview &&
      previousSelection &&
      sameGames(previousSelection.globallyFiltered, current.globallyFiltered) &&
      sameGames(previousSelection.sample, current.sample)
    )
      return previousSelection
    previousOverview = overview
    previousSelection = current
    return current
  })
  const sampleGames = computed(() => selection.value.sample)
  return {
    selection,
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

export function useMemberAnalysisData() {
  const store = useMemberAnalysisStore()
  let data = sharedData.get(store)
  if (!data) {
    data = createData(store)
    sharedData.set(store, data)
  }
  return data
}
