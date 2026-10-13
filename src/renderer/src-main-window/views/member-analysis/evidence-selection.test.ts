import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { expect, test } from 'vitest'

import { aggregateRoles } from './analytics'
import {
  earlyEvidenceGames,
  jungleEvidenceGames,
  laneGankEvidenceGames,
  memberRoleEvidenceGames,
  pairEvidenceGames
} from './evidence-selection'
import { resolveMatchNavigationTarget } from './match-navigation'

const player = 'Synthetic A#TEST_ONLY'
const selection = { player, role: 'TOP', metric: 'gd15' } as const
function fixture(gameId: number, gd15: number | null, kp: number | null) {
  return {
    gameId,
    players: [{ player, role: 'TOP', gd15, kp } as MemberAnalysisPlayerGame]
  } as MemberAnalysisGame
}

test('scalar support keeps known zero/negative and follows the selected metric', () => {
  const sample = [
    fixture(900001, 0, null),
    fixture(900002, -500, 0),
    fixture(900003, 200, null),
    fixture(900004, null, 0.5),
    fixture(900005, null, 0.8)
  ]
  expect(memberRoleEvidenceGames(sample, selection)).toEqual(sample.slice(0, 3))
  expect(memberRoleEvidenceGames(sample, { ...selection, metric: 'kp' })).toEqual([
    sample[1],
    sample[3],
    sample[4]
  ])
  expect(sample).toHaveLength(5)
})

test('consumes only supplied sample and exact full member/role identity', () => {
  const game = fixture(900010, 100, 0.5)
  const otherRole = fixture(900011, 100, 0.5)
  otherRole.players[0].role = 'MIDDLE'
  const otherMember = fixture(900012, 100, 0.5)
  otherMember.players[0].player = 'Synthetic A#OTHER_ONLY'
  expect(memberRoleEvidenceGames([otherRole, otherMember, game], selection)).toEqual([game])
  expect(memberRoleEvidenceGames([], selection)).toEqual([])
  expect(memberRoleEvidenceGames([fixture(900013, null, null)], selection)).toEqual([])
})

test('does not collapse same-number records or bypass hidden overview ambiguity', () => {
  const visible = fixture(900020, 0, 0)
  const hidden = fixture(900020, 10, 0.5)
  const supported = memberRoleEvidenceGames([visible], selection)
  expect(supported[0]).toBe(visible)
  expect(resolveMatchNavigationTarget([visible, hidden], supported, visible.gameId).kind).toBe(
    'ambiguous'
  )
  const both = memberRoleEvidenceGames([hidden, visible], selection)
  expect(both).toHaveLength(2)
  expect(both[0]).toBe(hidden)
  expect(both[1]).toBe(visible)
})

test('nonfinite and legacy-normalized unknown observations never become zero support', () => {
  expect(
    memberRoleEvidenceGames(
      [
        fixture(900030, Number.NaN, 0),
        fixture(900031, Number.POSITIVE_INFINITY, 0),
        fixture(900032, null, null)
      ],
      selection
    )
  ).toEqual([])
})

test('compound aggregate population keeps known zero exposure and reproduces the actual result', () => {
  const games = [fixture(900040, 0, 0), fixture(900041, 0, 0), fixture(900042, 0, 0)]
  Object.assign(games[0].players[0], { damageShare: 0.2, goldShare: 0, champion: 'Gwen' })
  Object.assign(games[1].players[0], { damageShare: 0.2, goldShare: 0.4, champion: 'Gwen' })
  Object.assign(games[2].players[0], { damageShare: 0.9, goldShare: null, champion: 'Gwen' })
  const supported = memberRoleEvidenceGames(games, { ...selection, metric: 'damageConversion' })
  expect(supported).toEqual(games.slice(0, 2))
  const original = aggregateRoles(games, 'TOP', player)[0].damageConversion
  expect(original).toBe(1)
  expect(aggregateRoles(supported, 'TOP', player)[0].damageConversion).toBe(original)
  expect(
    memberRoleEvidenceGames(games, { ...selection, metric: 'damageConversion', champion: 'Ornn' })
  ).toEqual([])
})

test('known false and combat zero remain support while compound missing fields do not', () => {
  const games = [fixture(900050, 0, 0), fixture(900051, 0, 0)]
  Object.assign(games[0].players[0], {
    kills: 0,
    assists: 0,
    deaths: 0,
    fbPart: false,
    damage: 0,
    minutes: 0
  })
  Object.assign(games[1].players[0], {
    kills: 0,
    assists: null,
    deaths: 0,
    fbPart: null,
    damage: null,
    minutes: 30
  })
  for (const metric of ['kda', 'fbRate', 'dpm'] as const)
    expect(memberRoleEvidenceGames(games, { ...selection, metric })).toEqual([games[0]])
})

