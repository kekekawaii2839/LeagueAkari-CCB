import { type OpponentRanks, unavailableRank } from '@shared/shards/member-analysis/opponent-ranks'
import { createHash, randomUUID } from 'node:crypto'
import synchronousFileSystem from 'node:fs'
import {
  existsSync,
  promises as fileSystem,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { executeRankPublication } from './opponent-ranks/rank-publication-executor'
import { OpponentRankRepository } from './opponent-ranks/repository'
import { PublishedIdentitiesExecutor } from './published-identities-executor'
import { PublishedIdentitiesLoader } from './published-identities-loader'
import { projectPublishedIdentityBatch } from './published-identities-source'
import { MemberAnalysisRepository } from './repository'

vi.mock('./opponent-ranks/rank-publication-executor', () => ({ executeRankPublication: vi.fn() }))

const roots: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  syncBuiltinESMExports()
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

  test('opening a real read-only WAL connection keeps the publication token, actual writes invalidate it', () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 2)
    const setup = new DatabaseSync(value.currentAnalysisPath)
    setup.exec('PRAGMA journal_mode=WAL')
    setup.close()
    const before = value.publicationToken()
    const reader = new DatabaseSync(value.currentAnalysisPath, { readOnly: true })
    let writer: DatabaseSync | null = null
    try {
      expect(reader.prepare('SELECT COUNT(*) AS count FROM derived_games').get()).toMatchObject({
        count: 2
      })
      expect(existsSync(`${value.currentAnalysisPath}-wal`)).toBe(true)
      expect(readFileSync(`${value.currentAnalysisPath}-wal`)).toHaveLength(0)
      expect(value.publicationToken()).toBe(before)
      writer = new DatabaseSync(value.currentAnalysisPath)
      writer.exec('DELETE FROM derived_games WHERE game_id=2')
      expect(readFileSync(`${value.currentAnalysisPath}-wal`).length).toBeGreaterThan(0)
      expect(value.publicationToken()).not.toBe(before)
    } finally {
      writer?.close()
      reader.close()
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
      const database = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
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

  test('summary-only match overview never observes missing, invalid or escaping timelines', () => {
    const value = repository()
    try {
      const participants = [{ participantId: 1, originalField: 'preserved' }]
      const summary = { json: { gameId: 1, participants, teams: [] } }
      const details = { json: { gameId: 1, frames: [] } }
      const item = value.storeRaw('TEST', 1, 440, 'test', summary, details)
      expect(value.readMatchOverview(1)).toBeNull()
      writeAnalysis(value.currentAnalysisPath, 1)
      const expected = { serverId: 'TEST', summary: { source: 'sgp', gameId: 1, data: summary } }
      const timeline = value.safePath(item.detailsPath)
      const read = vi.spyOn(synchronousFileSystem, 'readFileSync')
      const exists = vi.spyOn(synchronousFileSystem, 'existsSync')
      const realpath = vi.spyOn(synchronousFileSystem, 'realpathSync')
      syncBuiltinESMExports()
      const assertOverview = () => {
        read.mockClear()
        exists.mockClear()
        realpath.mockClear()
        expect(value.readMatchOverview(1)).toEqual(expected)
        for (const probe of [read, exists, realpath])
          for (const call of probe.mock.calls) expect(String(call[0])).not.toBe(timeline)
      }
      assertOverview()
      expect(value.readMatchDetails(1)?.details?.data).toEqual(details)
      expect(read.mock.calls.some(([path]) => String(path) === timeline)).toBe(true)
      writeFileSync(timeline, 'invalid gzip timeline')
      assertOverview()
      expect(() => value.readMatchDetails(1)).toThrow()
      rmSync(timeline)
      assertOverview()
      expect(value.readMatchDetails(1)?.details).toBeNull()
      const catalog = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
      try {
        catalog.prepare("UPDATE catalog_games SET details_path='../outside-secret'").run()
        assertOverview()
        expect(() => value.readMatchDetails(1)).toThrow('path escapes data root')
      } finally {
        catalog.close()
      }
    } finally {
      value.close()
    }
  })

  test('summary-only match overview preserves eligibility, publication and exact-summary validation', () => {
    const value = repository()
    try {
      const summary = { json: { gameId: 1, participants: [], teams: [] } }
      const item = value.storeRaw('TEST', 1, 440, 'test', summary, null)
      writeAnalysis(value.currentAnalysisPath, 1)
      expect(value.readMatchOverview(99)).toBeNull()
      value.storeRaw('TEST', 1, 440, 'test', { json: { ...summary.json, gameId: 2 } }, null)
      expect(() => value.readMatchOverview(1)).toThrow('Invalid cached match summary')
      value.storeRaw('TEST', 1, 440, 'test', summary, null)
      const catalog = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
      try {
        catalog.prepare("UPDATE catalog_games SET summary_path='db/catalog.sqlite3'").run()
        expect(() => value.readMatchOverview(1)).toThrow('Invalid cached match path')
        catalog.prepare('UPDATE catalog_games SET summary_path=?').run(item.summaryPath)
      } finally {
        catalog.close()
      }
      const database = new DatabaseSync(value.currentAnalysisPath)
      try {
        database
          .prepare("UPDATE derived_games SET payload_json=json_set(payload_json,'$.duration',899)")
          .run()
        expect(value.readMatchOverview(1)).toBeNull()
        database
          .prepare("UPDATE derived_games SET payload_json=json_set(payload_json,'$.duration',1800)")
          .run()
        database
          .prepare(
            'INSERT INTO derived_games SELECT ?,game_id,checksum,payload_json,updated_at FROM derived_games WHERE game_id=1'
          )
          .run('OTHER')
        expect(value.readMatchOverview(1)).toBeNull()
      } finally {
        database.close()
      }
      ;(
        value as unknown as { _publicationRecoveryRequired: boolean }
      )._publicationRecoveryRequired = true
      expect(() => value.readMatchOverview(1)).toThrow('publication is pending')
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
    const catalog = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
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
    const database = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
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

test('participant-rank enrichment reads only exact game-player facts and leaves readable matches intact', () => {
  const value = repository()
  try {
    const start = Date.parse('2026-10-13T12:00:00.000Z'),
      end = start + 1800000
    const summary = {
      json: {
        gameId: 1,
        gameStartTimestamp: start,
        gameEndTimestamp: end,
        participants: Array.from({ length: 10 }, (_, index) => ({
          participantId: index + 1,
          puuid: `synthetic-person-${index + 1}`
        })),
        teams: []
      }
    }
    value.storeRaw('TEST', 1, 420, 'synthetic', summary, { json: { gameId: 1, frames: [] } })
    writeAnalysis(value.currentAnalysisPath, 1)
    const fetchedAt = new Date(start + 2000).toISOString()
    const snapshot = {
      attemptedAt: fetchedAt,
      fetchedAt,
      status: 'ok' as const,
      reason: null,
      solo: {
        status: 'ranked' as const,
        rank: { tier: 'GOLD' as const, division: 'II' as const, leaguePoints: 0 }
      },
      flex: { status: 'missing' as const, rank: null }
    }
    const ranks = {
      version: 1 as const,
      source: 'SGP leagues-ledge (current snapshot)' as const,
      serverId: 'TEST',
      capture: {
        mode: 'live' as const,
        phase: 'InProgress' as const,
        observedAt: new Date(start + 1000).toISOString()
      },
      opponents: Array.from({ length: 5 }, (_, index) => ({
        slot: index + 1,
        role: null,
        champion: null,
        snapshot,
        capturedDuringGame: true
      }))
    }
    value.opponentRanks.publishGames([
      {
        serverId: 'TEST',
        gameId: 1,
        ranks,
        identities: Array.from({ length: 5 }, (_, index) => `synthetic-person-${index + 6}`)
      }
    ])
    // A current player cache entry is deliberately not a per-game fact.
    value.opponentRanks.writePlayer('TEST', 'synthetic-person-1', snapshot)
    value.opponentRanks.publishGames([
      {
        serverId: 'OTHER',
        gameId: 1,
        ranks: { ...ranks, serverId: 'OTHER' },
        identities: ['synthetic-person-2', null, null, null, null]
      }
    ])
    const result = value.readMatchDetails(1)!
    expect(value.readMatchOverview(1)).toEqual({
      serverId: result.serverId,
      summary: result.summary,
      participantRanks: result.participantRanks
    })
    expect(result.participantRanks?.participants).toHaveLength(10)
    expect(result.participantRanks?.participants.filter((p) => p.snapshot !== null)).toHaveLength(5)
    expect(
      result.participantRanks?.participants.find((p) => p.participantId === 1)?.snapshot
    ).toBeNull()
    expect(
      result.participantRanks?.participants.find((p) => p.participantId === 2)?.snapshot
    ).toBeNull()
    expect(result.participantRanks?.participants.find((p) => p.participantId === 6)).toMatchObject({
      snapshot,
      timing: 'during-game'
    })
    const spy = vi.spyOn(value.opponentRanks, 'readGame').mockImplementation(() => {
      throw Error('synthetic damaged optional rank storage')
    })
    expect(value.readMatchDetails(1)?.summary.data).toEqual(summary)
    expect(value.readMatchDetails(1)?.participantRanks).toBeUndefined()
    spy.mockRestore()
  } finally {
    value.close()
  }
})

test('rank-history configured identity resolution is exact and failed/latest mappings never borrow old aliases', () => {
  const value = repository()
  try {
    value.recordMember('TEST', 'Configured', 'TAG', 'synthetic-identity', null)
    expect(value.resolveConfiguredMember('TEST', 'Configured', 'TAG')?.puuid).toBe(
      'synthetic-identity'
    )
    expect(value.resolveConfiguredMember('OTHER', 'Configured', 'TAG')).toBeNull()
    expect(value.resolveConfiguredMember('TEST', 'configured', 'TAG')).toBeNull()
    expect(value.resolveConfiguredMember('TEST', 'Configured', 'OTHER')).toBeNull()
    value.recordMember(
      'TEST',
      'Configured',
      'TAG',
      'synthetic-identity',
      'synthetic failed latest lookup'
    )
    expect(value.resolveConfiguredMember('TEST', 'Configured', 'TAG')).toBeNull()
    value.recordMember('TEST', 'Configured', 'TAG', null, null)
    expect(value.resolveConfiguredMember('TEST', 'Configured', 'TAG')).toBeNull()
  } finally {
    value.close()
  }
})

function identityFixture(count = 2) {
  const value = repository()
  writeAnalysis(value.currentAnalysisPath, count)
  const database = new DatabaseSync(value.currentAnalysisPath)
  database.prepare("UPDATE metadata SET value='5' WHERE key='derivation_version'").run()
  for (let id = 1; id <= count; id++) {
    const summary = {
      json: {
        gameId: id,
        participants: Array.from({ length: 10 }, (_, index) => ({
          participantId: index + 1,
          puuid: `SYNTHETIC_TEST_ONLY_${index + 1}`,
          teamId: index < 5 ? 100 : 200
        })),
        teams: []
      }
    }
    const checksum = value.checksum(summary)
    value.storeRaw('TEST', id, 440, checksum, summary, { json: { gameId: id, frames: [] } })
    const game = syntheticGame(id)
    game.players = Array.from({ length: 5 }, (_, index) => ({
      ...game.players[0],
      player: `Old label ${index + 1}`,
      participantId: index + 1
    }))
    database
      .prepare('UPDATE derived_games SET checksum=?,payload_json=? WHERE game_id=?')
      .run(checksum, JSON.stringify(game), id)
  }
  database.close()
  value.recordMember('TEST', 'New name', 'TAG', 'SYNTHETIC_TEST_ONLY_2', null)
  const members = [{ serverId: 'TEST', gameName: 'New name', tagLine: 'TAG' }]
  const loader = new PublishedIdentitiesLoader(value, () => members, {
    execute: (batch, assertCurrent) => projectPublishedIdentityBatch(batch, assertCurrent)
  })
  const request = {
    publicationToken: value.publicationToken()!,
    memberSlots: [1],
    pageSize: 1,
    cursor: null
  }
  return { value, loader, request, members }
}

test('published identity is exact participant ID, old derived label, paged and redacted', async () => {
  const { value, loader, request } = identityFixture()
  try {
    const first = await loader.read(request)
    expect(first.games).toEqual([
      {
        gameId: 2,
        status: 'available',
        members: [{ memberId: 'member-slot-1', player: 'Old label 2' }]
      }
    ])
    expect(JSON.stringify(first)).not.toContain('SYNTHETIC_TEST_ONLY')
    expect(first.pagination.nextCursor).not.toBeNull()
    const second = await loader.read({ ...request, cursor: first.pagination.nextCursor })
    expect(second.games[0].gameId).toBe(1)
    expect(second.configurationToken).toBe(first.configurationToken)
    expect(second.pagination.nextCursor).toBeNull()
    await expect(loader.read({ ...request, memberSlots: [2] })).rejects.toThrow(
      'Invalid published identities request'
    )
    await expect(
      loader.read({ ...request, pageSize: 2, cursor: first.pagination.nextCursor })
    ).rejects.toThrow('Invalid published identities request')
  } finally {
    value.close()
  }
})

test('legacy identity and tampered raw checksum are unavailable without guessing names or roles', async () => {
  const { value, loader, request } = identityFixture()
  try {
    const database = new DatabaseSync(value.currentAnalysisPath)
    const game = syntheticGame(2)
    database
      .prepare('UPDATE derived_games SET payload_json=? WHERE game_id=2')
      .run(JSON.stringify(game))
    database.close()
    const page = await loader.read({ ...request, publicationToken: value.publicationToken()! })
    expect(page.games[0]).toMatchObject({ status: 'identity-unavailable', members: [] })
    const raw = { json: { gameId: 1, participants: [], teams: [] } }
    value.updateRawSummary(value.catalogItem('TEST', 1)!, raw)
    const next = await loader.read({
      ...request,
      publicationToken: value.publicationToken()!,
      cursor: page.pagination.nextCursor
    })
    expect(next.games[0]).toMatchObject({ status: 'identity-unavailable', members: [] })
  } finally {
    value.close()
  }
})

test('publication/configuration mutation during item yield rejects whole identity page', async () => {
  const { value, loader, request, members } = identityFixture()
  try {
    setImmediate(() => {
      members[0] = { ...members[0], gameName: 'Changed' }
    })
    await expect(loader.read(request)).rejects.toThrow('Stale published identities request')
    const old = value.publicationToken()
    const database = new DatabaseSync(value.currentAnalysisPath)
    database.prepare("UPDATE metadata SET value='changed' WHERE key='generated_at'").run()
    database.close()
    expect(value.publicationToken()).not.toBe(old)
    await expect(loader.read(request)).rejects.toThrow('Stale published identities request')
  } finally {
    value.close()
  }
})

test('colliding cross-region game IDs are explicitly ambiguous and never pick one region', async () => {
  const { value, loader, request } = identityFixture(1)
  try {
    const database = new DatabaseSync(value.currentAnalysisPath)
    database
      .prepare(
        'INSERT INTO derived_games SELECT ?,game_id,checksum,payload_json,updated_at FROM derived_games'
      )
      .run('OTHER')
    database.close()
    const page = await loader.read({
      ...request,
      publicationToken: value.publicationToken()!,
      pageSize: 25
    })
    expect(page.games).toHaveLength(2)
    expect(
      page.games.every((game) => game.status === 'ambiguous-game' && game.members.length === 0)
    ).toBe(true)
  } finally {
    value.close()
  }
})

describe('additive catalog game lookup index', () => {
  test('reopens an existing v2 catalog without losing rows, raw payloads or legacy read compatibility', () => {
    const value = repository()
    try {
      const raw = { json: { gameId: 1, participants: [], teams: [] } }
      const item = value.storeRaw('TEST', 1, 440, 'before', raw, null)
      const bytes = readFileSync(value.safePath(item.summaryPath))
      value.close()
      const old = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
      old.exec('DROP INDEX idx_catalog_games_game_server')
      const before = old.prepare('SELECT * FROM catalog_games').all()
      old.close()
      value.initialize()
      value.close()
      value.initialize() // Idempotent on already-upgraded v2 catalogs.
      const catalog = new DatabaseSync(value.catalogPath, { readOnly: true })
      try {
        expect(catalog.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
        expect(catalog.prepare('SELECT * FROM catalog_games').all()).toEqual(before)
        const index = catalog
          .prepare("PRAGMA index_list('catalog_games')")
          .all()
          .find((entry) => entry.name === 'idx_catalog_games_game_server')
        expect(index?.unique).toBe(0)
        expect(
          catalog
            .prepare("PRAGMA index_info('idx_catalog_games_game_server')")
            .all()
            .map((entry) => entry.name)
        ).toEqual(['game_id', 'server_id'])
        // The pre-index version-2 reader needs no new fields or schema version.
        expect(
          catalog
            .prepare(
              'SELECT checksum,summary_path,details_path FROM catalog_games WHERE server_id=? AND game_id=?'
            )
            .get('TEST', 1)
        ).toMatchObject({
          checksum: 'before',
          summary_path: item.summaryPath,
          details_path: item.detailsPath
        })
      } finally {
        catalog.close()
      }
      expect(readFileSync(value.safePath(item.summaryPath))).toEqual(bytes)
      value.storeRaw('TEST', 1, 440, 'updated', raw, null)
      value.storeRaw('OTHER', 1, 440, 'second-server', raw, null)
      expect(value.knownChecksum('TEST', 1)).toBe('updated')
      expect(value.knownChecksum('OTHER', 1)).toBe('second-server')
      expect(value.storageStatus(5).catalogGames).toBe(2)
    } finally {
      value.close()
    }
  })

  test('keeps three-server catalog collisions unavailable rather than picking an indexed row', async () => {
    const { value, loader, request } = identityFixture(1)
    try {
      expect((await loader.read(request)).games[0].status).toBe('available')
      for (const server of ['AAA', 'ZZZ'])
        value.storeRaw(server, 1, 440, 'synthetic-collision', { json: { gameId: 1 } }, null)
      const page = await loader.read({ ...request, publicationToken: value.publicationToken()! })
      expect(page.games).toEqual([{ gameId: 1, status: 'identity-unavailable', members: [] }])
      expect(() => value.readPredictionSource(1)).toThrow('missing or ambiguous')
      expect(value.storageStatus(5).catalogGames).toBe(3)
    } finally {
      await loader.dispose()
      value.close()
    }
  })

  test('rejects an index-creation failure without changing published analysis or raw data and permits safe retry', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 1)
      const item = value.storeRaw('TEST', 1, 440, 'preserved', { json: { gameId: 1 } }, null)
      const published = readFileSync(value.currentAnalysisPath)
      const raw = readFileSync(value.safePath(item.summaryPath))
      value.close()
      const catalog = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
      catalog.exec(
        'DROP INDEX idx_catalog_games_game_server; CREATE TABLE idx_catalog_games_game_server (synthetic_conflict TEXT)'
      )
      catalog.close()
      expect(() => value.initialize()).toThrow()
      expect(() => value.knownChecksum('TEST', 1)).toThrow('repository is not initialized')
      expect(readFileSync(value.currentAnalysisPath)).toEqual(published)
      expect(readFileSync(value.safePath(item.summaryPath))).toEqual(raw)
      const recovery = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
      expect(recovery.prepare('PRAGMA user_version').get()?.user_version).toBe(2)
      expect(recovery.prepare('SELECT checksum FROM catalog_games').all()).toEqual([
        { checksum: 'preserved' }
      ])
      recovery.exec('DROP TABLE idx_catalog_games_game_server')
      recovery.close()
      value.initialize()
      expect(value.knownChecksum('TEST', 1)).toBe('preserved')
      expect(value.readGames().total).toBe(1)
    } finally {
      value.close()
    }
  })
})

describe('fresh publication metadata checks', () => {
  test('stats each file once per call and always repeats fresh checks across calls', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 1)
      const stat = vi.spyOn(synchronousFileSystem, 'statSync')
      const exists = vi.spyOn(synchronousFileSystem, 'existsSync')
      syncBuiltinESMExports()
      const first = value.publicationToken()
      expect(first).not.toBeNull()
      expect(value.publicationToken()).toBe(first)
      expect(stat.mock.calls.map(([path]) => String(path))).toEqual([
        value.currentAnalysisPath,
        `${value.currentAnalysisPath}-wal`,
        value.currentAnalysisPath,
        `${value.currentAnalysisPath}-wal`
      ])
      expect(exists).not.toHaveBeenCalled()
    } finally {
      value.close()
    }
  })

  test('clears a missing publication and detects an exact-byte replacement with the same generated timestamp', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 1)
      const bytes = readFileSync(value.currentAnalysisPath)
      const first = value.publicationToken()
      synchronousFileSystem.renameSync(
        value.currentAnalysisPath,
        `${value.currentAnalysisPath}.old-test`
      )
      writeFileSync(value.currentAnalysisPath, bytes)
      const replaced = value.publicationToken()
      expect(replaced).not.toBe(first)
      expect(readFileSync(value.currentAnalysisPath)).toEqual(bytes)
      rmSync(value.currentAnalysisPath)
      expect(value.publicationToken()).toBeNull()
      writeFileSync(value.currentAnalysisPath, bytes)
      expect(value.publicationToken()).not.toBe(replaced)
    } finally {
      value.close()
    }
  })

  test('treats missing and empty WAL equally but invalidates a changed WAL', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 1)
      const wal = `${value.currentAnalysisPath}-wal`
      const first = value.publicationToken()
      writeFileSync(wal, Buffer.alloc(0))
      expect(value.publicationToken()).toBe(first)
      writeFileSync(wal, Buffer.from('synthetic changed metadata'))
      const changed = value.publicationToken()
      expect(changed).not.toBe(first)
      rmSync(wal)
      const missing = value.publicationToken()
      expect(missing).not.toBe(changed)
      writeFileSync(wal, Buffer.alloc(0))
      expect(value.publicationToken()).toBe(missing)
    } finally {
      value.close()
    }
  })

  test.each(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const)(
    'preserves the complete fresh fingerprint field %s',
    (field) => {
      const value = repository()
      try {
        writeAnalysis(value.currentAnalysisPath, 1)
        const first = value.publicationToken()
        const actual = synchronousFileSystem.statSync(value.currentAnalysisPath, { bigint: true })
        const changed = { ...actual, [field]: actual[field] + 1n } as typeof actual
        vi.spyOn(synchronousFileSystem, 'statSync')
          .mockReturnValueOnce(changed)
          .mockReturnValueOnce(undefined)
        syncBuiltinESMExports()
        expect(value.publicationToken()).not.toBe(first)
      } finally {
        value.close()
      }
    }
  )

  test.each(['EACCES', 'EIO'])(
    'rejects %s on either file rather than returning a cached token',
    (code) => {
      const value = repository()
      try {
        writeAnalysis(value.currentAnalysisPath, 1)
        expect(value.publicationToken()).not.toBeNull()
        const actual = synchronousFileSystem.statSync(value.currentAnalysisPath, { bigint: true })
        const stat = vi.spyOn(synchronousFileSystem, 'statSync')
        syncBuiltinESMExports()
        for (const target of ['database', 'wal']) {
          const error = Object.assign(new Error('synthetic metadata failure'), { code })
          if (target === 'wal') stat.mockReturnValueOnce(actual)
          stat.mockImplementationOnce(() => {
            throw error
          })
          let caught: unknown
          try {
            value.publicationToken()
          } catch (failure) {
            caught = failure
          }
          expect(caught).toBe(error)
        }
      } finally {
        value.close()
      }
    }
  )

  test('keeps epoch invalidation and rejects pending or recovery-required publication before any stat', () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 1)
      const state = value as unknown as {
        _publicationEpoch: number
        _publicationWait: Promise<void> | null
        _publicationRecoveryRequired: boolean
      }
      const first = value.publicationToken()
      state._publicationEpoch++
      const changed = value.publicationToken()
      expect(changed).not.toBe(first)
      const stat = vi.spyOn(synchronousFileSystem, 'statSync')
      syncBuiltinESMExports()
      state._publicationWait = Promise.resolve()
      expect(value.publicationToken()).toBeNull()
      state._publicationWait = null
      state._publicationRecoveryRequired = true
      expect(value.publicationToken()).toBeNull()
      expect(stat).not.toHaveBeenCalled()
      state._publicationRecoveryRequired = false
      expect(value.publicationToken()).toBe(changed)
    } finally {
      value.close()
    }
  })
})

