import { expect, test, vi } from 'vitest'

import { CurrentProfileIcons } from './current-profile-icons'
import { PublishedIdentitiesLoader } from './published-identities-loader'
import type { PublishedIdentityGame } from './published-identities-source'
import type { MemberAnalysisRepository } from './repository'

function fixture() {
  let token = 'A'.repeat(32)
  const members = [{ serverId: 'TEST', gameName: 'SYNTHETIC_TEST_ONLY', tagLine: 'TAG' }]
  let identity = { puuid: 'PRIVATE_SYNTHETIC_TEST_ONLY', resolvedAt: '2026-01-01T00:00:00Z' }
  const repository = {
    dataRoot: 'C:/SYNTHETIC_TEST_ONLY',
    publicationToken: () => token,

    resolveConfiguredMembers: vi.fn((members: unknown[]) => members.map(() => identity)),
    readPublishedIdentityRows: vi.fn(() => [
      { server_id: 'TEST', game_id: 1, checksum: 'x', payload_json: '{}', ambiguous: 1 }
    ]),
    publishedIdentityCursor: () => 'cursor-private'
  } as unknown as MemberAnalysisRepository
  let finish!: (value: PublishedIdentityGame[]) => void
  const execute = vi.fn(
    (_batch: unknown, _current: () => void) =>
      new Promise<PublishedIdentityGame[]>((resolve) => {
        finish = resolve
      })
  )
  const dispose = vi.fn(async () => {})
  const loader = new PublishedIdentitiesLoader(repository, () => members, { execute, dispose })
  const request = { publicationToken: token, memberSlots: [1], pageSize: 25, cursor: null }
  return {
    loader,
    repository,
    request,
    members,
    execute,
    dispose,
    complete: (
      games: PublishedIdentityGame[] = [{ gameId: 1, status: 'identity-unavailable', members: [] }]
    ) => finish(games),
    changeToken: () => (token = 'B'.repeat(32)),

    changeIdentity: () => (identity = { ...identity, puuid: 'CHANGED_TEST_ONLY' })
  }
}
test('worker batch is bounded and receives only configured main-owned root/identity, public result is redacted', async () => {
  const f = fixture()
  const pending = f.loader.read(f.request)
  expect(f.execute.mock.calls[0][0]).toMatchObject({
    dataRoot: 'C:/SYNTHETIC_TEST_ONLY',
    members: [{ slot: 1, serverId: 'TEST', puuid: 'PRIVATE_SYNTHETIC_TEST_ONLY' }]
  })
  f.complete()
  const page = await pending
  expect(page.games).toHaveLength(1)
  expect(JSON.stringify(page)).not.toContain('PRIVATE_SYNTHETIC')
  await f.loader.dispose()
  expect(f.dispose).toHaveBeenCalledTimes(1)
})
test.each(['publication', 'configuration', 'identity'])(
  'inflight %s change rejects worker result instead of returning old scope',
  async (kind) => {
    const f = fixture()
    const pending = f.loader.read(f.request)
    if (kind === 'publication') f.changeToken()
    else if (kind === 'configuration') f.members[0] = { ...f.members[0], tagLine: 'CHANGED' }
    else f.changeIdentity()
    expect(() => f.execute.mock.calls[0][1]()).toThrow('Stale published identities request')
    f.complete()
    await expect(pending).rejects.toThrow('Stale published identities request')
    await f.loader.dispose()
  }
)

test('overview profile projection caches each game once per publication, excludes ambiguous IDs, never crosses a changed token', async () => {
  let token = 'A'.repeat(32)
  const rows = vi.fn((ids: number[]) =>
    ids.map((id) => ({
      server_id: 'TEST',
      game_id: id,
      checksum: 'x',
      payload_json: '{}',
      ambiguous: id === 2 ? 2 : 1
    }))
  )
  let finish: ((value: PublishedIdentityGame[]) => void) | undefined
  const execute = vi.fn(async (batch: any) => {
    if (finish === undefined)
      return batch.tasks.map((task: any) => ({
        gameId: task.gameId,
        status: 'available',
        members: [],
        profiles: [{ player: 'SYNTHETIC_OLD#TESTONLY', identity: 'a'.repeat(64), profileIconId: 0 }]
      }))
    return new Promise<PublishedIdentityGame[]>((resolve) => {
      finish = resolve
    })
  })
  const repository = {
    dataRoot: 'TEST',
    publicationToken: () => token,

    readPublishedProfileRows: rows
  } as unknown as MemberAnalysisRepository
  const loader = new PublishedIdentitiesLoader(repository, () => [], { execute })
  const games = [
    { gameId: 1, players: [{ player: 'SYNTHETIC_OLD#TESTONLY' }] },
    { gameId: 2, players: [{ player: 'SYNTHETIC_SAME#TESTONLY' }] }
  ] as any
  expect((await loader.enrichProfiles(games, token))[0].players[0].profileIconId).toBe(0)
  expect((await loader.enrichProfiles(games, token))[1].players[0].profileIconId).toBeNull()
  expect(rows).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(1)
  token = 'B'.repeat(32)
  await loader.enrichProfiles(games, token)
  expect(rows).toHaveBeenCalledTimes(2)
  await expect(loader.enrichProfiles(games, 'A'.repeat(32))).rejects.toThrow('Stale')
  finish = () => {}
  token = 'C'.repeat(32)
  const pending = loader.enrichProfiles(games, token)
  token = 'D'.repeat(32)
  finish!([
    {
      gameId: 1,
      status: 'available',
      members: [],
      profiles: [{ player: 'SYNTHETIC_OLD#TESTONLY', identity: 'c'.repeat(64), profileIconId: 88 }]
    }
  ])
  await expect(pending).rejects.toThrow('Stale')
  await loader.dispose()
})

