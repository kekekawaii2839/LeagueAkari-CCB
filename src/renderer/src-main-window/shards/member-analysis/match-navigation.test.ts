import { createPinia, setActivePinia } from 'pinia'
import { expect, test } from 'vitest'

import { useMemberAnalysisStore } from './store'

test('navigation is session-only, latest request wins, cancellation does not mutate controls', () => {
  setActivePinia(createPinia())
  const store = useMemberAnalysisStore()
  store.filters.outcome = 'win'
  store.sampleSize = 20
  store.analysisSide = 'Red'
  const before = JSON.stringify([
    store.filters,
    store.sampleSize,
    store.analysisSide,
    store.settings
  ])
  store.navigateToMatch(900001, '合成事件证据')
  const first = store.matchNavigation!
  store.navigateToMatch(900041, '合成事件证据')
  expect(store.matchNavigation!.gameId).toBe(900041)
  expect(store.matchNavigation!.sequence).toBeGreaterThan(first.sequence)
  store.navigateToMatch(900041, '合成事件证据')
  expect(store.matchNavigation!.gameId).toBe(900041)
  store.cancelMatchNavigation()
  expect(store.matchNavigation).toBeNull()
  expect(
    JSON.stringify([store.filters, store.sampleSize, store.analysisSide, store.settings])
  ).toBe(before)
})