describe('ordinary asynchronous storage statistics', () => {
  test('overlaps metadata reads with a four-request bound without changing exact byte counts', async () => {
    const value = repository()
    try {
      const raw = join(value.rawRoot, 'TEST_ONLY', 'nested')
      mkdirSync(raw, { recursive: true })
      for (let index = 0; index < 12; index += 1)
        writeFileSync(join(raw, `${index}.bin`), Buffer.alloc(index + 1))
      writeFileSync(join(value.dataRoot, 'other.bin'), Buffer.alloc(17))
      const expected = value.storageStatus(10)
      const stat = fileSystem.lstat
      let active = 0
      let peak = 0
      vi.spyOn(fileSystem, 'lstat').mockImplementation(async (path, options) => {
        active++
        peak = Math.max(peak, active)
        try {
          await new Promise<void>((resolve) => setImmediate(resolve))
          return await stat(path, options)
        } finally {
          active--
        }
      })
      expect(await value.storageStatusAsync(10)).toEqual(expected)
      expect(active).toBe(0)
      expect(peak).toBeGreaterThan(1)
      expect(peak).toBeLessThanOrEqual(4)
    } finally {
      value.close()
    }
  })

  test('stops scheduling after an IO failure and drains outstanding metadata reads before rejecting', async () => {
    const value = repository()
    const error = Object.assign(new Error('synthetic metadata denied'), { code: 'EIO' })
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const overlapping = new Promise<void>((resolve) => (entered = resolve))
    let observation: Promise<unknown> | undefined
    try {
      for (let index = 0; index < 8; index += 1)
        writeFileSync(join(value.dataRoot, `${index}.bin`), Buffer.alloc(1))
      const stat = fileSystem.lstat
      let denied = false
      let active = 0
      const reads = vi.spyOn(fileSystem, 'lstat').mockImplementation(async (path, options) => {
        if (String(path) === value.dataRoot) return stat(path, options)
        active++
        try {
          if (!denied) {
            denied = true
            await overlapping
            throw error
          }
          entered()
          await gate
          return await stat(path, options)
        } finally {
          active--
        }
      })
      let settled = false
      observation = value.storageStatusAsync(10).then(
        (result) => {
          settled = true
          return result
        },
        (failure: unknown) => {
          settled = true
          return failure
        }
      )
      await overlapping
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(settled).toBe(false)
      expect(active).toBeGreaterThan(0)
      const scheduled = reads.mock.calls.length
      release()
      expect(await observation).toBe(error)
      expect(active).toBe(0)
      expect(reads).toHaveBeenCalledTimes(scheduled)
    } finally {
      entered()
      release()
      await observation
      value.close()
    }
  })

  test('counts total and raw in one pass and lets another macro task run before completion', async () => {
    const value = repository()
    try {
      const raw = join(value.rawRoot, 'TEST_ONLY', 'nested')
      mkdirSync(raw, { recursive: true })
      for (let index = 0; index < 130; index += 1)
        writeFileSync(join(raw, `${index}.bin`), Buffer.alloc(13))
      writeFileSync(join(value.dataRoot, 'other.bin'), Buffer.alloc(17))
      const expected = value.storageStatus(10)
      const reads = vi.spyOn(fileSystem, 'lstat')
      let finished = false
      let sentinelBeforeFinished = false
      const sentinel = new Promise<void>((resolve) =>
        setImmediate(() => {
          sentinelBeforeFinished = !finished
          resolve()
        })
      )
      const actual = await value.storageStatusAsync(10)
      finished = true
      await sentinel
      expect(actual).toEqual(expected)
      expect(actual.rawBytes).toBe(130 * 13)
      expect(sentinelBeforeFinished).toBe(true)
      const paths = reads.mock.calls.map(([path]) => String(path))
      expect(new Set(paths).size).toBe(paths.length)
    } finally {
      value.close()
    }
  })

  test('does not follow a junction outside the data root', async () => {
    const value = repository()
    const outside = mkdtempSync(join(tmpdir(), 'member-analysis-synthetic-outside-'))
    roots.push(outside)
    writeFileSync(join(outside, 'sentinel.bin'), Buffer.alloc(999))
    const before = value.storageStatus(10)
    try {
      symlinkSync(
        outside,
        join(value.rawRoot, 'outside-link'),
        process.platform === 'win32' ? 'junction' : 'dir'
      )
      expect(await value.storageStatusAsync(10)).toEqual(before)
      expect(existsSync(join(outside, 'sentinel.bin'))).toBe(true)
    } finally {
      value.close()
    }
  })

  test('does not turn IO permission failures into successful zero statistics', async () => {
    const value = repository()
    try {
      const error = Object.assign(new Error('synthetic denied'), { code: 'EACCES' })
      vi.spyOn(fileSystem, 'lstat').mockRejectedValueOnce(error)
      await expect(value.storageStatusAsync(10)).rejects.toBe(error)
      const listingError = Object.assign(new Error('synthetic directory IO failure'), {
        code: 'EIO'
      })
      vi.spyOn(fileSystem, 'readdir').mockRejectedValueOnce(listingError)
      await expect(value.storageStatusAsync(10)).rejects.toBe(listingError)
    } finally {
      value.close()
    }
  })

  test('a missing tree uses the existing missing-path semantics without swallowing other failures', async () => {
    const value = repository()
    try {
      vi.spyOn(fileSystem, 'lstat').mockRejectedValueOnce(
        Object.assign(new Error('synthetic disappeared'), { code: 'ENOENT' })
      )
      expect(await value.storageStatusAsync(10)).toEqual({
        totalBytes: 0,
        rawBytes: 0,
        limitBytes: 10 * 1024 ** 3,
        overLimit: false,
        catalogGames: 0
      })
    } finally {
      value.close()
    }
  })
})

