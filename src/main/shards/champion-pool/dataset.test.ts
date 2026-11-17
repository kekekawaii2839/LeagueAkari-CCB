import { adaptLolalyticsStatistics } from '@shared/shards/member-analysis/champion-pool/lolalytics'
import { DRAFT_ROLES } from '@shared/shards/member-analysis/champion-pool/scoring'
import { expect, it } from 'vitest'

import { normalizeHero } from './dataset'
import type { SourceCatalog } from './source'

function fixture() {
  const scope = {
    source: 'lolalytics' as const,
    patch: '16.22',
    tier: 'all',
    region: 'all',
    queueId: 420
  }
  const catalog: SourceCatalog = {
    scope,
    slugs: {},
    baselines: DRAFT_ROLES.flatMap((role) =>
      [1, 2, 3, 4].map((championId) => ({
        scope,
        role,
        championId,
        games: 100,
        reportedWinRate: 0.45 + championId * 0.02,
        pickRate: 0.25,
        pickRateDenominator: 'same-role-games' as const
      }))
    )
  }
  const reports = DRAFT_ROLES.flatMap((otherRole) =>
    (['matchup', 'synergy'] as const)
      .filter((mode) => mode !== 'synergy' || otherRole !== 'MID')
      .map((mode) => ({
        scope,
        championId: 1,
        ownRole: 'MID' as const,
        otherRole,
        mode,
        pairs: [2, 3, 4].map((id) => ({
          championId: id,
          games: id === 4 ? 0 : 100,
          reportedWinRate: id === 3 ? null : 0.55
        }))
      }))
  )
  return { catalog, reports }
}
it('compact cached residuals equal the established adapter for all five enemy/four teammate blocks', () => {
  const { catalog, reports } = fixture()
  const scope = catalog.scope
  const compact = normalizeHero(catalog, 'MID', 1, reports),
    established = adaptLolalyticsStatistics(catalog.baselines, reports, { ownRole: 'MID', scope })
  for (const block of compact.blocks)
    for (const [target, delta, games, reportedWinRate] of block.pairs) {
      const sample = established.pairSamples.find(
        (p) =>
          p.selectedChampionId === 1 &&
          p.otherRole === block.role &&
          p.mode === block.mode &&
          p.championId === target
      )!
      expect(delta).toBe(sample.rawDeltaPp)
      expect(games).toBe(sample.games)
      expect(reportedWinRate).toBe(games === 0 || target === 3 ? null : 0.55)
    }
  expect(() => normalizeHero(catalog, 'MID', 1, reports.slice(1))).toThrow('source-changed')
})

it('preserves observed pair rates without estimable baselines but never invents zero-sample rates', () => {
  const { catalog, reports } = fixture()
  catalog.baselines.find((b) => b.role === 'MID' && b.championId === 1)!.games = 0
  const hero = normalizeHero(catalog, 'MID', 1, reports)
  for (const block of hero.blocks) {
    expect(block.pairs).toEqual([
      [2, null, 100, 0.55],
      [3, null, 100, null],
      [4, null, 0, null]
    ])
  }
})
it('retains genuine zero/all-win pair rates and rejects rates outside the source unit interval', () => {
  const { catalog, reports } = fixture()
  for (const report of reports) {
    report.pairs[0].reportedWinRate = 0
    report.pairs[1].reportedWinRate = 1
  }
  for (const block of normalizeHero(catalog, 'MID', 1, reports).blocks) {
    expect(block.pairs[0][3]).toBe(0)
    expect(block.pairs[1][3]).toBe(1)
  }
  reports[0].pairs[0].reportedWinRate = 1.01
  expect(() => normalizeHero(catalog, 'MID', 1, reports)).toThrow('source-changed')
})