test('operational failure retries in the same publication and an old failing request cannot erase new proof', async () => {
  let token = 'A'.repeat(32),
    rejectOld: ((error: Error) => void) | undefined
  const game = [{ gameId: 1, players: [{ player: 'SYNTHETIC_OLD#TESTONLY' }] }] as any
  const rows = vi.fn(() => [
    { server_id: 'TEST', game_id: 1, checksum: 'x', payload_json: '{}', ambiguous: 1 }
  ])
  const proof = [
    {
      gameId: 1,
      status: 'available' as const,
      members: [],
      profiles: [{ player: 'SYNTHETIC_OLD#TESTONLY', identity: 'a'.repeat(64), profileIconId: 0 }]
    }
  ]
  const execute = vi
    .fn()
    .mockRejectedValueOnce(Error('temporary worker timeout'))
    .mockResolvedValueOnce(proof)
  const loader = new PublishedIdentitiesLoader(
    {
      dataRoot: 'TEST',
      publicationToken: () => token,

      readPublishedProfileRows: rows
    } as unknown as MemberAnalysisRepository,
    () => [],
    { execute }
  )
  await expect(loader.enrichProfiles(game, token)).rejects.toThrow('temporary')
  expect((await loader.enrichProfiles(game, token))[0].players[0].profileIconId).toBe(0)
  await loader.enrichProfiles(game, token)
  expect(execute).toHaveBeenCalledTimes(2)
  token = 'B'.repeat(32)
  execute
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        })
    )
    .mockResolvedValueOnce(proof)
  const old = loader.enrichProfiles(game, token)
  const rejected = expect(old).rejects.toThrow('old worker failed')
  token = 'C'.repeat(32)
  await loader.enrichProfiles(game, token)
  rejectOld!(Error('old worker failed'))
  await rejected
  await loader.enrichProfiles(game, token)
  expect(execute).toHaveBeenCalledTimes(4)
  await loader.dispose()
  await expect(loader.enrichProfiles(game, token)).rejects.toThrow('Stale')
})

test('online exact lookup overrides cached icon without leaking private PUUIDs or depending on configured slot order', async () => {
  let now = 0
  const query = vi.fn(async (_server: string, ids: string[]) =>
    ids.map((puuid) => ({ puuid, profileIconId: now ? 19 : 0 }))
  )
  const online = new CurrentProfileIcons(
    { session: () => 'SYNTHETIC_SESSION', ready: () => true, query },
    () => now
  )
  const rows = vi.fn(() => [
    { server_id: 'TEST', game_id: 1, checksum: 'x', payload_json: '{}', ambiguous: 1 }
  ])
  const members = [
    { serverId: 'TEST', gameName: 'SYNTHETIC_A', tagLine: 'TESTONLY' },
    { serverId: 'TEST', gameName: 'SYNTHETIC_B', tagLine: 'TESTONLY' }
  ]
  const execute = vi.fn(async () => [
    {
      gameId: 1,
      status: 'available' as const,
      members: [],
      profiles: [{ player: 'SYNTHETIC_A#TESTONLY', identity: 'a'.repeat(64), profileIconId: 7 }],

      lookups: [{ identity: 'a'.repeat(64), serverId: 'TEST', puuid: 'PRIVATE_SYNTHETIC_PUUID' }]
    }
  ])
  const loader = new PublishedIdentitiesLoader(
    {
      dataRoot: 'TEST',
      publicationToken: () => 'A'.repeat(32),

      readPublishedProfileRows: rows
    } as unknown as MemberAnalysisRepository,
    () => members,
    { execute },
    online
  )
  const games = [{ gameId: 1, players: [{ player: 'SYNTHETIC_A#TESTONLY' }] }] as any
  const first = await loader.enrichProfiles(games, 'A'.repeat(32))
  expect(first[0].players[0].profileIconId).toBe(0)
  expect(JSON.stringify(first)).not.toContain('PRIVATE_SYNTHETIC_PUUID')
  expect(JSON.stringify(first)).not.toContain('lookups')
  members.reverse()
  now = 300001
  expect((await loader.enrichProfiles(games, 'A'.repeat(32)))[0].players[0].profileIconId).toBe(19)
  expect(rows).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledTimes(1)
  query.mockRejectedValue(Error('offline'))
  now = 600002
  expect((await loader.enrichProfiles(games, 'A'.repeat(32)))[0].players[0].profileIconId).toBe(7)
  online.dispose()
  await loader.dispose()
})

