import {
  type OpponentRanks,
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { matchDetailRanks } from '../match-detail-ranks'
import { OpponentRankRepository } from './repository'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
function path() {
  const root = mkdtempSync(join(tmpdir(), 'akari-synthetic-ranks-'))
  roots.push(root)
  return join(root, 'ranks.sqlite3')
}
const ranks = (): OpponentRanks => ({
  version: 1,
  source: 'SGP leagues-ledge (current snapshot)',
  serverId: 'TEST',
  opponents: Array.from({ length: 5 }, (_, i) => ({
    slot: i + 1,
    role: null,
    champion: null,
    snapshot: unavailableRank('auth-unavailable', '2026-10-07T12:00:00.000Z')
  }))
})

describe('isolated versioned rank cache', () => {
  test.each(['absent', 'null', 'conflicted', 'verified'] as const)(
    'reads old %s version annotations without changing archived rank facts or database schema',
    (kind) => {
      const file = path(),
        repo = new OpponentRankRepository(file)
      repo.initialize()
      const first = normalizeRankedStats(
        { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV', leaguePoints: 0 }] },
        '2026-10-07T12:00:00.000Z'
      )
      const second = normalizeRankedStats(
        { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV' }] },
        '2026-10-07T13:00:00.000Z'
      )
      const identities = Array.from({ length: 5 }, (_, index) => `synthetic-legacy-${index}`)
      repo.writePlayer('TEST', identities[0], first)
      repo.writePlayer('TEST', identities[0], second)
      const game = {
        ...ranks(),
        opponents: ranks().opponents.map((opponent) => ({ ...opponent, snapshot: second }))
      }
      repo.publishGames([{ serverId: 'TEST', gameId: 123, ranks: game, identities }])
      repo.close()
      const legacy =
        kind === 'conflicted'
          ? { status: 'conflicted' }
          : kind === 'verified'
            ? {
                status: 'verified',
                source: 'sgp-match-summary',
                scope: 'query-during-verified-match',
                serverId: 'TEST',
                gameId: 123,
                gameVersion: '26.1.2',
                gameStartTimestamp: Date.parse('2026-10-07T11:59:00.000Z'),
                gameEndTimestamp: Date.parse('2026-10-07T13:30:00.000Z'),
                observedAt: '2026-10-07T11:59:30.000Z',
                verifiedAt: '2026-10-07T14:00:00.000Z',
                sourceFingerprint: 'a'.repeat(64)
              }
            : null
      const decorate = (snapshot: object) =>
        kind === 'absent' ? snapshot : { ...snapshot, versionEvidence: legacy }
      const tables = [
        'player_cache',
        'player_observations',
        'game_players',
        'game_snapshots',
        'game_observations'
      ] as const
      const db = new DatabaseSync(file)
      try {
        for (const table of tables) {
          const rows = db.prepare(`SELECT rowid AS id,payload_json FROM ${table}`).all() as {
            id: number
            payload_json: string
          }[]
          for (const row of rows) {
            const input = JSON.parse(row.payload_json)
            const payload = JSON.stringify(
              table.startsWith('game_') && table !== 'game_players'
                ? {
                    ...input,
                    opponents: input.opponents.map(
                      (opponent: OpponentRanks['opponents'][number]) => ({
                        ...opponent,
                        snapshot: decorate(opponent.snapshot)
                      })
                    )
                  }
                : decorate(input)
            )
            if (table === 'game_observations')
              db.prepare(
                'UPDATE game_observations SET payload_json=?,content_hash=? WHERE rowid=?'
              ).run(payload, createHash('sha256').update(payload).digest('hex'), row.id)
            else db.prepare(`UPDATE ${table} SET payload_json=? WHERE rowid=?`).run(payload, row.id)
          }
        }
        const before = tables.map((table) =>
          db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
        )
        repo.initialize()
        expect(repo.readPlayer('TEST', identities[0])).toEqual(second)
        expect(repo.readPlayerHistory('TEST', identities[0])).toEqual([first, second])
        expect(repo.readGame('TEST', 123)).toEqual(game)
        expect(repo.readGameHistory('TEST', 123)).toEqual([game])
        expect(repo.readGamePlayer('TEST', 123, identities[0])).toEqual(second)
        expect([...repo.readGamePlayers('TEST', 123, identities).values()]).toEqual(
          identities.map(() => ({ snapshot: second, capturedDuringGame: false }))
        )
        const page = repo.readPlayerHistoryPage(
          'TEST',
          identities[0],
          'flex',
          1,
          null,
          'configured'
        )
        expect(page.points).toEqual([{ fetchedAt: second.fetchedAt, queueRank: second.flex }])
        const older = repo.readPlayerHistoryPage(
          'TEST',
          identities[0],
          'flex',
          1,
          page.pagination.nextCursor,
          'configured'
        )
        expect(older.points).toEqual([{ fetchedAt: first.fetchedAt, queueRank: first.flex }])
        expect(older.pagination.nextCursor).toBeNull()
        expect(
          tables.map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
        ).toEqual(before)
        expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 })
        const incoming = { ...second, versionEvidence: legacy }
        repo.writePlayer('TEST', 'synthetic-new-query', incoming)
        expect(repo.readPlayer('TEST', 'synthetic-new-query')).toEqual(second)
        expect(
          repo.readPlayerHistoryPage('TEST', 'synthetic-new-query', 'flex', 100, null, 'configured')
            .points
        ).toEqual([{ fetchedAt: second.fetchedAt, queueRank: second.flex }])
        const keys = db.prepare('SELECT payload_json FROM player_cache').all() as {
          payload_json: string
        }[]
        expect(
          keys.filter((row) => !Object.hasOwn(JSON.parse(row.payload_json), 'versionEvidence'))
        ).toHaveLength(kind === 'absent' ? 2 : 1)
      } finally {
        repo.close()
        db.close()
      }
    }
  )
  test('persists snapshots and private hashed cache identities across restarts, without mixing servers', () => {
    const file = path(),
      repo = new OpponentRankRepository(file)
    repo.initialize()
    const value = ranks()
    repo.writePlayer('TEST', 'synthetic-private-identity', value.opponents[0].snapshot)
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: value }])
    repo.close()
    const restored = new OpponentRankRepository(file)
    restored.initialize()
    expect(restored.readPlayer('test', 'synthetic-private-identity')).toEqual(
      value.opponents[0].snapshot
    )
    expect(restored.readPlayer('OTHER', 'synthetic-private-identity')).toBeNull()
    expect(restored.readGame('TEST', 9)).toEqual(value)
    expect(restored.readGame('OTHER', 9)).toBeUndefined()
    const db = new DatabaseSync(file)
    expect(JSON.stringify(db.prepare('SELECT * FROM player_cache').all())).not.toContain(
      'synthetic-private-identity'
    )
    db.close()
    restored.close()
  })
  test('validates complete batches before publication and tolerates a corrupt disposable payload as unavailable', () => {
    const file = path(),
      repo = new OpponentRankRepository(file)
    repo.initialize()
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: ranks() }])
    const invalid = ranks()
    invalid.opponents.pop()
    expect(() =>
      repo.publishGames([
        { serverId: 'TEST', gameId: 8, ranks: ranks() },
        { serverId: 'TEST', gameId: 9, ranks: invalid }
      ])
    ).toThrow()
    expect(repo.readGame('TEST', 8)).toBeUndefined()
    expect(repo.readGame('TEST', 9)?.opponents).toHaveLength(5)
    const db = new DatabaseSync(file)
    db.prepare("UPDATE game_snapshots SET payload_json='damaged' WHERE game_id=9").run()
    expect(repo.readGame('TEST', 9)).toBeUndefined()
    db.close()
    repo.close()
  })
  test('keeps timestamped successful observations across refresh failures, cache pruning and restart', () => {
    const file = path(),
      repo = new OpponentRankRepository(file)
    repo.initialize()
    const first = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'IV' }] },
      '2026-01-01T00:00:00.000Z'
    )
    const second = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV' }] },
      '2026-02-01T00:00:00.000Z'
    )
    repo.writePlayer('TEST', 'synthetic-history', first)
    repo.writePlayer('TEST', 'synthetic-history', first)
    repo.writePlayer('TEST', 'synthetic-history', second)
    repo.writePlayer(
      'TEST',
      'synthetic-history',
      unavailableRank('network-error', '2026-02-02T00:00:00.000Z')
    )
    const value = ranks()
    value.opponents[0].snapshot = first
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: value }])
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: value }])
    value.opponents[0].snapshot = second
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: value }])
    repo.prune()
    repo.close()
    const restored = new OpponentRankRepository(file)
    restored.initialize()
    expect(restored.readPlayer('TEST', 'synthetic-history')).toBeNull()
    expect(restored.readPlayerHistory('TEST', 'synthetic-history')).toEqual([first, second])
    expect(restored.readPlayerHistory('OTHER', 'synthetic-history')).toEqual([])
    expect(restored.readGameHistory('TEST', 9).map((v) => v.opponents[0].snapshot)).toEqual([
      first,
      second
    ])
    restored.close()
  })
  test('migrates version 1 without losing existing facts or their query times', () => {
    const file = path(),
      legacy = new DatabaseSync(file)
    const value = ranks()
    value.opponents[0].snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II' }] },
      '2026-10-01T00:00:00.000Z'
    )
    legacy.exec(
      'CREATE TABLE player_cache(key TEXT PRIMARY KEY, attempted_at TEXT NOT NULL, payload_json TEXT NOT NULL); CREATE TABLE game_snapshots(server_id TEXT NOT NULL, game_id INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(server_id,game_id)); PRAGMA user_version=1;'
    )
    legacy.prepare('INSERT INTO game_snapshots VALUES(?,?,?)').run('TEST', 9, JSON.stringify(value))
    legacy
      .prepare('INSERT INTO player_cache VALUES(?,?,?)')
      .run(
        createHash('sha256').update('TEST:synthetic-migration').digest('hex'),
        value.opponents[0].snapshot.attemptedAt,
        JSON.stringify(value.opponents[0].snapshot)
      )
    legacy.close()
    const repo = new OpponentRankRepository(file)
    repo.initialize()
    expect(repo.readGame('TEST', 9)).toEqual(value)
    expect(repo.readPlayerHistory('TEST', 'synthetic-migration')).toEqual([
      value.opponents[0].snapshot
    ])
    expect(repo.readGameHistory('TEST', 9)).toEqual([value])
    repo.close()
    repo.initialize()
    expect(repo.readGameHistory('TEST', 9)).toEqual([value])
    repo.close()
    const check = new DatabaseSync(file)
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 })
    check.close()
  })
  test('latest game publication and history roll back together on an archive write failure', () => {
    const file = path(),
      repo = new OpponentRankRepository(file)
    repo.initialize()
    const before = ranks()
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: before }])
    const db = new DatabaseSync(file)
    db.exec(
      "CREATE TRIGGER synthetic_archive_failure BEFORE INSERT ON game_observations BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;"
    )
    const next = ranks()
    next.opponents[0].snapshot = unavailableRank('network-error', '2026-10-07T13:00:00.000Z')
    expect(() =>
      repo.publishGames([
        { serverId: 'TEST', gameId: 8, ranks: next },
        { serverId: 'TEST', gameId: 9, ranks: next }
      ])
    ).toThrow('synthetic failure')
    expect(repo.readGame('TEST', 8)).toBeUndefined()
    expect(repo.readGame('TEST', 9)).toEqual(before)
    expect(repo.readGameHistory('TEST', 9)).toEqual([before])
    db.close()
    repo.close()
  })
  test('upgrades version 2 with identity mapping while preserving existing query history', () => {
    const file = path(),
      repo = new OpponentRankRepository(file)
    repo.initialize()
    repo.publishGames([{ serverId: 'TEST', gameId: 9, ranks: ranks() }])
    repo.close()
    const legacy = new DatabaseSync(file)
    legacy.exec('DROP TABLE game_players; PRAGMA user_version=2')
    legacy.close()
    repo.initialize()
    expect(repo.readGameHistory('TEST', 9)).toHaveLength(1)
    expect(repo.readGamePlayer('TEST', 9, 'synthetic-absent')).toBeNull()
    repo.close()
    const check = new DatabaseSync(file)
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 4 })
    check.close()
  })
  test('refuses future versions without modifying them', () => {
    const file = path(),
      db = new DatabaseSync(file)
    db.exec('PRAGMA user_version=99')
    db.close()
    expect(() => new OpponentRankRepository(file).initialize()).toThrow(
      'Unsupported opponent rank cache version'
    )
    const check = new DatabaseSync(file)
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 99 })
    check.close()
  })
})

