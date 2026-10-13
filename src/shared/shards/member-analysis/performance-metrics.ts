import type { PredictionObservation } from '../../../../packages/prediction-lab/src/legacy/model'
import {
  type PerformanceMetric,
  performanceMetricKeys
} from '../../../../packages/prediction-lab/src/metrics'
import { isEligibleMemberAnalysisGame } from './eligibility'
import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from './schemas'

export { performanceMetricKeys, type PerformanceMetric }
export { binaryPerformanceMetrics } from '../../../../packages/prediction-lab/src/akari-metrics'

export type NativeMetricPlayer = Omit<MemberAnalysisPlayerGame, 'champion' | 'counter'>
export type NativeMetricGame = Pick<
  MemberAnalysisGame,
  | 'gameId'
  | 'timestamp'
  | 'date'
  | 'duration'
  | 'win'
  | 'side'
  | 'dragon15Diff'
  | 'grub15Diff'
  | 'objectiveFight15Diff'
> & {
  players: NativeMetricPlayer[]
  laneGankDeaths?:
    | { status: 'available'; events: { victimPlayer: string; victimRole: string }[] }
    | { status: 'unavailable' }
    | null
}

// Native nullable source mapping. Keep formulas aligned with the pinned Lab;
// do not coerce absent raw observations to zero in the product boundary.
export function playerPerformanceMetrics(
  game: NativeMetricGame,
  row: NativeMetricPlayer
): Record<PerformanceMetric, number | null> {
  const ratio = (a: number | null, b: number | null) =>
    a !== null && b !== null && b > 0 ? a / b : null
  const perMinute = (value: number | null) => ratio(value, row.minutes)
  return {
    damageConversion:
      row.damageShare === null || row.goldShare === null
        ? null
        : ratio(row.damageShare, row.goldShare),
    dpm: perMinute(row.damage),
    gpm: perMinute(row.gold),
    kp: row.kp,
    winRate: Number(game.win),
    gd15: row.gd15,
    cspm: perMinute(row.cs),
    vspm: perMinute(row.vision),
    kda:
      row.kills === null || row.assists === null || row.deaths === null
        ? null
        : (row.kills + row.assists) / Math.max(1, row.deaths),
    killsPG: row.kills,
    deathsPG: row.deaths,
    assistsPG: row.assists,
    killShare: ratio(row.kills, row.teamKills),
    deathShare: ratio(row.deaths, row.teamDeaths),
    damageShare: row.damageShare,
    goldShare: row.goldShare,
    damagePerGold: ratio(row.damage, row.gold),
    wpm: perMinute(row.wardsPlaced),
    wcpm: perMinute(row.wardsKilled),
    cwpm: perMinute(row.controlWards),
    takenShare: row.takenShare,
    damageTakenPM: perMinute(row.damageTaken),
    mitigatedPM: perMinute(row.damageMitigated),
    objectiveDamagePM: perMinute(row.objectiveDamage),
    turretDamagePM: perMinute(row.turretDamage),
    healPM: perMinute(row.healTeammates),
    shieldPM: perMinute(row.shieldTeammates),
    ccPM: perMinute(row.ccSeconds),
    soloKillsPG: row.soloKills,
    fbRate: row.fbPart === null ? null : Number(row.fbPart),
    ftRate: row.ftPart === null ? null : Number(row.ftPart),
    gd10: row.gd10,
    csd15: row.csd15,
    xpd15: row.xpd15,
    damageDiff15: row.damageDiff15,
    soloDiff15: row.soloDiff15,
    dragon15: game.dragon15Diff,
    grub15: game.grub15Diff,
    objectiveFight15: game.objectiveFight15Diff,
    laneGankDeathsPG:
      row.role === 'JUNGLE' || game.laneGankDeaths?.status !== 'available'
        ? null
        : game.laneGankDeaths.events.filter(
            (e) => e.victimPlayer === row.player && e.victimRole === row.role
          ).length
  }
}

/** Produces the pinned Lab's nullable observation vector, not its non-null raw
 * source-game contract. No replacement values and no source game casts. */
export function predictionObservationsFromGames(
  games: NativeMetricGame[],
  members?: string[],
  side: 'all' | NativeMetricGame['side'] = 'all'
): PredictionObservation[] {
  const included = members === undefined ? null : new Set(members)
  return games
    .filter((game) => isEligibleMemberAnalysisGame(game) && (side === 'all' || game.side === side))
    .flatMap((game) =>
      game.players
        .filter((row) => included === null || included.has(row.player))
        .map((row) => {
          const metrics = playerPerformanceMetrics(game, row)
          return {
            gameId: game.gameId,
            timestamp: game.timestamp,
            date: game.date,
            player: row.player,
            role: row.role,
            win: game.win,
            side: game.side,
            metrics: performanceMetricKeys.map((key) => metrics[key])
          }
        })
    )
}