describe('durable asynchronous rank publication', () => {
  function commit(request: Parameters<typeof executeRankPublication>[0]) {
    const ranks = new OpponentRankRepository(request.path)
    ranks.openExisting()
    try {
      ranks.publishGames(request.games, request.publicationId)
    } finally {
      ranks.close()
    }
  }

  test('waits for the transaction and rejects synchronous write/read bypasses while publishing', async () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    writeAnalysis(value.stagingAnalysisPath, 2)
    let enter: () => void = () => {}
    const entered = new Promise<void>((resolve) => {
      enter = resolve
    })
    let resume: () => void = () => {}
    const resumed = new Promise<void>((resolve) => {
      resume = resolve
    })
    vi.mocked(executeRankPublication).mockImplementation(async (request) => {
      enter()
      await resumed
      commit(request)
    })
    try {
      const publication = value.publishStagingAsync([])
      await entered
      let readable = false
      const waiting = value.waitForPublication().then(() => {
        readable = true
      })
      let pruned = false
      const queued = value.opponentRanks.pruneAsync().then(() => {
        pruned = true
      })
      await Promise.resolve()
      expect(readable).toBe(false)
      expect(pruned).toBe(false)
      expect(value.publicationToken()).toBeNull()
      expect(() => value.readGames()).toThrow('publication is pending')
      expect(() => value.publishStaging()).toThrow('publication is pending')
      expect(() => value.opponentRanks.prune()).toThrow('Rank publication write is pending')
      resume()
      await expect(publication).resolves.toBe(2)
      await Promise.all([waiting, queued])
      expect(readable).toBe(true)
      expect(pruned).toBe(true)
      expect(value.readGames().total).toBe(2)
    } finally {
      resume()
      value.close()
    }
  })

  test('a failure before commit restores the previous analysis and retains rank history', async () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    writeAnalysis(value.stagingAnalysisPath, 2)
    vi.mocked(executeRankPublication).mockRejectedValue(new Error('synthetic precommit crash'))
    try {
      await expect(value.publishStagingAsync([])).rejects.toThrow(
        'Rank publication failed before commit'
      )
      expect(value.readGames().total).toBe(1)
      expect(existsSync(join(value.dbRoot, 'rank-publication.pending.json'))).toBe(false)
    } finally {
      value.close()
    }
  })

  test('a lost acknowledgement after commit preserves the committed analysis instead of rolling back', async () => {
    const value = repository()
    writeAnalysis(value.currentAnalysisPath, 1)
    writeAnalysis(value.stagingAnalysisPath, 2)
    vi.mocked(executeRankPublication).mockImplementation(async (request) => {
      commit(request)
      throw new Error('synthetic acknowledgement loss')
    })
    try {
      await expect(value.publishStagingAsync([])).resolves.toBe(2)
      expect(value.readGames().total).toBe(2)
    } finally {
      value.close()
    }
  })

  test.each([false, true])(
    'startup reconciles a pending journal using durable receipt committed=%s',
    (committed) => {
      const value = repository()
      const root = value.dataRoot
      writeAnalysis(value.currentAnalysisPath, 2)
      writeAnalysis(join(value.dbRoot, 'analysis.previous.sqlite3'), 1)
      const publicationId = randomUUID()
      writeFileSync(
        join(value.dbRoot, 'rank-publication.pending.json'),
        JSON.stringify({ publicationId, hadCurrent: true })
      )
      if (committed) value.opponentRanks.publishGames([], publicationId)
      value.close()
      const reopened = new MemberAnalysisRepository(root)
      try {
        reopened.initialize()
        expect(reopened.readGames().total).toBe(committed ? 2 : 1)
        expect(existsSync(join(reopened.dbRoot, 'rank-publication.pending.json'))).toBe(false)
      } finally {
        reopened.close()
      }
    }
  )
})