test('ten-player manual backfill adds own game facts without overwriting prior live enemies', () => {
  const repo = new OpponentRankRepository(path())
  repo.initialize()
  try {
    const participants = Array.from({ length: 10 }, (_, index) => ({
      puuid: `synthetic-ten-${index}`,
      role: null,
      champion: null
    }))
    const target = { serverId: 'TEST', gameId: 99, participants, opponents: participants.slice(5) }
    const before = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II', leaguePoints: 0 }] },
      '2026-10-13T12:00:05.000Z'
    )
    const live = {
      ...ranks(),
      capture: {
        mode: 'live' as const,
        observedAt: '2026-10-13T12:00:00.000Z',
        phase: 'InProgress' as const
      },
      opponents: ranks().opponents.map((entry) => ({ ...entry, snapshot: before }))
    }
    repo.publishLiveGame(target, live) // previously released five-opponent capture
    const after = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II', leaguePoints: 25 }] },
      '2026-10-13T13:00:00.000Z'
    )
    repo.publishGames([
      {
        serverId: 'TEST',
        gameId: 99,
        ranks: {
          ...ranks(),
          opponents: ranks().opponents.map((entry) => ({ ...entry, snapshot: after }))
        },
        identities: participants.slice(5).map((p) => p.puuid),
        playerSnapshots: participants.map((p) => ({
          puuid: p.puuid,
          snapshot: after,
          capturedDuringGame: false
        }))
      }
    ])
    expect(repo.readGame('TEST', 99)?.capture).toEqual(live.capture)
    expect(
      repo.readGame('TEST', 99)?.opponents.every((p) => p.snapshot.fetchedAt === before.fetchedAt)
    ).toBe(true)
    for (const p of participants.slice(0, 5)) {
      expect(repo.readGamePlayer('TEST', 99, p.puuid)).toEqual(after)
      expect(repo.wasGamePlayerCapturedLive('TEST', 99, p.puuid)).toBe(false)
    }
    for (const p of participants.slice(5)) {
      expect(repo.readGamePlayer('TEST', 99, p.puuid)).toEqual(before)
      expect(repo.wasGamePlayerCapturedLive('TEST', 99, p.puuid)).toBe(true)
    }
    expect(JSON.stringify(repo.readGame('TEST', 99))).not.toContain('synthetic-ten')
  } finally {
    repo.close()
  }
})
test('ten-player live publication persists all exact identities, preserves nullable LP, and rejects mismatch atomically', () => {
  const repo = new OpponentRankRepository(path())
  repo.initialize()
  try {
    const participants = Array.from({ length: 10 }, (_, index) => ({
      puuid: `synthetic-full-${index}`,
      role: null,
      champion: null
    }))
    const target = { serverId: 'TEST', gameId: 100, participants, opponents: participants.slice(5) }
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II' }] },
      '2026-10-13T12:00:05.000Z'
    )
    const live = {
      ...ranks(),
      capture: {
        mode: 'live' as const,
        observedAt: '2026-10-13T12:00:00.000Z',
        phase: 'InProgress' as const
      },
      opponents: ranks().opponents.map((entry) => ({ ...entry, snapshot }))
    }
    const playerSnapshots = participants.map((p) => ({
      puuid: p.puuid,
      snapshot,
      capturedDuringGame: false
    }))
    repo.publishLiveGame(target, live, playerSnapshots)
    for (const p of participants) {
      expect(repo.readGamePlayer('TEST', 100, p.puuid)).toEqual(snapshot)
      expect(repo.wasGamePlayerCapturedLive('TEST', 100, p.puuid)).toBe(true)
    }
    expect(snapshot.flex.status === 'ranked' && snapshot.flex.rank.leaguePoints).toBeNull()
    const invalid = playerSnapshots.map((p) => ({ ...p }))
    invalid[0].puuid = 'synthetic-unrelated'
    expect(() => repo.publishLiveGame(target, live, invalid)).toThrow()
    expect(repo.readGamePlayer('TEST', 100, 'synthetic-unrelated')).toBeNull()
    expect(repo.readGame('TEST', 100)?.opponents).toHaveLength(5)
  } finally {
    repo.close()
  }
})