test('ordered role pair evidence never substitutes all joint appearances', () => {
  const games = [fixture(900060, 0, 0), fixture(900061, 0, 0), fixture(900062, 0, 0)]
  for (const game of games)
    game.players.push({
      player: 'Synthetic B#TEST_ONLY',
      role: 'JUNGLE'
    } as MemberAnalysisPlayerGame)
  games[2].players[0].role = 'JUNGLE'
  games[2].players[1].role = 'TOP'
  games[0].upperGold15 = 0
  games[1].upperGold15 = null
  const pair = { pairType: 'upper_pair', pair: `${player} + Synthetic B#TEST_ONLY` } as const
  expect(pairEvidenceGames(games, { ...pair, metric: 'games' })).toEqual(games.slice(0, 2))
  expect(pairEvidenceGames(games, { ...pair, metric: 'upperGold15' })).toEqual([games[0]])
  expect(pairEvidenceGames(games, { ...pair, pair: 'unresolved', metric: 'games' })).toBeNull()
})

test('jungle support includes observed false/zero and requires each exact source', () => {
  const games = [fixture(900070, 0, 0), fixture(900071, 0, 0), fixture(900072, 0, 0)]
  for (const game of games) {
    game.players[0].role = 'JUNGLE'
    game.jungle = {
      player,
      startCamp: 'red',
      startCampOwn: false,
      level3Gank: false,
      topZoneWeight: 0,
      totalZoneWeight: 0,
      firstDragonTimeSec: null
    } as NonNullable<MemberAnalysisGame['jungle']>
  }
  games[1].jungle!.startCampOwn = null
  games[1].jungle!.totalZoneWeight = null
  games[2].jungle = null
  expect(jungleEvidenceGames(games, { player, metric: 'games' })).toEqual(games.slice(0, 2))
  expect(jungleEvidenceGames(games, { player, metric: 'ownStartRate' })).toEqual([games[0]])
  expect(jungleEvidenceGames(games, { player, metric: 'level3GankRate' })).toEqual(
    games.slice(0, 2)
  )
  expect(jungleEvidenceGames(games, { player, metric: 'topZoneRate' })).toEqual([games[0]])
  expect(jungleEvidenceGames(games, { player, metric: 'firstDragonTime' })).toEqual([])
  games[0].players = []
  games[0].dragon15Diff = 0
  expect(jungleEvidenceGames(games, { player, metric: 'dragon15' })).toEqual([games[0]])
  expect(jungleEvidenceGames(games, { player, metric: 'gd15' })).toEqual([games[1]])
})

test('lane gank denominator population includes observed zero-event games, affected set does not', () => {
  const games = [fixture(900080, 0, 0), fixture(900081, 0, 0), fixture(900082, 0, 0)]
  games[0].laneGankDeaths = {
    methodVersion: 1,
    status: 'available',
    events: [
      {
        victimPlayer: player,
        victimRole: 'TOP',
        victimChampion: 'Gwen',
        enemyJunglerChampion: 'LeeSin',
        lane: 'top',
        involvement: 'killer',
        timestampSec: 180
      },
      {
        victimPlayer: player,
        victimRole: 'TOP',
        victimChampion: 'Gwen',
        enemyJunglerChampion: 'LeeSin',
        lane: 'top',
        involvement: 'assist',
        timestampSec: 240
      }
    ]
  }
  games[1].laneGankDeaths = { methodVersion: 1, status: 'available', events: [] }
  games[2].laneGankDeaths = {
    methodVersion: 1,
    status: 'unavailable',
    reason: 'timeline-incomplete'
  }
  const scope = { player, role: 'TOP' } as const
  expect(laneGankEvidenceGames(games, { ...scope, mode: 'population' })).toEqual(games.slice(0, 2))
  expect(
    laneGankEvidenceGames(games, { ...scope, mode: 'affected', fromSec: 180, toSec: 240 })
  ).toEqual([games[0]])
  expect(
    laneGankEvidenceGames(games, { ...scope, mode: 'affected', fromSec: 0, toSec: 180 })
  ).toEqual([])
})

test('early evidence follows the selected timing and existing inclusive/exclusive bucket boundaries', () => {
  const games = [fixture(900090, -500, 0), fixture(900091, 500, 0)]
  for (const game of games) {
    game.duration = 1800
    for (const role of ['JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const)
      game.players.push({
        player: `Synthetic ${role}#TEST_ONLY`,
        role,
        gd15: 0
      } as MemberAnalysisPlayerGame)
  }
  games[0].gold20Diff = null
  games[1].gold20Diff = 0
  expect(earlyEvidenceGames(games, { timing: '15', group: 'neutral' })).toEqual([games[0]])
  expect(earlyEvidenceGames(games, { timing: '15', group: 'ahead' })).toEqual([games[1]])
  expect(earlyEvidenceGames(games, { timing: '20', group: 'neutral' })).toEqual([games[1]])
})
