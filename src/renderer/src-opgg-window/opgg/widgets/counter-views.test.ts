import type { OpggChampionCounter } from '@shared/types/opgg'
import { describe, expect, it } from 'vitest'

import { prepareCounterViews } from './counter-views'

const all: OpggChampionCounter[] = [
  { champion_id: 24, win: 40, play: 100, lane_kill_rate: 0.2 },
  { champion_id: 39, win: 48, play: 100, lane_kill_rate: 0.8 },
  { champion_id: 777, win: 49, play: 100, lane_kill_rate: null },
  { champion_id: 86, win: 60, play: 100, lane_kill_rate: 0.1 },
  { champion_id: 55, win: 70, play: 100, lane_kill_rate: 0.5 },
  { champion_id: 99, win: 10, play: 100, lane_kill_rate: 0 }
]
const ids = (rows: readonly OpggChampionCounter[]) => rows.map((row) => row.champion_id)
describe('completed OPGG matchup views', () => {
  it('prepares all four combinations, with a metric-specific unfavorable set', () => {
    const views = prepareCounterViews(all, all.slice(0, 3))
    expect(ids(views.win.all)).toEqual([55, 86, 777, 39, 24, 99])
    expect(ids(views.win.unfavorable)).toEqual([24, 39, 777])
    expect(ids(views.laneKill.all)).toEqual([39, 55, 24, 86, 99, 777])
    expect(ids(views.laneKill.unfavorable)).toEqual([24, 86, 99])
    expect(views.laneKillRates[99]).toBe(0)
    expect(views.laneKillRates[777]).toBeNull()
    expect(ids(all)).toEqual([24, 39, 777, 86, 55, 99])
  })
  it('keeps tied values stable by the win baseline and never treats missing data as a disadvantage', () => {
    const rows = all.map((row) => ({
      ...row,
      lane_kill_rate: row.champion_id === 24 || row.champion_id === 39 ? 0.5 : undefined
    }))
    const views = prepareCounterViews(rows, rows.slice(0, 3))
    expect(ids(views.laneKill.all)).toEqual([39, 24, 55, 86, 777, 99])
    expect(views.laneKill.unfavorable).toEqual([])
    expect(views.win.unfavorable).toHaveLength(3)
  })
  it('supports empty and independently replaced snapshots without changing the previous prepared result', () => {
    expect(prepareCounterViews([], []).laneKill.unfavorable).toEqual([])
    const previous = prepareCounterViews(all, all.slice(0, 3))
    const next = prepareCounterViews(
      all.map((row) => ({ ...row, lane_kill_rate: 0.9 })),
      [all[3]]
    )
    expect(next.laneKill.unfavorable).toEqual([])
    expect(ids(previous.laneKill.unfavorable)).toEqual([24, 86, 99])
  })
})
