import type { SgpMain } from '@main/shards/sgp'
import {
  type OpponentRanks,
  type PlayerRankSnapshot,
  RANK_CACHE_TTL_MS,
  type RankFailure,
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { setTimeout as delay } from 'node:timers/promises'

import type { GameRankSnapshot, OpponentRankRepository } from './repository'

export type RankGameTarget = {
  serverId: string
  gameId: number
  opponents: {
    puuid: string | null
    role: OpponentRanks['opponents'][number]['role']
    champion: string | null
  }[]
}

type RankLoadLimits = {
  requests: number
  milliseconds: number
  spacing: number
  timeout: number
  fresh?: boolean
  retries?: number
  retryDelay?: number
}

/** One refresh, bounded and cancellable. Identity and authenticated IO stay in main. */
export class OpponentRankLoader {
  constructor(
    private readonly _sgp: SgpMain,
    private readonly _repository: OpponentRankRepository
  ) {}

  async load(
    games: RankGameTarget[],
    signal: AbortSignal,
    onProgress: (processed: number, total: number, message: string) => void,
    limits: RankLoadLimits = { requests: 300, milliseconds: 90_000, spacing: 150, timeout: 12_000 }
  ): Promise<GameRankSnapshot[]> {
    const seen = new Map<string, PlayerRankSnapshot>()
    const circuit = new Map<string, RankFailure>()
    const networkFailures = new Map<string, number>()
    const started = Date.now()
    let lastProgress = started
    let requests = 0
    const query = async (
      serverId: string,
      puuid: string,
      previous: PlayerRankSnapshot | null
    ): Promise<PlayerRankSnapshot> => {
      const serverKey = serverId.toUpperCase()
      const retryCount = Math.min(2, Math.max(0, limits.retries ?? 2))
      let attempted = false
      let snapshot = this._fallback(previous, 'budget-exhausted')
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        signal.throwIfAborted()
        const unavailable = this._availability(serverId) ?? circuit.get(serverKey)
        if (unavailable) return this._fallback(previous, unavailable)
        const pause =
          (requests > 0 ? limits.spacing : 0) +
          (attempt > 0
            ? (limits.retryDelay ?? 500) * 2 ** (attempt - 1) * (1 + Math.random() * 0.25)
            : 0)
        const remaining = limits.milliseconds - (Date.now() - started)
        // Do not start artificial 1ms requests as the batch deadline approaches.
        if (requests >= limits.requests || remaining < pause + Math.min(1000, limits.timeout)) break
        if (pause > 0) await delay(pause, undefined, { signal })
        signal.throwIfAborted()
        const availabilityAfterPause = this._availability(serverId)
        if (availabilityAfterPause) return this._fallback(previous, availabilityAfterPause)
        const timeout = Math.min(limits.timeout, limits.milliseconds - (Date.now() - started))
        if (timeout < Math.min(1000, limits.timeout)) break
        requests++
        attempted = true
        try {
          const response = await this._sgp.api.leaguesLedge.getRankedStatsByPuuid(puuid, {
            __sgpServerId: serverId,
            retry: false,
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)])
          })
          signal.throwIfAborted()
          snapshot = normalizeRankedStats(response.data, new Date().toISOString())
          networkFailures.set(serverKey, 0)
          if (snapshot.status !== 'ok') {
            snapshot = this._fallback(previous, 'invalid-response')
            circuit.set(serverKey, 'invalid-response')
          }
          break
        } catch (error) {
          signal.throwIfAborted()
          const status = (error as { response?: { status?: number } }).response?.status
          const reason: RankFailure =
            status === 401
              ? 'auth-unavailable'
              : status === 403
                ? 'forbidden'
                : status === 404
                  ? 'not-found'
                  : status === 429
                    ? 'rate-limited'
                    : status === 405 || status === 501
                      ? 'unsupported'
                      : 'network-error'
          snapshot = this._fallback(previous, reason)
          const transient =
            status === undefined ||
            status === 408 ||
            status === 425 ||
            (status >= 500 && status !== 501)
          if (reason === 'network-error' && transient) continue
          if (['auth-unavailable', 'forbidden', 'rate-limited', 'unsupported'].includes(reason))
            circuit.set(serverKey, reason)
          else networkFailures.set(serverKey, 0)
          break
        }
      }
      if (attempted) {
        if (snapshot.reason === 'network-error') {
          const failures = (networkFailures.get(serverKey) ?? 0) + 1
          networkFailures.set(serverKey, failures)
          // One slow opponent cannot label the rest of the server as timed out.
          if (failures >= 3) circuit.set(serverKey, 'network-paused')
        }
        this._repository.writePlayer(serverId, puuid, snapshot)
      }
      return snapshot
    }
    const result: GameRankSnapshot[] = []
    if (games.length) onProgress(0, games.length, 'loading-opponent-ranks')
    // Successful per-match observations are fixed at their original query time.
    // Uncovered matches go first, so old history cannot starve behind new arrivals.
    const pending = games.map((game, index) => ({
      game,
      index,
      saved: limits.fresh ? undefined : this._repository.readGame(game.serverId, game.gameId)
    }))
    const usable = (snapshot: PlayerRankSnapshot | undefined) =>
      snapshot?.status === 'ok' &&
      (snapshot.solo.status !== 'missing' || snapshot.flex.status !== 'missing')
    pending.sort((a, b) => {
      const covered = (item: typeof a) =>
        item.saved?.opponents.every(({ snapshot }) => usable(snapshot)) ? 1 : 0
      // For uncovered history, oldest input first (collector supplies newest first).
      return covered(a) - covered(b) || b.index - a.index
    })
    for (const { game, saved } of pending) {
      signal.throwIfAborted()
      const opponents: OpponentRanks['opponents'] = []
      // Missing or ambiguous enemy identities never receive another player’s rank.
      const identityCounts = new Map<string, number>()
      for (const opponent of game.opponents)
        if (opponent.puuid)
          identityCounts.set(opponent.puuid, (identityCounts.get(opponent.puuid) ?? 0) + 1)
      for (let slot = 0; slot < 5; slot++) {
        signal.throwIfAborted()
        const opponent = game.opponents[slot]
        const puuid =
          game.opponents.length === 5 && opponent?.puuid && identityCounts.get(opponent.puuid) === 1
            ? opponent.puuid
            : null
        let snapshot: PlayerRankSnapshot
        const savedSnapshot =
          saved?.capture?.mode === 'live'
            ? puuid
              ? (this._repository.readGamePlayer(game.serverId, game.gameId, puuid) ?? undefined)
              : undefined
            : saved?.opponents.find((entry) => entry.slot === slot + 1)?.snapshot
        if (usable(savedSnapshot)) snapshot = savedSnapshot!
        else if (!puuid) snapshot = unavailableRank('identity-missing', new Date().toISOString())
        else {
          const key = `${game.serverId.toUpperCase()}:${puuid}`
          const seenSnapshot = seen.get(key)
          const previous =
            seenSnapshot ??
            (limits.fresh ? null : this._repository.readPlayer(game.serverId, puuid)) ??
            savedSnapshot ??
            null
          const age = previous ? Date.now() - Date.parse(previous.attemptedAt) : Infinity
          if (
            previous &&
            (seenSnapshot ||
              (!limits.fresh &&
                age >= 0 &&
                age <
                  (previous.status === 'ok'
                    ? RANK_CACHE_TTL_MS
                    : ['network-error', 'network-paused', 'budget-exhausted'].includes(
                          previous.reason ?? ''
                        )
                      ? 0
                      : 15 * 60_000)))
          )
            snapshot = previous
          else {
            snapshot = await query(game.serverId, puuid, previous)
          }
          seen.set(key, snapshot)
        }
        opponents.push({
          slot: slot + 1,
          role: opponent?.role ?? null,
          champion: opponent?.champion ?? null,
          ...(saved?.capture
            ? {
                capturedDuringGame: Boolean(
                  puuid &&
                  usable(savedSnapshot) &&
                  this._repository.wasGamePlayerCapturedLive(game.serverId, game.gameId, puuid)
                )
              }
            : {}),
          snapshot
        })
      }
      result.push({
        serverId: game.serverId,
        gameId: game.gameId,
        identities: game.opponents.map((player) => player.puuid),
        ranks: {
          version: 1,
          source: 'SGP leagues-ledge (current snapshot)',
          ...(saved?.capture ? { capture: saved.capture } : {}),
          serverId: game.serverId,
          opponents
        }
      })
      if (
        result.length === 1 ||
        result.length === games.length ||
        Date.now() - lastProgress >= 100
      ) {
        onProgress(result.length, games.length, 'loading-opponent-ranks')
        lastProgress = Date.now()
      }
      // A fully cached history must still yield so cancellation IPC can be processed.
      if (result.length % 25 === 0) await delay(0, undefined, { signal })
    }
    signal.throwIfAborted()
    this._repository.prune()
    // Loading priority must not reorder the published analysis.
    const order = new Map(games.map((game, index) => [`${game.serverId}:${game.gameId}`, index]))
    return result.sort(
      (a, b) => order.get(`${a.serverId}:${a.gameId}`)! - order.get(`${b.serverId}:${b.gameId}`)!
    )
  }

  private _availability(serverId: string): RankFailure | null {
    const { availability, isTokenReady } = this._sgp.state
    if (!availability.sgpServerId) return 'disconnected'
    if (availability.sgpServerId.toUpperCase() !== serverId.toUpperCase()) return 'cross-region'
    if (!availability.serversSupported.common) return 'unsupported'
    if (!isTokenReady) return 'auth-unavailable'
    return null
  }
  private _fallback(
    previous: PlayerRankSnapshot | null | undefined,
    reason: RankFailure
  ): PlayerRankSnapshot {
    const attemptedAt = new Date().toISOString()
    return previous?.fetchedAt
      ? { ...previous, status: 'stale', reason, attemptedAt }
      : unavailableRank(reason, attemptedAt)
  }
}
