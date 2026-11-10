import { describe, expect, it } from 'vitest'

import { InteractionAccumulator } from './interactions'
import { normalizeRiotMatch } from './riot-match'

const scope = {
  patch: '16.21',
  region: 'synthetic',
  queueId: 420,
  population: 'synthetic verified cohort'
}
function payload() {
  return {
    metadata: { matchId: 'SYNTHETIC_1', participants: ['synthetic-unused'] },
    info: {
      queueId: 420,
      gameVersion: '16.21.123.456',
      gameDuration: 1800,
      participants: ([100, 200] as const).flatMap((teamId, team) =>
        ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((teamPosition, i) => ({
          championId: team * 5 + i + 1,
          teamPosition,
          teamId,
          win: teamId === 100,
          puuid: 'synthetic-unused',
          riotIdGameName: 'Synthetic private name'
        }))
      )
    }
  }
}

describe('Riot Match-V5 projection and admission', () => {
  it('rejects a different platform instead of trusting the caller label', () => {
    const input = payload()
    input.metadata.matchId = 'OTHER_1'
    expect(normalizeRiotMatch(input, scope, 300)).toEqual({
      status: 'excluded',
      reason: 'region-mismatch'
    })
  })
  it('does not accept object prototype properties as positions', () => {
    for (const position of ['toString', 'constructor', '__proto__']) {
      const input = payload()
      input.info.participants[0].teamPosition = position
      expect(normalizeRiotMatch(input, scope, 300)).toEqual({
        status: 'excluded',
        reason: 'unknown-role'
      })
    }
  })
  it('projects identities away, maps roles and feeds complete counting', () => {
    const result = normalizeRiotMatch(payload(), scope, 300)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.match.participants.map((p) => p.role)).toEqual([
      'TOP',
      'JUNGLE',
      'MID',
      'ADC',
      'SUP',
      'TOP',
      'JUNGLE',
      'MID',
      'ADC',
      'SUP'
    ])
    expect(Object.keys(result.match.participants[0]).sort()).toEqual([
      'champion',
      'role',
      'team',
      'win'
    ])
    expect(Object.keys(result.match).sort()).toEqual([
      'matchId',
      'participants',
      'patch',
      'population',
      'queueId',
      'region'
    ])
    const accumulator = new InteractionAccumulator(scope)
    expect(accumulator.add(result.match)).toBe('added')
    expect(accumulator.estimates()).toHaveLength(90)
  })
  it('does not infer a rank or merge a different queue/patch', () => {
    const input = payload()
    input.info.queueId = 440
    expect(normalizeRiotMatch(input, scope, 300)).toEqual({
      status: 'excluded',
      reason: 'queue-mismatch'
    })
    input.info.queueId = 420
    input.info.gameVersion = '16.22.1'
    expect(normalizeRiotMatch(input, scope, 300)).toEqual({
      status: 'excluded',
      reason: 'patch-mismatch'
    })
  })
  it('keeps duration exclusions explicit and includes the cutoff boundary', () => {
    const input = payload()
    input.info.gameDuration = 299
    expect(normalizeRiotMatch(input, scope, 300)).toEqual({
      status: 'excluded',
      reason: 'short-game'
    })
    input.info.gameDuration = 300
    expect(normalizeRiotMatch(input, scope, 300).status).toBe('accepted')
    expect(() => normalizeRiotMatch(input, scope, NaN)).toThrow()
  })
  it('never guesses positions when teamPosition is unknown', () => {
    const input = payload()
    input.info.participants[0].teamPosition = ''
    expect(normalizeRiotMatch(input, scope, 300)).toEqual({
      status: 'excluded',
      reason: 'unknown-role'
    })
  })
  it('rejects malformed and inconsistent match results without leaking the payload', () => {
    for (const input of [null, {}, { ...payload(), metadata: {} }, { ...payload(), info: {} }])
      expect(normalizeRiotMatch(input, scope, 300)).toEqual({
        status: 'excluded',
        reason: 'invalid-payload'
      })
    const input = payload()
    input.info.participants[0].win = false
    expect(normalizeRiotMatch(input, scope, 300)).toEqual({
      status: 'excluded',
      reason: 'invalid-payload'
    })
  })
})