test('committed receipt without its installed analysis fails closed and preserves the previous file and journal', () => {
  const value = repository()
  const root = value.dataRoot
  const previous = join(value.dbRoot, 'analysis.previous.sqlite3')
  const journal = join(value.dbRoot, 'rank-publication.pending.json')
  writeAnalysis(previous, 1)
  const publicationId = randomUUID()
  value.opponentRanks.publishGames([], publicationId)
  writeFileSync(journal, JSON.stringify({ publicationId, hadCurrent: true }))
  value.close()
  const reopened = new MemberAnalysisRepository(root)
  expect(() => reopened.initialize()).toThrow('Committed analysis is unavailable')
  expect(existsSync(previous)).toBe(true)
  expect(existsSync(journal)).toBe(true)
  reopened.close()
})

describe('private identity publication', () => {
  function candidate(value: MemberAnalysisRepository) {
    const raw = {
      json: {
        gameId: 1,
        teams: [],
        participants: Array.from({ length: 10 }, (_, i) => ({
          participantId: i + 1,
          puuid: `PRIVATE_TEST_ONLY_${i + 1}`,
          teamId: i < 5 ? 100 : 200
        }))
      }
    }
    const checksum = value.checksum(raw)
    const item = value.storeRaw('TEST', 1, 420, checksum, raw, {})
    writeAnalysis(value.stagingAnalysisPath, 1)
    const database = new DatabaseSync(value.stagingAnalysisPath)
    const game = syntheticGame(1)
    game.players = Array.from({ length: 5 }, (_, i) => ({
      ...game.players[0],
      player: `OLD_TEST_ONLY_${i + 1}`,
      participantId: i + 1
    }))
    database
      .prepare('UPDATE derived_games SET checksum=?,payload_json=?')
      .run(checksum, JSON.stringify(game))
    database.exec(
      "CREATE TABLE game_identity_facts(server_id TEXT,game_id INTEGER,source_checksum TEXT,summary_digest TEXT,method_version INTEGER,payload_json TEXT,PRIMARY KEY(server_id,game_id)); INSERT INTO metadata VALUES('identity_facts_state','candidate-v1'); INSERT INTO metadata VALUES('identity_facts_count','1')"
    )
    database.prepare('INSERT INTO game_identity_facts VALUES(?,?,?,?,?,?)').run(
      'TEST',
      1,
      checksum,
      createHash('sha256')
        .update(readFileSync(value.safePath(item.summaryPath)))
        .digest('hex'),
      1,
      JSON.stringify(raw.json.participants.map((actor) => ({ ...actor, profileIconId: null })))
    )
    database.close()
    vi.spyOn(PublishedIdentitiesExecutor.prototype, 'execute').mockImplementation(
      async (batch, current) => {
        current()
        return projectPublishedIdentityBatch(batch, current)
      }
    )
    vi.spyOn(PublishedIdentitiesExecutor.prototype, 'dispose').mockResolvedValue()
    vi.mocked(executeRankPublication).mockImplementation(async (request) => {
      const ranks = new OpponentRankRepository(request.path)
      ranks.openExisting()
      try {
        ranks.publishGames(request.games, request.publicationId)
      } finally {
        ranks.close()
      }
    })
    return item
  }
  test('only verified async publication exposes facts and raw removal no longer invalidates them', async () => {
    const value = repository()
    try {
      const item = candidate(value)
      expect(() => value.publishStaging()).toThrow('asynchronous verified')
      const committed = vi.fn()
      expect(await value.publishStagingAsync([], { onCommit: committed })).toBe(1)
      expect(committed).toHaveBeenCalledOnce()
      rmSync(value.safePath(item.summaryPath))
      const rows = value.readPublishedIdentityRows(null, 25)
      expect(rows[0].identityFacts).toBeDefined()
      const projected = await projectPublishedIdentityBatch({
        dataRoot: value.dataRoot,
        tasks: rows.map((row) => ({
          serverId: row.server_id,
          gameId: row.game_id,
          checksum: row.checksum,
          payload: row.payload_json,
          ambiguous: row.ambiguous,
          identityFacts: row.identityFacts
        })),
        members: [{ slot: 4, serverId: 'TEST', puuid: 'PRIVATE_TEST_ONLY_3' }]
      })
      expect(projected[0].members).toEqual([
        { memberId: 'member-slot-4', player: 'OLD_TEST_ONLY_3' }
      ])
      expect(JSON.stringify(projected)).not.toContain('PRIVATE_TEST_ONLY')
      expect(value.readPublishedProfileRows([1])[0].identityFacts).toBeDefined()
    } finally {
      value.close()
    }
  })
  test('forged source bytes fail before commit and preserve the previous publication', async () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 2)
      candidate(value)
      const database = new DatabaseSync(value.stagingAnalysisPath)
      database.prepare('UPDATE game_identity_facts SET summary_digest=?').run('a'.repeat(64))
      database.close()
      const commit = vi.fn()
      await expect(value.publishStagingAsync([], { onCommit: commit })).rejects.toThrow(
        'verification failed'
      )
      expect(commit).not.toHaveBeenCalled()
      expect(value.readGames().total).toBe(2)
      const check = new DatabaseSync(value.stagingAnalysisPath)
      expect(
        check.prepare("SELECT value FROM metadata WHERE key='identity_facts_state'").get()
      ).toEqual({ value: 'candidate-v1' })
      check.close()
    } finally {
      value.close()
    }
  })
  test('mid-verification cancellation drains before release and does not mark or commit', async () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 2)
      candidate(value)
      let enter: () => void = () => {},
        release: () => void = () => {}
      const entered = new Promise<void>((resolve) => {
        enter = resolve
      })
      const waiting = new Promise<void>((resolve) => {
        release = resolve
      })
      vi.spyOn(PublishedIdentitiesExecutor.prototype, 'execute').mockImplementation(
        async (_batch, current) => {
          enter()
          await waiting
          current()
          return []
        }
      )
      const controller = new AbortController(),
        commit = vi.fn()
      let settled = false
      const publication = value.publishStagingAsync([], {
        signal: controller.signal,
        onCommit: commit
      })
      const outcome = publication.then(
        () => {
          settled = true
        },
        () => {
          settled = true
        }
      )
      await entered
      controller.abort(new Error('cancelled'))
      await Promise.resolve()
      expect(settled).toBe(false)
      expect(commit).not.toHaveBeenCalled()
      release()
      await expect(publication).rejects.toThrow('cancelled')
      await outcome
      expect(value.readGames().total).toBe(2)
      const db = new DatabaseSync(value.stagingAnalysisPath)
      expect(
        db.prepare("SELECT value FROM metadata WHERE key='identity_facts_state'").get()
      ).toEqual({ value: 'candidate-v1' })
      db.close()
    } finally {
      value.close()
    }
  })
  test('candidate, unknown methods and broken coverage cannot be read as published facts', async () => {
    for (const mutation of [
      "UPDATE metadata SET value='candidate-v1' WHERE key='identity_facts_state'",
      'UPDATE game_identity_facts SET method_version=9',
      "UPDATE metadata SET value='2' WHERE key='identity_facts_count'",
      'DELETE FROM game_identity_facts'
    ]) {
      const value = repository()
      try {
        candidate(value)
        await value.publishStagingAsync([])
        const db = new DatabaseSync(value.currentAnalysisPath)
        db.exec(mutation)
        db.close()
        expect(() => value.readPublishedIdentityRows(null, 25)).toThrow('identity facts')
      } finally {
        value.close()
      }
    }
  })
  test('new publication layout damage never becomes legacy fallback', () => {
    for (const sql of [
      "INSERT INTO metadata VALUES('identity_facts_count','1')",
      "INSERT INTO metadata VALUES('identity_facts_state','future-v99')",
      'CREATE VIEW game_identity_facts AS SELECT 1 AS value'
    ]) {
      const value = repository()
      try {
        writeAnalysis(value.currentAnalysisPath, 1)
        const db = new DatabaseSync(value.currentAnalysisPath)
        db.exec(sql)
        db.close()
        expect(() => value.readPublishedIdentityRows(null, 25)).toThrow('identity facts')
      } finally {
        value.close()
      }
    }
  })
  test('cancellation before verification preserves old publication and never enters commit', async () => {
    const value = repository()
    try {
      writeAnalysis(value.currentAnalysisPath, 2)
      candidate(value)
      const controller = new AbortController()
      controller.abort(new Error('cancelled'))
      const commit = vi.fn()
      await expect(
        value.publishStagingAsync([], { signal: controller.signal, onCommit: commit })
      ).rejects.toThrow('cancelled')
      expect(commit).not.toHaveBeenCalled()
      expect(value.readGames().total).toBe(2)
    } finally {
      value.close()
    }
  })
})

