import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'

import { createSyntheticOpportunityLedger } from '../../../../../packages/prediction-lab/runner/opportunity-ledger.mjs'
import type { PredictionOpportunityRequest } from '../../../../shared/shards/member-analysis/prediction'
import {
  NativePredictionController,
  type NativePredictionDependencies,
  type PredictionRuntime
} from './native-prediction-controller'
import type { NativePredictionRequest } from './native-prediction-executor'
import { nativePredictionIdentity } from './native-prediction-loader'

const study = 'native-prospective-capture-v1'
const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'prediction-lab-synthetic-native-controller-'))
  let now = 10000
  const ledger = createSyntheticOpportunityLedger(root, () => now)
  const members = roles.map((_, index) => ({
    serverId: 'SYNTHETIC',
    gameName: `Member${index}`,
    tagLine: 'TEST',
    puuid: `synthetic-${index}`
  }))
  const lineup = Object.fromEntries(
    roles.map((role, index) => [role, nativePredictionIdentity('SYNTHETIC', members[index].puuid)])
  ) as NativePredictionRequest['lineup']
  const runtime: PredictionRuntime = {
    connected: true,
    phase: 'Lobby',
    serverId: 'SYNTHETIC',
    self: members[0].puuid,
    game: null
  }
  const request: PredictionOpportunityRequest = {
    members: members.map(
      ({ puuid: _puuid, ...member }) => member
    ) as PredictionOpportunityRequest['members'],
    side: 'all',
    targetQueue: null
  }
  const fingerprint = { code: 'a'.repeat(64), protocol: 'b'.repeat(64) }
  const digest = (input: NativePredictionRequest) =>
    createHash('sha256').update(JSON.stringify(input)).digest('hex')
  const capture = vi.fn(async () => {
    expect(ledger.listOpportunities(study).opportunities).toHaveLength(1)
    const input: NativePredictionRequest = {
      lineup,
      side: 'all',
      dataCutoffMs: now,
      observations: Array.from({ length: 7 }, (_, gameId) =>
        roles.map((role) => ({
          gameId: gameId + 1,
          timestamp: (gameId + 1) * 1000,
          date: '2026-01-01',
          player: lineup[role],
          role,
          win: gameId % 2 === 0,
          side: 'Blue' as const,
          metrics: Array(40).fill(null) as null[]
        }))
      ).flat()
    }
    return {
      request: input,
      provenance: {
        schemaVersion: 1 as const,
        scope: 'immutable-development-seed-only' as const,
        availabilityEvidence: 'study-initial-observation-not-original-ingestion' as const,
        studyInitiatedAtMs: now,
        inputReadCompletedAtMs: now,
        sourceReadCompletedAtMs: now,
        studyObservedAtMs: now,
        dataCutoffMs: now,
        inputHash: 'c'.repeat(64),
        requestHash: digest(input),
        receiptSha256: 'd'.repeat(64),
        sources: []
      }
    }
  })
  const execute = vi.fn(async (input: NativePredictionRequest, _signal: AbortSignal) => ({
    status: 'completed' as const,
    result: {
      status: 'available' as const,
      probability: 0.6,
      modelId: 'baseline' as const,
      estimateKind: 'reference' as const,
      trainingRows: 2,
      bootstrapSuccess: 0,
      interval: null
    },
    inputHash: digest(input),
    observedAtMs: now
  }))
  const raw = {
    json: {
      gameId: 77,
      gameStartTimestamp: 10001,
      gameEndTimestamp: 910001,
      gameDuration: 900,
      queueId: 710,
      teams: [{ teamId: 100, win: true }],
      participants: roles.map((role, index) => ({
        puuid: members[index].puuid,
        teamId: 100,
        teamPosition: role
      }))
    }
  }
  const readResult = vi.fn(async () => raw)
  const dependencies = {
    ledger,
    userDataPath: root,
    clock: () => now,
    runtime: () => runtime,
    fingerprint: () => fingerprint,
    resolve: vi.fn(async () => members),
    capture,
    execute,
    readResult,
    freeze: (input: Parameters<NativePredictionDependencies['freeze']>[0]) => ({
      id: randomUUID(),
      dataHash: 'e'.repeat(64),
      requestHash: digest(input.request),
      frozenAtMs: now,
      durableCompletedAtMs: now,
      request: structuredClone(input.request)
    })
  }
  const controller = new NativePredictionController(dependencies)
  cleanups.push(async () => {
    await controller.dispose()
    ledger.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    ledger,
    members,
    lineup,
    runtime,
    request,
    fingerprint,
    capture,
    execute,
    raw,
    readResult,
    controller,
    dependencies,
    setNow: (value: number) => {
      now = value
    }
  }
}

test('durable registration precedes capture/compute; first observation reconciles actual times and scores one team', async () => {
  const h = setup()
  const reply = await h.controller.begin(h.request)
  expect(reply).toMatchObject({ status: 'forecasted', adaptive: 0.6 })
  // Seven matches, five required history matches: two training outcomes, one win, Beta(1,1)=0.5.
  expect(reply).toMatchObject({ baseline: 0.5 })
  h.setNow(10002)
  h.runtime.phase = 'GameStart'
  h.runtime.game = { serverId: 'SYNTHETIC', gameId: 77 }
  await h.controller.tick()
  h.runtime.game.gameId = 78
  await h.controller.tick()
  h.setNow(910002)
  await h.controller.tick()
  const view = h.ledger.listOpportunities(study)
  expect(view.opportunities[0].binding?.value.gameId).toBe(77)
  expect(view.opportunities[0].terminal?.value).toMatchObject({ kind: 'resolved', eligible: true })
  expect(h.controller.summary()).toMatchObject({ opportunities: 1, eligible: 1, resolved: 1 })
  expect(h.readResult).toHaveBeenCalledWith('SYNTHETIC', 77)
})

