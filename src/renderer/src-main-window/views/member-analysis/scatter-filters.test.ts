import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { expect, test } from 'vitest'

import { matchScatterRows } from './scatter-analysis'
import { defaultScatterFilters, selectScatterPopulation } from './scatter-filters'
import type { TrendInput } from './version-trend/domain'

function player(
  name: string,
  role: MemberAnalysisPlayerGame['role'] = 'TOP'
): MemberAnalysisPlayerGame {
  return {
    player: name,
    role,
    champion: 'Synthetic',
    minutes: 30,
    kills: 4,
    deaths: 2,
    assists: 6,
    teamKills: 20,
    teamDeaths: 10,
    damage: 18000,
    damageShare: 0.2,
    gold: 12000,
    goldShare: 0.2,
    cs: 200,
    vision: 30,
    wardsPlaced: 10,
    wardsKilled: 2,
    controlWards: 1,
    damageTaken: 15000,
    takenShare: 0.2,
    damageMitigated: 8000,
    objectiveDamage: 3000,
    turretDamage: 2000,
    healTeammates: 0,
    shieldTeammates: 0,
    ccSeconds: 30,
    soloKills: 1,
    fbPart: false,
    ftPart: false,
    kp: 0.5,
    gd10: 0,
    gd15: 0,
    csd15: 0,
    xpd15: 0,
    damageDiff15: 0,
    soloDiff15: 0,
    counter: null
  }
}
function game(id: number, changes: Partial<MemberAnalysisGame> = {}): MemberAnalysisGame {
  return {
    gameId: id,
    timestamp: Date.UTC(2026, 0, id),
    date: `2026-01-0${id}`,
    patch: '16.1',
    side: 'Blue',
    win: true,
    duration: 1800,
    roster: 'Synthetic',
    metricSemantics: 'current-v5',
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    counterMean: null,
    upperGold15: 0,
    botGold15: 0,
    gold20Diff: 0,
    tower20Diff: 0,
    jungle: null,
    eventDecision: null,
    laneGankDeaths: { methodVersion: 1, status: 'available', events: [] },
    players: [player(`Alias ${id}`), player('Teammate', 'JUNGLE')],
    ...changes
  }
}
function input(games: MemberAnalysisGame[]): TrendInput {
  return {
    generation: 1,
    identitiesGeneration: 1,
    configuredMemberIds: ['member-slot-1', 'member-slot-2'],
    games,
    identities: games.map((game) => ({
      gameId: game.gameId,
      members: game.players.map((row, index) => ({
        memberId: `member-slot-${index + 1}`,
        player: row.player
      }))
    }))
  }
}
test('comparison filters resolve renamed members by stable slot and keep original evidence labels', () => {
  const data = input([game(1), game(2, { patch: '16.2' }), game(3, { side: 'Red' })])
  const selected = selectScatterPopulation(
    data,
    {
      ...defaultScatterFilters(),
      memberId: 'member-slot-1',
      includeMemberIds: ['member-slot-2'],
      patchFrom: '16.2'
    },
    'ALL'
  )
  expect(selected.games.map((game) => game.gameId)).toEqual([2])
  expect(selected.games[0].players.map((row) => row.player)).toEqual(['Alias 2'])
  expect(data.games[1].players).toHaveLength(2)
})
test('all-role and all-member comparison combines individual observations without multiplying matches', () => {
  const data = input([
    game(1),
    game(2, { players: [player('Alias 2', 'MIDDLE'), player('Teammate', 'JUNGLE')] })
  ])
  const all = selectScatterPopulation(data, defaultScatterFilters(), 'ALL')
  expect(all.games).toHaveLength(2)
  expect(matchScatterRows(all.games, 'ALL')).toHaveLength(4)
  expect(
    selectScatterPopulation(data, defaultScatterFilters(), 'TOP').games.map((game) => game.gameId)
  ).toEqual([1])
})
test('side, outcome, date, duration, exclusions and conflicts follow trend selection rules', () => {
  const data = input([game(1), game(2, { side: 'Red', win: false, duration: 2400 })])
  const selected = selectScatterPopulation(
    data,
    {
      ...defaultScatterFilters(),
      memberId: 'member-slot-1',
      side: 'Red',
      outcome: 'loss',
      dateFrom: '2026-01-02',
      durationMin: 35,
      durationMax: 45
    },
    'ALL'
  )
  expect(selected.games.map((game) => game.gameId)).toEqual([2])
  expect(
    selectScatterPopulation(
      data,
      {
        ...defaultScatterFilters(),
        memberId: 'member-slot-1',
        excludeMemberIds: ['member-slot-2']
      },
      'ALL'
    ).games
  ).toEqual([])
  expect(() =>
    selectScatterPopulation(
      data,
      { ...defaultScatterFilters(), durationMin: 45, durationMax: 30 },
      'ALL'
    )
  ).toThrow('invalid-duration-range')
  expect(() =>
    selectScatterPopulation(data, { ...defaultScatterFilters(), patchFrom: 'bad' }, 'ALL')
  ).toThrow('invalid-patch-range')
})
test('per-match native metrics expose duration and distinguish zero deaths from missing damage', () => {
  const rows = matchScatterRows(
    [
      game(1, {
        players: [
          { ...player('A'), deaths: 0 },
          { ...player('B'), damageTaken: null },
          { ...player('C'), deaths: 3 }
        ]
      })
    ],
    'ALL'
  )
  expect(rows.map((row) => row.gameDuration)).toEqual([30, 30, 30])
  expect(rows.map((row) => row.damageTakenPerDeath)).toEqual([null, null, 5000])
  expect(rows.map((row) => row.deaths)).toEqual([0, 2, 3])
})
