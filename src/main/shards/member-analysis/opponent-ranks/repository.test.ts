import {
  type OpponentRanks,
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'

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
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 })
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
    expect(check.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 })
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
