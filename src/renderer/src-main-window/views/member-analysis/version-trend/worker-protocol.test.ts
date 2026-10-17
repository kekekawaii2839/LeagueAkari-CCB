import { expect, test } from 'vitest'

import type { TrendRequest } from './domain'
import { createTrendWorkerHandler } from './worker-protocol'

const request: TrendRequest = {
  axis: 'patch',
  timeBucket: 'week',
  memberId: 'member-slot-1',
  role: 'TOP',
  metric: 'player:winRate',
  champion: null,
  side: 'all',
  outcome: 'all',
  patchFrom: '',
  patchTo: '',
  dateFrom: '',
  dateTo: '',
  durationMin: null,
  durationMax: null,
  includeMemberIds: [],
  excludeMemberIds: [],
  completeness: 'all'
}
test('worker ignores old jobs and publishes empty real dataset with matching generation', () => {
  const replies: unknown[] = []
  const handle = createTrendWorkerHandler((reply) => replies.push(reply))
  handle({
    type: 'start',
    jobId: 1,
    generation: 7,
    configuredMemberIds: ['member-slot-1'],
    request
  })
  handle({
    type: 'start',
    jobId: 2,
    generation: 8,
    configuredMemberIds: ['member-slot-1'],
    request
  })
  handle({ type: 'finish', jobId: 1 })
  expect(replies).toEqual([])
  handle({ type: 'chunk', jobId: 2, games: [], identities: [] })
  handle({ type: 'finish', jobId: 2 })
  expect(replies).toEqual([
    expect.objectContaining({
      type: 'done',
      jobId: 2,
      result: expect.objectContaining({ generation: 8, points: [] })
    })
  ])
})
test('invalid request is fixed failure not leaked worker error', () => {
  const replies: unknown[] = []
  const handle = createTrendWorkerHandler((reply) => replies.push(reply))
  handle({ type: 'start', jobId: 3, generation: 1, configuredMemberIds: [], request })
  handle({ type: 'finish', jobId: 3 })
  expect(replies).toEqual([{ type: 'failed', jobId: 3, reason: 'invalid-input' }])
})

test('independent early games and later identity chunks preserve full float order and missingness until finish', () => {
  const games = Array.from({ length: 53 }, (_, index) => ({
    gameId: 1000 - index,
    timestamp: 1700000000000 + index * 1000,
    date: '2026-01-01',
    patch: '15.15',
    side: 'Blue',
    win: index % 2 === 0,
    duration: 1800,
    metricSemantics: 'current-v5',
    roster: 'Synthetic',
    jungle: null,
    players: [
      {
        player: 'Synthetic',
        role: 'TOP',
        champion: 'SyntheticChampion',
        minutes: 30,
        gd15: [1e16, 1, -1e16][index % 3]
      }
    ]
  })) as any
  const identities = games
    .slice(0, 51)
    .map((game: any) => ({
      gameId: game.gameId,
      members: [{ memberId: 'member-slot-1', player: 'Synthetic' }]
    }))
  const selection = { ...request, metric: 'player:gd15' }
  const replies: any[] = [],
    handle = createTrendWorkerHandler((reply) => replies.push(reply))
  handle({
    type: 'start',
    jobId: 9,
    generation: 3,
    configuredMemberIds: ['member-slot-1'],
    request: selection
  })
  handle({ type: 'chunk', jobId: 9, games: games.slice(0, 25), identities: [] })
  handle({ type: 'chunk', jobId: 9, games: [], identities: identities.slice(25, 50) })
  handle({ type: 'chunk', jobId: 9, games: games.slice(25, 50), identities: [] })
  handle({ type: 'chunk', jobId: 9, games: [], identities: identities.slice(0, 25) })
  handle({ type: 'chunk', jobId: 9, games: games.slice(50), identities: [] })
  handle({ type: 'chunk', jobId: 9, games: [], identities: identities.slice(50) })
  expect(replies).toEqual([])
  handle({ type: 'finish', jobId: 9 })
  const baseline: any[] = [],
    original = createTrendWorkerHandler((reply) => baseline.push(reply))
  original({
    type: 'start',
    jobId: 9,
    generation: 3,
    configuredMemberIds: ['member-slot-1'],
    request: selection
  })
  for (let offset = 0; offset < games.length; offset += 25)
    original({
      type: 'chunk',
      jobId: 9,
      games: games.slice(offset, offset + 25),
      identities: identities.slice(offset, offset + 25)
    })
  original({ type: 'finish', jobId: 9 })
  expect(replies).toEqual(baseline)
  expect(replies[0].type).toBe('done')
  expect(replies[0].result.unresolvedIdentityGames).toBe(2)
})
