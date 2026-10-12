import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import type { JungleAggregate, SideLabel } from '../analytics'

export const campIds = ['red', 'blue', 'gromp', 'raptors', 'wolves', 'krugs'] as const
export const campMetrics = [
  'redStartRate',
  'blueStartRate',
  'grompStartRate',
  'raptorsStartRate',
  'wolvesStartRate',
  'krugsStartRate'
] as const
export const zoneMetrics = ['topZoneRate', 'midZoneRate', 'botZoneRate'] as const
export const efficiencyMetrics = ['cspm', 'gpm', 'objectiveDamagePM'] as const
export type JungleGroup = 'opening' | 'gank' | 'objectives' | 'development'
export type JungleEvidence = {
  games: number
  camps: number
  missingCamps: number
  ownership: number
  unknownOwnership: number
  counts: number[][]
  valid: Record<string, number>
  zoneWeight: number
  zoneGames: number
  minutes: number
}
export const evidenceKey = (player: string, side: SideLabel) => `${player}|${side}`
export const emptyEvidence = (): JungleEvidence => ({
  games: 0,
  camps: 0,
  missingCamps: 0,
  ownership: 0,
  unknownOwnership: 0,
  counts: campIds.map(() => [0, 0, 0]),
  valid: {},
  zoneWeight: 0,
  zoneGames: 0,
  minutes: 0
})

/** Supplementary populations only: existing aggregate values/formulas remain authoritative. */
export function jungleEvidence(games: MemberAnalysisGame[]) {
  const result = new Map<string, JungleEvidence>()
  for (const game of games) {
    const jungle = game.jungle
    if (!jungle) continue
    for (const side of ['总计', game.side === 'Blue' ? '蓝方' : '红方'] as SideLabel[]) {
      const key = evidenceKey(jungle.player, side)
      const evidence = result.get(key) ?? emptyEvidence()
      evidence.games++
      const camp = campIds.indexOf(jungle.startCamp as (typeof campIds)[number])
      if (camp >= 0) {
        evidence.camps++
        const owner = jungle.startCampOwn === true ? 0 : jungle.startCampOwn === false ? 1 : 2
        evidence.counts[camp][owner]++
        if (owner === 2) evidence.unknownOwnership++
        else evidence.ownership++
      } else evidence.missingCamps++
      evidence.zoneWeight += jungle.totalZoneWeight
      if (jungle.totalZoneWeight > 0) evidence.zoneGames++
      evidence.valid.firstDragonRate =
        (evidence.valid.firstDragonRate ?? 0) + (typeof jungle.gotFirstDragon === 'boolean' ? 1 : 0)
      evidence.valid.firstDragonTime =
        (evidence.valid.firstDragonTime ?? 0) + (Number.isFinite(jungle.firstDragonTimeSec) ? 1 : 0)
      const player = game.players.find((p) => p.player === jungle.player && p.role === 'JUNGLE')
      for (const metric of ['gd10', 'gd15', 'xpd15'] as const)
        evidence.valid[metric] =
          (evidence.valid[metric] ?? 0) + (player && Number.isFinite(player[metric]) ? 1 : 0)
      for (const metric of ['dragon15', 'grub15', 'objectiveFight15'] as const) {
        const field = (
          {
            dragon15: 'dragon15Diff',
            grub15: 'grub15Diff',
            objectiveFight15: 'objectiveFight15Diff'
          } as const
        )[metric]
        evidence.valid[metric] =
          (evidence.valid[metric] ?? 0) + (Number.isFinite(game[field]) ? 1 : 0)
      }
      if (player) {
        evidence.minutes += player.minutes
        for (const metric of efficiencyMetrics)
          evidence.valid[metric] = (evidence.valid[metric] ?? 0) + 1
      }
      result.set(key, evidence)
    }
  }
  return result
}
export function metricPopulation(e: JungleEvidence, key: string) {
  if (key === 'ownStartRate' || key === 'invadeStartRate') return e.ownership
  if ((campMetrics as readonly string[]).includes(key)) return e.camps
  return e.valid[key] ?? e.games
}
export function jointRate(e: JungleEvidence, camp: number, owner: number) {
  return e.camps ? e.counts[camp][owner] / e.camps : null
}
export function commonExtent(rows: JungleAggregate[], keys: readonly string[], minimum: number) {
  return (
    Math.max(
      minimum,
      ...rows.flatMap((row) =>
        keys.map((key) =>
          typeof row[key] === 'number' && Number.isFinite(row[key])
            ? Math.abs(row[key] as number)
            : 0
        )
      )
    ) * 1.05
  )
}
