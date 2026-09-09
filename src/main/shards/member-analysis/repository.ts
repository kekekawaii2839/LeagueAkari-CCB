import {
  type MemberAnalysisCleanupPreview,
  type MemberAnalysisCollectionAudit,
  MemberAnalysisCollectionAuditSchema,
  type MemberAnalysisFilters,
  type MemberAnalysisGame,
  MemberAnalysisGameSchema,
  type MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'
import { createHash } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'

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
const DERIVATION_VERSION = '4'
const COMPATIBLE_DERIVATION_VERSIONS = new Set(['2', '3', DERIVATION_VERSION])
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

  private _catalog: DatabaseSync | null = null
  private _cleanupPlan: CleanupPlan | null = null
  private _cleanupRunning = false

  constructor(readonly dataRoot: string) {
    this.dataRoot = resolve(dataRoot)
    this.rawRoot = join(this.dataRoot, 'raw')
    this.jobsRoot = join(this.dataRoot, 'jobs')
    this.dbRoot = join(this.dataRoot, 'db')
    this.catalogPath = join(this.dbRoot, 'catalog.sqlite3')
    this.currentAnalysisPath = join(this.dbRoot, 'analysis.sqlite3')
    this.stagingAnalysisPath = join(this.dbRoot, 'analysis.next.sqlite3')
  }

  initialize() {
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
    } catch (error) {
      this._catalog?.close()
      this._catalog = null
      throw error
    }
  }

  close() {
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

  publishStaging() {
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
    try {
      this._removeDatabaseFile(previous)
      this._removeSqliteSidecars(this.stagingAnalysisPath)
      this._removeSqliteSidecars(this.currentAnalysisPath)
      if (existsSync(this.currentAnalysisPath)) {
        this._renameWithRetry(this.currentAnalysisPath, previous)
        movedCurrent = true
      }
      this._renameWithRetry(this.stagingAnalysisPath, this.currentAnalysisPath)
      this._removeDatabaseFile(previous)
    } catch (error) {
      if (movedCurrent && !existsSync(this.currentAnalysisPath) && existsSync(previous))
        this._renameWithRetry(previous, this.currentAnalysisPath)
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
    if (!existsSync(this.currentAnalysisPath))
      return {
        generatedAt: null,
        source: 'SGP 对局历史与详情',
        games: [],
        total: 0,
        playerCount: 0,
        nextCursor: null,
        collectionAudit: null
      }
    const database = new DatabaseSync(this.currentAnalysisPath, { readOnly: true })
    try {
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
      const generatedAt = database
        .prepare("SELECT value FROM metadata WHERE key='generated_at'")
        .get() as { value: string } | undefined
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
        games: rows
          .slice(0, pageSize)
          .map((row) => MemberAnalysisGameSchema.parse(JSON.parse(row.payload_json))),
        total,
        playerCount,
        collectionAudit,
        nextCursor:
          rows.length > pageSize
            ? this._encodeCursor(rows[pageSize - 1].game_id, rows[pageSize - 1].server_id)
            : null
      }
    } finally {
      database.close()
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
