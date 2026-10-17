import type { MemberAnalysisSettings } from '@shared/shards/member-analysis'
import type { PlayerRankSnapshot } from '@shared/shards/member-analysis/opponent-ranks'
import { expect, test, vi } from 'vitest'

import { CurrentRankRefresh, type CurrentRankRefreshSource } from './current-rank-refresh'

const id = '11111111-1111-4111-8111-111111111111'
const anotherId = '22222222-2222-4222-8222-222222222222'
const snapshot: PlayerRankSnapshot = {
  status: 'ok',
  attemptedAt: '2026-10-15T00:00:00.000Z',
  fetchedAt: '2026-10-15T00:00:00.000Z',
  reason: null,
  solo: { status: 'ranked', rank: { tier: 'GOLD', division: 'IV', leaguePoints: 0 } },
  flex: { status: 'ranked', rank: { tier: 'GOLD', division: 'IV', leaguePoints: null } }
}
function harness() {
  const settings: Pick<
    MemberAnalysisSettings,
    'enabled' | 'experimentalLpTrendEnabled' | 'members'
  > = {
    enabled: true,
    experimentalLpTrendEnabled: true,
    members: Array.from({ length: 3 }, (_, i) => ({
      serverId: 'TEST',
      gameName: `Synthetic ${i + 1}`,
      tagLine: 'TEST_ONLY'
    }))
  }
  const repo = { recordMember: vi.fn() }
  let now = Date.parse('2026-10-15T00:00:00Z'),
    session: string | null = 'test-session'
  const source: CurrentRankRefreshSource = {
    session: () => session,
    resolve: vi.fn(async (member) => `PUUID_TEST_ONLY_${member.gameName}`),
    capture: vi.fn(async (players, _signal, assertCurrent, onSnapshot) => {
      for (const player of players) {
        assertCurrent()
        onSnapshot(player, snapshot)
      }
    })
  }
  const service = new CurrentRankRefresh(
    repo,
    () => settings,
    source,
    () => now
  )
  return {
    service,
    settings,
    source,
    repo,
    advance: () => (now += 5001),
    setSession: (next: string | null) => (session = next)
  }
}

test('fixed roster exact identities are merged once; zero and missing LP are not fabricated or cleared', async () => {
  const h = harness()
  h.source.resolve = vi.fn(async (member) =>
    member.gameName === 'Synthetic 3' ? null : 'DUPLICATE_TEST_ONLY'
  )
  const reply = await h.service.start(id)
  expect(reply.ok).toBe(true)
  if (reply.ok)
    expect(reply.value.members).toEqual([
      { memberSlot: 1, status: 'updated', fetchedAt: snapshot.fetchedAt, reason: null },
      { memberSlot: 2, status: 'updated', fetchedAt: snapshot.fetchedAt, reason: null },
      { memberSlot: 3, status: 'failed', fetchedAt: null, reason: 'identity-unresolved' }
    ])
  expect(h.source.capture).toHaveBeenCalledWith(
    [{ serverId: 'TEST', puuid: 'DUPLICATE_TEST_ONLY' }],
    expect.any(AbortSignal),
    expect.any(Function),
    expect.any(Function)
  )
  expect(h.repo.recordMember).toHaveBeenCalledTimes(2)
  expect(h.repo.recordMember.mock.calls.every((call) => call[3] !== null)).toBe(true)
  await h.service.dispose()
})

test('in-flight calls join only the same id, foreign cancellation cannot abort, and completion is throttled', async () => {
  const h = harness()
  let enter!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  h.source.capture = vi.fn(async (players, signal, _assert, onSnapshot) => {
    onSnapshot(players[0], snapshot)
    enter()
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    )
  })
  const operation = h.service.start(id)
  expect(h.service.start(id)).toBe(operation)
  expect(await h.service.start(anotherId)).toMatchObject({
    ok: false,
    error: { code: 'JOB_ALREADY_RUNNING' }
  })
  await entered
  expect(h.service.cancel(anotherId)).toBe(false)
  expect(h.service.cancel(id)).toBe(true)
  const reply = await operation
  if (!reply.ok) throw Error('Expected cancelled summary')
  expect(reply.value.status).toBe('cancelled')
  expect(reply.value.members.map((member) => member.status)).toEqual([
    'updated',
    'cancelled',
    'cancelled'
  ])
  expect(await h.service.start(anotherId)).toMatchObject({
    ok: false,
    error: { code: 'JOB_ALREADY_RUNNING' }
  })
  h.advance()
  h.source.capture = vi.fn(async () => {})
  expect((await h.service.start(anotherId)).ok).toBe(true)
  await h.service.dispose()
})

test.each(['session', 'roster', 'disabled'] as const)(
  'late identity completion after %s change cannot publish or erase identity',
  async (change) => {
    const h = harness()
    let finish!: (value: string) => void
    h.source.resolve = vi.fn(() => new Promise<string>((resolve) => (finish = resolve)))
    const operation = h.service.start(id)
    if (change === 'session') h.setSession('another-session')
    if (change === 'roster') h.settings.members[0].tagLine = 'CHANGED'
    if (change === 'disabled') h.settings.enabled = false
    finish('LATE_TEST_ONLY')
    const reply = await operation
    expect(reply).toMatchObject({ ok: true, value: { status: 'cancelled' } })
    expect(h.repo.recordMember).not.toHaveBeenCalled()
    expect(h.source.capture).not.toHaveBeenCalled()
    await h.service.dispose()
  }
)

test('disabled flag and disconnected source do not resolve or query any member', async () => {
  const h = harness()
  h.settings.experimentalLpTrendEnabled = false
  expect(await h.service.start(id)).toMatchObject({
    ok: false,
    error: { code: 'FEATURE_DISABLED' }
  })
  h.settings.experimentalLpTrendEnabled = true
  h.setSession(null)
  expect(await h.service.start(id)).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
  expect(h.source.resolve).not.toHaveBeenCalled()
  expect(h.source.capture).not.toHaveBeenCalled()
  await h.service.dispose()
})

test('the overall action deadline cancels unresolved work while retaining committed outcomes', async () => {
  vi.useFakeTimers()
  const h = harness()
  let enter!: () => void
  const entered = new Promise<void>((resolve) => (enter = resolve))
  h.source.capture = vi.fn(async (players, signal, _assert, onSnapshot) => {
    onSnapshot(players[0], snapshot)
    enter()
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    )
  })
  try {
    const operation = h.service.start(id)
    await entered
    await vi.advanceTimersByTimeAsync(45001)
    const result = await operation
    expect(result).toMatchObject({ ok: true, value: { status: 'cancelled' } })
    if (result.ok)
      expect(result.value.members.map((member) => member.status)).toEqual([
        'updated',
        'cancelled',
        'cancelled'
      ])
  } finally {
    await h.service.dispose()
    vi.useRealTimers()
  }
})
