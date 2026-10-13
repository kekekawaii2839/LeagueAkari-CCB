import { type OpponentRanks, unavailableRank } from '@shared/shards/member-analysis/opponent-ranks'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { MemberAnalysisRepository } from './repository'

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
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

function writeAnalysis(path: string, count: number, playerCount = 1) {
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
      JSON.stringify(
        syntheticGame(
          gameId,
          playerCount === 1 ? 'Player Alpha' : `Synthetic ${gameId % playerCount}`
        )
      ),
      '2026-01-01'
    )
  database.exec('COMMIT')
  database.close()
}

describe('member analysis repository', () => {
  test('reuses both full-scope counts across five pages but not a new first request or filter', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 500, 30)
      const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
      const countCalls = () =>
        prepare.mock.calls.filter(
          ([sql]) => /^SELECT COUNT\((\*|DISTINCT)/.test(sql) && sql.includes('derived_games')
        ).length
      const first = value.readGames({ pageSize: 100 })
      const ids = first.games.map((game) => game.gameId)
      let cursor = first.nextCursor
      while (cursor) {
        const page = value.readGames({ pageSize: 100, cursor })
        expect(page.total).toBe(500)
        expect(page.playerCount).toBe(30)
        ids.push(...page.games.map((game) => game.gameId))
        cursor = page.nextCursor
      }
      expect(ids).toHaveLength(500)
      expect(new Set(ids).size).toBe(500)
      expect(countCalls()).toBe(2)
      value.readGames({ pageSize: 100 })
      expect(countCalls()).toBe(4)
      const filters = {
        outcome: 'win' as const,
        patch: 'all',
        dateFrom: '',
        dateTo: '',
        durationMin: null,
        durationMax: null,
        participant: 'all',
        matchRole: 'all' as const,
        champion: 'all',
        query: ''
      }
      const filtered = value.readGames({ pageSize: 100, cursor: first.nextCursor, filters })
      expect(filtered.total).toBe(250)
      expect(filtered.playerCount).toBe(15)
      expect(countCalls()).toBe(6)
      value.readGames({ pageSize: 100, cursor: first.nextCursor })
      expect(countCalls()).toBe(8)
    } finally {
      value.close()
    }
  })

  test('invalidates continuation counts on a publication with the same generated timestamp', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 20, 5)
      const first = value.readGames({ pageSize: 5 })
      writeAnalysis(value.stagingAnalysisPath, 7)
      value.publishStaging()
      const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
      const current = value.readGames({ cursor: first.nextCursor, pageSize: 5 })
      expect(current.generatedAt).toBe(first.generatedAt)
      expect(current.total).toBe(7)
      expect(current.playerCount).toBe(1)
      expect(
        prepare.mock.calls.filter(
          ([sql]) => sql.startsWith('SELECT COUNT(') && sql.includes('derived_games')
        )
      ).toHaveLength(2)
    } finally {
      value.close()
    }
  })

  test.each(['delete', 'wal'] as const)(
    'detects in-place data changes without a new generated timestamp: %s',
    (mode) => {
      const value = repository()
      let writer: DatabaseSync | null = null
      try {
        writeAnalysis(value.currentAnalysisPath, 20, 5)
        writer = new DatabaseSync(value.currentAnalysisPath)
        if (mode === 'wal') writer.exec('PRAGMA journal_mode=WAL')
        const first = value.readGames({ pageSize: 5 })
        writer.exec('DELETE FROM derived_games WHERE game_id > 1')
        const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
        const current = value.readGames({ cursor: first.nextCursor, pageSize: 5 })
        expect(current.generatedAt).toBe(first.generatedAt)
        expect(current.total).toBe(1)
        expect(current.playerCount).toBe(1)
        expect(
          prepare.mock.calls.filter(
            ([sql]) => sql.startsWith('SELECT COUNT(') && sql.includes('derived_games')
          )
        ).toHaveLength(2)
      } finally {
        writer?.close()
        value.close()
      }
    }
  )

  test('invalidates counts after failed publication rollback and still validates versions per page', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 20, 5)
      const first = value.readGames({ pageSize: 5 })
      writeAnalysis(value.stagingAnalysisPath, 7)
      vi.spyOn(value.opponentRanks, 'publishGames').mockImplementationOnce(() => {
        throw new Error('Synthetic publication failure')
      })
      expect(() => value.publishStaging()).toThrow('Synthetic publication failure')
      const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
      const restored = value.readGames({ cursor: first.nextCursor, pageSize: 5 })
      expect(restored.total).toBe(20)
      expect(restored.playerCount).toBe(5)
      expect(
        prepare.mock.calls.filter(
          ([sql]) => sql.startsWith('SELECT COUNT(') && sql.includes('derived_games')
        )
      ).toHaveLength(2)
      const database = new DatabaseSync(value.currentAnalysisPath)
      database.prepare("UPDATE metadata SET value='999' WHERE key='derivation_version'").run()
      database.close()
      expect(() => value.readGames({ cursor: restored.nextCursor, pageSize: 5 })).toThrow(
        'Unsupported member analysis derivation version'
      )
    } finally {
      value.close()
    }
  })

  test('clears counts when the publication disappears and when the repository is reopened', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 20, 5)
      const first = value.readGames({ pageSize: 5 })
      value.close()
      value.initialize()
      const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
      expect(value.readGames({ cursor: first.nextCursor, pageSize: 5 }).total).toBe(20)
      expect(
        prepare.mock.calls.filter(
          ([sql]) => sql.startsWith('SELECT COUNT(') && sql.includes('derived_games')
        )
      ).toHaveLength(2)
      rmSync(value.currentAnalysisPath)
      expect(value.readGames({ cursor: first.nextCursor }).total).toBe(0)
      writeAnalysis(value.currentAnalysisPath, 2)
      expect(value.readGames({ cursor: first.nextCursor }).total).toBe(2)
      expect(
        prepare.mock.calls.filter(
          ([sql]) => sql.startsWith('SELECT COUNT(') && sql.includes('derived_games')
        )
      ).toHaveLength(4)
    } finally {
      value.close()
    }
  })

  test('future prediction expansion checks raw future start before touching old derived outcomes', () => {
    const value = repository()
    try {
      for (const [gameId, start] of [
        [1, 500],
        [2, 1500]
      ])
        value.storeRaw(
          'TEST',
          gameId,
          710,
          'synthetic',
          {
            json: {
              gameId,
              gameStartTimestamp: start,
              gameEndTimestamp: start + 900000,
              gameDuration: 900,
              queueId: 710,
              participants: [],
              teams: []
            }
          },
          {}
        )
      writeAnalysis(value.currentAnalysisPath, 2)
      const database = new DatabaseSync(value.currentAnalysisPath)
      database
        .prepare('UPDATE derived_games SET payload_json=? WHERE game_id=1')
        .run('not valid JSON: old isolated tail must not be read')
      database.close()
      const future = value.readFuturePredictionGames(1000, 1000000)
      expect(future.games).toHaveLength(1)
      expect(future.queueEntries).toEqual([['1500|2', 710]])
      expect(future.studyCreatedAtMs).toBe(1000)
      expect(future.observedAtMs).toBeGreaterThanOrEqual(1000000)
      expect(value.readFuturePredictionGames(1000, 901500).games).toHaveLength(0)
    } finally {
      value.close()
    }
  })

  test('observed future game without derived features fails instead of silently dropping it', () => {
    const value = repository()
    try {
      value.storeRaw(
        'TEST',
        2,
        710,
        'synthetic',
        {
          json: {
            gameId: 2,
            gameStartTimestamp: 1500,
            gameEndTimestamp: 901500,
            gameDuration: 900,
            queueId: 710,
            participants: [],
            teams: []
          }
        },
        {}
      )
      expect(() => value.readFuturePredictionGames(1000, 1000000)).toThrow(
        'Future features not ready'
      )
      expect(() => value.readFuturePredictionGames(2000, 1000)).toThrow(
        'Invalid future prediction window'
      )
    } finally {
      value.close()
    }
  })

  test('prediction source reads only an exact unambiguous raw cache without current derived data', () => {
    const value = repository()
    try {
      const summary = { json: { gameId: 1, participants: [], teams: [] } }
      const item = value.storeRaw('TEST', 1, 440, 'synthetic', summary, { json: { gameId: 1 } })
      expect(value.readPredictionSource(1)).toEqual({ serverId: 'TEST', summary })
      expect(existsSync(value.currentAnalysisPath)).toBe(false)
      expect(() => value.readPredictionSource(2)).toThrow('missing or ambiguous')
      expect(() => value.readPredictionSource(-1)).toThrow('Invalid prediction source')
      const database = new DatabaseSync(value.catalogPath)
      database
        .prepare('UPDATE catalog_games SET summary_path=? WHERE game_id=1')
        .run(item.detailsPath)
      database.close()
      expect(() => value.readPredictionSource(1)).toThrow('Invalid prediction source path')
      value.storeRaw('TEST', 1, 440, 'synthetic', summary, {})
      value.storeRaw('OTHER', 1, 440, 'synthetic', summary, {})
      expect(() => value.readPredictionSource(1)).toThrow('missing or ambiguous')
    } finally {
      value.close()
    }
  })

  test('reads only an eligible unambiguous derived match from its exact local cache', () => {
    const value = repository()
    const summary = { json: { gameId: 1, participants: [], teams: [] } }
    const details = { json: { gameId: 1, frames: [] } }
    value.storeRaw('TEST', 1, 440, 'test', summary, details)
    expect(value.readMatchDetails(1)).toBeNull()
    writeAnalysis(value.currentAnalysisPath, 2)
    expect(value.readMatchDetails(1)).toEqual({
      serverId: 'TEST',
      summary: { source: 'sgp', gameId: 1, data: summary },
      details: { source: 'sgp', gameId: 1, data: details }
    })
    expect(value.readMatchDetails(2)).toBeNull()
    expect(value.readMatchDetails(99)).toBeNull()
    const item = value.catalogItem('TEST', 1)!
    rmSync(value.safePath(item.detailsPath))
    expect(value.readMatchDetails(1)?.details).toBeNull()
    value.storeRaw('TEST', 1, 440, 'test', { json: { ...summary.json, gameId: 9 } }, details)
    expect(() => value.readMatchDetails(1)).toThrow('Invalid cached match summary')
    const database = new DatabaseSync(value.currentAnalysisPath)
    database
      .prepare(
        'INSERT INTO derived_games SELECT ?,game_id,checksum,payload_json,updated_at FROM derived_games WHERE game_id=1'
      )
      .run('OTHER')
    database.close()
    expect(value.readMatchDetails(1)).toBeNull()
    value.close()
  })

  test('does not expose remake caches or renderer-selected file paths', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    value.storeRaw(
      'TEST',
      1,
      440,
      'test',
      { json: { gameId: 1, participants: [], teams: [] } },
      null
    )
    const catalog = new DatabaseSync(value.catalogPath)
    catalog.prepare("UPDATE catalog_games SET summary_path='db/catalog.sqlite3'").run()
    catalog.close()
    expect(() => value.readMatchDetails(1)).toThrow('Invalid cached match path')
    const database = new DatabaseSync(value.currentAnalysisPath)
    database
      .prepare("UPDATE derived_games SET payload_json=json_set(payload_json,'$.duration',899)")
      .run()
    database.close()
    expect(value.readMatchDetails(1)).toBeNull()
    value.close()
  })
  test('hydrates additive rank snapshots through existing overview reads and restores old analysis if rank publication fails', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    expect(value.readGames().games[0].opponentRanks).toBeUndefined()
    const ranks: OpponentRanks = {
      version: 1,
      source: 'SGP leagues-ledge (current snapshot)',
      serverId: 'TEST',
      opponents: Array.from({ length: 5 }, (_, i) => ({
        slot: i + 1,
        role: null,
        champion: null,
        snapshot: unavailableRank('cross-region', '2026-10-07T12:00:00.000Z')
      }))
    }
    writeAnalysis(value.stagingAnalysisPath, 2)
    value.publishStaging([{ serverId: 'TEST', gameId: 2, ranks }])
    expect(value.readGames().games[0].opponentRanks).toEqual(ranks)
    expect(value.readGames().games[1].opponentRanks).toBeUndefined()
    writeAnalysis(value.stagingAnalysisPath, 3)
    const invalid = structuredClone(ranks)
    invalid.opponents.pop()
    expect(() => value.publishStaging([{ serverId: 'TEST', gameId: 3, ranks: invalid }])).toThrow()
    expect(value.readGames().total).toBe(2)
    expect(value.opponentRanks.readGame('TEST', 3)).toBeUndefined()
    value.close()
  })
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

  test('excludes short cached games from counts, players and pagination without rewriting storage', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 4)
    const database = new DatabaseSync(value.currentAnalysisPath)
    const update = database.prepare('UPDATE derived_games SET payload_json=? WHERE game_id=?')
    for (const [gameId, duration] of [
      [1, 900],
      [2, 901],
      [3, 899],
      [4, 0]
    ]) {
      update.run(
        JSON.stringify({
          ...syntheticGame(gameId, gameId > 2 ? 'Short Only' : 'Eligible'),
          duration
        }),
        gameId
      )
    }
    database.close()
    const first = value.readGames({ pageSize: 1 })
    expect(first.total).toBe(2)
    expect(first.playerCount).toBe(1)
    expect(first.games.map((row) => row.gameId)).toEqual([2])
    const second = value.readGames({ pageSize: 1, cursor: first.nextCursor })
    expect(second.games.map((row) => row.gameId)).toEqual([1])
    expect(second.games[0].duration).toBe(900)
    expect(second.nextCursor).toBeNull()
    const unchanged = new DatabaseSync(value.currentAnalysisPath, { readOnly: true })
    expect(unchanged.prepare('SELECT COUNT(*) AS count FROM derived_games').get()?.count).toBe(4)
    unchanged.close()
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

