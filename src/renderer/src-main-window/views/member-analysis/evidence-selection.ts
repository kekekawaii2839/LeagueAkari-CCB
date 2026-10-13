import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { playerPerformanceMetrics } from '@shared/shards/member-analysis/performance-metrics'
import type { PerformanceMetric } from '@shared/shards/member-analysis/performance-metrics'

import { knownMetricPopulation } from './analytics'
import { type RolePairLocation, rolePairEvidence } from './combination-navigation'
import {
  type EarlyGroup,
  earlyBucketMatches,
  earlyGroupMatches,
  earlyResultRows
} from './early-results'

export type MemberRoleEvidenceMetric = PerformanceMetric | 'counter' | 'games'
export interface MatchEvidenceSelection {
  games: MemberAnalysisGame[]
  source: string
  publishedGeneration: number
  metricLabel: string
  available: boolean
}
export interface MemberRoleEvidenceSelection {
  player: string
  role: MemberAnalysisPlayerGame['role']
  metric: MemberRoleEvidenceMetric
  champion?: string
  side?: MemberAnalysisGame['side']
}

const aggregateSources: Partial<
  Record<MemberRoleEvidenceMetric, readonly (keyof MemberAnalysisPlayerGame)[]>
> = {
  damageConversion: ['damageShare', 'goldShare'],
  kda: ['kills', 'deaths', 'assists'],
  killShare: ['kills', 'teamKills'],
  deathShare: ['deaths', 'teamDeaths'],
  damagePerGold: ['damage', 'gold'],
  dpm: ['damage', 'minutes'],
  gpm: ['gold', 'minutes'],
  cspm: ['cs', 'minutes'],
  vspm: ['vision', 'minutes'],
  wpm: ['wardsPlaced', 'minutes'],
  wcpm: ['wardsKilled', 'minutes'],
  cwpm: ['controlWards', 'minutes'],
  damageTakenPM: ['damageTaken', 'minutes'],
  mitigatedPM: ['damageMitigated', 'minutes'],
  objectiveDamagePM: ['objectiveDamage', 'minutes'],
  turretDamagePM: ['turretDamage', 'minutes'],
  healPM: ['healTeammates', 'minutes'],
  shieldPM: ['shieldTeammates', 'minutes'],
  ccPM: ['ccSeconds', 'minutes']
}

/** Consume the current filtered/windowed sample, never resample the overview.
 * Scalar means share the single-game mapper's known population. Compound
 * aggregate ratios reuse the aggregate's joint source population; a null
 * single-game ratio is not a general-purpose exclusion predicate.
 * Keep record identity/order here; navigation owns full-overview ambiguity checks.
 */
export function memberRoleEvidenceGames(
  sample: readonly MemberAnalysisGame[],
  selection: MemberRoleEvidenceSelection
): MemberAnalysisGame[] {
  return sample.filter(
    (game) =>
      (!selection.side || game.side === selection.side) &&
      game.players.some((row) => {
        if (row.player !== selection.player || row.role !== selection.role) return false
        if (selection.champion !== undefined && row.champion !== selection.champion) return false
        if (selection.metric === 'games') return true
        const sources = aggregateSources[selection.metric]
        if (sources)
          return (
            knownMetricPopulation(
              [row],
              ...sources.map((field) => (value: MemberAnalysisPlayerGame) => value[field])
            ).length > 0
          )
        if (selection.metric === 'counter')
          return knownMetricPopulation([row], (value) => value.counter).length > 0
        const value = playerPerformanceMetrics(game, row)[selection.metric]
        return typeof value === 'number' && Number.isFinite(value)
      })
  )
}

export type PairEvidenceMetric =
  | 'games'
  | 'winRate'
  | 'counterMean'
  | 'upperGold15'
  | 'botGold15'
  | 'dragon15Diff'
  | 'grub15Diff'
  | 'objectiveFight15Diff'
  | 'gold20Diff'
  | 'tower20Diff'
export function pairEvidenceGames(
  sample: readonly MemberAnalysisGame[],
  selection: RolePairLocation & { metric: PairEvidenceMetric; side?: MemberAnalysisGame['side'] }
): MemberAnalysisGame[] | null {
  const evidence = rolePairEvidence(sample, selection)
  if (!evidence) return null
  return evidence.gamesList.filter((game) => {
    if (selection.side && game.side !== selection.side) return false
    return (
      selection.metric === 'games' ||
      selection.metric === 'winRate' ||
      knownMetricPopulation(
        [game],
        (value) => value[selection.metric as Exclude<PairEvidenceMetric, 'games' | 'winRate'>]
      ).length > 0
    )
  })
}

