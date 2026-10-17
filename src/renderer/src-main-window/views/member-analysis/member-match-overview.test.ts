import { normalizeRankedStats } from '@shared/shards/member-analysis/opponent-ranks'
import { describe, expect, test } from 'vitest'

import { type MemberMatchOverviewInput, memberMatchTeams } from './member-match-overview'

type RawFixture = Omit<MemberMatchOverviewInput, 'summary'> & {
  summary: { data: { json: { gameId: number; participants: Record<string, unknown>[] } } }
}
function raw(): RawFixture {
  return {
    summary: {
      data: {
        json: {
          gameId: 1,
          participants: Array.from({ length: 10 }, (_, i) => ({
            participantId: i + 1,
            puuid: `synthetic-${i}`,
            championId: i + 1,
            teamId: i < 5 ? 100 : 200,
            riotIdGameName: `Synthetic ${i}`,
            summonerName: `Synthetic ${i}`,
            riotIdTagline: 'TEST_ONLY',
            teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5]
          }))
        }
      }
    }
  }
}
const game = { gameId: 1, side: 'Blue' } as const
describe('ten-player match overview identity', () => {
  test('keeps blue first and red second with equal groups, without confusing displayed side and own team', () => {
    const value = raw()
    const blueRank = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II' }] },
      '2026-10-13T12:00:00Z'
    )
    const redRank = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'I' }] },
      '2026-10-13T12:00:00Z'
    )
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: [
        { participantId: 6, snapshot: redRank, timing: 'unknown', observedAt: null },
        { participantId: 1, snapshot: blueRank, timing: 'after-game', observedAt: null }
      ]
    }
    const before = JSON.stringify(value)
    const teams = memberMatchTeams({ ...game, side: 'Red' }, value)!
    expect(teams.map((t) => [t.id, t.own, t.players.length])).toEqual([
      [100, false, 5],
      [200, true, 5]
    ])
    expect(teams[0].players[0].identity).toBe('Synthetic 0#TEST_ONLY')
    expect(teams[1].players[0].identity).toBe('Synthetic 5#TEST_ONLY')
    expect(teams[0].players[0].rank?.snapshot).toBe(blueRank)
    expect(teams[1].players[0].rank?.snapshot).toBe(redRank)
    expect(JSON.stringify(value)).toBe(before)
  })
  test('does not invent raw opponents, roles or ranks', () => {
    expect(memberMatchTeams(game, null)).toBeNull()
    const value = raw()
    value.summary.data.json.participants[0].teamPosition = ''
    const row = memberMatchTeams(game, value)![0].players.find((p) => p.participantId === 1)!
    expect(row.position).toBeNull()
    expect(row.rank).toBeNull()
    expect(memberMatchTeams({ ...game, gameId: 2 }, value)).toBeNull()
  })
  test('refuses ambiguous raw identities and incomplete teams', () => {
    const value = raw()
    value.summary.data.json.participants[1].puuid = value.summary.data.json.participants[0].puuid
    expect(memberMatchTeams(game, value)).toBeNull()
    const other = raw()
    other.summary.data.json.participants[0].teamId = 200
    expect(memberMatchTeams(game, other)).toBeNull()
  })
  test('maps only the returned participantId, never slot, nickname or role order', () => {
    const value = raw()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II' }] },
      '2026-10-13T12:00:00Z'
    )
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: [{ participantId: 6, snapshot, timing: 'after-game', observedAt: null }]
    }
    const teams = memberMatchTeams(game, value)!
    expect(teams[0].players.every((p) => p.rank === null)).toBe(true)
    expect(teams[1].players[0].rank?.snapshot).toBe(snapshot)
    expect(teams[1].players[0].rank?.timing).toBe('after-game')
    value.participantRanks.participants.push({
      participantId: 6,
      snapshot: null,
      timing: 'unknown',
      observedAt: null
    })
    expect(memberMatchTeams(game, value)![1].players[0].rank).toBeNull()
  })
  test.each([
    null,
    undefined,
    7,
    'not-a-player',
    [],
    { participantId: 1, teamId: 100, championId: 1 },
    { puuid: '   ', participantId: 1, teamId: 100, championId: 1 },
    { puuid: 'synthetic-invalid', participantId: 0, teamId: 100, championId: 1 },
    { puuid: 'synthetic-invalid', participantId: 11, teamId: 100, championId: 1 },
    { puuid: 'synthetic-invalid', participantId: 1.5, teamId: 100, championId: 1 },
    { puuid: 'synthetic-invalid', participantId: 1, teamId: 300, championId: 1 },
    { puuid: 'synthetic-invalid', participantId: 1, teamId: 100, championId: -1 },
    { puuid: 'synthetic-invalid', participantId: 1, teamId: 100, championId: 'Garen' }
  ])('returns unavailable instead of dereferencing an invalid raw element: %j', (invalid) => {
    const value = raw()
    const input: MemberMatchOverviewInput = {
      summary: {
        data: {
          json: {
            ...value.summary.data.json,
            participants: [invalid, ...value.summary.data.json.participants.slice(1)]
          }
        }
      }
    }
    expect(memberMatchTeams(game, input)).toBeNull()
  })
  test('rejects duplicate participant IDs even when all PUUIDs are unique', () => {
    const value = raw()
    value.summary.data.json.participants[1].participantId = 1
    expect(memberMatchTeams(game, value)).toBeNull()
  })
  test('preserves unknown role, source-unknown champion zero and legitimate name fallback', () => {
    const value = raw()
    const player = value.summary.data.json.participants[0]
    delete player.teamPosition
    delete player.riotIdGameName
    player.championId = 0
    const row = memberMatchTeams(game, value)![0].players.find((p) => p.participantId === 1)!
    expect(row.position).toBeNull()
    expect(row.championId).toBe(0)
    expect(row.name).toBe('Synthetic 0')
    expect(row.identity).toBe('Synthetic 0#TEST_ONLY')
    player.teamPosition = { role: 'TOP' }
    player.riotIdGameName = { name: 'not-a-name-string' }
    player.riotIdTagline = { tag: 'not-a-tag-string' }
    const partial = memberMatchTeams(game, value)![0].players.find((p) => p.participantId === 1)!
    expect(partial.position).toBeNull()
    expect(partial.name).toBe('Synthetic 0')
    expect(partial.identity).toBe('Synthetic 0')
    delete player.summonerName
    delete player.riotIdGameName
    delete player.riotIdTagline
    const unnamed = memberMatchTeams(game, value)![0].players.find((p) => p.participantId === 1)!
    expect(unnamed.name).toBe('')
    expect(unnamed.identity).toBe('')
  })
  test('orders the mapped display by known role while preserving shuffled identity/rank associations and raw input', () => {
    const value = raw()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II' }] },
      '2026-10-13T12:00:00Z'
    )
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: [
        { participantId: 8, snapshot, timing: 'during-game', observedAt: '2026-10-13T11:59:00Z' },
        { participantId: 2, snapshot: null, timing: 'unknown', observedAt: null }
      ]
    }
    value.summary.data.json.participants.reverse()
    const beforeRaw = JSON.stringify(value.summary.data.json.participants)
    const beforeRanks = JSON.stringify(value.participantRanks)
    const teams = memberMatchTeams(game, value)!
    expect(teams.map((team) => team.players.map((player) => player.position))).toEqual([
      ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'],
      ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
    ])
    const player = teams[1].players.find((p) => p.participantId === 8)!
    expect(player.rank?.snapshot).toBe(snapshot)
    expect(player.rank?.timing).toBe('during-game')
    expect(teams[0].players.find((p) => p.participantId === 2)?.rank?.snapshot).toBeNull()
    expect(JSON.stringify(value.summary.data.json.participants)).toBe(beforeRaw)
    expect(JSON.stringify(value.participantRanks)).toBe(beforeRanks)
  })
  test('places unknown roles last and uses stable participant IDs for equal-role ties without filling missing roles', () => {
    const value = raw()
    value.summary.data.json.participants[0].teamPosition = 'JUNGLE'
    value.summary.data.json.participants[3].teamPosition = ''
    value.summary.data.json.participants[4].teamPosition = null
    value.summary.data.json.participants.reverse()
    const team = memberMatchTeams(game, value)![0]
    expect(team.players.map((p) => p.participantId)).toEqual([1, 2, 3, 4, 5])
    expect(team.players.map((p) => p.position)).toEqual(['JUNGLE', 'JUNGLE', 'MIDDLE', null, null])
  })
})
