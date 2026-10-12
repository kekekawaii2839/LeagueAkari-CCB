import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { describe, expect, test } from 'vitest'

import { aggregatePairs, aggregateSynergy } from './analytics'
import {
  relatedRolePairs,
  relatedSynergy,
  rolePairEvidence,
  rolePairMembers
} from './combination-navigation'
import { sharedHeroStats } from './synergy-analysis'

const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
function game(id: number, names: string[]): MemberAnalysisGame {
  return {
    gameId: id,
    win: id % 2 === 1,
    side: 'Blue',
    players: names.map((player, i) => ({ player, role: roles[i] }))
  } as MemberAnalysisGame
}
describe('cross-view navigation preserves identities and independent populations', () => {
  test('role hero statistics include only this ordered role pairing, with missing heroes retained', () => {
    const games = [
      game(1, ['Member A', 'Member B']),
      game(2, ['Member B', 'Member A']),
      game(3, ['Member A', 'Member B'])
    ]
    games[0].players[0].champion = 'Garen'
    games[0].players[1].champion = 'Ahri'
    games[1].players[0].champion = 'Lux'
    games[1].players[1].champion = 'Vi'
    games[2].players[0].champion = ''
    games[2].players[1].champion = 'Ahri'
    const e = rolePairEvidence(games, { pairType: 'upper_pair', pair: 'Member A + Member B' })!
    expect(e.gamesList.map((g) => g.gameId)).toEqual([1, 3])
    const stats = sharedHeroStats({
      playerA: e.members[0],
      playerB: e.members[1],
      games: e.gamesList.length,
      gamesList: e.gamesList
    })
    expect(stats.total).toBe(2)
    expect(stats.members.map((m) => m.available)).toEqual([1, 2])
    expect(stats.pairsAvailable).toBe(1)
    expect(stats.members[0].rows.some((r) => r.champion === 'Vi')).toBe(false)
    expect(stats.members[0].rows.find((r) => r.champion === null)?.share).toBe(0.5)
    expect(rolePairEvidence([], { pairType: 'upper_pair', pair: 'Member A + Member B' })).toBeNull()
  })
  test('role reversal is two role rows but one member pair, without resampling', () => {
    const games = [
      game(1, ['Member A', 'Member B']),
      game(2, ['Member B', 'Member A']),
      game(3, ['Member A', 'Member C'])
    ]
    const roles = aggregatePairs(games)
    const shared = aggregateSynergy(games)
    const original = JSON.stringify({ games, roles, shared })
    const target = { pairType: 'upper_pair' as const, pair: 'Member A + Member B' }
    const members = rolePairMembers(games, target)!
    expect(members).toEqual(['Member A', 'Member B'])
    expect(relatedRolePairs(roles, games, members).map((row) => row.pair)).toEqual([
      'Member A + Member B',
      'Member B + Member A'
    ])
    expect(relatedSynergy(shared, members)?.games).toBe(2)
    expect(roles.find((row) => row.sideLabel === '总计' && row.pair === target.pair)?.games).toBe(1)
    expect(JSON.stringify({ games, roles, shared })).toBe(original)
  })
  test('full identities with identical short names never link to the wrong member', () => {
    const [first, second] = ['SYNTHETIC_ONE', 'SYNTHETIC_TWO'].map((tag) =>
      ['Synthetic Member', tag].join('#')
    )
    const games = [game(1, [first, second]), game(2, [first, 'Other Synthetic Member'])]
    const members = rolePairMembers(games, {
      pairType: 'upper_pair',
      pair: `${first} + ${second}`
    })!
    expect(members).toEqual([first, second])
    expect(relatedSynergy(aggregateSynergy(games), members)?.games).toBe(1)
    expect(relatedSynergy(aggregateSynergy(games), ['Member', 'Other'])).toBeUndefined()
  })
  test('a pair outside the three role definitions remains a valid shared pair', () => {
    const games = [game(1, ['Member A', 'Member B', 'Member C', 'Member D', 'Member E'])]
    expect(relatedRolePairs(aggregatePairs(games), games, ['Member A', 'Member E'])).toEqual([])
    expect(relatedSynergy(aggregateSynergy(games), ['Member A', 'Member E'])?.games).toBe(1)
  })
  test('missing roles and ambiguous legacy strings refuse fabricated identity links', () => {
    const games = [
      game(1, ['Member A + Member B', 'Member C']),
      game(2, ['Member A', 'Member B + Member C'])
    ]
    expect(
      rolePairMembers(games, { pairType: 'upper_pair', pair: 'Member A + Member B + Member C' })
    ).toBeNull()
    expect(
      rolePairMembers([game(1, ['Member A'])], {
        pairType: 'upper_pair',
        pair: 'Member A + Member B'
      })
    ).toBeNull()
    expect(
      relatedRolePairs(aggregatePairs(games), games, ['Member A', 'Member B + Member C'])
    ).toEqual([])
  })
  test('changed populations drop an unavailable link, without choosing another pair', () => {
    const games = [game(1, ['Member A', 'Member C'])]
    expect(relatedSynergy(aggregateSynergy(games), ['Member A', 'Member B'])).toBeUndefined()
    expect(relatedRolePairs(aggregatePairs(games), games, ['Member A', 'Member B'])).toEqual([])
    expect(rolePairMembers([], { pairType: 'upper_pair', pair: 'Member A + Member B' })).toBeNull()
  })
})
