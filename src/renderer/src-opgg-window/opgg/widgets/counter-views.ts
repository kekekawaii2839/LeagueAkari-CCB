import type { OpggChampionCounter } from '@shared/types/opgg'

// Prepare every switch combination from one completed detail snapshot, never from live requests.
export function prepareCounterViews(
  all: readonly OpggChampionCounter[],
  unfavorable: readonly OpggChampionCounter[]
) {
  const allWin = all.toSorted((a, b) => b.win / (b.play || 1) - a.win / (a.play || 1))
  const laneKillRates: Record<number, number | null> = {}
  for (const counter of [...unfavorable, ...all]) {
    laneKillRates[counter.champion_id] = counter.lane_kill_rate ?? null
  }
  const allLaneKill = allWin.toSorted((a, b) => {
    const aRate = laneKillRates[a.champion_id]
    const bRate = laneKillRates[b.champion_id]
    if (aRate === null) return bRate === null ? 0 : 1
    if (bRate === null) return -1
    return bRate - aRate
  })
  return {
    win: { all: allWin, unfavorable: [...unfavorable] },
    laneKill: {
      all: allLaneKill,
      unfavorable: allLaneKill.filter((counter) => {
        const rate = laneKillRates[counter.champion_id]
        return rate !== null && rate < 0.5
      })
    },
    laneKillRates
  }
}