export function earlyEvidenceGames(
  sample: MemberAnalysisGame[],
  selection: { timing: '15' | '20'; group: EarlyGroup; bucket?: string }
): MemberAnalysisGame[] {
  return earlyResultRows(sample, selection.timing)
    .filter(
      (row) =>
        earlyGroupMatches(row.diff, selection.group) &&
        (!selection.bucket || earlyBucketMatches(row, selection.bucket))
    )
    .map((row) => row.game)
}

/** Population includes observed zero-event games. The explicitly named affected
 * set is for event evidence only, never a rate/mean's denominator population. */
export function laneGankEvidenceGames(
  sample: readonly MemberAnalysisGame[],
  selection: {
    player: string
    role: MemberAnalysisPlayerGame['role']
    mode: 'population' | 'affected'
    fromSec?: number
    toSec?: number
    side?: MemberAnalysisGame['side']
  }
): MemberAnalysisGame[] {
  if (selection.role === 'JUNGLE') return []
  return sample.filter((game) => {
    if (selection.side && game.side !== selection.side) return false
    if (
      game.laneGankDeaths?.status !== 'available' ||
      !game.players.some((row) => row.player === selection.player && row.role === selection.role)
    )
      return false
    return (
      selection.mode === 'population' ||
      game.laneGankDeaths.events.some(
        (event) =>
          event.victimPlayer === selection.player &&
          event.victimRole === selection.role &&
          event.timestampSec >= (selection.fromSec ?? 0) &&
          event.timestampSec < (selection.toSec ?? 14 * 60)
      )
    )
  })
}

const jungleFields = {
  level3GankRate: 'level3Gank',
  level4GankRate: 'level4Gank',
  firstDragonRate: 'gotFirstDragon',
  topGanksPG: 'topGanks',
  midGanksPG: 'midGanks',
  botGanksPG: 'botGanks',
  firstDragonTime: 'firstDragonTimeSec',
  dragonsPG: 'dragons',
  soloDragonsPG: 'soloDragons',
  voidgrubsPG: 'voidgrubs',
  heraldsPG: 'heralds',
  baronsPG: 'barons',
  topZoneRate: 'topZoneWeight',
  midZoneRate: 'midZoneWeight',
  botZoneRate: 'botZoneWeight'
} as const
const campMetrics = [
  'redStartRate',
  'blueStartRate',
  'grompStartRate',
  'raptorsStartRate',
  'wolvesStartRate',
  'krugsStartRate'
] as const
export type JungleEvidenceMetric =
  | keyof typeof jungleFields
  | (typeof campMetrics)[number]
  | 'games'
  | 'winRate'
  | 'ownStartRate'
  | 'invadeStartRate'
  | 'gd10'
  | 'gd15'
  | 'xpd15'
  | 'cspm'
  | 'gpm'
  | 'objectiveDamagePM'
  | 'dragon15'
  | 'grub15'
  | 'objectiveFight15'
export function jungleEvidenceGames(
  sample: readonly MemberAnalysisGame[],
  selection: { player: string; metric: JungleEvidenceMetric; side?: MemberAnalysisGame['side'] }
): MemberAnalysisGame[] {
  return sample.filter((game) => {
    const jungle = game.jungle
    if (
      !jungle ||
      jungle.player !== selection.player ||
      (selection.side && game.side !== selection.side)
    )
      return false
    const metric = selection.metric
    if (metric === 'games' || metric === 'winRate') return true
    if (metric === 'ownStartRate' || metric === 'invadeStartRate')
      return jungle.startCamp !== null && typeof jungle.startCampOwn === 'boolean'
    if ((campMetrics as readonly string[]).includes(metric)) return jungle.startCamp !== null
    if (metric === 'dragon15' || metric === 'grub15' || metric === 'objectiveFight15') {
      const field = {
        dragon15: 'dragon15Diff',
        grub15: 'grub15Diff',
        objectiveFight15: 'objectiveFight15Diff'
      } as const
      return knownMetricPopulation([game], (value) => value[field[metric]]).length > 0
    }
    if (metric in jungleFields) {
      const value = jungle[jungleFields[metric as keyof typeof jungleFields]]
      if (
        metric === 'level3GankRate' ||
        metric === 'level4GankRate' ||
        metric === 'firstDragonRate'
      )
        return typeof value === 'boolean'
      return (
        knownMetricPopulation(
          [jungle],
          () => value,
          (item) => (metric.endsWith('ZoneRate') ? item.totalZoneWeight : value)
        ).length > 0
      )
    }
    return (
      memberRoleEvidenceGames([game], {
        player: selection.player,
        role: 'JUNGLE',
        metric: metric as MemberRoleEvidenceMetric
      }).length > 0
    )
  })
}
