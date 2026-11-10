import type {
  OpggChampionBuildResponse,
  OpggChampionPosition,
  OpggChampionsResponse
} from '../../../types/opgg'
import { expectedPairWinRate } from '../blindability'
import { DRAFT_ROLES, type DraftRole, type ScopedInteractionBlock } from './scoring'

export interface OpggLaneOptions {
  role: DraftRole
  region: string
  tier: string
  expectedPatch: string
}

export interface OpggLaneBaseline {
  championId: number
  play: number
  reportedWinRate: number
  winRateSource: 'provider-reported-rounded-ratio'
}

export interface OpggLaneDataset {
  block: ScopedInteractionBlock
  baselines: OpggLaneBaseline[]
  coverage: {
    population: 'supplier-listed-champion-role-rows-only'
    scopeEvidence: 'patch-verified-region-and-tier-declared-by-caller'
    baselineWinRates: 'provider-reported-rounded-ratios-no-integer-wins-inferred'
    pickRateDenominator: 'sum-of-listed-same-role-play'
    listedRolePlay: number
    listedChampions: number
    detailsProvided: number
    missingDetailChampionIds: number[]
    possibleDirectedNonMirrorPairs: number
    reportedDirectedNonMirrorPairs: number
    positiveSamplePairs: number
    usableDeltaPairs: number
    unavailableDeltaPairs: number
    zeroSamplePairs: number
    mirrorEntriesExcluded: number
    omittedTargetPairs: { championId: number; targetChampionId: number }[]
    singleRoleOnly: true
    shrinkageAvailable: false
    providerCachedAt: string[]
  }
}

function validId(id: number) {
  return Number.isSafeInteger(id) && id > 0
}

function checkVersion(actual: string, expected: string) {
  if (actual !== expected) throw new Error('OP.GG response patch does not match requested patch')
}

/**
 * Adapts only a same-position counter block, NOT the complete nine-block blindability dataset.
 * Region/tier are caller assertions because these responses do not echo them. The collector must
 * supply responses fetched with those exact parameters. Every echoed patch is checked here.
 * The roster's rounded win_rate is used as reported; it is never converted to fabricated wins.
 * No IO, persistence, API access or source-score calibration occurs in this adapter.
 */
