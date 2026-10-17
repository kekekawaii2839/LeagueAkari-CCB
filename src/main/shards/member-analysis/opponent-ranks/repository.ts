import {
  type OpponentRanks,
  OpponentRanksSchema,
  type PlayerRankSnapshot,
  PlayerRankSnapshotSchema
} from '@shared/shards/member-analysis/opponent-ranks'
import type { RankQueue } from '@shared/shards/member-analysis/opponent-ranks'
import type { MemberAnalysisRankObservationHistoryPage } from '@shared/shards/member-analysis/rank-observation-history'
import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  rmSync
} from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import type { RankGameTarget } from './loader'

export type GamePlayerRankSnapshot = {
  puuid: string
  snapshot: PlayerRankSnapshot
  capturedDuringGame: boolean
}

export type GameRankSnapshot = {
  serverId: string
  gameId: number
  ranks: OpponentRanks
  identities?: (string | null)[]
  /** Main-only exact ten-player observations; never exposed as enemy slots. */
  playerSnapshots?: GamePlayerRankSnapshot[]
}

/** Independent, versioned descriptive cache. Never rewrites raw matches/derived history. */
export class OpponentRankRepository {
  private _historyCursors = new Map<
    string,
    {
      key: string
      queue: RankQueue
      scope: string
      pageSize: number
      upperRowid: number
      lastFetchedAt: string
      lastRowid: number
      createdAt: number
    }
  >()
  private _database: DatabaseSync | null = null
  private _writeTail: Promise<void> = Promise.resolve()
  private _externalPublication = false
  constructor(readonly path: string) {}