describe('fresh configured member batch resolution', () => {
  test('one exact SQL snapshot preserves slot order, duplicate requests, special characters and server/case isolation', () => {
    const value = repository()
    try {
      value.recordMember('TEST', "Name' OR 1=1--", 'TAG', 'PRIVATE_TEST_ONLY_A', null)
      value.recordMember('OTHER', "Name' OR 1=1--", 'TAG', 'PRIVATE_TEST_ONLY_B', null)
      value.recordMember('TEST', 'Name', 'tag', 'PRIVATE_TEST_ONLY_C', null)
      const roster = [
        { serverId: 'OTHER', gameName: "Name' OR 1=1--", tagLine: 'TAG' },
        { serverId: 'TEST', gameName: "Name' OR 1=1--", tagLine: 'TAG' },
        { serverId: 'TEST', gameName: 'name', tagLine: 'tag' },
        { serverId: 'TEST', gameName: 'missing', tagLine: 'TAG' },
        { serverId: 'TEST', gameName: "Name' OR 1=1--", tagLine: 'TAG' }
      ]
      const expected = roster.map((m) =>
        value.resolveConfiguredMember(m.serverId, m.gameName, m.tagLine)
      )
      const prepare = vi.spyOn(DatabaseSync.prototype, 'prepare')
      expect(value.resolveConfiguredMembers(roster)).toEqual(expected)
      expect(prepare).toHaveBeenCalledTimes(1)
      expect(value.resolveConfiguredMembers([roster[1]])).toEqual([expected[1]])
      expect(
        value.resolveConfiguredMembers(
          Array.from({ length: 20 }, (_, i) => roster[i % roster.length])
        )
      ).toEqual(Array.from({ length: 20 }, (_, i) => expected[i % expected.length]))
      expect(() => value.resolveConfiguredMembers(Array(21).fill(roster[0]))).toThrow(
        'Invalid configured member batch'
      )
      prepare.mockClear()
      expect(value.resolveConfiguredMembers([])).toEqual([])
      expect(prepare).not.toHaveBeenCalled()
    } finally {
      value.close()
    }
  })
  test('malformed, missing and failed identities are isolated per slot exactly as the single resolver', () => {
    const value = repository()
    try {
      const inputs = [
        null,
        '',
        '00000000-0000-0000-0000-000000000000',
        ' whitespace ',
        'x'.repeat(257),
        'PRIVATE_TEST_ONLY_VALID'
      ]
      const roster = inputs.map((puuid, i) => {
        value.recordMember('TEST', `Member${i}`, 'TAG', puuid, null)
        return { serverId: 'TEST', gameName: `Member${i}`, tagLine: 'TAG' }
      })
      const db = new DatabaseSync(join(value.dbRoot, 'catalog.sqlite3'))
      db.prepare("UPDATE members SET updated_at='not-a-date' WHERE game_name='Member5'").run()
      value.recordMember('TEST', 'LatestFailure', 'TAG', 'PRIVATE_TEST_ONLY_FAILED', 'failed')
      roster.push({ serverId: 'TEST', gameName: 'LatestFailure', tagLine: 'TAG' })
      value.recordMember('TEST', 'Valid', 'TAG', 'PRIVATE_TEST_ONLY_GOOD', null)
      roster.push({ serverId: 'TEST', gameName: 'Valid', tagLine: 'TAG' })
      db.prepare(
        "UPDATE members SET updated_at='2026-01-01T01:00:00+01:00' WHERE game_name='Valid'"
      ).run()
      db.close()
      const expected = roster.map((m) =>
        value.resolveConfiguredMember(m.serverId, m.gameName, m.tagLine)
      )
      expect(value.resolveConfiguredMembers(roster)).toEqual(expected)
      expect(expected.slice(0, 7)).toEqual(Array(7).fill(null))
      expect(expected[7]?.puuid).toBe('PRIVATE_TEST_ONLY_GOOD')
      expect(expected[7]?.resolvedAt).toBe('2026-01-01T00:00:00.000Z')
    } finally {
      value.close()
    }
  })
  test('every call sees current identity, resolution status and timestamp; SQL failures are not cached or swallowed', () => {
    const value = repository(),
      member = { serverId: 'TEST', gameName: 'Member', tagLine: 'TAG' }
    try {
      expect(value.resolveConfiguredMembers([member])).toEqual([null])
      value.recordMember('TEST', 'Member', 'TAG', 'PRIVATE_TEST_ONLY_FIRST', null)
      const first = value.resolveConfiguredMembers([member])
      expect(first[0]?.puuid).toBe('PRIVATE_TEST_ONLY_FIRST')
      value.recordMember('TEST', 'Member', 'TAG', 'PRIVATE_TEST_ONLY_SECOND', null)
      expect(value.resolveConfiguredMembers([member])[0]?.puuid).toBe('PRIVATE_TEST_ONLY_SECOND')
      value.recordMember('TEST', 'Member', 'TAG', 'PRIVATE_TEST_ONLY_SECOND', 'failed')
      expect(value.resolveConfiguredMembers([member])).toEqual([null])
      const error = new Error('synthetic SQL failure')
      vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementationOnce(() => {
        throw error
      })
      expect(() => value.resolveConfiguredMembers([member])).toThrow(error)
    } finally {
      value.close()
    }
  })
})
