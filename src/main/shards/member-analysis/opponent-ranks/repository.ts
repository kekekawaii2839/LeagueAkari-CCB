import {
  type OpponentRanks,
  OpponentRanksSchema,
  type PlayerRankSnapshot,
  PlayerRankSnapshotSchema
} from '@shared/shards/member-analysis/opponent-ranks'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { RankGameTarget } from './loader'

export type GameRankSnapshot = {
  serverId: string
  gameId: number
  ranks: OpponentRanks
  identities?: (string | null)[]
}

/** Independent, versioned descriptive cache. Never rewrites raw matches/derived history. */
export class OpponentRankRepository {
  private _database: DatabaseSync | null = null
  constructor(readonly path: string) {}

  initialize() {
    try {
      this._database = new DatabaseSync(this.path)
      const version = (
        this._database.prepare('PRAGMA user_version').get() as { user_version: number }
      ).user_version
      if (version > 3) throw new Error('Unsupported opponent rank cache version')
      this._database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS player_cache(key TEXT PRIMARY KEY, attempted_at TEXT NOT NULL, payload_json TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS game_snapshots(server_id TEXT NOT NULL, game_id INTEGER NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(server_id,game_id));
        CREATE TABLE IF NOT EXISTS player_observations(key TEXT NOT NULL, fetched_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(key,fetched_at));
        CREATE TABLE IF NOT EXISTS game_observations(server_id TEXT NOT NULL, game_id INTEGER NOT NULL, content_hash TEXT NOT NULL, stored_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(server_id,game_id,content_hash));
        CREATE TABLE IF NOT EXISTS game_players(server_id TEXT NOT NULL,game_id INTEGER NOT NULL,player_key TEXT NOT NULL,during_game INTEGER NOT NULL,payload_json TEXT NOT NULL,PRIMARY KEY(server_id,game_id,player_key));
        COMMIT;`)
      this._archiveLegacy(version)
      this._db().exec('PRAGMA user_version=3')
    } catch (error) {
      this.close()
      throw error
    }
  }
  close() {
    this._database?.close()
    this._database = null
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
  publishGames(games: GameRankSnapshot[]) {
    const validated = games.map((game) => ({
      ...game,
      ranks: OpponentRanksSchema.parse(game.ranks)
    }))
    const db = this._db()
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const game of validated) {
        const existing = this.readGame(game.serverId, game.gameId)
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
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
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
  publishLiveGame(target: RankGameTarget, ranks: OpponentRanks) {
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
    this._db()
      .prepare('DELETE FROM game_snapshots WHERE server_id=? AND game_id=?')
      .run(serverId, gameId)
  }
  prune() {
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