test('rank history pages newest-first, freeze append upper bound, preserve raw LP and deduplicate exact time', () => {
  const repo = new OpponentRankRepository(path())
  repo.initialize()
  try {
    const observed = (time: string, lp: number | null) =>
      normalizeRankedStats(
        {
          queues: [
            {
              queueType: 'RANKED_SOLO_5x5',
              tier: 'MASTER',
              ...(lp === null ? {} : { leaguePoints: lp })
            }
          ]
        },
        time
      )
    for (const [time, lp] of [
      ['2026-10-13T12:00:00.000Z', 0],
      ['2026-10-13T12:01:00.000Z', null],
      ['2026-10-13T12:02:00.000Z', 321]
    ] as const)
      repo.writePlayer('TEST', 'synthetic-history', observed(time, lp))
    repo.writePlayer('TEST', 'synthetic-history', observed('2026-10-13T12:02:00.000Z', 321))
    repo.writePlayer('OTHER', 'synthetic-history', observed('2026-10-13T13:00:00.000Z', 999))
    const first = repo.readPlayerHistoryPage(
      'TEST',
      'synthetic-history',
      'solo',
      1,
      null,
      'configuration-A'
    )
    expect(first.points[0]).toMatchObject({
      fetchedAt: '2026-10-13T12:02:00.000Z',
      queueRank: { status: 'ranked', rank: { tier: 'MASTER', leaguePoints: 321 } }
    })
    expect(first.pagination.nextCursor).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(first.pagination.nextCursor).not.toContain('synthetic-history')
    repo.writePlayer('TEST', 'synthetic-history', observed('2026-10-13T12:01:30.000Z', 777)) // inserted after first page, older time
    const second = repo.readPlayerHistoryPage(
      'TEST',
      'synthetic-history',
      'solo',
      1,
      first.pagination.nextCursor,
      'configuration-A'
    )
    expect(second.points[0]).toMatchObject({
      fetchedAt: '2026-10-13T12:01:00.000Z',
      queueRank: { status: 'ranked', rank: { leaguePoints: null } }
    })
    const last = repo.readPlayerHistoryPage(
      'TEST',
      'synthetic-history',
      'solo',
      1,
      second.pagination.nextCursor,
      'configuration-A'
    )
    expect(last.points[0]).toMatchObject({
      queueRank: { status: 'ranked', rank: { leaguePoints: 0 } }
    })
    expect(last.pagination.nextCursor).toBeNull()
    expect(
      repo.readPlayerHistoryPage(
        'TEST',
        'synthetic-history',
        'solo',
        1,
        first.pagination.nextCursor,
        'configuration-A'
      ).points
    ).toEqual(second.points)
  } finally {
    repo.close()
  }
})
test('rank history opaque cursors reject forgery, scope/identity/queue changes, expiry and restart', () => {
  const repo = new OpponentRankRepository(path())
  repo.initialize()
  try {
    for (const time of ['2026-10-13T12:00:00.000Z', '2026-10-13T12:01:00.000Z'])
      repo.writePlayer('TEST', 'synthetic-history', normalizeRankedStats({ queues: [] }, time))
    const token = repo.readPlayerHistoryPage('TEST', 'synthetic-history', 'solo', 1, null, 'A')
      .pagination.nextCursor!
    for (const [server, puuid, queue, scope, cursor] of [
      ['OTHER', 'synthetic-history', 'solo', 'A', token],
      ['TEST', 'synthetic-other', 'solo', 'A', token],
      ['TEST', 'synthetic-history', 'flex', 'A', token],
      ['TEST', 'synthetic-history', 'solo', 'B', token],
      ['TEST', 'synthetic-history', 'solo', 'A', 'A'.repeat(32)]
    ] as const)
      expect(() => repo.readPlayerHistoryPage(server, puuid, queue, 1, cursor, scope)).toThrow(
        'Invalid rank history cursor'
      )
    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 31 * 60_000)
    expect(() =>
      repo.readPlayerHistoryPage('TEST', 'synthetic-history', 'solo', 1, token, 'A')
    ).toThrow('Invalid rank history cursor')
    vi.useRealTimers()
    const restartedToken = repo.readPlayerHistoryPage(
      'TEST',
      'synthetic-history',
      'solo',
      1,
      null,
      'A'
    ).pagination.nextCursor!
    repo.close()
    repo.initialize()
    expect(() =>
      repo.readPlayerHistoryPage('TEST', 'synthetic-history', 'solo', 1, restartedToken, 'A')
    ).toThrow('Invalid rank history cursor')
  } finally {
    vi.useRealTimers()
    repo.close()
  }
})

