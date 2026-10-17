import { afterEach, expect, test, vi } from 'vitest'

import { CurrentProfileIcons } from './current-profile-icons'

const row = (puuid = 'SYNTHETIC_PUUID', serverId = 'TEST', identity = 'a'.repeat(64)) => ({
  puuid,
  serverId,
  identity
})
afterEach(() => vi.useRealTimers())
test('exact server/PUUID current profile including zero wins; success TTL and session reset are bounded', async () => {
  let now = 0,
    session: string | null = 'SYNTHETIC_SESSION'
  const query = vi.fn(async (_server: string, ids: string[]) =>
    ids.map((puuid) => ({ puuid, profileIconId: 0 }))
  )
  const service = new CurrentProfileIcons(
    { session: () => session, ready: () => true, query },
    () => now
  )
  expect((await service.resolve([row()], () => {})).get(row().identity)).toBe(0)
  await service.resolve([row()], () => {})
  expect(query).toHaveBeenCalledTimes(1)
  now = 300001
  await service.resolve([row()], () => {})
  expect(query).toHaveBeenCalledTimes(2)
  await service.resolve([row('SYNTHETIC_PUUID', 'OTHER')], () => {})
  expect(query).toHaveBeenLastCalledWith('OTHER', ['SYNTHETIC_PUUID'], expect.any(AbortSignal))
  session = null
  expect((await service.resolve([row()], () => {})).size).toBe(0)
  session = 'NEXT_SESSION'
  await service.resolve([row()], () => {})
  expect(query).toHaveBeenCalledTimes(4)
  service.dispose()
  expect((await service.resolve([row()], () => {})).size).toBe(0)
})
test('wrong identity/duplicates/invalid icons fail closed; unavailable source does not query and failure TTL retries', async () => {
  let now = 0,
    ready = false
  const query = vi.fn().mockResolvedValue([{ puuid: 'FOREIGN', profileIconId: 11 }])
  const service = new CurrentProfileIcons(
    { session: () => 'SYNTHETIC', ready: () => ready, query },
    () => now
  )
  expect((await service.resolve([row()], () => {})).size).toBe(0)
  expect(query).not.toHaveBeenCalled()
  ready = true
  expect((await service.resolve([row()], () => {})).size).toBe(0)
  await service.resolve([row()], () => {})
  expect(query).toHaveBeenCalledTimes(1)
  now = 30001
  query.mockResolvedValue([
    { puuid: row().puuid, profileIconId: 8 },
    { puuid: row().puuid, profileIconId: 9 }
  ])
  expect((await service.resolve([row()], () => {})).size).toBe(0)
  now = 60002
  query.mockResolvedValue([{ puuid: row().puuid, profileIconId: -1 }])
  expect((await service.resolve([row()], () => {})).size).toBe(0)
  now = 90003
  query.mockResolvedValue([{ puuid: row().puuid, profileIconId: 12 }])
  expect((await service.resolve([row()], () => {})).get(row().identity)).toBe(12)
  service.dispose()
})
test('three second deadline aborts hanging requests; inflight dedup, two batches max twenty and changed scope cannot commit', async () => {
  vi.useFakeTimers()
  let active = 0,
    maxActive = 0,
    stale = false
  const query = vi.fn(async (_server: string, ids: string[], signal: AbortSignal) => {
    active++
    maxActive = Math.max(maxActive, active)
    expect(ids.length).toBeLessThanOrEqual(20)
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true })
    )
    active--
    return ids.map((puuid) => ({ puuid, profileIconId: 33 }))
  })
  const service = new CurrentProfileIcons({ session: () => 'SYNTHETIC', ready: () => true, query })
  const rows = Array.from({ length: 45 }, (_, i) =>
    row('SYNTHETIC_' + i, 'TEST', String(i).padStart(64, 'a'))
  )
  const pending = service.resolve(rows, () => {
    if (stale) throw Error('stale')
  })
  const duplicate = service.resolve(rows.slice(0, 20), () => {})
  expect(query).toHaveBeenCalledTimes(2)
  expect(maxActive).toBe(2)
  await vi.advanceTimersByTimeAsync(3001)
  expect((await pending).size).toBe(0)
  expect((await duplicate).size).toBe(0)
  expect(query.mock.calls.every((call) => call[2].aborted)).toBe(true)
  stale = true
  const p = service.resolve([row('NEXT')], () => {
    if (stale) throw Error('stale')
  })
  const rejected = expect(p).rejects.toThrow('stale')
  service.clear()
  await rejected
  service.dispose()
})
test('success cache evicts least recently used identities beyond 256', async () => {
  const query = vi.fn(async (_server: string, ids: string[]) =>
    ids.map((puuid) => ({ puuid, profileIconId: 1 }))
  )
  const service = new CurrentProfileIcons({ session: () => 'SYNTHETIC', ready: () => true, query })
  await service.resolve(
    Array.from({ length: 257 }, (_, i) => row('SYNTHETIC_' + i)),
    () => {}
  )
  const calls = query.mock.calls.length
  await service.resolve([row('SYNTHETIC_0')], () => {})
  expect(query).toHaveBeenCalledTimes(calls + 1)
  service.dispose()
})
