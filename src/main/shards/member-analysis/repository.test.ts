import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'

import { MemberAnalysisRepository } from './repository'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'member-analysis-'))
  roots.push(root)
  const value = new MemberAnalysisRepository(root)
  value.initialize()
  return value
}

function syntheticGame(gameId: number, player = 'Player Alpha') {
  return {
    gameId,
    timestamp: gameId,
    date: '2026-01-01',
    patch: '1.1',
    side: 'Blue',
    win: gameId % 2 === 0,
    duration: 1800,
    roster: player,
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    counterMean: null,
    upperGold15: 0,
    botGold15: 0,
    gold20Diff: 0,
    tower20Diff: 0,
    jungle: null,
    eventDecision: {
      killEpisodes: 0,
      convertedKillEpisodes: 0,
      killToEpicEpisodes: 0,
      killToTowerEpisodes: 0,
      conversionDelayTotalSec: 0,
      conversionDelaySamples: 0,
      deathEpisodes: 0,
      highCostDeathEpisodes: 0,
      deathCostEpics: 0,
      deathCostTowers: 0,
      deathCostPlates: 0,
      deathCostPoints: 0,
      shutdownBountyLost: 0,
      objectivesTaken: 0,
      cleanObjectives: 0,
      wonFightObjectives: 0,
      evenFightObjectives: 0,
      lostFightObjectives: 0,
      objectiveFightSamples: 0,
      objectiveFightWins: 0,
      enemyObjectives: 0,
      tradedEnemyObjectives: 0,
      tradeDelayTotalSec: 0,
      tradeDelaySamples: 0
    },
    players: [
      {
        player,
        role: 'TOP',
        champion: 'Champion A',
        minutes: 30,
        kills: 0,
        deaths: 0,
        assists: 0,
        teamKills: 0,
        teamDeaths: 0,
        damage: 0,
        damageShare: null,
        gold: 0,
        goldShare: null,
        cs: 0,
        vision: 0,
        wardsPlaced: 0,
        wardsKilled: 0,
        controlWards: 0,
        damageTaken: 0,
        takenShare: null,
        damageMitigated: 0,
        objectiveDamage: 0,
        turretDamage: 0,
        healTeammates: 0,
        shieldTeammates: 0,
        ccSeconds: 0,
        soloKills: 0,
        fbPart: false,
        ftPart: false,
        kp: null,
        gd10: null,
        gd15: null,
        csd15: null,
        xpd15: null,
        damageDiff15: null,
        soloDiff15: null,
        counter: null
      }
    ]
  }
}

function writeAnalysis(path: string, count: number) {
  const database = new DatabaseSync(path)
  database.exec(
    `CREATE TABLE derived_games(server_id TEXT NOT NULL,game_id INTEGER NOT NULL,checksum TEXT NOT NULL,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(server_id,game_id)); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO metadata VALUES('generated_at','2026-01-01T00:00:00.000Z'); INSERT INTO metadata VALUES('derivation_version','2');`
  )
  const insert = database.prepare('INSERT INTO derived_games VALUES(?,?,?,?,?)')
  database.exec('BEGIN')
  for (let gameId = 1; gameId <= count; gameId += 1)
    insert.run(
      'TEST',
      gameId,
      `checksum-${gameId}`,
      JSON.stringify(syntheticGame(gameId)),
      '2026-01-01'
    )
  database.exec('COMMIT')
  database.close()
}

