import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { describe, expect, test } from 'vitest'

import { aggregateJungle } from '../analytics'
import {
  campIds,
  commonExtent,
  evidenceKey,
  jointRate,
  jungleEvidence,
  metricPopulation
} from './analysis'

const fixture = (
  camp: (typeof campIds)[number] | null,
  owner: boolean | null,
  side: 'Blue' | 'Red' = 'Blue',
  gd15: number | null = 0
): MemberAnalysisGame =>
  ({
    side,
    win: true,
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    players: [
      {
        player: 'A',
        role: 'JUNGLE',
        minutes: 30,
        cs: 0,
        gold: 10000,
        objectiveDamage: 0,
        gd10: 0,
        gd15,
        xpd15: null
      }
    ],
    jungle: {
      player: 'A',
      startCamp: camp,
      startCampOwn: owner,
      level3Gank: false,
      level4Gank: false,
      topGanks: 0,
      midGanks: 0,
      botGanks: 0,
      topZoneWeight: 0,
      midZoneWeight: 0,
      botZoneWeight: 0,
      totalZoneWeight: 0,
      gotFirstDragon: null,
      firstDragonTimeSec: null,
      dragons: 0,
      soloDragons: 0,
      voidgrubs: 0,
      heralds: 0,
      barons: 0
    }
  }) as MemberAnalysisGame
describe('joint first-camp evidence', () => {
  test('ownership is mutually exclusive/exhaustive within identified camps and unknown never renormalizes own/enemy', () => {
    const games = [
      fixture('red', true),
      fixture('red', false),
      fixture('wolves', null),
      fixture(null, true)
    ]
    const input = JSON.stringify(games),
      e = jungleEvidence(games).get(evidenceKey('A', '总计'))!
    expect(e).toMatchObject({
      games: 4,
      camps: 3,
      missingCamps: 1,
      ownership: 2,
      unknownOwnership: 1
    })
    expect(e.counts.flat().reduce((s, n) => s + n, 0)).toBe(3)
    expect(e.counts[0]).toEqual([1, 1, 0])
    expect(e.counts[4]).toEqual([0, 0, 1])
    expect(jointRate(e, 0, 0)).toBeCloseTo(1 / 3)
    expect(jointRate(e, 0, 1)).toBeCloseTo(1 / 3)
    expect(jointRate(e, 4, 2)).toBeCloseTo(1 / 3)
    expect(JSON.stringify(games)).toBe(input)
  })
  test('all eighteen cells sum by side and retain zero cells', () => {
    const games = campIds.flatMap((camp, i) =>
      [true, false, null].map((own, j) => fixture(camp, own, (i + j) % 2 ? 'Red' : 'Blue'))
    )
    const map = jungleEvidence(games),
      all = map.get(evidenceKey('A', '总计'))!,
      blue = map.get(evidenceKey('A', '蓝方'))!,
      red = map.get(evidenceKey('A', '红方'))!
    expect(all.camps).toBe(18)
    expect(all.unknownOwnership).toBe(6)
    for (let c = 0; c < 6; c++)
      for (let o = 0; o < 3; o++) {
        expect(all.counts[c][o]).toBe(1)
        expect(all.counts[c][o]).toBe(blue.counts[c][o] + red.counts[c][o])
      }
    expect(all.camps).toBe(blue.camps + red.camps)
  })
  test('no eligible camp means unavailable percentages, not fabricated zeros', () => {
    const e = jungleEvidence([fixture(null, null)]).get(evidenceKey('A', '总计'))!
    expect(e).toMatchObject({ camps: 0, missingCamps: 1, unknownOwnership: 0 })
    expect(jointRate(e, 0, 0)).toBeNull()
    const zero = jungleEvidence([fixture('blue', true)]).get(evidenceKey('A', '总计'))!
    expect(jointRate(zero, 0, 0)).toBe(0)
  })
  test('uses each metric actual population while leaving aggregate values unchanged', () => {
    const games = [fixture('red', true, 'Blue', null), fixture('blue', null, 'Red', 0)]
    const before = aggregateJungle(games),
      e = jungleEvidence(games).get(evidenceKey('A', '总计'))!
    expect(metricPopulation(e, 'gd10')).toBe(2)
    expect(metricPopulation(e, 'gd15')).toBe(1)
    expect(metricPopulation(e, 'xpd15')).toBe(0)
    expect(metricPopulation(e, 'ownStartRate')).toBe(1)
    expect(metricPopulation(e, 'redStartRate')).toBe(2)
    expect(metricPopulation(e, 'firstDragonRate')).toBe(0)
    expect(metricPopulation(e, 'firstDragonTime')).toBe(0)
    expect(e.minutes).toBe(60)
    expect(e.zoneWeight).toBe(0)
    expect(e.zoneGames).toBe(0)
    expect(aggregateJungle(games)).toEqual(before)
    expect(before[0]).toMatchObject({ gd15: 0, xpd15: null, cspm: 0 })
  })
  test('excludes games without jungle and keeps distinct members and scales across sides', () => {
    const game = fixture('red', true)
    const another = {
      ...fixture('blue', false, 'Red', -2000),
      jungle: { ...game.jungle!, player: 'B' },
      players: []
    }
    expect(jungleEvidence([{ ...game, jungle: null }, another]).has(evidenceKey('A', '总计'))).toBe(
      false
    )
    const rows = aggregateJungle([
      fixture('red', true, 'Blue', 2000),
      fixture('blue', false, 'Red', -2000)
    ])
    expect(commonExtent(rows, ['gd15'], 500)).toBe(2100)
  })
})
export { fixture }