test('capture failure remains registered and cannot be silently retried as another opportunity', async () => {
  const h = setup()
  h.capture.mockRejectedValueOnce(Error('synthetic failure'))
  expect(await h.controller.begin(h.request)).toMatchObject({ status: 'registered-failed' })
  expect(await h.controller.begin(h.request)).toEqual({ status: 'rejected', reason: 'busy' })
  expect(h.execute).not.toHaveBeenCalled()
  expect(h.controller.summary()).toMatchObject({ opportunities: 1, pending: 1 })
})

test('draft starting during computation prevents any forecast commit, retaining the registered attempt', async () => {
  const h = setup()
  const original = h.execute.getMockImplementation()!
  h.execute.mockImplementationOnce(async (...args) => {
    const result = await original(...args)
    h.runtime.phase = 'ChampSelect'
    return result
  })
  expect(await h.controller.begin(h.request)).toMatchObject({ status: 'registered-failed' })
  expect(h.ledger.listOpportunities(study).opportunities[0].forecast).toBeNull()
})

test('recovery gap never binds a later game; cancellation stays terminal', async () => {
  const h = setup()
  const reply = await h.controller.begin(h.request)
  expect(reply.status).toBe('forecasted')
  await h.controller.dispose()
  const restarted = new NativePredictionController(h.dependencies)
  h.runtime.phase = 'GameStart'
  h.runtime.game = { serverId: 'SYNTHETIC', gameId: 88 }
  await restarted.tick()
  expect(h.ledger.listOpportunities(study).opportunities[0].binding).toBeNull()
  h.setNow(10000 + 2 * 3600000)
  await restarted.tick()
  expect(h.ledger.listOpportunities(study).opportunities[0].terminal?.value).toEqual({
    kind: 'unobserved'
  })
  await restarted.dispose()
})

test('disconnect gap is not repaired by choosing a later first game', async () => {
  const h = setup()
  await h.controller.begin(h.request)
  h.runtime.connected = false
  await h.controller.tick()
  h.runtime.connected = true
  h.runtime.phase = 'InProgress'
  h.runtime.game = { serverId: 'SYNTHETIC', gameId: 99 }
  await h.controller.tick()
  expect(h.ledger.listOpportunities(study).opportunities[0].binding).toBeNull()
})

test('code drift prevents further enrollment and does not create a replacement study', async () => {
  const h = setup()
  const result = await h.controller.begin(h.request)
  if (result.status !== 'forecasted') throw Error('synthetic setup failed')
  expect(h.controller.cancel(result.id)).toBe(true)
  h.fingerprint.code = 'f'.repeat(64)
  expect(await h.controller.begin(h.request)).toEqual({ status: 'rejected', reason: 'integrity' })
  expect(h.ledger.listOpportunities(study).opportunities).toHaveLength(1)
})

test('identity switch across alias await is rejected before enrollment', async () => {
  const h = setup()
  h.dependencies.resolve.mockImplementationOnce(async () => {
    h.runtime.self = 'different-account'
    return h.members
  })
  expect(await h.controller.begin(h.request)).toEqual({ status: 'rejected', reason: 'not-ready' })
  expect(h.ledger.getStudy(study)).toBeNull()
})

test('short disconnect and reconnect reaction irreversibly marks the opportunity gap', async () => {
  const h = setup()
  await h.controller.begin(h.request)
  h.runtime.connected = false
  h.controller.runtimeChanged()
  h.runtime.connected = true
  h.controller.runtimeChanged()
  h.runtime.phase = 'GameStart'
  h.runtime.game = { serverId: 'SYNTHETIC', gameId: 77 }
  h.controller.runtimeChanged()
  await h.controller.tick()
  expect(h.ledger.listOpportunities(study).opportunities[0].binding).toBeNull()
})

test('already observed first game recovers using original self rather than current login', async () => {
  const h = setup()
  await h.controller.begin(h.request)
  h.setNow(10002)
  h.runtime.phase = 'GameStart'
  h.runtime.game = { serverId: 'SYNTHETIC', gameId: 77 }
  await h.controller.tick()
  await h.controller.dispose()
  const recovered = new NativePredictionController(h.dependencies)
  h.runtime.self = 'different-account'
  h.setNow(910002)
  await recovered.tick()
  expect(h.ledger.listOpportunities(study).opportunities[0].terminal?.value).toMatchObject({
    kind: 'resolved',
    eligible: true
  })
  await recovered.dispose()
})

test('malformed string team IDs are not converted to a false Red-side result', async () => {
  const h = setup()
  await h.controller.begin(h.request)
  h.setNow(10002)
  h.runtime.phase = 'GameStart'
  h.runtime.game = { serverId: 'SYNTHETIC', gameId: 77 }
  await h.controller.tick()
  for (const player of h.raw.json.participants) Reflect.set(player, 'teamId', '100')
  Reflect.set(h.raw.json.teams[0], 'teamId', '100')
  h.setNow(910002)
  await h.controller.tick()
  expect(h.ledger.listOpportunities(study).opportunities[0].terminal).toBeNull()
})