describe('rank publication receipt and write ownership', () => {
  test('commits a receipt atomically and repeats only the identical publication payload', () => {
    const repo = new OpponentRankRepository(path())
    repo.initialize()
    try {
      const publicationId = randomUUID()
      const games = [{ serverId: 'TEST', gameId: 99, ranks: ranks() }]
      repo.publishGames(games, publicationId)
      expect(repo.publicationReceipt(publicationId)).toMatch(/^[0-9a-f]{64}$/)
      const before = repo.readGameHistory('TEST', 99)
      repo.publishGames(games, publicationId)
      expect(repo.readGameHistory('TEST', 99)).toEqual(before)
      expect(() => repo.publishGames([{ ...games[0], gameId: 100 }], publicationId)).toThrow(
        'payload changed'
      )
      expect(repo.readGame('TEST', 100)).toBeUndefined()
    } finally {
      repo.close()
    }
  })

  test('an invalid game rolls all rank facts and its receipt back', () => {
    const repo = new OpponentRankRepository(path())
    repo.initialize()
    try {
      const publicationId = randomUUID()
      expect(() =>
        repo.publishGames(
          [
            { serverId: 'TEST', gameId: 1, ranks: ranks() },
            { serverId: 'OTHER', gameId: 2, ranks: ranks() }
          ],
          publicationId
        )
      ).toThrow('Invalid rank game region')
      expect(repo.publicationReceipt(publicationId)).toBeNull()
      expect(repo.readGame('TEST', 1)).toBeUndefined()
      expect(repo.readGameHistory('TEST', 1)).toEqual([])
    } finally {
      repo.close()
    }
  })

  test('all direct writers refuse worker ownership and cancelled queued writes do not persist', async () => {
    const repo = new OpponentRankRepository(path())
    repo.initialize()
    let release: () => void = () => {}
    let enter: () => void = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const signal = new AbortController()
    const value = ranks()
    try {
      const publication = repo.withExternalPublication(async () => {
        enter()
        await pending
      })
      await entered
      const queued = repo.writePlayerAsync(
        'TEST',
        'synthetic-queued',
        value.opponents[0].snapshot,
        signal.signal
      )
      const rejected = expect(queued).rejects.toThrow('synthetic cancelled')
      expect(() =>
        repo.writePlayer('TEST', 'synthetic-bypass', value.opponents[0].snapshot)
      ).toThrow('write is pending')
      expect(() => repo.publishGames([])).toThrow('write is pending')
      expect(() => repo.prune()).toThrow('write is pending')
      expect(() => repo.removeGame('TEST', 1)).toThrow('write is pending')
      signal.abort(new Error('synthetic cancelled'))
      release()
      await publication
      await rejected
      expect(repo.readPlayer('TEST', 'synthetic-queued')).toBeNull()
      await repo.pruneAsync()
    } finally {
      release()
      repo.close()
    }
  })

  test('a failed version-3 migration restores the existing database and its successful observations', () => {
    const file = path()
    const original = new OpponentRankRepository(file)
    original.initialize()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV', leaguePoints: 0 }] },
      '2026-10-14T01:00:00.000Z'
    )
    original.writePlayer('TEST', 'synthetic-migration-fact', snapshot)
    original.close()
    const legacy = new DatabaseSync(file)
    legacy.exec('DROP TABLE publication_receipts; PRAGMA user_version=3')
    legacy.close()
    const migrating = new OpponentRankRepository(file)
    const fail = vi.spyOn(migrating as any, '_archiveLegacy').mockImplementation(() => {
      throw new Error('synthetic migration interrupted')
    })
    expect(() => migrating.initialize()).toThrow('synthetic migration interrupted')
    fail.mockRestore()
    const check = new DatabaseSync(file)
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 })
    expect(check.prepare('SELECT COUNT(*) AS count FROM player_observations').get()).toMatchObject({
      count: 1
    })
    check.close()
    migrating.initialize()
    try {
      expect(migrating.readPlayerHistory('TEST', 'synthetic-migration-fact')).toEqual([snapshot])
    } finally {
      migrating.close()
    }
  })
})

