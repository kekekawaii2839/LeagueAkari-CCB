import { MemberAnalysisParticipantRanksSchema } from '@shared/shards/member-analysis/match-details'
import {
  type OpponentRanks,
  type PlayerRankSnapshot,
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { expect, test, vi } from 'vitest'

import { matchDetailRanks } from './match-detail-ranks'

const START = Date.parse('2026-10-13T12:00:00.000Z')
const END = START + 1800000
const iso = (time: number) => new Date(time).toISOString()
function fixture() {
  const summary = {
    gameId: 7,
    gameStartTimestamp: START,
    gameEndTimestamp: END,
    participants: Array.from({ length: 10 }, (_, index) => ({
      participantId: index + 1,
      puuid: `synthetic-${index + 1}`
    }))
  }
  const records = new Map<string, { snapshot: PlayerRankSnapshot; live: boolean }>()
  let captureGame: OpponentRanks | undefined = {
    version: 1,
    source: 'SGP leagues-ledge (current snapshot)',
    serverId: 'TEST',
    capture: { mode: 'live', observedAt: iso(START + 1000), phase: 'InProgress' },
    opponents: Array.from({ length: 5 }, (_, index) => ({
      slot: index + 1,
      role: null,
      champion: null,
      snapshot: unavailableRank('not-found', iso(START))
    }))
  }
  const reader = {
    readGame: vi.fn((server: string, id: number) =>
      server === 'TEST' && id === 7 ? captureGame : undefined
    ),
    readGamePlayers: vi.fn(
      (server: string, id: number, puuids: readonly string[]) =>
        new Map(
          puuids.map((puuid) => {
            const entry = records.get(`${server}:${id}:${puuid}`)
            return [
              puuid,
              { snapshot: entry?.snapshot ?? null, capturedDuringGame: entry?.live ?? false }
            ]
          })
        )
    )
  }
  const put = (
    participant: number,
    fetched = START + 2000,
    live = true,
    server = 'TEST',
    id = 7
  ) => {
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'II', leaguePoints: 0 }] },
      iso(fetched)
    )
    records.set(`${server}:${id}:synthetic-${participant}`, { snapshot, live })
    return snapshot
  }
  return {
    summary,
    records,
    reader,
    put,
    run: () => matchDetailRanks('TEST', 7, summary, reader),
    setCapture: (value: OpponentRanks | undefined) => {
      captureGame = value
    }
  }
}
test('participant-rank enrichment is exact per-game identity, not slot/order/name/role/champion or global cache', () => {
  const f = fixture()
  const saved = f.put(7)
  f.summary.participants.reverse()
  const input = structuredClone(f.summary)
  const value = f.run()!
  expect(value.participants.find((p) => p.participantId === 7)).toEqual({
    participantId: 7,
    snapshot: saved,
    timing: 'during-game',
    observedAt: iso(START + 1000)
  })
  expect(value.participants.filter((p) => p.snapshot === null)).toHaveLength(9)
  expect(
    f.reader.readGamePlayers.mock.calls.every(([server, id]) => server === 'TEST' && id === 7)
  ).toBe(true)
  expect(f.summary).toEqual(input)
  f.put(2, START + 2000, true, 'OTHER')
  f.put(3, START + 2000, true, 'TEST', 8)
  expect(f.run()!.participants.find((p) => p.participantId === 2)?.snapshot).toBeNull()
  expect(f.run()!.participants.find((p) => p.participantId === 3)?.snapshot).toBeNull()
})
test('ambiguous or absent PUUID never borrows a snapshot; duplicate or incomplete participant IDs omit enrichment', () => {
  const f = fixture()
  f.put(1)
  f.summary.participants[1].puuid = 'synthetic-1'
  f.summary.participants[2].puuid = ''
  const value = f.run()!
  for (const id of [1, 2, 3])
    expect(value.participants.find((p) => p.participantId === id)?.snapshot).toBeNull()
  expect(
    f.reader.readGamePlayers.mock.calls.some(([, , puuids]) => puuids.includes('synthetic-1'))
  ).toBe(false)
  for (const puuid of [null, undefined, '']) {
    const nullIdentity = {
      ...f.summary,
      participants: f.summary.participants.map((p, index) => (index === 0 ? { ...p, puuid } : p))
    }
    expect(matchDetailRanks('TEST', 7, nullIdentity, f.reader)!.participants[0].snapshot).toBeNull()
  }
  f.summary.participants[1].participantId = 1
  expect(f.run()).toBeUndefined()
  f.summary.participants.pop()
  expect(f.run()).toBeUndefined()
})
test('during-game requires actual capture and fetch times inside trustworthy epoch-ms bounds', () => {
  const f = fixture()
  for (const [fetch, live, expected] of [
    [START + 2000, true, 'during-game'],
    [END + 1, true, 'after-game'],
    [START - 1, true, 'unknown'],
    [START + 2000, false, 'unknown']
  ] as const) {
    f.put(1, fetch, live)
    expect(f.run()!.participants[0].timing).toBe(expected)
  }
  f.put(1)
  const capture = f.reader.readGame('TEST', 7)!
  f.setCapture({ ...capture, capture: { ...capture.capture!, observedAt: iso(START + 3000) } })
  expect(f.run()!.participants[0].timing).toBe('unknown')
  f.setCapture({ ...capture, capture: { ...capture.capture!, observedAt: iso(START - 1) } })
  expect(f.run()!.participants[0].timing).toBe('unknown')
  f.setCapture({ ...capture, serverId: 'OTHER' })
  expect(f.run()!.participants[0]).toMatchObject({ timing: 'unknown', observedAt: null })
  f.setCapture(undefined)
  expect(f.run()!.participants[0]).toMatchObject({ timing: 'unknown', observedAt: null })
  f.summary.gameStartTimestamp = Math.floor(START / 1000)
  f.summary.gameEndTimestamp = Math.floor(END / 1000)
  expect(f.run()).toBeUndefined()
})
test('missing or invalid match bounds and legacy summaries omit only the additive payload', () => {
  const f = fixture()
  for (const summary of [
    { ...f.summary, gameStartTimestamp: undefined },
    { ...f.summary, gameEndTimestamp: undefined },
    { ...f.summary, gameEndTimestamp: START },
    { ...f.summary, gameId: 8 },
    { ...f.summary, participants: [] }
  ])
    expect(matchDetailRanks('TEST', 7, summary, f.reader)).toBeUndefined()
})
test('solo/flex missingness, provisional/stale and unavailable facts are preserved independently of timing', () => {
  const f = fixture()
  const snapshot = f.put(1, END + 1000)
  snapshot.status = 'stale'
  snapshot.reason = 'network-error'
  snapshot.solo = { status: 'provisional', rank: null }
  expect(f.run()!.participants[0]).toEqual({
    participantId: 1,
    snapshot,
    timing: 'after-game',
    observedAt: iso(START + 1000)
  })
  expect(f.run()!.participants[0].snapshot?.flex).toEqual({ status: 'missing', rank: null })
  f.records.set('TEST:7:synthetic-1', {
    snapshot: unavailableRank('budget-exhausted', iso(END)),
    live: false
  })
  expect(f.run()!.participants[0]).toMatchObject({
    snapshot: { status: 'unavailable', fetchedAt: null },
    timing: 'unknown',
    observedAt: null
  })
})
test('strict public participant-rank schema rejects duplicate IDs and fabricated absent provenance', () => {
  const f = fixture()
  const value = f.run()!
  expect(MemberAnalysisParticipantRanksSchema.safeParse(value).success).toBe(true)
  value.participants[1].participantId = 1
  expect(MemberAnalysisParticipantRanksSchema.safeParse(value).success).toBe(false)
  value.participants[1].participantId = 2
  value.participants[0].timing = 'during-game'
  expect(MemberAnalysisParticipantRanksSchema.safeParse(value).success).toBe(false)
})

test('one batch receives only unique valid identities in participant order, and SQL failures propagate to the optional caller', () => {
  const f = fixture()
  f.summary.participants.reverse()
  f.summary.participants[0].puuid = 'synthetic-9'
  f.summary.participants[2].puuid = ' '
  f.run()
  expect(f.reader.readGamePlayers).toHaveBeenCalledTimes(1)
  expect(f.reader.readGamePlayers).toHaveBeenCalledWith('TEST', 7, [
    'synthetic-7',
    'synthetic-6',
    'synthetic-5',
    'synthetic-4',
    'synthetic-3',
    'synthetic-2',
    'synthetic-1'
  ])
  f.reader.readGamePlayers.mockImplementationOnce(() => {
    throw new Error('synthetic SQL failure')
  })
  expect(() => f.run()).toThrow('synthetic SQL failure')
})
