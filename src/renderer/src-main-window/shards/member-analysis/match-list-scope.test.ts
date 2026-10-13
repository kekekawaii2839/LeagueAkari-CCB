import type { MemberAnalysisOverview } from '@shared/shards/member-analysis'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test } from 'vitest'

import { useMemberAnalysisStore } from './store'

const overview = (): MemberAnalysisOverview => ({
  contractVersion: 1,
  dataVersion: 5,
  firstRun: false,
  generatedAt: 'synthetic-generation',
  source: 'Synthetic',
  gameCount: 3,
  playerCount: 5,
  collectionAudit: null,
  games: [1, 2, 3].map((gameId) => ({ gameId })) as any,
  pagination: { nextCursor: null }
})

describe('session-only exact match-list scopes', () => {
  beforeEach(() => setActivePinia(createPinia()))
  test('deduplicates exact IDs, preserves all global controls and does not pick a single match', () => {
    const store = useMemberAnalysisStore()
    store.overview = overview()
    store.filters.query = 'Synthetic'
    store.sampleSize = 20
    const filters = { ...store.filters }
    expect(store.navigateToMatches([3, 1, 3], 'Member evidence', store.overviewGeneration)).toBe(
      true
    )
    expect(store.matchListScope).toMatchObject({
      gameIds: [3, 1],
      status: 'active',
      source: 'Member evidence'
    })
    expect(store.matchNavigation).toBeNull()
    expect(store.filters).toEqual(filters)
    expect(store.sampleSize).toBe(20)
  })
  test.each(['replace', 'clear'] as const)(
    'expires the evidence generation on overview %s without rebinding old IDs',
    (change) => {
      const store = useMemberAnalysisStore()
      store.overview = overview()
      const generation = store.overviewGeneration
      store.navigateToMatches([1, 2], 'Synthetic', generation)
      store.overview = change === 'replace' ? overview() : null
      expect(store.overviewGeneration).toBeGreaterThan(generation)
      expect(store.matchListScope?.status).toBe('expired')
      expect(store.matchListScope?.publishedGeneration).toBe(generation)
      expect(store.navigateToMatches([1], 'Synthetic', generation)).toBe(false)
      expect(store.matchListScopeError).toBe('stale')
    }
  )
  test.each([
    [[], 'empty'],
    [[0], 'invalid'],
    [[99], 'missing']
  ] as const)('rejects invalid scopes with typed visible-consumer feedback: %s', (ids, reason) => {
    const store = useMemberAnalysisStore()
    store.overview = overview()
    store.navigateToMatches([1], 'Previous', store.overviewGeneration)
    const previous = store.matchListScope
    expect(store.navigateToMatches(ids, 'Synthetic', store.overviewGeneration)).toBe(false)
    expect(store.matchListScope).toBe(previous)
    expect(store.matchListScopeError).toBe(reason)
  })
  test('rejects full-overview identity collisions rather than picking the first match', () => {
    const store = useMemberAnalysisStore()
    store.overview = { ...overview(), games: [{ gameId: 1 }, { gameId: 1 }] as any }
    expect(store.navigateToMatches([1], 'Synthetic', store.overviewGeneration)).toBe(false)
    expect(store.matchListScopeError).toBe('ambiguous')
    expect(store.matchListScope).toBeNull()
  })
  test('keeps active scope across control changes, and single-match navigation clears it', () => {
    const store = useMemberAnalysisStore()
    store.overview = overview()
    store.navigateToMatches([1, 2], 'Synthetic', store.overviewGeneration)
    const scope = store.matchListScope
    store.filters.query = 'narrower'
    store.sampleSize = 100
    expect(store.matchListScope).toBe(scope)
    store.navigateToMatch(3, 'Single evidence')
    expect(store.matchListScope).toBeNull()
    expect(store.matchNavigation?.gameId).toBe(3)
  })
})