export function adaptOpggLaneStatistics(
  roster: OpggChampionsResponse,
  details: readonly OpggChampionBuildResponse[],
  options: OpggLaneOptions
): OpggLaneDataset {
  if (
    !DRAFT_ROLES.includes(options.role) ||
    !options.region.trim() ||
    !options.tier.trim() ||
    !/^\d+\.\d+$/.test(options.expectedPatch)
  ) {
    throw new Error('Explicit OP.GG role, region, tier and patch required')
  }
  checkVersion(roster.meta.version, options.expectedPatch)
  const providerPosition = options.role === 'SUP' ? 'SUPPORT' : options.role
  const ids = new Set<number>()
  const baselineById = new Map<number, OpggLaneBaseline>()
  for (const hero of roster.data) {
    if (!validId(hero.id) || ids.has(hero.id))
      throw new Error('Invalid or duplicate roster champion')
    ids.add(hero.id)
    const positions = (hero.positions ?? []).filter((p) => p.name === providerPosition)
    if (positions.length > 1) throw new Error('Duplicate roster champion position')
    const position: OpggChampionPosition | undefined = positions[0]
    if (!position) continue
    const { play, win_rate: rate } = position.stats
    if (!Number.isSafeInteger(play) || play < 0 || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error('Invalid roster position statistics')
    }
    baselineById.set(hero.id, {
      championId: hero.id,
      play,
      reportedWinRate: rate,
      winRateSource: 'provider-reported-rounded-ratio'
    })
  }
  const baselines = [...baselineById.values()].sort((a, b) => a.championId - b.championId)
  const listedRolePlay = baselines.reduce((sum, row) => sum + row.play, 0)
  if (!Number.isSafeInteger(listedRolePlay)) throw new Error('Listed role play exceeds safe range')
  const rows = baselines.map((row) => row.championId)
  const rowIndex = new Map(rows.map((id, index) => [id, index]))
  const rawPp: (number | null)[][] = rows.map(() => rows.map(() => null))
  const coverage: OpggLaneDataset['coverage'] = {
    population: 'supplier-listed-champion-role-rows-only',
    scopeEvidence: 'patch-verified-region-and-tier-declared-by-caller',
    baselineWinRates: 'provider-reported-rounded-ratios-no-integer-wins-inferred',
    pickRateDenominator: 'sum-of-listed-same-role-play',
    listedRolePlay,
    listedChampions: rows.length,
    detailsProvided: details.length,
    missingDetailChampionIds: [],
    possibleDirectedNonMirrorPairs: rows.length * Math.max(0, rows.length - 1),
    reportedDirectedNonMirrorPairs: 0,
    positiveSamplePairs: 0,
    usableDeltaPairs: 0,
    unavailableDeltaPairs: 0,
    zeroSamplePairs: 0,
    mirrorEntriesExcluded: 0,
    omittedTargetPairs: [],
    singleRoleOnly: true,
    shrinkageAvailable: false,
    providerCachedAt: [String(roster.meta.cached_at)]
  }
  const detailIds = new Set<number>()
  for (const detail of details) {
    checkVersion(detail.meta.version, options.expectedPatch)
    const id = detail.data.summary.id
    if (!validId(id) || detailIds.has(id)) throw new Error('Invalid or duplicate champion detail')
    detailIds.add(id)
    if (!baselineById.has(id))
      throw new Error('Detail champion is outside the listed role population')
    if (!detail.data.summary.positions?.some((p) => p.name === providerPosition)) {
      throw new Error('Detail does not list the requested position')
    }
    coverage.providerCachedAt.push(String(detail.meta.cached_at))
    const own = baselineById.get(id)!
    const targets = new Set<number>()
    for (const counter of detail.data.counters ?? []) {
      if (!validId(counter.champion_id) || targets.has(counter.champion_id)) {
        throw new Error('Invalid or duplicate counter target')
      }
      targets.add(counter.champion_id)
      if (
        !Number.isSafeInteger(counter.play) ||
        counter.play < 0 ||
        !Number.isSafeInteger(counter.win) ||
        counter.win < 0 ||
        counter.win > counter.play
      ) {
        throw new Error('Invalid integer counter win/play counts')
      }
      if (counter.champion_id === id) {
        coverage.mirrorEntriesExcluded++
        continue
      }
      const other = baselineById.get(counter.champion_id)
      if (!other) {
        coverage.omittedTargetPairs.push({ championId: id, targetChampionId: counter.champion_id })
        continue
      }
      coverage.reportedDirectedNonMirrorPairs++
      if (counter.play === 0) {
        coverage.zeroSamplePairs++
        continue
      }
      coverage.positiveSamplePairs++
      // A 0/100% single-champion baseline has undefined odds. Preserve unavailable,
      // rather than silently adding an undocumented prior or substituting neutral odds.
      if (
        own.play === 0 ||
        other.play === 0 ||
        own.reportedWinRate <= 0 ||
        own.reportedWinRate >= 1 ||
        other.reportedWinRate <= 0 ||
        other.reportedWinRate >= 1
      ) {
        continue
      }
      const expected = expectedPairWinRate(own.reportedWinRate, other.reportedWinRate, 'matchup')
      rawPp[rowIndex.get(id)!][rowIndex.get(other.championId)!] =
        100 * (counter.win / counter.play - expected)
      coverage.usableDeltaPairs++
    }
  }
  coverage.missingDetailChampionIds = rows.filter((id) => !detailIds.has(id))
  coverage.unavailableDeltaPairs =
    coverage.possibleDirectedNonMirrorPairs - coverage.usableDeltaPairs
  const rates = baselines.map((row) => (listedRolePlay > 0 ? row.play / listedRolePlay : 0))
  return {
    block: {
      mode: 'matchup',
      ownRole: options.role,
      otherRole: options.role,
      champions: rows.map(String),
      targets: rows.map(String),
      championPickRates: [...rates],
      targetPickRates: [...rates],
      rawPp,
      shrunkPp: rows.map(() => rows.map(() => null)),
      scope: {
        source: 'opgg-champion-api-ranked-lane-summary',
        interactionPatch: options.expectedPatch,
        playRatePatch: options.expectedPatch,
        region: options.region,
        queueId: 420,
        population: options.tier
      }
    },
    baselines,
    coverage
  }
}
