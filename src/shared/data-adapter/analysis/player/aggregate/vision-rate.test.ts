import { describe, expect, it } from 'vitest'

import type { MatchBasicInfo } from '../../../match-history/match-basic'
import { toParticipants } from '../../../match-history/participants'
import type { LcuOrSgpGameSummary } from '../../../wrapper'
import type { PreparedGame } from '../types/helpers'
import { computeAggregatedChampions } from './champions'
import { computeAggregatedSummary } from './summary'

// Minimal synthetic API inputs; no player/match snapshots.
function game(
  source: 'sgp' | 'lcu',
  vision: unknown,
  seconds: number,
  championId = 103
): PreparedGame {
  const stats = {
    visionScore: vision,
    kills: 1,
    deaths: 1,
    assists: 1,
    win: true,
    totalDamageDealtToChampions: 100,
    goldEarned: 100,
    neutralMinionsKilled: 0,
    totalMinionsKilled: 0
  }
  const summary = (source === 'sgp'
    ? {
        source,
        data: {
          json: { participants: [{ ...stats, puuid: 'synthetic', championId, teamId: 100 }] }
        }
      }
    : {
        source,
        data: {
          participants: [{ participantId: 1, championId, teamId: 100, stats }],
          participantIdentities: [{ participantId: 1, player: { puuid: 'synthetic' } }]
        }
      }) as unknown as LcuOrSgpGameSummary
  const basic = { gameDuration: seconds, gameMode: 'CLASSIC', mapId: 11 } as MatchBasicInfo
  const participants = toParticipants(summary, basic)
  return {
    basic,
    participants,
    participant: participants[0],
    single: { summary: {} }
  } as PreparedGame
}

describe('vision score per minute', () => {
  it.each(['sgp', 'lcu'] as const)(
    'derives %s rates from raw total and seconds, not optional challenges',
    (source) => {
      expect(game(source, 25, 1800).participant.visionScorePerMinute).toBeCloseTo(25 / 30)
      expect(game(source, 0, 1800).participant.visionScorePerMinute).toBe(0)
      for (const missing of [null, undefined, NaN, Infinity, -1, '25']) {
        expect(game(source, missing, 1800).participant.visionScorePerMinute).toBeNull()
      }
      for (const duration of [0, -1, NaN, Infinity]) {
        expect(game(source, 25, duration).participant.visionScorePerMinute).toBeNull()
      }
    }
  )

  it('averages per-game rates equally, not total score / total time', () => {
    const summary = computeAggregatedSummary([game('sgp', 20, 1200), game('lcu', 80, 2400)])
    expect(summary.avgVisionScorePerMinute).toBe(1.5)
    expect(summary.avgVisionScorePerMinute).not.toBeCloseTo(100 / 60)
    expect(summary.visionScorePerMinuteGames).toBe(2)
    expect(summary.avgVisionScore).toBe(50) // Existing total-score contract remains intact.
  })

  it('counts real zero but excludes unavailable games from the denominator', () => {
    const summary = computeAggregatedSummary([
      game('sgp', 40, 1200),
      game('lcu', 0, 1800),
      game('sgp', undefined, 1800),
      game('lcu', 40, 0)
    ])
    expect(summary.avgVisionScorePerMinute).toBe(1)
    expect(summary.visionScorePerMinuteGames).toBe(2)
  })

  it('returns unavailable instead of zero for empty/all-invalid samples', () => {
    for (const games of [[], [game('sgp', undefined, 1800), game('lcu', 10, 0)]]) {
      expect(computeAggregatedSummary(games)).toMatchObject({
        avgVisionScorePerMinute: null,
        visionScorePerMinuteGames: 0
      })
    }
  })

  it('aggregates champion-specific rates separately and retains unrounded precision', () => {
    const champions = computeAggregatedChampions([
      game('sgp', 25, 1800, 103),
      game('lcu', 1, 1800, 103),
      game('sgp', 80, 1200, 64)
    ])
    expect(champions[103].summary.avgVisionScorePerMinute).toBeCloseTo(26 / 60)
    expect(champions[103].summary.visionScorePerMinuteGames).toBe(2)
    expect(champions[64].summary.avgVisionScorePerMinute).toBe(4)
  })
})
