import { describe, expect, it } from 'vitest'

import { runRiotPilot } from './pilot'

const options = { patch: '16.21', maximumDetails: 3, maximumSeeds: 2, minimumDurationSeconds: 300 }
function payload(id: string, version = '16.21.123') {
  return {
    metadata: { matchId: id },
    info: {
      queueId: 420,
      gameVersion: version,
      gameDuration: 1800,
      participants: [100, 200].flatMap((teamId, t) =>
        ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((teamPosition, i) => ({
          teamId,
          teamPosition,
          championId: t * 5 + i + 1,
          win: teamId === 100,
          puuid: 'synthetic-unused',
          riotIdGameName: 'Synthetic unused'
        }))
      )
    }
  }
}

describe('bounded Riot pilot orchestration', () => {
  it('rejects mismatched response identity and cancellation during the last detail', async () => {
    const controller = new AbortController()
    const client = {
      async getLeagueEntries() {
        return [{ puuid: 'synthetic-seed' }]
      },
      async getMatchIds() {
        return ['EUW1_REQUESTED']
      },
      async getMatch() {
        return payload('EUW1_DIFFERENT')
      }
    }
    const result = await runRiotPilot(client, { ...options, maximumDetails: 1 })
    expect(result.acceptedMatches).toBe(0)
    expect(result.excluded).toEqual({ 'identity-mismatch': 1 })
    await expect(
      runRiotPilot(
        {
          ...client,
          async getMatch() {
            controller.abort()
            return payload('EUW1_REQUESTED')
          }
        },
        { ...options, maximumDetails: 1 },
        controller.signal
      )
    ).rejects.toThrow('Pilot cancelled')
  })
  it('deduplicates histories, admits the requested patch and never returns player identities', async () => {
    const calls: string[] = []
    const client = {
      async getLeagueEntries() {
        calls.push('league')
        return [{ puuid: 'synthetic-seed' }]
      },
      async getMatchIds() {
        calls.push('ids')
        return [
          'EUW1_SYNTHETIC_1',
          'EUW1_SYNTHETIC_1',
          'EUW1_SYNTHETIC_2',
          'EUW1_SYNTHETIC_3',
          'EUW1_SYNTHETIC_4'
        ]
      },
      async getMatch(_route: string, id: string) {
        calls.push(id)
        return payload(id, id === 'EUW1_SYNTHETIC_2' ? '16.22.1' : '16.21.123')
      }
    }
    const result = await runRiotPilot(client, options)
    expect(result.requests).toEqual({ league: 1, history: 1, details: 3 })
    expect(result.acceptedMatches).toBe(2)
    expect(result.excluded).toEqual({ duplicate: 1, 'patch-mismatch': 1 })
    expect(result.versionsObserved).toEqual({ '16.21': 2, '16.22': 1 })
    expect(result.interactionCells).toBe(90)
    expect(calls).not.toContain('EUW1_SYNTHETIC_4')
    expect(result.rawBlocks.every((b) => b.scope.population.includes('unverified'))).toBe(true)
    expect(Object.keys(result.matches[0].participants[0]).sort()).toEqual([
      'champion',
      'role',
      'team',
      'win'
    ])
    expect(JSON.stringify(result)).not.toContain('synthetic-seed')
  })
  it('does not invent a player lookup when league entries have no PUUID', async () => {
    const client = {
      async getLeagueEntries() {
        return [{ summonerId: 'synthetic-legacy' }]
      },
      async getMatchIds() {
        throw new Error('Must not call')
      },
      async getMatch() {
        throw new Error('Must not call')
      }
    }
    const result = await runRiotPilot(client, options)
    expect(result.seedAvailability).toBe('no-puuid-in-league-response')
    expect(result.requests).toEqual({ league: 1, history: 0, details: 0 })
  })
  it('rejects unbounded plans and honours cancellation before making requests', async () => {
    const client = {
      async getLeagueEntries() {
        throw new Error('Must not call')
      },
      async getMatchIds() {
        throw new Error('Must not call')
      },
      async getMatch() {
        throw new Error('Must not call')
      }
    }
    await expect(runRiotPilot(client, { ...options, maximumDetails: 1000000 })).rejects.toThrow(
      'Invalid bounded pilot plan'
    )
    const controller = new AbortController()
    controller.abort()
    await expect(runRiotPilot(client, options, controller.signal)).rejects.toThrow(
      'Pilot cancelled'
    )
  })
})