  initialize() {
    let backup: string | null = null
    let backupReady = false
    const existed = existsSync(this.path)
    try {
      this._database = new DatabaseSync(this.path)
      const version = (
        this._database.prepare('PRAGMA user_version').get() as { user_version: number }
      ).user_version
      if (version > 4) throw new Error('Unsupported opponent rank cache version')
      if (
        version === 4 &&
        !this._database
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publication_receipts'")
          .get()
      )
        throw new Error('Rank publication receipt storage is missing')
      if (existed && version < 4) {
        const checkpoint = this._database.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as {
          busy: number
        }
        if (checkpoint.busy !== 0) throw new Error('Rank migration storage is busy')
        backup = `${this.path}.migration-v4-${randomBytes(12).toString('hex')}`
        copyFileSync(this.path, backup)
        const descriptor = openSync(backup, 'r+')
        try {
          fsyncSync(descriptor)
        } finally {
          closeSync(descriptor)
        }
        backupReady = true
      }
      this._database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS player_cache(key TEXT PRIMARY KEY, attempted_at TEXT NOT NULL, payload_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS game_snapshots(server_id TEXT NOT NULL, game_id INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(server_id,game_id));
        CREATE TABLE IF NOT EXISTS player_observations(key TEXT NOT NULL, fetched_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(key,fetched_at));
        CREATE TABLE IF NOT EXISTS game_observations(server_id TEXT NOT NULL, game_id INTEGER NOT NULL, content_hash TEXT NOT NULL, stored_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(server_id,game_id,content_hash));
        CREATE TABLE IF NOT EXISTS game_players(server_id TEXT NOT NULL,game_id INTEGER NOT NULL,player_key TEXT NOT NULL,during_game INTEGER NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(server_id,game_id,player_key));
        CREATE TABLE IF NOT EXISTS publication_receipts(publication_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, committed_at TEXT NOT NULL);
        COMMIT;`)
      this._archiveLegacy(version)
      this._db().exec('PRAGMA user_version=4')
      if (backup) rmSync(backup)
    } catch (error) {
      this.close()
      if (backup && backupReady && existsSync(backup)) {
        const restored = `${this.path}.migration-restore-${randomBytes(12).toString('hex')}`
        copyFileSync(backup, restored)
        const descriptor = openSync(restored, 'r+')
        try {
          fsyncSync(descriptor)
        } finally {
          closeSync(descriptor)
        }
        for (const suffix of ['-wal', '-shm']) rmSync(`${this.path}${suffix}`, { force: true })
        renameSync(restored, this.path)
        rmSync(backup)
      }
      throw error
    }
  }

  /** Worker-only existing-schema connection: never runs migrations beside main. */
  openExisting() {
    if (!existsSync(this.path)) throw new Error('Rank publication storage is missing')
    const file = lstatSync(this.path)
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Invalid rank publication storage')
    this._database = new DatabaseSync(this.path)
    try {
      const version = this._db().prepare('PRAGMA user_version').get() as { user_version: number }
      if (version.user_version !== 4) throw new Error('Unsupported rank publication storage')
      this._db().exec('PRAGMA busy_timeout=5000')
    } catch (error) {
      this.close()
      throw error
    }
  }

  private _queueWrite<T>(operation: () => T | Promise<T>): Promise<T> {
    const execution = this._writeTail.then(operation)
    this._writeTail = execution.then(
      () => undefined,
      () => undefined
    )
    return execution
  }

  async withExternalPublication<T>(operation: () => Promise<T>): Promise<T> {
    return this._queueWrite(async () => {
      this._externalPublication = true
      try {
        return await operation()
      } finally {
        this._externalPublication = false
      }
    })
  }

  private _assertWritable() {
    if (this._externalPublication) throw new Error('Rank publication write is pending')
  }

  async writePlayerAsync(
    serverId: string,
    puuid: string,
    snapshot: PlayerRankSnapshot,
    signal?: AbortSignal
  ) {
    return this._queueWrite(() => {
      signal?.throwIfAborted()
      this.writePlayer(serverId, puuid, snapshot)
    })
  }

  async publishLiveGameAsync(
    target: RankGameTarget,
    ranks: OpponentRanks,
    snapshots?: GamePlayerRankSnapshot[],
    signal?: AbortSignal
  ) {
    return this._queueWrite(() => {
      signal?.throwIfAborted()
      this.publishLiveGame(target, ranks, snapshots)
    })
  }

  async pruneAsync(signal?: AbortSignal) {
    return this._queueWrite(() => {
      signal?.throwIfAborted()
      this.prune()
    })
  }

  publicationReceipt(publicationId: string): string | null {
    const row = this._db()
      .prepare('SELECT payload_hash FROM publication_receipts WHERE publication_id=?')
      .get(publicationId) as { payload_hash: string } | undefined
    if (row && !/^[0-9a-f]{64}$/.test(row.payload_hash))
      throw new Error('Invalid rank publication receipt')
    return row?.payload_hash ?? null
  }

  close() {
    this._database?.close()
    this._database = null
    this._historyCursors.clear()
  }

  readPlayer(serverId: string, puuid: string): PlayerRankSnapshot | null {
    const row = this._db()
      .prepare('SELECT payload_json FROM player_cache WHERE key=?')
      .get(this._key(serverId, puuid)) as { payload_json: string } | undefined
    if (!row) return null
    try {
      return PlayerRankSnapshotSchema.parse(JSON.parse(row.payload_json))
    } catch {
      return null
    }
  }
  writePlayer(serverId: string, puuid: string, snapshot: PlayerRankSnapshot) {
    this._assertWritable()
    const parsed = PlayerRankSnapshotSchema.parse(snapshot)
    const db = this._db()
    db.exec('BEGIN IMMEDIATE')
    try {
      const key = this._key(serverId, puuid)
      db.prepare('INSERT OR REPLACE INTO player_cache VALUES(?,?,?)').run(
        key,
        parsed.attemptedAt,
        JSON.stringify(parsed)
      )
      if (parsed.status === 'ok')
        db.prepare('INSERT OR IGNORE INTO player_observations VALUES(?,?,?)').run(
          key,
          parsed.fetchedAt!,
          JSON.stringify(parsed)
        )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  readPlayerHistory(serverId: string, puuid: string): PlayerRankSnapshot[] {
    return this._db()
      .prepare('SELECT payload_json FROM player_observations WHERE key=? ORDER BY fetched_at')
      .all(this._key(serverId, puuid))
      .flatMap((row) => {
        try {
          return [PlayerRankSnapshotSchema.parse(JSON.parse(row.payload_json as string))]
        } catch {
          return []
        }
      })
  }
  /** Indexed, bounded read of immutable query-time observations. The cursor is
   * opaque, ephemeral, scope-bound and pins append upper bound on its first page.
   * Existing (key,fetched_at) PK de-duplicates repeated observations/cache hits.
   */
  readPlayerHistoryPage(
    serverId: string,
    puuid: string,
    queue: RankQueue,
    pageSize: number,
    cursor: string | null,
    scope: string
  ): Pick<MemberAnalysisRankObservationHistoryPage, 'points' | 'pagination'> {
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > 100 ||
      !['solo', 'flex'].includes(queue)
    )
      throw new Error('Invalid rank history request')
    const key = this._key(serverId, puuid),
      now = Date.now()
    for (const [token, context] of this._historyCursors)
      if (now < context.createdAt || now - context.createdAt >= 30 * 60_000)
        this._historyCursors.delete(token)
    let state = cursor === null ? undefined : this._historyCursors.get(cursor)
    if (
      cursor !== null &&
      (!state ||
        state.key !== key ||
        state.queue !== queue ||
        state.scope !== scope ||
        state.pageSize !== pageSize)
    )
      throw new Error('Invalid rank history cursor')
    if (!state) {
      const upper = this._db()
        .prepare('SELECT COALESCE(MAX(rowid),0) AS bound FROM player_observations WHERE key=?')
        .get(key) as { bound: number }
      state = {
        key,
        queue,
        scope,
        pageSize,
        upperRowid: upper.bound,
        lastFetchedAt: '~',
        lastRowid: Number.MAX_SAFE_INTEGER,
        createdAt: now
      }
    }
    // All source writers use ISO UTC query timestamps. Only this identity's
    // indexed key/time range is read; never parse/sort an unlimited history.
    const rows = this._db()
      .prepare(
        `SELECT rowid AS row_id,fetched_at,payload_json FROM player_observations WHERE key=? AND fetched_at<=? AND rowid<=? AND (fetched_at<? OR (fetched_at=? AND rowid<?)) ORDER BY fetched_at DESC,rowid DESC LIMIT ?`
      )
      .all(
        key,
        state.lastFetchedAt,
        state.upperRowid,
        state.lastFetchedAt,
        state.lastFetchedAt,
        state.lastRowid,
        pageSize + 1
      ) as { row_id: number; fetched_at: string; payload_json: string }[]
    const selected = rows.slice(0, pageSize)
    const points: MemberAnalysisRankObservationHistoryPage['points'] = []
    for (const row of selected) {
      try {
        const snapshot = PlayerRankSnapshotSchema.parse(JSON.parse(row.payload_json))
        if (snapshot.status === 'ok' && snapshot.fetchedAt === row.fetched_at)
          points.push({
            fetchedAt: snapshot.fetchedAt,
            queueRank: snapshot[queue]
          })
      } catch {
        /* Corrupt individual observations never become invented ranks. */
      }
    }
    let nextCursor: string | null = null
    if (rows.length > pageSize && selected.length) {
      while (this._historyCursors.size >= 512)
        this._historyCursors.delete(this._historyCursors.keys().next().value!)
      nextCursor = randomBytes(24).toString('base64url')
      const last = selected.at(-1)!
      this._historyCursors.set(nextCursor, {
        ...state,
        lastFetchedAt: last.fetched_at,
        lastRowid: last.row_id
      })
    }
    return { points, pagination: { nextCursor } }
  }

  readGameHistory(serverId: string, gameId: number): OpponentRanks[] {
    return this._db()
      .prepare(
        'SELECT payload_json FROM game_observations WHERE server_id=? AND game_id=? ORDER BY stored_at,rowid'
      )
      .all(serverId, gameId)
      .flatMap((row) => {
        try {
          return [OpponentRanksSchema.parse(JSON.parse(row.payload_json as string))]
        } catch {
          return []
        }
      })
  }

  readGame(serverId: string, gameId: number): OpponentRanks | undefined {
    const row = this._db()
      .prepare('SELECT payload_json FROM game_snapshots WHERE server_id=? AND game_id=?')
      .get(serverId, gameId) as { payload_json: string } | undefined
    if (!row) return undefined
    // A damaged disposable snapshot is unavailable, never a fabricated rank.
    try {
      return OpponentRanksSchema.parse(JSON.parse(row.payload_json))
    } catch {
      return undefined
    }
  }
  publishGames(games: GameRankSnapshot[], publicationId?: string) {
    this._assertWritable()
    if (
      publicationId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(publicationId)
    )
      throw new Error('Invalid rank publication ID')
    const payloadHash = publicationId
      ? createHash('sha256').update(JSON.stringify(games)).digest('hex')
      : null
    const receipt = publicationId ? this.publicationReceipt(publicationId) : null
    if (receipt) {
      if (receipt !== payloadHash) throw new Error('Rank publication ID payload changed')
      return
    }
    const validated = games.map((game) => ({
      ...game,
      ranks: OpponentRanksSchema.parse(game.ranks)
    }))
    const db = this._db()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const game of validated) {
        if (game.ranks.serverId !== game.serverId) throw new Error('Invalid rank game region')
        const existing = this.readGame(game.serverId, game.gameId)
        if (game.playerSnapshots)
          this._storePlayerSnapshots(game.serverId, game.gameId, game.playerSnapshots, false)
        if (existing?.capture?.mode === 'live' && !game.ranks.capture) continue
        const opponents = game.ranks.opponents.map((entry) => {
          const puuid = game.identities?.[entry.slot - 1]
          const previous = puuid ? this.readGamePlayer(game.serverId, game.gameId, puuid) : null
          if (
            puuid &&
            this.wasGamePlayerCapturedLive(game.serverId, game.gameId, puuid) &&
            previous?.status === 'ok' &&
            (previous.solo.status !== 'missing' || previous.flex.status !== 'missing')
          )
            return { ...entry, snapshot: previous, capturedDuringGame: true }
          return entry
        })
        const ranks = {
          ...game.ranks,
          ...(existing?.capture ? { capture: existing.capture } : {}),
          opponents
        }
        if (game.identities)
          this._storeIdentities(game.serverId, game.gameId, game.identities, ranks)
        this._storeGame(game.serverId, game.gameId, JSON.stringify(ranks))
      }
      if (publicationId)
        db.prepare('INSERT INTO publication_receipts VALUES(?,?,?)').run(
          publicationId,
          payloadHash!,
          new Date().toISOString()
        )
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  /** Exact local identities only; no global-cache fallback or persisted changes. */
  readGamePlayers(
    serverId: string,
    gameId: number,
    puuids: readonly string[]
  ): Map<string, { snapshot: PlayerRankSnapshot | null; capturedDuringGame: boolean }> {
    const identities = [...new Set(puuids)]
    if (identities.length > 10) throw new Error('Too many match rank identities')
    const result = new Map<
      string,
      { snapshot: PlayerRankSnapshot | null; capturedDuringGame: boolean }
    >()
    if (!identities.length) return result
    const keys = new Map(identities.map((puuid) => [this._key(serverId, puuid), puuid]))
    const rows = this._db()
      .prepare(
        `SELECT player_key,payload_json,during_game FROM game_players
         WHERE server_id=? AND game_id=? AND player_key IN (${identities.map(() => '?').join(',')})`
      )
      .all(serverId, gameId, ...keys.keys()) as {
      player_key: string
      payload_json: string
      during_game: unknown
    }[]
    for (const row of rows) {
      const puuid = keys.get(row.player_key)
      if (puuid === undefined) continue
      let snapshot: PlayerRankSnapshot | null = null
      try {
        snapshot = PlayerRankSnapshotSchema.parse(JSON.parse(row.payload_json))
      } catch {
        // A corrupt disposable row must not discard valid neighbours.
      }
      result.set(puuid, { snapshot, capturedDuringGame: row.during_game === 1 })
    }
    return result
  }
  readGamePlayer(serverId: string, gameId: number, puuid: string): PlayerRankSnapshot | null {
    const row = this._db()
      .prepare(
        'SELECT payload_json FROM game_players WHERE server_id=? AND game_id=? AND player_key=?'
      )
      .get(serverId, gameId, this._key(serverId, puuid))
    if (!row) return null
    try {
      return PlayerRankSnapshotSchema.parse(JSON.parse(row.payload_json as string))
    } catch {
      return null
    }
  }
  wasGamePlayerCapturedLive(serverId: string, gameId: number, puuid: string): boolean {
    return (
      this._db()
        .prepare(
          'SELECT during_game FROM game_players WHERE server_id=? AND game_id=? AND player_key=?'
        )
        .get(serverId, gameId, this._key(serverId, puuid))?.during_game === 1
    )
  }
  private _storeIdentities(
    serverId: string,
    gameId: number,
    identities: (string | null)[],
    ranks: OpponentRanks
  ) {
    if (
      identities.length !== 5 ||
      new Set(identities.filter(Boolean)).size !== identities.filter(Boolean).length
    )
      throw new Error('Invalid rank identities')
    for (const entry of ranks.opponents) {
      const puuid = identities[entry.slot - 1]
      if (puuid)
        this._db()
          .prepare('INSERT OR REPLACE INTO game_players VALUES(?,?,?,?,?)')
          .run(
            serverId,
            gameId,
            this._key(serverId, puuid),
            Number(entry.capturedDuringGame === true),
            JSON.stringify(entry.snapshot)
          )
    }
  }
  private _storePlayerSnapshots(
    serverId: string,
    gameId: number,
    entries: GamePlayerRankSnapshot[],
    live: boolean
  ) {
    if (
      entries.length !== 10 ||
      entries.some(
        (entry) =>
          typeof entry.puuid !== 'string' ||
          !entry.puuid ||
          entry.puuid.length > 256 ||
          entry.puuid.trim() !== entry.puuid
      ) ||
      new Set(entries.map((entry) => entry.puuid)).size !== 10
    )
      throw new Error('Invalid ten-player rank identities')
    const parsed = entries.map((entry) => ({
      ...entry,
      snapshot: PlayerRankSnapshotSchema.parse(entry.snapshot)
    }))
    for (const entry of parsed) {
      const previous = this.readGamePlayer(serverId, gameId, entry.puuid)
      const keepLive =
        this.wasGamePlayerCapturedLive(serverId, gameId, entry.puuid) &&
        previous?.status === 'ok' &&
        (previous.solo.status !== 'missing' || previous.flex.status !== 'missing')
      const snapshot = keepLive ? previous! : entry.snapshot
      this._db()
        .prepare('INSERT OR REPLACE INTO game_players VALUES(?,?,?,?,?)')
        .run(
          serverId,
          gameId,
          this._key(serverId, entry.puuid),
          Number(keepLive || (live && snapshot.status === 'ok')),
          JSON.stringify(snapshot)
        )
    }
  }
  publishLiveGame(
    target: RankGameTarget,
    ranks: OpponentRanks,
    playerSnapshots?: GamePlayerRankSnapshot[]
  ) {
    this._assertWritable()
    const parsed = OpponentRanksSchema.parse(ranks)
    if (
      parsed.capture?.mode !== 'live' ||
      parsed.serverId !== target.serverId ||
      target.opponents.length !== 5 ||
      new Set(target.opponents.map((p) => p.puuid)).size !== 5 ||
      target.opponents.some((p) => !p.puuid)
    )
      throw new Error('Invalid live rank target')
    const db = this._db()
    db.exec('BEGIN IMMEDIATE')
    try {
      if (playerSnapshots) {
        if (
          !target.participants ||
          target.participants.length !== 10 ||
          playerSnapshots.some(
            (entry) => !target.participants!.some((player) => player.puuid === entry.puuid)
          )
        )
          throw new Error('Live rank identities do not match target')
        this._storePlayerSnapshots(target.serverId, target.gameId, playerSnapshots, true)
      }
      const existing = this.readGame(target.serverId, target.gameId)
      const opponents = parsed.opponents.map((entry) => {
        const puuid = target.opponents[entry.slot - 1].puuid!
        const previous = this.readGamePlayer(target.serverId, target.gameId, puuid)
        const snapshot =
          this.wasGamePlayerCapturedLive(target.serverId, target.gameId, puuid) &&
          previous?.status === 'ok' &&
          (previous.solo.status !== 'missing' || previous.flex.status !== 'missing')
            ? previous
            : entry.snapshot
        return { ...entry, snapshot, capturedDuringGame: snapshot.status === 'ok' }
      })
      const merged = { ...parsed, capture: existing?.capture ?? parsed.capture, opponents }
      this._storeIdentities(
        target.serverId,
        target.gameId,
        target.opponents.map((p) => p.puuid),
        merged
      )
      this._storeGame(target.serverId, target.gameId, JSON.stringify(merged))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  private _storeGame(serverId: string, gameId: number, payload: string) {
    const existing = this.readGame(serverId, gameId)
    // A manual refresh started earlier must not overwrite a newly captured live match.
    if (existing?.capture?.mode === 'live' && !JSON.parse(payload).capture) return
    this._db()
      .prepare('INSERT OR REPLACE INTO game_snapshots VALUES(?,?,?)')
      .run(serverId, gameId, payload)
    this._archiveGame(serverId, gameId, payload)
  }
  removeGame(serverId: string, gameId: number) {
    this._assertWritable()
    this._db()
      .prepare('DELETE FROM game_snapshots WHERE server_id=? AND game_id=?')
      .run(serverId, gameId)
  }
  prune() {
    this._assertWritable()
    this._db()
      .prepare('DELETE FROM player_cache WHERE attempted_at < ?')
      .run(new Date(Date.now() - 30 * 86400_000).toISOString())
    this._db().exec(
      'DELETE FROM player_cache WHERE key IN (SELECT key FROM player_cache ORDER BY attempted_at DESC LIMIT -1 OFFSET 10000)'
    )
  }
  private _archiveGame(serverId: string, gameId: number, payload: string) {
    this._db()
      .prepare('INSERT OR IGNORE INTO game_observations VALUES(?,?,?,?,?)')
      .run(
        serverId,
        gameId,
        createHash('sha256').update(payload).digest('hex'),
        new Date().toISOString(),
        payload
      )
  }
  private _archiveLegacy(version: number) {
    if (version >= 2) return
    const db = this._db()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of db.prepare('SELECT key,payload_json FROM player_cache').all()) {
        const parsed = (() => {
          try {
            return PlayerRankSnapshotSchema.safeParse(JSON.parse(row.payload_json as string))
          } catch {
            return null
          }
        })()
        if (parsed?.success && parsed.data.status === 'ok')
          db.prepare('INSERT OR IGNORE INTO player_observations VALUES(?,?,?)').run(
            row.key,
            parsed.data.fetchedAt!,
            JSON.stringify(parsed.data)
          )
      }
      for (const row of db
        .prepare('SELECT server_id,game_id,payload_json FROM game_snapshots')
        .all()) {
        const parsed = (() => {
          try {
            return OpponentRanksSchema.safeParse(JSON.parse(row.payload_json as string))
          } catch {
            return null
          }
        })()
        if (parsed?.success)
          this._archiveGame(
            row.server_id as string,
            row.game_id as number,
            JSON.stringify(parsed.data)
          )
      }
      db.exec('PRAGMA user_version=2; COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  private _key(serverId: string, puuid: string) {
    return createHash('sha256').update(`${serverId.toUpperCase()}:${puuid}`).digest('hex')
  }
  private _db() {
    if (!this._database) throw new Error('Opponent rank repository not initialized')
    return this._database
  }
}
