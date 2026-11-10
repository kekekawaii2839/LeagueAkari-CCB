import { describe, expect, it } from 'vitest'

import { expectedPairWinRate } from '../blindability'
import {
  type LolalyticsBaseline,
  type LolalyticsPairReport,
  type LolalyticsScope,
  adaptLolalyticsStatistics
} from './lolalytics'
import { DRAFT_ROLES, scoreScopedBlindability } from './scoring'

const scope: LolalyticsScope = {
  source: 'lolalytics',
  patch: '16.21',
  tier: 'diamond_plus',
  queueId: 420,
  region: 'all'
}
function fixture() {
  const baselines: LolalyticsBaseline[] = DRAFT_ROLES.flatMap((role) =>
    [3, 1, 2].map((championId) => ({
      scope: { ...scope },
      championId,
      role,
      games: 1000,
      reportedWinRate: championId === 1 ? 0.52 : championId === 2 ? 0.48 : 0.5,
      reportedWinRatePrecisionPp: 0.01,
      pickRate: championId === 1 ? 0.5 : championId === 2 ? 0.3 : 0.2,
      pickRateDenominator: 'same-role-games' as const,
      populationWinRate: 0.519
    }))
  )
  const reports: LolalyticsPairReport[] = [3, 1, 2].flatMap((championId) =>
    (['matchup', 'synergy'] as const).flatMap((mode) =>
      DRAFT_ROLES.flatMap((otherRole) => {
        if (mode === 'synergy' && otherRole === 'SUP') return []
        return [
          {
            scope: { ...scope },
            championId,
            ownRole: 'SUP' as const,
            mode,
            otherRole,
            pairs: [3, 1, 2]
              .filter((target) => target !== championId)
              .map((target) => ({
                championId: target,
                games: 111,
                reportedWinRate: 0.55 + (target - championId) * 0.01,
                reportedWinRatePrecisionPp: 0.01
              }))
          }
        ]
      })
    )
  )
  return { baselines, reports, options: { ownRole: 'SUP' as const, scope: { ...scope } } }
}

