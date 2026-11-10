import { describe, expect, it } from 'vitest'

import { aggregateNativeMetric, nativeGameMetrics } from './native-metrics'
import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from './schemas'

const row = (damageTaken: number | null, deaths: number | null) =>
  ({ player: 'A', role: 'TOP', damageTaken, deaths }) as MemberAnalysisPlayerGame
const game = (id: number, duration: number, totalKills: number | null, players = [row(1000, 2)]) =>
  ({
    gameId: id,
    duration,
    players,
    teamMetrics: {
      totalKills,
      firstDragonTime: null,
      firstTowerTime: null,
      dragons: 0,
      barons: 0,
      dragonSouls: 0,
      elderDragons: 0
    }
  }) as MemberAnalysisGame
describe('native match metrics', () => {
  it('preserves zero deaths, absent enrichments and observed zero objectives', () => {
    const g = game(1, 1800, 30)
    expect(nativeGameMetrics(g, row(100, 0)).damageTakenPerDeath).toBeNull()
    expect(nativeGameMetrics(g).bloodiness).toBe(1)
    expect(nativeGameMetrics(g).teamDragonsPG).toBe(0)
    expect(nativeGameMetrics({ ...g, teamMetrics: undefined }).bloodiness).toBeNull()
  })
  it('weights bloodiness by minutes and never multiplies team observations by players', () => {
    expect(
      aggregateNativeMetric([game(1, 600, 20), game(2, 1800, 30)], 'bloodiness')
    ).toMatchObject({ value: 1.25, validGames: 2, numerator: 50, denominator: 40 })
  })
  it('uses the known positive-death population for damage per death', () => {
    expect(
      aggregateNativeMetric(
        [game(1, 600, 2, [row(1000, 2), row(2000, 0), row(null, 5)])],
        'damageTakenPerDeath'
      )
    ).toMatchObject({ value: 500, validGames: 1, numerator: 1000, denominator: 2 })
  })
})