test('read-only legacy recovery keeps unknown zeros unavailable; v5 zeros survive publication', () => {
  const value = repository()
  writeAnalysis(value.currentAnalysisPath, 1)
  const before = readFileSync(value.currentAnalysisPath)
  const old = value.readGames().games[0]
  expect(old.metricSemantics).toBe('legacy-unknown')
  expect(old.players[0].kills).toBeNull()
  expect(old.gold20Diff).toBeNull()
  expect(old.eventDecision).toBeNull()
  expect(readFileSync(value.currentAnalysisPath)).toEqual(before)
  writeAnalysis(value.stagingAnalysisPath, 1)
  const db = new DatabaseSync(value.stagingAnalysisPath)
  db.prepare("UPDATE metadata SET value='5' WHERE key='derivation_version'").run()
  db.close()
  value.publishStaging()
  expect(value.readGames().games[0].players[0].kills).toBe(0)
  expect(value.readGames().games[0].gold20Diff).toBe(0)
  value.close()
})
test('invalid staging leaves legacy results readable even without raw caches', () => {
  const value = repository()
  writeAnalysis(value.currentAnalysisPath, 1)
  const before = readFileSync(value.currentAnalysisPath)
  writeFileSync(value.stagingAnalysisPath, 'invalid staging')
  expect(() => value.publishStaging()).toThrow()
  expect(readFileSync(value.currentAnalysisPath)).toEqual(before)
  expect(value.readGames().games[0].metricSemantics).toBe('legacy-unknown')
  value.close()
})
