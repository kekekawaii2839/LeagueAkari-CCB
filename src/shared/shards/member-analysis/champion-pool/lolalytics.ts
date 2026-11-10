import { expectedPairWinRate } from '../blindability'
import {
  DRAFT_ROLES,
  type DraftRole,
  type InteractionMode,
  type ScopedInteractionBlock
} from './scoring'

/** Collector-normalized provenance. Non-echoing endpoints must be bound to their
 * verified page navigation and exact request parameters by the collector.
 */
export interface LolalyticsScope {
  source: 'lolalytics'
  patch: string
  tier: string
  queueId: number
  region: string
}

export interface LolalyticsBaseline {
  scope: LolalyticsScope
  championId: number
  role: DraftRole
  games: number
  reportedWinRate: number | null // 0..1, not percentage units
  reportedWinRatePrecisionPp?: number | null
  pickRate: number // role-wide 0..1; NEVER a pair's conditional co-occurrence share
  pickRateDenominator: 'same-role-games'
  populationWinRate?: number | null // retained warning, not an undocumented correction
}

export interface LolalyticsPair {
  championId: number // target hero
  games: number
  reportedWinRate: number | null // selected champion's reported pair win rate, 0..1
  reportedWinRatePrecisionPp?: number | null
}

/** One selected hero, one interaction mode, one other position's chart. */
export interface LolalyticsPairReport {
  scope: LolalyticsScope
  championId: number
  ownRole: DraftRole
  mode: InteractionMode
  otherRole: DraftRole
  pairs: readonly LolalyticsPair[]
}

export interface LolalyticsPairSample extends LolalyticsPair {
  selectedChampionId: number
  ownRole: DraftRole
  otherRole: DraftRole
  mode: InteractionMode
  wins: null
  expectedWinRate: number | null
  rawDeltaPp: number | null
  state:
    | 'available'
    | 'zero-sample'
    | 'missing-pair-rate'
    | 'baseline-unavailable'
    | 'outside-roster'
    | 'mirror-excluded'
}

export interface LolalyticsDataset {
  blocks: ScopedInteractionBlock[]
  baselines: LolalyticsBaseline[]
  pairSamples: LolalyticsPairSample[]
  coverage: {
    population: 'supplier-listed-champion-role-rows-only'
    deltaMethod: 'unadjusted-odds-residual-from-reported-ratios'
    integerWins: 'not-reported-not-inferred'
    globalPickRateSource: 'same-supplier-same-scope-role-baselines'
    conditionalPairPickRatesUsed: false
    shrinkageAvailable: false
    referenceNormalization: 'all-listed-own-role-heroes-before-display-filtering'
    expectedCharts: number
    providedCharts: number
    missingCharts: { championId: number; mode: InteractionMode; otherRole: DraftRole }[]
    possibleDirectedNonMirrorPairs: number
    reportedPairs: number
    usableDeltaPairs: number
    zeroSamplePairs: number
    missingPairRatePairs: number
    baselineUnavailablePairs: number
    outsideRosterPairs: number
    mirrorEntriesExcluded: number
    missingOrUnavailablePairs: number
    populationWinRateNotCentered: { role: DraftRole; reportedRates: number[] }[]
  }
}

const scopeKeys = ['source', 'patch', 'tier', 'queueId', 'region'] as const
const key = (role: DraftRole, id: number) => `${role}:${id}`
const chartKey = (id: number, mode: InteractionMode, role: DraftRole) => `${id}:${mode}:${role}`
const validId = (id: number) => Number.isSafeInteger(id) && id > 0
const validCount = (n: number) => Number.isSafeInteger(n) && n >= 0
const validRate = (n: number | null) => n === null || (Number.isFinite(n) && n >= 0 && n <= 1)

function checkScope(actual: LolalyticsScope, expected: LolalyticsScope) {
  if (
    actual.source !== 'lolalytics' ||
    !/^\d+\.\d+$/.test(actual.patch) ||
    !Number.isSafeInteger(actual.queueId) ||
    actual.queueId <= 0 ||
    !['tier', 'region'].every((k) => {
      const value = actual[k as 'tier' | 'region']
      return typeof value === 'string' && value.trim() !== '' && value === value.trim()
    }) ||
    scopeKeys.some((field) => actual[field] !== expected[field])
  )
    throw new Error('Cannot mix Lolalytics source, patch, tier, queue or region')
}

function checkPrecision(value: number | null | undefined) {
  if (
    value !== undefined &&
    value !== null &&
    (!Number.isFinite(value) || value <= 0 || value > 100)
  ) {
    throw new Error('Invalid reported win-rate precision in percentage points')
  }
}

