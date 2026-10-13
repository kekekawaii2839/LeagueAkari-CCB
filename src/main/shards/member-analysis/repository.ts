import {
  MEMBER_ANALYSIS_MIN_DURATION_SEC,
  type MemberAnalysisCleanupPreview,
  type MemberAnalysisCollectionAudit,
  MemberAnalysisCollectionAuditSchema,
  type MemberAnalysisFilters,
  type MemberAnalysisGame,
  MemberAnalysisGameSchema,
  type MemberAnalysisMatchDetails,
  type MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'
import { normalizeLegacyMemberAnalysisGame } from '@shared/shards/member-analysis/schemas'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync, gzipSync } from 'node:zlib'

import { type GameRankSnapshot, OpponentRankRepository } from './opponent-ranks/repository'

export type CatalogItem = {
  serverId: string
  gameId: number
  queueId: number
  checksum: string
  summaryPath: string
  detailsPath: string
}

const CATALOG_SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS catalog_games (
  server_id TEXT NOT NULL,
  game_id INTEGER NOT NULL,
  queue_id INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  summary_path TEXT NOT NULL,
  details_path TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(server_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_catalog_games_queue ON catalog_games(queue_id, game_id DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_games_fetched ON catalog_games(fetched_at, server_id, game_id);
CREATE TABLE IF NOT EXISTS members (
  server_id TEXT NOT NULL,
  game_name TEXT NOT NULL,
  tag_line TEXT NOT NULL,
  puuid TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(server_id, game_name, tag_line)
);
PRAGMA user_version=2;`

const GIB = 1024 ** 3
const ANALYSIS_SCHEMA_VERSION = 2
const DERIVATION_VERSION = '5'
const COMPATIBLE_DERIVATION_VERSIONS = new Set(['2', '3', '4', DERIVATION_VERSION])
const DEFAULT_FILTERS: MemberAnalysisFilters = {
  outcome: 'all',
  patch: 'all',
  dateFrom: '',
  dateTo: '',
  durationMin: null,
  durationMax: null,
  participant: 'all',
  matchRole: 'all',
  champion: 'all',
  query: ''
}

type CleanupCandidate = { serverId: string; gameId: number; folder: string; bytes: number }
type CleanupPlan = MemberAnalysisCleanupPreview & { candidates: CleanupCandidate[] }

export class MemberAnalysisRepository {
  readonly rawRoot: string
  readonly jobsRoot: string
  readonly dbRoot: string
  readonly catalogPath: string
  readonly currentAnalysisPath: string
  readonly stagingAnalysisPath: string
  readonly opponentRanks: OpponentRankRepository

  private _catalog: DatabaseSync | null = null
  private _cleanupPlan: CleanupPlan | null = null
  private _cleanupRunning = false
  private _overviewCounts: { scope: string; total: number; playerCount: number } | null = null

  constructor(readonly dataRoot: string) {
    this.dataRoot = resolve(dataRoot)
    this.rawRoot = join(this.dataRoot, 'raw')
    this.jobsRoot = join(this.dataRoot, 'jobs')
    this.dbRoot = join(this.dataRoot, 'db')
    this.catalogPath = join(this.dbRoot, 'catalog.sqlite3')
    this.currentAnalysisPath = join(this.dbRoot, 'analysis.sqlite3')
    this.stagingAnalysisPath = join(this.dbRoot, 'analysis.next.sqlite3')
    this.opponentRanks = new OpponentRankRepository(join(this.dbRoot, 'opponent-ranks.sqlite3'))
  }

  initialize() {
    this._overviewCounts = null
    mkdirSync(this.rawRoot, { recursive: true })
    mkdirSync(this.jobsRoot, { recursive: true })
    mkdirSync(this.dbRoot, { recursive: true })
    try {
      this._catalog = new DatabaseSync(this.catalogPath)
      const catalogVersion = (
        this._catalog.prepare('PRAGMA user_version').get() as { user_version: number }
      ).user_version
      if (catalogVersion > 2) throw new Error('Unsupported member analysis catalog version')
      this._catalog.exec(CATALOG_SCHEMA)
      this._migrateAnalysisDatabase()
      this.opponentRanks.initialize()
    } catch (error) {
      this._catalog?.close()
      this._catalog = null
      this.opponentRanks.close()
      throw error
    }
  }

  close() {
    this._overviewCounts = null
    this.opponentRanks.close()
    this._catalog?.close()
    this._catalog = null
  }

  checksum(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex')
  }

  knownChecksum(serverId: string, gameId: number): string | null {
    const row = this._db()
      .prepare('SELECT checksum FROM catalog_games WHERE server_id = ? AND game_id = ?')
      .get(serverId, gameId) as { checksum: string } | undefined
    return row?.checksum ?? null
  }

  catalogItem(serverId: string, gameId: number): CatalogItem | null {
    const row = this._db()
      .prepare(
        `SELECT server_id,game_id,queue_id,checksum,summary_path,details_path
         FROM catalog_games WHERE server_id = ? AND game_id = ?`
      )
      .get(serverId, gameId) as
      | {
          server_id: string
          game_id: number
          queue_id: number
          checksum: string
          summary_path: string
          details_path: string
        }
      | undefined
    return row
      ? {
          serverId: row.server_id,
          gameId: row.game_id,
          queueId: row.queue_id,
          checksum: row.checksum,
          summaryPath: row.summary_path,
          detailsPath: row.details_path
        }
      : null
  }

  /** Main-only initial prediction source reconciliation; never scans current derived outcomes. */
  readPredictionSource(gameId: number): { serverId: string; summary: unknown } {
    if (!Number.isSafeInteger(gameId) || gameId <= 0) throw new Error('Invalid prediction source')
    const servers = this._db()
      .prepare('SELECT server_id FROM catalog_games WHERE game_id=? LIMIT 2')
      .all(gameId) as { server_id: string }[]
    if (servers.length !== 1) throw new Error('Prediction source is missing or ambiguous')
    const serverId = servers[0].server_id
    const item = this.catalogItem(serverId, gameId)!
    const expected = this.safePath(
      join('raw', this.safeSegment(serverId), String(gameId), 'summary.json.gz')
    )
    if (this.safePath(item.summaryPath) !== expected)
      throw new Error('Invalid prediction source path')
    const root = realpathSync(this.dataRoot)
    let part = this.dataRoot
    for (const segment of relative(this.dataRoot, expected).split(sep)) {
      part = join(part, segment)
      if (lstatSync(part).isSymbolicLink()) throw new Error('Invalid prediction source location')
    }
    const actual = realpathSync(expected)
    if (!actual.startsWith(`${root}${sep}`)) throw new Error('Invalid prediction source location')
    const sourceStat = lstatSync(actual)
    if (!sourceStat.isFile() || sourceStat.size > 32 * 1024 * 1024)
      throw new Error('Invalid prediction source size')
    const summary = JSON.parse(
      gunzipSync(readFileSync(actual), { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8')
    )
    if (
      summary?.json?.gameId !== gameId ||
      !Array.isArray(summary.json.participants) ||
      !Array.isArray(summary.json.teams)
    )
      throw new Error('Invalid prediction source summary')
    return { serverId, summary }
  }

  /** Future-only expansion: inspect raw start before loading any derived outcome payload. */
  readFuturePredictionGames(studyCreatedAtMs: number, cutoffMs: number) {
    if (
      !Number.isSafeInteger(studyCreatedAtMs) ||
      !Number.isSafeInteger(cutoffMs) ||
      studyCreatedAtMs < 0 ||
      cutoffMs < studyCreatedAtMs ||
      cutoffMs > Date.now()
    )
      throw new Error('Invalid future prediction window')
    const catalog = this._db()
      .prepare(
        'SELECT game_id FROM catalog_games WHERE fetched_at >= ? ORDER BY fetched_at,server_id,game_id LIMIT 10001'
      )
      .all(new Date(studyCreatedAtMs).toISOString()) as { game_id: number }[]
    if (catalog.length > 10000) throw new Error('Future prediction source budget exceeded')
    const games: unknown[] = []
    const queueEntries: [string, number][] = []
    let database: DatabaseSync | null = null
    try {
      for (const item of catalog) {
        const source = this.readPredictionSource(item.game_id)
        const raw = (source.summary as { json: Record<string, unknown> }).json
        const start = raw.gameStartTimestamp || raw.gameCreation
        if (!Number.isSafeInteger(start)) throw new Error('Missing future source start')
        if (Number(start) < studyCreatedAtMs || Number(start) >= cutoffMs) continue
        if (!Number.isSafeInteger(raw.gameEndTimestamp))
          throw new Error('Missing future source end')
        if (Number(raw.gameEndTimestamp) >= cutoffMs) continue
        if (typeof raw.gameDuration !== 'number') throw new Error('Missing future duration')
        if (raw.gameDuration < 900) continue
        if (!database) {
          if (!existsSync(this.currentAnalysisPath)) throw new Error('Future features not ready')
          database = new DatabaseSync(this.currentAnalysisPath, { readOnly: true })
        }
        const row = database
          .prepare('SELECT payload_json FROM derived_games WHERE server_id=? AND game_id=?')
          .get(source.serverId, item.game_id) as { payload_json: string } | undefined
        if (!row) throw new Error('Future features not ready')
        games.push(JSON.parse(row.payload_json))
        queueEntries.push([`${start}|${item.game_id}`, Number(raw.queueId)])
        if (games.length > 167) throw new Error('Future prediction input budget exceeded')
      }
    } finally {
      database?.close()
    }
    return { games, queueEntries, studyCreatedAtMs, observedAtMs: Date.now() }
  }

  readMatchDetails(gameId: number): MemberAnalysisMatchDetails | null {
    if (!existsSync(this.currentAnalysisPath)) return null
    const database = new DatabaseSync(this.currentAnalysisPath, { readOnly: true })
    let rows: { server_id: string }[]
    try {
      rows = database
        .prepare(
          `SELECT server_id FROM derived_games WHERE game_id = ?
         AND json_extract(payload_json,'$.duration') >= ? LIMIT 2`
        )
        .all(gameId, MEMBER_ANALYSIS_MIN_DURATION_SEC) as { server_id: string }[]
    } finally {
      database.close()
    }
    // Do not guess the region when legacy datasets contain a colliding game ID.
    if (rows.length !== 1) return null
    const serverId = rows[0].server_id
    const item = this.catalogItem(serverId, gameId)
    if (!item) return null
    const read = (name: 'summary' | 'details', indexedPath: string) => {
      const expected = this.safePath(
        join('raw', this.safeSegment(serverId), String(gameId), `${name}.json.gz`)
      )
      if (this.safePath(indexedPath) !== expected) throw new Error('Invalid cached match path')
      if (!existsSync(expected)) return null
      const actual = realpathSync(expected)
      const rawRoot = realpathSync(this.rawRoot)
      if (!actual.startsWith(`${rawRoot}${sep}`)) throw new Error('Invalid cached match location')
      return JSON.parse(
        gunzipSync(readFileSync(actual), { maxOutputLength: 32 * 1024 * 1024 }).toString('utf8')
      )
    }
    const summary = read('summary', item.summaryPath)
    if (!summary) return null
    if (
      summary.json?.gameId !== gameId ||
      !Array.isArray(summary.json?.participants) ||
      !Array.isArray(summary.json?.teams)
    )
      throw new Error('Invalid cached match summary')
    const details = read('details', item.detailsPath)
    if (details && (details.json?.gameId !== gameId || !Array.isArray(details.json?.frames)))
      throw new Error('Invalid cached match timeline')
    return {
      serverId,
      summary: { source: 'sgp', gameId, data: summary },
      details: details ? { source: 'sgp', gameId, data: details } : null
    }
  }

  updateRawSummary(item: CatalogItem, summary: unknown) {
    const summaryPath = this.safePath(item.summaryPath)
    this._atomicWrite(summaryPath, gzipSync(JSON.stringify(summary)))
  }

  storeRaw(
    serverId: string,
    gameId: number,
    queueId: number,
    checksum: string,
    summary: unknown,
    details: unknown
  ): CatalogItem {
    const folder = this.safePath(join('raw', this.safeSegment(serverId), String(gameId)))
    mkdirSync(folder, { recursive: true })
    const summaryPath = join(folder, 'summary.json.gz')
    const detailsPath = join(folder, 'details.json.gz')
    this._atomicWrite(summaryPath, gzipSync(JSON.stringify(summary)))
    this._atomicWrite(detailsPath, gzipSync(JSON.stringify(details)))
    const item = {
      serverId,
      gameId,
      queueId,
      checksum,
      summaryPath: this.relativePath(summaryPath),
      detailsPath: this.relativePath(detailsPath)
    }
    this._db()
      .prepare(
        `INSERT INTO catalog_games(server_id,game_id,queue_id,checksum,summary_path,details_path,fetched_at)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(server_id,game_id) DO UPDATE SET
         queue_id=excluded.queue_id,checksum=excluded.checksum,summary_path=excluded.summary_path,
         details_path=excluded.details_path,fetched_at=excluded.fetched_at`
      )
      .run(
        serverId,
        gameId,
        queueId,
        checksum,
        item.summaryPath,
        item.detailsPath,
        new Date().toISOString()
      )
    return item
  }

  recordMember(
    serverId: string,
    gameName: string,
    tagLine: string,
    puuid: string | null,
    error: string | null
  ) {
    this._db()
      .prepare(
        `INSERT INTO members(server_id,game_name,tag_line,puuid,last_error,updated_at) VALUES(?,?,?,?,?,?)
         ON CONFLICT(server_id,game_name,tag_line) DO UPDATE SET
         puuid=excluded.puuid,last_error=excluded.last_error,updated_at=excluded.updated_at`
      )
      .run(serverId, gameName, tagLine, puuid, error, new Date().toISOString())
  }

  writeJobManifest(jobId: string, items: CatalogItem[], audit: MemberAnalysisCollectionAudit) {
    const jobRoot = this.safePath(join('jobs', this.safeSegment(jobId)))
    mkdirSync(jobRoot, { recursive: true })
    const path = join(jobRoot, 'manifest.json')
    this._atomicWrite(path, Buffer.from(JSON.stringify({ contractVersion: 1, items, audit })))
    return {
      manifest: this.relativePath(path),
      checkpoint: this.relativePath(join(jobRoot, 'checkpoint.json')),
      staging: this.relativePath(this.stagingAnalysisPath),
      current: this.relativePath(this.currentAnalysisPath)
    }
  }

  publishStaging(rankSnapshots: GameRankSnapshot[] = []) {
    // A publication attempt (including rollback) ends any prior count scope.
    this._overviewCounts = null
    if (!existsSync(this.stagingAnalysisPath)) throw new Error('analysis staging database missing')
    const staging = new DatabaseSync(this.stagingAnalysisPath)
    let count: number
    try {
      staging.exec('PRAGMA wal_checkpoint(TRUNCATE)')
      const integrity = (
        staging.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      ).integrity_check
      if (integrity !== 'ok') throw new Error('analysis staging integrity check failed')
      count = (
        staging.prepare('SELECT COUNT(*) AS count FROM derived_games').get() as { count: number }
      ).count
    } finally {
      staging.close()
    }
    const previous = join(this.dbRoot, 'analysis.previous.sqlite3')
    let movedCurrent = false
    let installedStaging = false
    try {
      this._removeDatabaseFile(previous)
      this._removeSqliteSidecars(this.stagingAnalysisPath)
      this._removeSqliteSidecars(this.currentAnalysisPath)
      if (existsSync(this.currentAnalysisPath)) {
        this._renameWithRetry(this.currentAnalysisPath, previous)
        movedCurrent = true
      }
      this._renameWithRetry(this.stagingAnalysisPath, this.currentAnalysisPath)
      installedStaging = true
      this.opponentRanks.publishGames(rankSnapshots)
      this._removeDatabaseFile(previous)
    } catch (error) {
      if (movedCurrent && existsSync(previous)) {
        this._removeDatabaseFile(this.currentAnalysisPath)
        this._renameWithRetry(previous, this.currentAnalysisPath)
      } else if (installedStaging) this._removeDatabaseFile(this.currentAnalysisPath)
      throw error
    }
    return count
  }

  readGames(input?: {
    filters?: MemberAnalysisFilters
    cursor?: string | null
    pageSize?: number
  }): {
    generatedAt: string | null
    source: string
    games: MemberAnalysisGame[]
    total: number
    playerCount: number
    nextCursor: string | null
    collectionAudit: MemberAnalysisCollectionAudit | null
  } {
    if (!existsSync(this.currentAnalysisPath)) {
      this._overviewCounts = null
      return {
        generatedAt: null,
        source: 'SGP 对局历史与详情',
        games: [],
        total: 0,
        playerCount: 0,
        nextCursor: null,
        collectionAudit: null
      }
    }
    let database: DatabaseSync | null = null
    try {
      database = new DatabaseSync(this.currentAnalysisPath, { readOnly: true })
      const derivation = database
        .prepare("SELECT value FROM metadata WHERE key='derivation_version'")
        .get() as { value: string } | undefined
      if (!derivation?.value || !COMPATIBLE_DERIVATION_VERSIONS.has(derivation.value))
        throw new Error('Unsupported member analysis derivation version')
      const filters = input?.filters ?? DEFAULT_FILTERS
      const pageSize = Math.min(100, Math.max(1, input?.pageSize ?? 25))
      const { sql: whereSql, params } = this._filterSql(filters)
      const cursor = this._decodeCursor(input?.cursor ?? null)
      const cursorSql = cursor ? ' AND (game_id < ? OR (game_id = ? AND server_id > ?))' : ''
      const cursorParams = cursor ? [cursor.gameId, cursor.gameId, cursor.serverId] : []
      const rows = database
        .prepare(
          `SELECT server_id,game_id,payload_json FROM derived_games WHERE ${whereSql}${cursorSql}
           ORDER BY game_id DESC,server_id ASC LIMIT ?`
        )
        .all(...params, ...cursorParams, pageSize + 1) as {
        server_id: string
        game_id: number
        payload_json: string
      }[]
      const generatedAt = database
        .prepare("SELECT value FROM metadata WHERE key='generated_at'")
        .get() as { value: string } | undefined
      // Reuse only continuation-page counts for the same immutable publication
      // and complete filter scope. Keep one entry, not an unbounded query cache.
      // File identity also distinguishes publications with equal timestamps;
      // WAL identity covers in-place SQLite changes without a main-file write.
      const countScope = JSON.stringify([
        derivation.value,
        generatedAt?.value ?? null,
        Object.keys(DEFAULT_FILTERS).map((key) => filters[key as keyof MemberAnalysisFilters]),
        ...[this.currentAnalysisPath, `${this.currentAnalysisPath}-wal`].map((path) => {
          if (!existsSync(path)) return null
          const stat = statSync(path, { bigint: true })
          return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String)
        })
      ])
      let counts =
        cursor && this._overviewCounts?.scope === countScope ? this._overviewCounts : null
      if (!counts) {
        const total = (
          database
            .prepare(`SELECT COUNT(*) AS count FROM derived_games WHERE ${whereSql}`)
            .get(...params) as {
            count: number
          }
        ).count
        const playerCount = (
          database
            .prepare(
              `SELECT COUNT(DISTINCT json_extract(player.value,'$.player')) AS count
             FROM derived_games,json_each(derived_games.payload_json,'$.players') player
             WHERE ${whereSql}`
            )
            .get(...params) as { count: number }
        ).count
        counts = { scope: countScope, total, playerCount }
        this._overviewCounts = counts
      }
      const source = database.prepare("SELECT value FROM metadata WHERE key='source'").get() as
        { value: string } | undefined
      const auditRow = database
        .prepare("SELECT value FROM metadata WHERE key='collection_audit'")
        .get() as { value: string } | undefined
      const collectionAudit = auditRow
        ? MemberAnalysisCollectionAuditSchema.parse(JSON.parse(auditRow.value))
        : null
      return {
        generatedAt: generatedAt?.value ?? null,
        source: source?.value?.trim() || '来源未知',
        games: rows.slice(0, pageSize).map((row) => {
          const game =
            derivation.value === DERIVATION_VERSION
              ? MemberAnalysisGameSchema.parse(JSON.parse(row.payload_json))
              : normalizeLegacyMemberAnalysisGame(JSON.parse(row.payload_json))
          const ranks = this.opponentRanks.readGame(row.server_id, row.game_id)
          return ranks ? { ...game, opponentRanks: ranks } : game
        }),
        total: counts.total,
        playerCount: counts.playerCount,
        collectionAudit,
        nextCursor:
          rows.length > pageSize
            ? this._encodeCursor(rows[pageSize - 1].game_id, rows[pageSize - 1].server_id)
            : null
      }
    } catch (error) {
      this._overviewCounts = null
      throw error
    } finally {
      database?.close()
    }
  }

  storageStatus(limitGiB: number): MemberAnalysisStorageStatus {
    const totalBytes = this._treeBytes(this.dataRoot)
    const rawBytes = this._treeBytes(this.rawRoot)
    const catalogGames = (
      this._db().prepare('SELECT COUNT(*) AS count FROM catalog_games').get() as { count: number }
    ).count
    const limitBytes = limitGiB * GIB
    return { totalBytes, rawBytes, limitBytes, overLimit: totalBytes > limitBytes, catalogGames }
  }

  previewCleanup(limitGiB: number, limitBytesOverride?: number): MemberAnalysisCleanupPreview {
    const status = this.storageStatus(limitGiB)
    const limitBytes = limitBytesOverride ?? status.limitBytes
    const rows = this._db()
      .prepare(
        'SELECT server_id,game_id,summary_path,details_path FROM catalog_games ORDER BY fetched_at ASC,server_id ASC,game_id ASC'
      )
      .all() as { server_id: string; game_id: number; summary_path: string; details_path: string }[]
    const candidates: CleanupCandidate[] = []
    let reclaimableBytes = 0
    for (const row of rows) {
      if (status.totalBytes - reclaimableBytes <= limitBytes) break
      const summary = this.safePath(row.summary_path)
      const details = this.safePath(row.details_path)
      const folder = dirname(summary)
      const bytes =
        (existsSync(summary) ? statSync(summary).size : 0) +
        (existsSync(details) ? statSync(details).size : 0)
      candidates.push({ serverId: row.server_id, gameId: row.game_id, folder, bytes })
      reclaimableBytes += bytes
    }
    const fingerprint = JSON.stringify({
      totalBytes: status.totalBytes,
      limitBytes,
      candidates: candidates.map(({ serverId, gameId, bytes }) => [serverId, gameId, bytes])
    })
    const plan: CleanupPlan = {
      previewId: createHash('sha256').update(fingerprint).digest('hex'),
      createdAt: new Date().toISOString(),
      currentBytes: status.totalBytes,
      limitBytes,
      reclaimableBytes,
      gameCount: candidates.length,
      candidates
    }
    this._cleanupPlan = plan
    const { candidates: _candidates, ...preview } = plan
    return preview
  }

  confirmCleanup(
    previewId: string,
    limitGiB: number,
    limitBytesOverride?: number
  ): MemberAnalysisStorageStatus {
    if (this._cleanupRunning) throw new Error('member analysis cleanup is already running')
    const plan = this._cleanupPlan
    if (!plan || plan.previewId !== previewId) throw new Error('cleanup preview is stale')
    const desiredLimit = limitBytesOverride ?? limitGiB * GIB
    if (plan.limitBytes !== desiredLimit) throw new Error('cleanup preview is stale')
    const refreshed = this.previewCleanup(limitGiB, desiredLimit)
    if (refreshed.previewId !== previewId) throw new Error('cleanup preview is stale')
    const activePlan = this._cleanupPlan!
    this._cleanupRunning = true
    const trashRoot = this.safePath(join('.cleanup-trash', previewId))
    const moved: { from: string; to: string }[] = []
    try {
      mkdirSync(trashRoot, { recursive: true })
      for (const candidate of activePlan.candidates) {
        if (!existsSync(candidate.folder)) continue
        const target = join(trashRoot, `${candidate.serverId}-${candidate.gameId}`)
        renameSync(candidate.folder, target)
        moved.push({ from: candidate.folder, to: target })
      }
      this._db().exec('BEGIN IMMEDIATE')
      try {
        const remove = this._db().prepare(
          'DELETE FROM catalog_games WHERE server_id=? AND game_id=?'
        )
        for (const candidate of activePlan.candidates)
          remove.run(candidate.serverId, candidate.gameId)
        this._db().exec('COMMIT')
      } catch (error) {
        this._db().exec('ROLLBACK')
        throw error
      }
      rmSync(trashRoot, { recursive: true, force: true })
      this._cleanupPlan = null
      return this.storageStatus(limitGiB)
    } catch (error) {
      for (const item of moved.reverse()) if (existsSync(item.to)) renameSync(item.to, item.from)
      throw error
    } finally {
      this._cleanupRunning = false
    }
  }

  safePath(relativeValue: string) {
    const candidate = resolve(this.dataRoot, relativeValue)
    if (candidate !== this.dataRoot && !candidate.startsWith(`${this.dataRoot}${sep}`)) {
      throw new Error('member analysis path escapes data root')
    }
    return candidate
  }

  relativePath(path: string) {
    return relative(this.dataRoot, path).split(sep).join('/')
  }

  safeSegment(value: string) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error('invalid path segment')
    return value
  }

  private _atomicWrite(path: string, value: Buffer) {
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${process.pid}.tmp`
    writeFileSync(temporary, value, { flag: 'wx' })
    const fd = openSync(temporary, 'r+')
    try {
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, path)
  }

  private _removeDatabaseFile(path: string) {
    this._retryFileOperation(() => rmSync(path, { force: true }))
    this._removeSqliteSidecars(path)
  }

  private _removeSqliteSidecars(path: string) {
    for (const suffix of ['-wal', '-shm'])
      this._retryFileOperation(() => rmSync(`${path}${suffix}`, { force: true }))
  }

  private _renameWithRetry(from: string, to: string) {
    this._retryFileOperation(() => renameSync(from, to))
  }

  private _retryFileOperation(operation: () => void) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        operation()
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (attempt >= 20 || !['EACCES', 'EBUSY', 'EPERM'].includes(code ?? '')) throw error
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  }

  private _filterSql(filters: MemberAnalysisFilters) {
    const clauses = ['1=1']
    const params: (string | number)[] = []
    const add = (sql: string, ...values: (string | number)[]) => {
      clauses.push(sql)
      params.push(...values)
    }
    // Fixed eligibility is independent of user filters and precedes pagination/counts.
    add("json_extract(payload_json,'$.duration') >= ?", MEMBER_ANALYSIS_MIN_DURATION_SEC)
    if (filters.outcome !== 'all')
      add("json_extract(payload_json,'$.win') = ?", filters.outcome === 'win' ? 1 : 0)
    if (filters.patch !== 'all') add("json_extract(payload_json,'$.patch') = ?", filters.patch)
    if (filters.dateFrom) add("json_extract(payload_json,'$.date') >= ?", filters.dateFrom)
    if (filters.dateTo) add("json_extract(payload_json,'$.date') <= ?", filters.dateTo)
    if (filters.durationMin !== null)
      add("json_extract(payload_json,'$.duration') >= ?", filters.durationMin * 60)
    if (filters.durationMax !== null)
      add("json_extract(payload_json,'$.duration') <= ?", filters.durationMax * 60)
    if (
      filters.participant !== 'all' ||
      filters.matchRole !== 'all' ||
      filters.champion !== 'all'
    ) {
      const playerClauses = ['1=1']
      if (filters.participant !== 'all') {
        playerClauses.push("json_extract(p.value,'$.player') = ?")
        params.push(filters.participant)
      }
      if (filters.matchRole !== 'all') {
        playerClauses.push("json_extract(p.value,'$.role') = ?")
        params.push(filters.matchRole)
      }
      if (filters.champion !== 'all') {
        playerClauses.push("json_extract(p.value,'$.champion') = ?")
        params.push(filters.champion)
      }
      clauses.push(
        `EXISTS (SELECT 1 FROM json_each(payload_json,'$.players') p WHERE ${playerClauses.join(' AND ')})`
      )
    }
    if (filters.query)
      add(
        "lower(payload_json) LIKE ? ESCAPE '\\'",
        `%${filters.query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`
      )
    return { sql: clauses.join(' AND '), params }
  }

  private _encodeCursor(gameId: number, serverId: string) {
    return Buffer.from(JSON.stringify({ v: 1, gameId, serverId })).toString('base64url')
  }

  private _decodeCursor(value: string | null): { gameId: number; serverId: string } | null {
    if (!value) return null
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
      if (
        parsed?.v !== 1 ||
        !Number.isSafeInteger(parsed.gameId) ||
        typeof parsed.serverId !== 'string'
      )
        throw new Error()
      return { gameId: parsed.gameId, serverId: this.safeSegment(parsed.serverId) }
    } catch {
      throw new Error('invalid member analysis cursor')
    }
  }

  private _treeBytes(root: string): number {
    if (!existsSync(root)) return 0
    const info = lstatSync(root)
    if (info.isSymbolicLink()) return 0
    if (info.isFile()) return info.size
    return readdirSync(root).reduce((total, name) => total + this._treeBytes(join(root, name)), 0)
  }

  private _migrateAnalysisDatabase() {
    if (!existsSync(this.currentAnalysisPath)) return
    const backup = join(this.dbRoot, 'analysis.migration-backup.sqlite3')
    copyFileSync(this.currentAnalysisPath, backup)
    let database: DatabaseSync | null = null
    try {
      database = new DatabaseSync(this.currentAnalysisPath)
      const currentVersion = (
        database.prepare('PRAGMA user_version').get() as { user_version: number }
      ).user_version
      if (currentVersion > ANALYSIS_SCHEMA_VERSION) {
        throw new Error(
          `member analysis schema ${currentVersion} is newer than supported ${ANALYSIS_SCHEMA_VERSION}`
        )
      }
      if (currentVersion === ANALYSIS_SCHEMA_VERSION) {
        database.close()
        database = null
        rmSync(backup, { force: true })
        return
      }
      database.exec(`PRAGMA busy_timeout=5000;
        CREATE INDEX IF NOT EXISTS idx_derived_games_game ON derived_games(game_id DESC,server_id ASC);
        CREATE INDEX IF NOT EXISTS idx_derived_games_patch ON derived_games(json_extract(payload_json,'$.patch'));
        CREATE INDEX IF NOT EXISTS idx_derived_games_date ON derived_games(json_extract(payload_json,'$.date'));
        PRAGMA user_version=${ANALYSIS_SCHEMA_VERSION};`)
      const integrity = (
        database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
      ).integrity_check
      database.close()
      database = null
      if (integrity !== 'ok') throw new Error('analysis migration integrity check failed')
      rmSync(backup, { force: true })
    } catch (error) {
      database?.close()
      copyFileSync(backup, this.currentAnalysisPath)
      throw error
    }
  }

  private _db() {
    if (!this._catalog) throw new Error('member analysis repository is not initialized')
    return this._catalog
  }
}
