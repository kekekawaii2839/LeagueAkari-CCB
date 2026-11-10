import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { describe, expect, it } from 'vitest'

import { analysisGroupDestination, analysisGroupFor, analysisGroups } from './analysis-navigation'
import { aggregateBans } from './ban-statistics'

describe('ban occurrence and navigation', () => {
  it('deduplicates mirrored bans and excludes unknown sides from the denominator', () => {
    const games = [
      { bans: { own: [1, 2], enemy: [1, 3] } },
      { bans: { own: [], enemy: null } },
      {}
    ] as MemberAnalysisGame[]
    expect(aggregateBans(games, 'both')).toEqual({
      validGames: 1,
      missingGames: 2,
      rows: [1, 2, 3].map((championId) => ({ championId, games: 1, rate: 1 }))
    })
    expect(aggregateBans(games, 'own').validGames).toBe(2)
  })
  it('has five analysis-only groups, keeps deep links and rejects unavailable remembered experimental pages', () => {
    expect(analysisGroups).toHaveLength(5)
    expect(analysisGroupDestination('patch-notes', ['patch-notes'])).toBeNull()
    expect(analysisGroupFor('lp-trend')).toBe('personal')
    expect(analysisGroupFor('synergy')).toBe('combination')
    expect(analysisGroupDestination('team', ['team-metrics', 'early'], 'prediction')).toBe(
      'team-metrics'
    )
  })
})