/** Pure adapter: no IO and no supplier d1/d2 consumption. The independent odds
 * baseline is deliberately NOT represented as Lolalytics' tier normalization.
 * A returned dataset can be partial; coverage states what is actually provided.
 */
export function adaptLolalyticsStatistics(
  inputBaselines: readonly LolalyticsBaseline[],
  reports: readonly LolalyticsPairReport[],
  options: { ownRole: DraftRole; scope: LolalyticsScope }
): LolalyticsDataset {
  checkScope(options.scope, options.scope)
  if (!DRAFT_ROLES.includes(options.ownRole)) throw new Error('Invalid selected position')
  const baselineByKey = new Map<string, LolalyticsBaseline>()
  for (const row of inputBaselines) {
    checkScope(row.scope, options.scope)
    checkPrecision(row.reportedWinRatePrecisionPp)
    if (
      !validId(row.championId) ||
      !DRAFT_ROLES.includes(row.role) ||
      !validCount(row.games) ||
      !validRate(row.reportedWinRate) ||
      !Number.isFinite(row.pickRate) ||
      row.pickRate < 0 ||
      row.pickRate > 1 ||
      row.pickRateDenominator !== 'same-role-games' ||
      (row.populationWinRate !== undefined && !validRate(row.populationWinRate))
    ) {
      throw new Error('Invalid role-wide Lolalytics baseline or pick-rate denominator')
    }
    const id = key(row.role, row.championId)
    if (baselineByKey.has(id)) throw new Error('Duplicate champion-position baseline')
    baselineByKey.set(id, {
      scope: { ...row.scope },
      championId: row.championId,
      role: row.role,
      games: row.games,
      reportedWinRate: row.reportedWinRate,
      reportedWinRatePrecisionPp: row.reportedWinRatePrecisionPp ?? null,
      pickRate: row.pickRate,
      pickRateDenominator: 'same-role-games',
      populationWinRate: row.populationWinRate ?? null
    })
  }
  const roleBaselines = new Map(
    DRAFT_ROLES.map((role) => [
      role,
      [...baselineByKey.values()]
        .filter((row) => row.role === role)
        .sort((a, b) => a.championId - b.championId)
    ])
  )
  if (DRAFT_ROLES.some((role) => roleBaselines.get(role)!.length === 0)) {
    throw new Error('All five role baseline rosters are required; do not substitute another source')
  }
  const own = roleBaselines.get(options.ownRole)!
  const charts = new Map<string, LolalyticsPairReport>()
  for (const report of reports) {
    checkScope(report.scope, options.scope)
    if (
      report.ownRole !== options.ownRole ||
      !DRAFT_ROLES.includes(report.otherRole) ||
      !['matchup', 'synergy'].includes(report.mode) ||
      (report.mode === 'synergy' && report.otherRole === options.ownRole) ||
      !baselineByKey.has(key(options.ownRole, report.championId))
    ) {
      throw new Error('Interaction chart is outside the selected position population')
    }
    const id = chartKey(report.championId, report.mode, report.otherRole)
    if (charts.has(id)) throw new Error('Duplicate hero interaction chart')
    charts.set(id, report)
  }
  const coverage: LolalyticsDataset['coverage'] = {
    population: 'supplier-listed-champion-role-rows-only',
    deltaMethod: 'unadjusted-odds-residual-from-reported-ratios',
    integerWins: 'not-reported-not-inferred',
    globalPickRateSource: 'same-supplier-same-scope-role-baselines',
    conditionalPairPickRatesUsed: false,
    shrinkageAvailable: false,
    referenceNormalization: 'all-listed-own-role-heroes-before-display-filtering',
    expectedCharts: own.length * 9,
    providedCharts: reports.length,
    missingCharts: [],
    possibleDirectedNonMirrorPairs: 0,
    reportedPairs: 0,
    usableDeltaPairs: 0,
    zeroSamplePairs: 0,
    missingPairRatePairs: 0,
    baselineUnavailablePairs: 0,
    outsideRosterPairs: 0,
    mirrorEntriesExcluded: 0,
    missingOrUnavailablePairs: 0,
    populationWinRateNotCentered: DRAFT_ROLES.flatMap((role) => {
      const rates = [
        ...new Set(
          roleBaselines
            .get(role)!
            .flatMap((r) =>
              r.populationWinRate !== undefined &&
              r.populationWinRate !== null &&
              Math.abs(r.populationWinRate - 0.5) > 1e-12
                ? [r.populationWinRate]
                : []
            )
        )
      ]
      return rates.length ? [{ role, reportedRates: rates.sort((a, b) => a - b) }] : []
    })
  }
  const pairSamples: LolalyticsPairSample[] = []
  const blocks: ScopedInteractionBlock[] = []
  for (const mode of ['matchup', 'synergy'] as const)
    for (const otherRole of DRAFT_ROLES) {
      if (mode === 'synergy' && otherRole === options.ownRole) continue
      const targets = roleBaselines.get(otherRole)!
      const targetIndex = new Map(targets.map((target, i) => [target.championId, i]))
      const rawPp = own.map(() => targets.map((): number | null => null))
      own.forEach((row, rowIndex) => {
        coverage.possibleDirectedNonMirrorPairs += targets.filter(
          (t) => t.championId !== row.championId
        ).length
        const report = charts.get(chartKey(row.championId, mode, otherRole))
        if (!report) {
          coverage.missingCharts.push({ championId: row.championId, mode, otherRole })
          return
        }
        const seenTargets = new Set<number>()
        for (const pair of report.pairs) {
          checkPrecision(pair.reportedWinRatePrecisionPp)
          if (
            !validId(pair.championId) ||
            !validCount(pair.games) ||
            !validRate(pair.reportedWinRate) ||
            seenTargets.has(pair.championId)
          ) {
            throw new Error('Invalid or duplicate pair sample')
          }
          seenTargets.add(pair.championId)
          const sample: LolalyticsPairSample = {
            championId: pair.championId,
            games: pair.games,
            reportedWinRate: pair.reportedWinRate,
            reportedWinRatePrecisionPp: pair.reportedWinRatePrecisionPp ?? null,
            selectedChampionId: row.championId,
            ownRole: options.ownRole,
            otherRole,
            mode,
            wins: null,
            expectedWinRate: null,
            rawDeltaPp: null,
            state: 'baseline-unavailable'
          }
          const target = baselineByKey.get(key(otherRole, pair.championId))
          if (pair.championId === row.championId) {
            sample.state = 'mirror-excluded'
            coverage.mirrorEntriesExcluded++
          } else if (!target) {
            sample.state = 'outside-roster'
            coverage.outsideRosterPairs++
          } else {
            coverage.reportedPairs++
            if (pair.games === 0) {
              sample.state = 'zero-sample'
              coverage.zeroSamplePairs++
            } else if (pair.reportedWinRate === null) {
              sample.state = 'missing-pair-rate'
              coverage.missingPairRatePairs++
            } else if (
              row.games === 0 ||
              target.games === 0 ||
              row.reportedWinRate === null ||
              target.reportedWinRate === null ||
              row.reportedWinRate <= 0 ||
              row.reportedWinRate >= 1 ||
              target.reportedWinRate <= 0 ||
              target.reportedWinRate >= 1
            ) {
              coverage.baselineUnavailablePairs++
            } else {
              sample.expectedWinRate = expectedPairWinRate(
                row.reportedWinRate,
                target.reportedWinRate,
                mode
              )
              sample.rawDeltaPp = 100 * (pair.reportedWinRate - sample.expectedWinRate)
              sample.state = 'available'
              rawPp[rowIndex][targetIndex.get(pair.championId)!] = sample.rawDeltaPp
              coverage.usableDeltaPairs++
            }
          }
          pairSamples.push(sample)
        }
      })
      blocks.push({
        mode,
        ownRole: options.ownRole,
        otherRole,
        champions: own.map((row) => String(row.championId)),
        championPickRates: own.map((row) => row.pickRate),
        targets: targets.map((row) => String(row.championId)),
        targetPickRates: targets.map((row) => row.pickRate),
        rawPp,
        shrunkPp: own.map(() => targets.map(() => null)),
        scope: {
          source: 'lolalytics-reported-pair-statistics-unadjusted-odds',
          interactionPatch: options.scope.patch,
          playRatePatch: options.scope.patch,
          region: options.scope.region,
          queueId: options.scope.queueId,
          population: options.scope.tier
        }
      })
    }
  coverage.missingOrUnavailablePairs =
    coverage.possibleDirectedNonMirrorPairs - coverage.usableDeltaPairs
  return {
    blocks,
    baselines: [...baselineByKey.values()].sort(
      (a, b) =>
        DRAFT_ROLES.indexOf(a.role) - DRAFT_ROLES.indexOf(b.role) || a.championId - b.championId
    ),
    pairSamples,
    coverage
  }
}