describe('Lolalytics normalized statistics adapter (synthetic only)', () => {
  it('builds five opponent and four teammate blocks with stable full role rosters', () => {
    const f = fixture(),
      result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    expect(result.blocks).toHaveLength(9)
    expect(result.blocks.filter((b) => b.mode === 'matchup')).toHaveLength(5)
    expect(result.blocks.filter((b) => b.mode === 'synergy')).toHaveLength(4)
    expect(
      result.blocks.every(
        (b) => b.champions.join(',') === '1,2,3' && b.targets.join(',') === '1,2,3'
      )
    ).toBe(true)
    expect(
      result.blocks.every(
        (b) =>
          b.championPickRates.join(',') === '0.5,0.3,0.2' &&
          b.targetPickRates.join(',') === '0.5,0.3,0.2'
      )
    ).toBe(true)
    expect(result.coverage.expectedCharts).toBe(27)
    expect(result.coverage.providedCharts).toBe(27)
    expect(result.coverage.missingCharts).toEqual([])
    expect(result.coverage.possibleDirectedNonMirrorPairs).toBe(54)
    expect(result.coverage.usableDeltaPairs).toBe(54)
  })

  it('uses our odds residual for matchup and synergy, never supplier d1/d2', () => {
    const f = fixture()
    const first = f.reports.find(
      (r) => r.championId === 1 && r.mode === 'matchup' && r.otherRole === 'MID'
    )!
    Object.assign(
      first.pairs.find((p) => p.championId === 2)!,
      { d1: 99, d2: 99, pr: 99 }
    )
    const result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    const matchup = result.blocks.find((b) => b.mode === 'matchup' && b.otherRole === 'MID')!
    const synergy = result.blocks.find((b) => b.mode === 'synergy' && b.otherRole === 'MID')!
    expect(matchup.rawPp[0][1]).toBeCloseTo(
      100 * (0.56 - expectedPairWinRate(0.52, 0.48, 'matchup'))
    )
    expect(synergy.rawPp[0][1]).toBeCloseTo(
      100 * (0.56 - expectedPairWinRate(0.52, 0.48, 'synergy'))
    )
    expect(result.pairSamples.every((p) => !('d1' in p) && !('d2' in p) && !('pr' in p))).toBe(true)
    expect(result.coverage.conditionalPairPickRatesUsed).toBe(false)
  })

  it('preserves reported rates and sample counts without fabricating integer wins', () => {
    const f = fixture(),
      result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    expect(
      result.pairSamples.every(
        (p) => p.games === 111 && p.wins === null && p.reportedWinRatePrecisionPp === 0.01
      )
    ).toBe(true)
    expect(
      result.baselines.every((b) => b.games === 1000 && b.reportedWinRatePrecisionPp === 0.01)
    ).toBe(true)
    expect(result.coverage.integerWins).toBe('not-reported-not-inferred')
  })

  it('warns about a non-50% population instead of silently applying supplier normalization', () => {
    const f = fixture(),
      result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    expect(result.coverage.populationWinRateNotCentered).toHaveLength(5)
    expect(
      result.coverage.populationWinRateNotCentered.every((r) => r.reportedRates[0] === 0.519)
    ).toBe(true)
    expect(result.coverage.deltaMethod).toBe('unadjusted-odds-residual-from-reported-ratios')
  })

  it('keeps missing charts and cells null without deleting heroes from the z reference population', () => {
    const f = fixture()
    const reports = f.reports.filter(
      (r) => !(r.championId === 2 && r.mode === 'synergy' && r.otherRole === 'ADC')
    )
    const result = adaptLolalyticsStatistics(f.baselines, reports, f.options)
    const block = result.blocks.find((b) => b.mode === 'synergy' && b.otherRole === 'ADC')!
    expect(block.champions).toEqual(['1', '2', '3'])
    expect(block.rawPp[1]).toEqual([null, null, null])
    expect(result.coverage.missingCharts).toEqual([
      { championId: 2, mode: 'synergy', otherRole: 'ADC' }
    ])
    expect(result.coverage.missingOrUnavailablePairs).toBe(2)
  })

  it('distinguishes zero samples, missing pair rates and unavailable baselines', () => {
    const f = fixture()
    const report = f.reports.find(
      (r) => r.championId === 1 && r.mode === 'matchup' && r.otherRole === 'MID'
    )!
    report.pairs[0].games = 0
    report.pairs[1].reportedWinRate = null
    f.baselines.find((b) => b.championId === 2 && b.role === 'TOP')!.reportedWinRate = 1
    const result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    expect(result.coverage.zeroSamplePairs).toBe(1)
    expect(result.coverage.missingPairRatePairs).toBe(1)
    expect(result.coverage.baselineUnavailablePairs).toBe(4)
    expect(
      result.pairSamples.find(
        (p) =>
          p.otherRole === 'MID' &&
          p.mode === 'matchup' &&
          p.selectedChampionId === 1 &&
          p.championId === 3
      )!.state
    ).toBe('zero-sample')
  })

  it('excludes mirror entries and preserves unknown target samples without inventing their baselines', () => {
    const f = fixture(),
      report = f.reports[0]
    report.pairs = [
      ...report.pairs,
      { championId: report.championId, games: 0, reportedWinRate: null },
      { championId: 999, games: 3, reportedWinRate: 0.33 }
    ]
    const result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    expect(result.coverage.mirrorEntriesExcluded).toBe(1)
    expect(result.coverage.outsideRosterPairs).toBe(1)
    expect(result.pairSamples.find((p) => p.championId === 999)!.state).toBe('outside-roster')
  })

  it('does not invent shrinkage; alpha zero scores while default alpha remains unavailable', () => {
    const f = fixture(),
      result = adaptLolalyticsStatistics(f.baselines, f.reports, f.options)
    expect(result.blocks.every((b) => b.shrunkPp.every((r) => r.every((v) => v === null)))).toBe(
      true
    )
    const raw = scoreScopedBlindability('SUP', result.blocks, {
      shrinkAlpha: 0,
      pickRateFloor: 0,
      pickRateWeighted: true
    })
    expect(raw.rows.some((r) => r.aggregate !== null)).toBe(true)
    expect(
      scoreScopedBlindability('SUP', result.blocks, {
        shrinkAlpha: 0.8,
        pickRateFloor: 0,
        pickRateWeighted: true
      }).rows.every((r) => r.aggregate === null)
    ).toBe(true)
  })

  it.each(['source', 'patch', 'tier', 'queueId', 'region'] as const)(
    'rejects baseline and chart scope mismatch: %s',
    (field) => {
      const f = fixture()
      const mutate = (s: LolalyticsScope) => {
        Object.assign(s, {
          [field]:
            field === 'queueId' ? 440 : field === 'source' ? 'another-source' : 'another-scope'
        })
      }
      mutate(f.baselines[0].scope)
      expect(() => adaptLolalyticsStatistics(f.baselines, f.reports, f.options)).toThrow(
        /Cannot mix/
      )
      const g = fixture()
      mutate(g.reports[0].scope)
      expect(() => adaptLolalyticsStatistics(g.baselines, g.reports, g.options)).toThrow(
        /Cannot mix/
      )
    }
  )

  it('rejects missing role baselines, duplicate charts, duplicate targets and conditional PR denominators', () => {
    const f = fixture()
    expect(() =>
      adaptLolalyticsStatistics(
        f.baselines.filter((b) => b.role !== 'MID'),
        f.reports,
        f.options
      )
    ).toThrow(/five role/)
    expect(() =>
      adaptLolalyticsStatistics(f.baselines, [...f.reports, f.reports[0]], f.options)
    ).toThrow(/Duplicate hero/)
    const g = fixture()
    g.reports[0].pairs = [...g.reports[0].pairs, g.reports[0].pairs[0]]
    expect(() => adaptLolalyticsStatistics(g.baselines, g.reports, g.options)).toThrow(
      /duplicate pair/
    )
    const h = fixture()
    Object.assign(h.baselines[0], { pickRateDenominator: 'conditional-pair-games' })
    expect(() => adaptLolalyticsStatistics(h.baselines, h.reports, h.options)).toThrow(
      /denominator/
    )
  })

  it('rejects percentage-unit rates, invalid sample counts and unreported precision claims', () => {
    const f = fixture()
    f.baselines[0].reportedWinRate = 52
    expect(() => adaptLolalyticsStatistics(f.baselines, f.reports, f.options)).toThrow(/baseline/)
    const g = fixture()
    g.reports[0].pairs[0].games = 1.2
    expect(() => adaptLolalyticsStatistics(g.baselines, g.reports, g.options)).toThrow(
      /pair sample/
    )
    const h = fixture()
    h.baselines[0].reportedWinRatePrecisionPp = -1
    expect(() => adaptLolalyticsStatistics(h.baselines, h.reports, h.options)).toThrow(/precision/)
  })
})
