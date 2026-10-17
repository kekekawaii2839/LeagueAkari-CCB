import { normalizeRankedStats } from '@shared/shards/member-analysis/opponent-ranks'
import type { GameflowSession } from '@shared/types/league-client/gameflow'
import { observable, runInAction } from 'mobx'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { MemberAnalysisSettingsState } from '../state'
import { OpponentRankLiveController, liveRankTarget } from './live-controller'
import { OpponentRankLoader } from './loader'
import { OpponentRankRepository } from './repository'

vi.mock('node:timers/promises', () => ({
  setTimeout: (milliseconds: number, value: unknown, options?: { signal?: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const signal = options?.signal
      signal?.throwIfAborted()
      const abort = () => {
        clearTimeout(timer)
        reject(signal?.reason)
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort)
        resolve(value)
      }, milliseconds)
      signal?.addEventListener('abort', abort, { once: true })
    })
}))

const roots: string[] = []
const controllers: OpponentRankLiveController[] = []
const repositories: OpponentRankRepository[] = []
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((c) => c.dispose()))
  repositories.splice(0).forEach((r) => r.close())
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }))
  vi.useRealTimers()
})
function session(id = 9001): GameflowSession {
  const player = (i: number) => ({
    puuid: `synthetic-live-${i}`,
    championId: i + 1,
    selectedPosition: 'TOP'
  })
  return {
    map: { id: 11 },
    phase: 'GameStart',
    gameData: {
      gameId: id,
      isCustomGame: false,
      teamOne: Array.from({ length: 5 }, (_, i) => player(i)),
      teamTwo: Array.from({ length: 5 }, (_, i) => player(i + 5))
    }
  } as GameflowSession
}
function harness() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
  const root = mkdtempSync(join(tmpdir(), 'akari-synthetic-live-ranks-'))
  roots.push(root)
  const repo = new OpponentRankRepository(join(root, 'ranks.sqlite3'))
  repo.initialize()
  repositories.push(repo)
  const league = observable({
    state: { connectionState: 'connected' },
    data: {
      gameflow: { phase: 'GameStart', session: session() },
      summoner: { me: { puuid: 'synthetic-live-0' } }
    }
  })
  const call = vi.fn(async (_puuid: string, _options: any) => ({
    data: {
      queues: [
        {
          queueType: 'RANKED_FLEX_SR',
          tier: 'GOLD',
          rank: ['IV', 'III', 'II', 'I', 'II'][Number(_puuid.split('-').at(-1)) - 5] ?? 'IV'
        }
      ]
    }
  }))
  const sgp = observable({
    state: {
      isTokenReady: true,
      availability: { sgpServerId: 'TEST', serversSupported: { common: true } }
    },
    api: { leaguesLedge: { getRankedStatsByPuuid: call } }
  })
  const settings = new MemberAnalysisSettingsState()
  settings.enabled = true
  const logger = { warn: vi.fn() }
  const controller = new OpponentRankLiveController(
    league as any,
    sgp as any,
    settings,
    repo,
    logger
  )
  controllers.push(controller)
  return { repo, league, sgp, settings, call, controller, logger }
}
describe('automatic per-game opponent ranks', () => {
  test('rejects spectator, wrong map, custom, hidden/duplicate identities and non-player sessions', () => {
    const value = session()
    expect(liveRankTarget(value, 'GameStart', 'synthetic-live-0', 'TEST')?.opponents).toHaveLength(
      5
    )
    expect(liveRankTarget(value, 'WatchInProgress', 'synthetic-live-0', 'TEST')).toBeNull()
    expect(liveRankTarget(value, 'GameStart', 'not-in-game', 'TEST')).toBeNull()
    value.map.id = 12
    expect(liveRankTarget(value, 'GameStart', 'synthetic-live-0', 'TEST')).toBeNull()
    value.map.id = 11
    value.gameData.isCustomGame = true
    expect(liveRankTarget(value, 'GameStart', 'synthetic-live-0', 'TEST')).toBeNull()
    value.gameData.isCustomGame = false
    value.gameData.teamTwo[0].puuid = value.gameData.teamOne[0].puuid
    expect(liveRankTarget(value, 'GameStart', 'synthetic-live-0', 'TEST')).toBeNull()
  })
  test('captures without opening the page, bypasses player cache and keeps source/time across phase changes and refresh', async () => {
    const h = harness(),
      target = liveRankTarget(session(), 'GameStart', 'synthetic-live-0', 'TEST')!
    const old = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'IV' }] },
      new Date().toISOString()
    )
    for (const p of target.participants!) h.repo.writePlayer('TEST', p.puuid!, old)
    h.controller.watch()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.call).toHaveBeenCalledTimes(10)
    const saved = h.repo.readGame('TEST', 9001)!
    for (const player of target.participants!) {
      expect(h.repo.readGamePlayer('TEST', 9001, player.puuid!)?.status).toBe('ok')
      expect(h.repo.wasGamePlayerCapturedLive('TEST', 9001, player.puuid!)).toBe(true)
    }
    expect(saved.capture).toMatchObject({ mode: 'live', phase: 'GameStart' })
    expect(
      saved.opponents.every(
        (p) =>
          p.capturedDuringGame &&
          p.snapshot.flex.status === 'ranked' &&
          p.snapshot.flex.rank.tier === 'GOLD'
      )
    ).toBe(true)
    runInAction(() => {
      h.league.data.gameflow.phase = 'InProgress'
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.call).toHaveBeenCalledTimes(10)
    // Match-history order differs from gameflow: identity, not anonymous slot, must match.
    const reversed = { ...target, opponents: [...target.opponents].reverse() }
    const result = await new OpponentRankLoader(h.sgp as any, h.repo).load(
      [reversed],
      new AbortController().signal,
      () => {},
      { requests: 0, milliseconds: 1, spacing: 0, timeout: 1 }
    )
    expect(result[0].ranks.opponents[0].snapshot).toEqual(saved.opponents[4].snapshot)
    expect(result[0].ranks.opponents[0].snapshot).not.toEqual(saved.opponents[0].snapshot)
    expect(result[0].ranks.opponents.every((p) => p.capturedDuringGame)).toBe(true)
    h.repo.publishGames(result)
    expect(h.repo.readGame('TEST', 9001)!.capture).toEqual(saved.capture)
    expect(JSON.stringify(h.repo.readGame('TEST', 9001))).not.toContain('synthetic-live')
  })
  test('only fills failed live identities on a bounded retry and preserves first successful query time', async () => {
    const h = harness()
    h.call.mockImplementation(async (puuid) => {
      if (puuid.endsWith('-5') && Date.now() < Date.parse('2026-10-07T12:00:10Z'))
        throw new Error('synthetic timeout')
      return { data: { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV' }] } }
    })
    h.controller.watch()
    await vi.advanceTimersByTimeAsync(4000)
    const first = h.repo.readGame('TEST', 9001)!
    expect(h.call).toHaveBeenCalledTimes(12)
    await vi.advanceTimersByTimeAsync(20000)
    const later = h.repo.readGame('TEST', 9001)!
    expect(h.call).toHaveBeenCalledTimes(13)
    expect(later.opponents.slice(1)).toEqual(first.opponents.slice(1))
    expect(later.opponents.every((p) => p.capturedDuringGame)).toBe(true)
  })
  test('disabled/disconnected does not query; ending game cancels in-flight capture without publication', async () => {
    const h = harness()
    runInAction(() => {
      h.settings.enabled = false
    })
    h.controller.watch()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.call).not.toHaveBeenCalled()
    h.call.mockImplementation(
      (_p, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener('abort', () => reject(options.signal.reason), {
            once: true
          })
        )
    )
    runInAction(() => {
      h.settings.enabled = true
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(h.call).toHaveBeenCalledTimes(1)
    runInAction(() => {
      h.league.data.gameflow.phase = 'EndOfGame'
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(h.repo.readGame('TEST', 9001)).toBeUndefined()
    runInAction(() => {
      h.league.state.connectionState = 'disconnected'
      h.league.data.gameflow.phase = 'GameStart'
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.call).toHaveBeenCalledTimes(1)
    expect(h.logger.warn).not.toHaveBeenCalled()
  })
  test('persistent failure is bounded across phase toggles and shutdown removes subscription', async () => {
    const h = harness()
    h.call.mockRejectedValue(new Error('synthetic unavailable'))
    h.controller.watch()
    await vi.advanceTimersByTimeAsync(180000)
    expect(h.call).toHaveBeenCalledTimes(9)
    runInAction(() => {
      h.league.data.gameflow.phase = 'EndOfGame'
    })
    runInAction(() => {
      h.league.data.gameflow.phase = 'Reconnect'
    })
    await vi.advanceTimersByTimeAsync(180000)
    expect(h.call).toHaveBeenCalledTimes(9)
    await h.controller.dispose()
    runInAction(() => {
      h.league.data.gameflow.session = session(9002)
    })
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.call).toHaveBeenCalledTimes(9)
  })
  test('manual publication that began earlier cannot overwrite a live snapshot', async () => {
    const h = harness()
    h.controller.watch()
    await vi.advanceTimersByTimeAsync(2000)
    const before = h.repo.readGame('TEST', 9001)!
    const backfill = structuredClone(before)
    delete backfill.capture
    backfill.opponents.forEach((p) => {
      p.snapshot = normalizeRankedStats({ queues: [] }, new Date().toISOString())
    })
    h.repo.publishGames([{ serverId: 'TEST', gameId: 9001, ranks: backfill }])
    expect(h.repo.readGame('TEST', 9001)).toEqual(before)
    // A manual job that already saw partial live metadata also cannot clobber later live successes.
    backfill.capture = before.capture
    h.repo.publishGames([
      {
        serverId: 'TEST',
        gameId: 9001,
        ranks: backfill,
        identities: session().gameData.teamTwo.map((p) => p.puuid)
      }
    ])
    expect(h.repo.readGame('TEST', 9001)).toEqual(before)
    await h.controller.dispose()
    h.repo.close()
    h.repo.initialize()
    h.controller.watch()
    await vi.advanceTimersByTimeAsync(2000)
    expect(h.call).toHaveBeenCalledTimes(10)
  })
})

test('each new live match queries ten identities despite global TTL and keeps public enemy shape', async () => {
  const h = harness()
  h.controller.watch()
  await vi.advanceTimersByTimeAsync(2000)
  expect(h.call).toHaveBeenCalledTimes(10)
  runInAction(() => {
    h.league.data.gameflow.session = session(9002)
  })
  await vi.advanceTimersByTimeAsync(2000)
  expect(h.call).toHaveBeenCalledTimes(20)
  expect(h.repo.readGame('TEST', 9002)?.opponents).toHaveLength(5)
  for (const p of [...session(9002).gameData.teamOne, ...session(9002).gameData.teamTwo])
    expect(h.repo.readGamePlayer('TEST', 9002, p.puuid)?.status).toBe('ok')
})