describe('exact match rank batch reads', () => {
  function batchFixture() {
    const file = path(),
      repo = new OpponentRankRepository(file)
    repo.initialize()
    const start = Date.parse('2026-10-13T12:00:00.000Z')
    const summary = {
      gameId: 91,
      gameStartTimestamp: start,
      gameEndTimestamp: start + 1800000,
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        puuid: `synthetic-batch-${i}`
      })).reverse()
    }
    const value = ranks()
    value.capture = {
      mode: 'live',
      observedAt: new Date(start + 1000).toISOString(),
      phase: 'InProgress'
    }
    const snapshots = summary.participants.map((p, i) => ({
      puuid: p.puuid,
      snapshot: normalizeRankedStats(
        {
          queues: [
            { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'IV', leaguePoints: 0 },
            { queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'II', leaguePoints: 23 }
          ]
        },
        new Date(start + 2000 + i).toISOString()
      ),
      capturedDuringGame: i % 2 === 0
    }))
    repo.publishGames([{ serverId: 'TEST', gameId: 91, ranks: value, playerSnapshots: snapshots }])
    return { file, repo, summary, snapshots }
  }
  test('two actual SQL reads replace twenty-one while the complete ordered DTO equals legacy exact reads', () => {
    const { repo, summary } = batchFixture()
    const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
    try {
      const legacy = matchDetailRanks('TEST', 91, summary, {
        readGame: repo.readGame.bind(repo),
        readGamePlayers: (server, game, puuids) =>
          new Map(
            puuids.map((puuid) => [
              puuid,
              {
                snapshot: repo.readGamePlayer(server, game, puuid),
                capturedDuringGame: repo.wasGamePlayerCapturedLive(server, game, puuid)
              }
            ])
          )
      })
      expect(prepare).toHaveBeenCalledTimes(21)
      prepare.mockClear()
      const current = matchDetailRanks('TEST', 91, summary, repo)
      expect(prepare).toHaveBeenCalledTimes(2)
      expect(current).toEqual(legacy)
      expect(current?.participants.map((p) => p.participantId)).toEqual(
        summary.participants.map((p) => p.participantId)
      )
    } finally {
      prepare.mockRestore()
      repo.close()
    }
  })
  test('bad JSON/schema remain row-local, capture is strict, and server/game/missing identities never borrow', () => {
    const { repo, file, snapshots } = batchFixture()
    const db = new DatabaseSync(file)
    const key = (puuid: string) => createHash('sha256').update(`TEST:${puuid}`).digest('hex')
    try {
      db.prepare('UPDATE game_players SET payload_json=? WHERE player_key=?').run(
        'broken',
        key(snapshots[0].puuid)
      )
      db.prepare('UPDATE game_players SET payload_json=? WHERE player_key=?').run(
        '{}',
        key(snapshots[1].puuid)
      )
      db.prepare('UPDATE game_players SET during_game=2 WHERE player_key=?').run(
        key(snapshots[2].puuid)
      )
      const ids = snapshots.map((p) => p.puuid)
      const batch = repo.readGamePlayers('TEST', 91, ids)
      for (const id of ids)
        expect(batch.get(id)).toEqual({
          snapshot: repo.readGamePlayer('TEST', 91, id),
          capturedDuringGame: repo.wasGamePlayerCapturedLive('TEST', 91, id)
        })
      expect(batch.get(ids[0])?.snapshot).toBeNull()
      expect(batch.get(ids[1])?.snapshot).toBeNull()
      expect(batch.get(ids[2])?.capturedDuringGame).toBe(false)
      expect(batch.get(ids[3])?.snapshot).toEqual(snapshots[3].snapshot)
      expect(repo.readGamePlayers('OTHER', 91, ids).size).toBe(0)
      expect(repo.readGamePlayers('test', 91, ids).size).toBe(0)
      expect(repo.readGamePlayers('TEST', 92, ids).size).toBe(0)
      expect(repo.readGamePlayers('TEST', 91, ['synthetic-absent']).size).toBe(0)
      expect(repo.readGamePlayers('TEST', 91, [ids[3], ids[3]]).size).toBe(1)
      expect(repo.readGamePlayers('TEST', 91, []).size).toBe(0)
      expect(() =>
        repo.readGamePlayers(
          'TEST',
          91,
          Array.from({ length: 11 }, (_, i) => `synthetic-${i}`)
        )
      ).toThrow('Too many')
      db.exec('DROP TABLE game_players')
      expect(() => repo.readGamePlayers('TEST', 91, ids)).toThrow()
    } finally {
      db.close()
      repo.close()
    }
  })
})