test('overlapping fifty-game overview requests reuse already scheduled later batches instead of rereading raw', async () => {
  const rows = vi.fn((ids: number[]) =>
    ids.map((game_id) => ({
      server_id: 'TEST',
      game_id,
      checksum: 'x',
      payload_json: '{}',
      ambiguous: 1
    }))
  )
  const finish: (() => void)[] = []
  const execute = vi.fn(
    (batch: any) =>
      new Promise<PublishedIdentityGame[]>((resolve) =>
        finish.push(() =>
          resolve(
            batch.tasks.map((task: any) => ({
              gameId: task.gameId,
              status: 'identity-unavailable',
              members: []
            }))
          )
        )
      )
  )
  const loader = new PublishedIdentitiesLoader(
    {
      dataRoot: 'TEST',
      publicationToken: () => 'A'.repeat(32),

      readPublishedProfileRows: rows
    } as unknown as MemberAnalysisRepository,
    () => [],
    { execute }
  )
  const games = Array.from({ length: 50 }, (_, i) => ({
    gameId: i + 1,
    players: [{ player: 'SYNTHETIC_A#TESTONLY' }]
  })) as any
  const a = loader.enrichProfiles(games, 'A'.repeat(32)),
    b = loader.enrichProfiles(games, 'A'.repeat(32))
  expect(execute).toHaveBeenCalledTimes(2)
  finish[1]()
  await Promise.resolve()
  finish[0]()
  await Promise.all([a, b])
  expect(execute).toHaveBeenCalledTimes(2)
  expect(rows).toHaveBeenCalledTimes(2)
  await loader.dispose()
})

test('public identity response strips private worker-only lookups before strict DTO validation', async () => {
  const f = fixture(),
    pending = f.loader.read(f.request)
  const calls = f.execute.mock.calls
  // Complete through the fixture's real deferred worker result.
  f.complete([
    {
      gameId: 1,
      status: 'available',
      members: [],

      lookups: [{ identity: 'a'.repeat(64), serverId: 'TEST', puuid: 'PRIVATE_SYNTHETIC_PUUID' }]
    }
  ])
  const page = await pending
  expect(JSON.stringify(page)).not.toContain('lookups')

  expect(JSON.stringify(page)).not.toContain('PRIVATE_SYNTHETIC')
  expect(calls[0][0]).not.toHaveProperty('profileToken')
  await f.loader.dispose()
})

test('identity pages never reuse overview availability and retry unavailable raw on the next read', async () => {
  const f = fixture()
  const proof = [
    {
      gameId: 1,
      status: 'available' as const,
      members: [],
      profiles: [{ player: 'SYNTHETIC_OLD#TESTONLY', identity: 'a'.repeat(64), profileIconId: 0 }]
    }
  ]
  // Existing overview-only cache is deliberately not an identity-page cache.
  const repo = f.repository
  repo.readPublishedProfileRows = () => [
    { server_id: 'TEST', game_id: 1, checksum: 'x', payload_json: '{}', ambiguous: 1 }
  ]
  const overview = f.loader.enrichProfiles(
    [{ gameId: 1, players: [{ player: 'SYNTHETIC_OLD#TESTONLY' }] }] as any,
    f.request.publicationToken
  )
  f.complete(proof)
  await overview
  for (let i = 0; i < 2; i++) {
    const pending = f.loader.read(f.request)
    expect(f.execute).toHaveBeenCalledTimes(i + 2)
    f.complete([{ gameId: 1, status: 'raw-missing', members: [] }])
    expect((await pending).games[0]).toEqual({ gameId: 1, status: 'raw-missing', members: [] })
  }
  await f.loader.dispose()
})

test('disposal while an identity page is pending rejects the final worker reply', async () => {
  const f = fixture()
  const pending = f.loader.read(f.request)
  const rejected = expect(pending).rejects.toThrow('Stale published identities request')
  await f.loader.dispose()
  f.complete()
  await rejected
})

test('each identity guard freshly resolves the entire configured roster without calling the old per-member API', async () => {
  const f = fixture()
  const resolver = vi.mocked(f.repository.resolveConfiguredMembers)
  const old = vi.fn(() => {
    throw new Error('single resolver must not be used')
  })
  f.repository.resolveConfiguredMember = old
  const pending = f.loader.read(f.request)
  const firstCount = resolver.mock.calls.length
  expect(firstCount).toBeGreaterThan(0)
  expect(resolver.mock.calls.every(([members]) => members === f.members)).toBe(true)
  for (let i = 0; i < 25; i++) f.execute.mock.calls[0][1]()
  expect(resolver).toHaveBeenCalledTimes(firstCount + 25)
  f.complete()
  const page = await pending
  expect(resolver.mock.calls.length).toBeGreaterThan(firstCount + 25)
  expect(old).not.toHaveBeenCalled()
  expect(JSON.stringify(page)).not.toContain('PRIVATE_SYNTHETIC')
  await f.loader.dispose()
})
