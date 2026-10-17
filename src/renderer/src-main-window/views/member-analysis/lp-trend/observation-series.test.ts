import type { QueueRank, RankValue } from '@shared/shards/member-analysis/opponent-ranks'
import { expect, test } from 'vitest'

import {
  observationSeries,
  rankProgressCoordinate,
  rankProgressDomain,
  rankProgressTick
} from './observation-series'

const ranked = (
  tier: RankValue['tier'],
  division: RankValue['division'],
  leaguePoints: number | null
): QueueRank => ({
  status: 'ranked',
  rank: { tier, division, leaguePoints }
})

test('promotion uses stable rank progress without pretending to measure LP earned', () => {
  expect(rankProgressCoordinate(ranked('BRONZE', 'I', 99).rank!)).toBe(799)
  expect(rankProgressCoordinate(ranked('SILVER', 'IV', 10).rank!)).toBe(810)
  expect(rankProgressCoordinate(ranked('BRONZE', 'I', 100).rank!)).toBe(800)
  expect(rankProgressTick(800)).toBe('白银 IV')
})

test('top tiers share actual LP, without invented tier offsets or a 100 LP ceiling', () => {
  for (const tier of ['MASTER', 'GRANDMASTER', 'CHALLENGER'] as const) {
    expect(rankProgressCoordinate({ tier, division: null, leaguePoints: 1420 })).toBe(4220)
    expect(rankProgressCoordinate({ tier, division: null, leaguePoints: 0 })).toBe(2800)
  }
})

test('missing and anomalous facts remain available, never clamped or converted to zero', () => {
  const original = [
    { fetchedAt: '2026-10-13T01:00:00Z', rank: ranked('GOLD', 'IV', 0) },
    { fetchedAt: '2026-10-13T02:00:00Z', rank: ranked('GOLD', 'IV', null) },
    { fetchedAt: '2026-10-13T03:00:00Z', rank: ranked('GOLD', 'IV', 120) },
    { fetchedAt: '2026-10-13T04:00:00Z', rank: { status: 'missing', rank: null } as QueueRank },
    { fetchedAt: '2026-10-13T05:00:00Z', rank: ranked('GOLD', 'IV', -1) }
  ]
  const points = observationSeries(original)
  expect(points.map((point) => point.y)).toEqual([1200, null, null, null, null])
  expect(points[2].observation).toBe(original[2])
  expect(points[4].observation).toBe(original[4])
})

test('uses actual observation time, preserves gaps, and determines a common all-member domain', () => {
  const one = observationSeries([
    { fetchedAt: '2026-10-13T03:00:00Z', rank: ranked('SILVER', 'IV', 10) },
    { fetchedAt: '2026-10-13T01:00:00Z', rank: ranked('BRONZE', 'I', 99) }
  ])
  const two = observationSeries([
    { fetchedAt: '2026-10-13T02:00:00Z', rank: ranked('MASTER', null, 1200) }
  ])
  expect(one.map((point) => point.x)).toEqual([
    Date.parse('2026-10-13T01:00:00Z'),
    Date.parse('2026-10-13T03:00:00Z')
  ])
  expect(rankProgressDomain([one, two])).toMatchObject({ min: 400, max: 4000 })
  expect(rankProgressDomain([])).toBeNull()
})