describe('member analysis repository', () => {
  test('stores compressed raw data atomically and indexes by checksum', () => {
    const value = repository()
    const item = value.storeRaw(
      'TEST_1',
      7,
      420,
      'checksum-a',
      { summary: true },
      { details: true }
    )
    expect(value.knownChecksum('TEST_1', 7)).toBe('checksum-a')
    expect(readFileSync(value.safePath(item.summaryPath)).subarray(0, 2)).toEqual(
      Buffer.from([0x1f, 0x8b])
    )
    value.close()
  })

  test('publishes a valid staging database and preserves current on validation failure', () => {
    const value = repository()
    const staging = new DatabaseSync(value.stagingAnalysisPath)
    staging.exec(
      `CREATE TABLE derived_games(server_id TEXT, game_id INTEGER, payload_json TEXT); INSERT INTO derived_games VALUES('TEST',1,'{}');`
    )
    staging.close()
    expect(value.publishStaging()).toBe(1)
    const current = readFileSync(value.currentAnalysisPath)
    writeFileSync(value.stagingAnalysisPath, 'not a sqlite database')
    expect(() => value.publishStaging()).toThrow()
    expect(readFileSync(value.currentAnalysisPath)).toEqual(current)
    value.close()
  })

  test('checkpoints staging and removes stale SQLite sidecars before atomic publication', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    writeFileSync(`${value.currentAnalysisPath}-wal`, '')
    writeFileSync(`${value.currentAnalysisPath}-shm`, '')
    const staging = new DatabaseSync(value.stagingAnalysisPath)
    staging.exec(
      `PRAGMA journal_mode=WAL; CREATE TABLE derived_games(server_id TEXT,game_id INTEGER,payload_json TEXT); INSERT INTO derived_games VALUES('TEST',2,'{}');`
    )
    staging.close()
    expect(value.publishStaging()).toBe(1)
    expect(existsSync(`${value.currentAnalysisPath}-wal`)).toBe(false)
    expect(existsSync(`${value.currentAnalysisPath}-shm`)).toBe(false)
    expect(existsSync(value.stagingAnalysisPath)).toBe(false)
    value.close()
  })

  test('rejects path traversal before filesystem access', () => {
    const value = repository()
    expect(() => value.safePath('../outside')).toThrow('escapes data root')
    expect(() => value.safeSegment('..')).toThrow('invalid path segment')
    value.close()
  })

  test('uses filtered keyset pagination without returning the full database', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 10_000)
    const first = value.readGames({
      filters: {
        outcome: 'win',
        patch: '1.1',
        dateFrom: '',
        dateTo: '',
        durationMin: null,
        durationMax: null,
        participant: 'all',
        matchRole: 'all',
        champion: 'all',
        query: ''
      },
      pageSize: 37
    })
    expect(first.total).toBe(5_000)
    expect(first.games).toHaveLength(37)
    expect(first.playerCount).toBe(1)
    expect(first.nextCursor).toBeTruthy()
    const second = value.readGames({ cursor: first.nextCursor, pageSize: 37 })
    expect(second.games[0].gameId).toBeLessThan(first.games.at(-1)!.gameId)
    value.close()
  })

  test('rejects unsupported derivation instead of presenting existing data as an empty first run', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    const database = new DatabaseSync(value.currentAnalysisPath)
    database.prepare("DELETE FROM metadata WHERE key='derivation_version'").run()
    database.close()
    expect(() => value.readGames()).toThrow('Unsupported member analysis derivation version')
    value.close()
  })

  test('does not downgrade a catalog written by a newer application', () => {
    const value = repository()
    value.close()
    const database = new DatabaseSync(value.catalogPath)
    database.exec('PRAGMA user_version=99')
    database.close()
    expect(() => value.initialize()).toThrow('Unsupported member analysis catalog version')
    const reopened = new DatabaseSync(value.catalogPath, { readOnly: true })
    expect(reopened.prepare('PRAGMA user_version').get()?.user_version).toBe(99)
    reopened.close()
  })

  test('does not invent source metadata for a legacy database', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    expect(value.readGames().source).toBe('来源未知')
    value.close()
  })

  test('requires a current preview and only cleans oldest raw catalog rows', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    const publishedBefore = readFileSync(value.currentAnalysisPath)
    value.storeRaw('TEST', 1, 420, 'one', { game: 1 }, { detail: 'a'.repeat(100) })
    const stale = value.previewCleanup(10, 0)
    value.storeRaw('TEST', 2, 420, 'two', { game: 2 }, { detail: 'b'.repeat(100) })
    expect(() => value.confirmCleanup(stale.previewId, 10, 0)).toThrow('stale')
    const preview = value.previewCleanup(10, 0)
    expect(preview.gameCount).toBe(2)
    expect(preview.reclaimableBytes).toBeGreaterThan(0)
    const status = value.confirmCleanup(preview.previewId, 10, 0)
    expect(status.catalogGames).toBe(0)
    expect(readFileSync(value.currentAnalysisPath)).toEqual(publishedBefore)
    expect((value as any)._cleanupRunning).toBe(false)
    value.close()
  })

  test('rejects concurrent cleanup entry', () => {
    const value = repository()
    const preview = value.previewCleanup(10)
    ;(value as any)._cleanupRunning = true
    expect(() => value.confirmCleanup(preview.previewId, 10)).toThrow('already running')
    ;(value as any)._cleanupRunning = false
    value.close()
  })

  test('migrates a legacy analysis database with a backup-safe schema step', () => {
    const root = mkdtempSync(join(tmpdir(), 'member-analysis-migration-'))
    roots.push(root)
    const value = new MemberAnalysisRepository(root)
    mkdirSync(value.dbRoot, { recursive: true })
    writeAnalysis(value.currentAnalysisPath, 1)
    value.initialize()
    const database = new DatabaseSync(value.currentAnalysisPath, { readOnly: true })
    expect(
      (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    ).toBe(2)
    expect(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='index' AND name='idx_derived_games_patch'"
          )
          .get() as { count: number }
      ).count
    ).toBe(1)
    database.close()
    value.close()
  })

  test('restores the pre-migration database when a legacy schema step fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'member-analysis-migration-failure-'))
    roots.push(root)
    const value = new MemberAnalysisRepository(root)
    mkdirSync(value.dbRoot, { recursive: true })
    const database = new DatabaseSync(value.currentAnalysisPath)
    database.exec(
      'CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); PRAGMA user_version=1;'
    )
    database.close()
    const before = readFileSync(value.currentAnalysisPath)

    expect(() => value.initialize()).toThrow('no such table')
    expect(readFileSync(value.currentAnalysisPath)).toEqual(before)
    expect(readFileSync(join(value.dbRoot, 'analysis.migration-backup.sqlite3'))).toEqual(before)
    value.close()
  })

  test('rejects a newer analysis schema without silently downgrading it', () => {
    const root = mkdtempSync(join(tmpdir(), 'member-analysis-migration-newer-'))
    roots.push(root)
    const value = new MemberAnalysisRepository(root)
    mkdirSync(value.dbRoot, { recursive: true })
    writeAnalysis(value.currentAnalysisPath, 1)
    const database = new DatabaseSync(value.currentAnalysisPath)
    database.exec('PRAGMA user_version=99')
    database.close()
    const before = readFileSync(value.currentAnalysisPath)

    expect(() => value.initialize()).toThrow('schema 99 is newer than supported 2')
    expect(readFileSync(value.currentAnalysisPath)).toEqual(before)
    const restored = new DatabaseSync(value.currentAnalysisPath, { readOnly: true })
    expect(
      (restored.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
    ).toBe(99)
    restored.close()
    value.close()
  })
})
