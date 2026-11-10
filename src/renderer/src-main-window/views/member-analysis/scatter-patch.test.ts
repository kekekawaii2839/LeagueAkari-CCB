import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { expect, test } from 'vitest'

import { aggregateRoles } from './analytics'
import { patchScatterRows } from './scatter-patch'
import { filterSummaryByMinimumGames } from './scatter-summary-filter'

function player(change: Partial<MemberAnalysisPlayerGame> = {}): MemberAnalysisPlayerGame {
  return {
    player: 'Synthetic A',
    role: 'MIDDLE',
    champion: 'Synthetic',
    minutes: 30,
    kills: 0,
    deaths: 0,
    assists: 10,
    teamKills: 20,
    teamDeaths: 4,
    damage: 3000,
    damageShare: 0.1,
    gold: 6000,
    goldShare: 0.1,
    cs: 20,
    vision: 60,
    wardsPlaced: 20,
    wardsKilled: 3,
    controlWards: 2,
    damageTaken: 3000,
    takenShare: 0.1,
    damageMitigated: 2000,
    objectiveDamage: 400,
    turretDamage: 100,
    healTeammates: 100,
    shieldTeammates: 100,
    ccSeconds: 20,
    soloKills: 0,
    fbPart: false,
    ftPart: false,
    kp: 0.5,
    gd10: -100,
    gd15: 0,
    csd15: 0,
    xpd15: 0,
    damageDiff15: 0,
    soloDiff15: 0,
    counter: null,
    ...change
  }
}
function game(id: number, patch: string, rows = [player()]): MemberAnalysisGame {
  return {
    gameId: id,
    timestamp: id * 1000,
    date: '2026-01-01',
    patch,
    side: 'Blue',
    win: id % 2 === 1,
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
    laneGankDeaths: null,
    players: rows
  }
}
const rows = (games: MemberAnalysisGame[]) =>
  patchScatterRows(games, 'ALL', 'all', 'gd15', 'winRate')

test('groups actual member-role-patch populations, normalizes builds and orders patches numerically', () => {
  const games = [
    game(1, '16.10'),
    game(2, '16.9.123'),
    game(3, '16.9.456', [player(), player({ player: 'Synthetic B', role: 'TOP' })])
  ]
  const before = JSON.stringify(games)
  expect(rows(games).map((r) => [r.patch, r.player, r.role, r.games, r.winRate])).toEqual([
    ['16.9', 'Synthetic B', 'TOP', 1, 1],
    ['16.9', 'Synthetic A', 'MIDDLE', 2, 0.5],
    ['16.10', 'Synthetic A', 'MIDDLE', 1, 1]
  ])
  expect(JSON.stringify(games)).toBe(before)
  expect(rows([])).toEqual([])
})

test('reuses ratio-of-source-totals rather than averaging match KDA or DPM', () => {
  const games = [
    game(1, '16.1', [player({ kills: 2, assists: 0, deaths: 0, damage: 100, minutes: 10 })]),
    game(2, '16.1', [player({ kills: 0, assists: 0, deaths: 4, damage: 900, minutes: 30 })])
  ]
  const [result] = patchScatterRows(games, 'MIDDLE', 'all', 'kda', 'dpm')
  expect(result.kda).toBe(0.5)
  expect(result.dpm).toBe(25)
  expect(result.validX).toBe(2)
  expect(result.validY).toBe(2)
  expect(result.kda).toBe(aggregateRoles(games)[0].kda)
})

test('keeps independent axis support, valid zero/negative and null observations', () => {
  const games = [
    game(1, '16.1', [player({ gd15: -100, kp: null })]),
    game(2, '16.1', [player({ gd15: 0, kp: null })]),
    game(3, '16.2', [player({ gd15: null, kp: 0 })])
  ]
  const result = patchScatterRows(games, 'MIDDLE', 'all', 'gd15', 'kp')
  expect(result.map((r) => [r.games, r.gd15, r.kp, r.validX, r.validY])).toEqual([
    [2, -50, null, 2, 0],
    [1, null, 0, 0, 1]
  ])
})

test('retains known zero exposure in compound support and uses native metric support', () => {
  const games = [
    game(1, '16.1', [player({ damageShare: 0.2, goldShare: 0, deaths: 0 })]),
    game(2, '16.1', [player({ damageShare: 0.2, goldShare: 0.2, deaths: 2, damageTaken: 1000 })])
  ]
  const [result] = patchScatterRows(
    games,
    'MIDDLE',
    'all',
    'damageConversion',
    'damageTakenPerDeath'
  )
  expect(result.damageConversion).toBe(2)
  expect(result.validX).toBe(2)
  expect(result.damageTakenPerDeath).toBe(500)
  expect(result.validY).toBe(1)
})

test('minimum games applies within each patch without dropping missing metrics first', () => {
  const games = [game(1, '16.1'), game(2, '16.1', [player({ gd15: null })]), game(3, '16.2')]
  const filtered = filterSummaryByMinimumGames(rows(games), 2)
  expect(filtered.hidden).toBe(1)
  expect(filtered.visible.map((r) => [r.patch, r.games, r.validX])).toEqual([['16.1', 2, 1]])
})

test('unknown patches stay explicit, selected populations do not invent cross-product records', () => {
  const games = [
    game(1, 'unknown'),
    game(2, '16.1', [player({ player: 'Synthetic B' })]),
    game(3, '16.2', [player({ role: 'TOP' })])
  ]
  expect(rows(games).map((r) => r.patch)).toEqual(['16.1', '16.2', ''])
  expect(
    patchScatterRows(games, 'MIDDLE', 'Synthetic A', 'gd15', 'winRate').map((r) => r.patch)
  ).toEqual([''])
  expect(patchScatterRows(games.slice(1, 2), 'MIDDLE', 'all', 'gd15', 'winRate')).toHaveLength(1)
})
