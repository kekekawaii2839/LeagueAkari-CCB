import type { SgpMain } from '@main/shards/sgp'
import { EMPTY_PUUID } from '@shared/constants/common'
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
  /** All ten match identities; main-only and never serialized as opponents. */
  participants?: RankGameTarget['opponents']
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

  /** Fixed-roster, query-time observations only. No fabricated match or version association. */
  async loadCurrentPlayers(
    players: { serverId: string; puuid: string }[],
    signal: AbortSignal,
    assertCurrent: () => void,
    onSnapshot: (player: { serverId: string; puuid: string }, snapshot: PlayerRankSnapshot) => void
  ): Promise<void> {
    const unique = [
      ...new Map(
        players.map((player) => [JSON.stringify([player.serverId, player.puuid]), player])
      ).values()
    ]
    if (unique.length > 20) throw new Error('Current rank roster exceeds configured limit')
    const circuit = new Map<string, RankFailure>()
    for (const [index, player] of unique.entries()) {
      signal.throwIfAborted()
      assertCurrent()
      if (index) await delay(150, undefined, { signal })
      const unavailable =
        this._availability(player.serverId) ?? circuit.get(player.serverId.toUpperCase())
      if (unavailable) {
        onSnapshot(player, unavailableRank(unavailable, new Date().toISOString()))
        continue
      }
      let snapshot: PlayerRankSnapshot
      try {
        const response = await this._sgp.api.leaguesLedge.getRankedStatsByPuuid(player.puuid, {
          __sgpServerId: player.serverId,
          retry: false,
          signal: AbortSignal.any([signal, AbortSignal.timeout(6000)])
        })
        signal.throwIfAborted()
        assertCurrent()
        snapshot = normalizeRankedStats(response.data, new Date().toISOString())
      } catch (error) {
        signal.throwIfAborted()
        assertCurrent()
        const status = (error as { response?: { status?: number } }).response?.status
        const reason: RankFailure =
          status === 401
            ? 'auth-unavailable'
            : status === 403
              ? 'forbidden'
              : status === 429
                ? 'rate-limited'
                : status === 404
                  ? 'not-found'
                  : status === 405 || status === 501
                    ? 'unsupported'
                    : 'network-error'
        if (['auth-unavailable', 'forbidden', 'rate-limited', 'unsupported'].includes(reason))
          circuit.set(player.serverId.toUpperCase(), reason)
        snapshot = unavailableRank(reason, new Date().toISOString())
      }
      signal.throwIfAborted()
      assertCurrent()
      if (snapshot.status === 'ok')
        await this._repository.writePlayerAsync(player.serverId, player.puuid, snapshot, signal)
      onSnapshot(player, snapshot)
    }
  }

  async load(
    games: RankGameTarget[],
    signal: AbortSignal,
    onProgress: (processed: number, total: number, message: string) => void,
    limits: RankLoadLimits = { requests: 300, milliseconds: 90_000, spacing: 150, timeout: 12_000 }
  ): Promise<GameRankSnapshot[]> {
    const seen = new Map<string, PlayerRankSnapshot>()
    // Only this load's actual query outcomes, never global TTL or another game's saved fact.
    const freshSeen = new Map<string, PlayerRankSnapshot>()
    const circuit = new Map<string, RankFailure>()
    const networkFailures = new Map<string, number>()
    const started = Date.now()
    let lastProgress = started
    let requests = 0
    const query = async (
      serverId: string,
      puuid: string,
      previous: PlayerRankSnapshot | null,
      retryAllowance = limits.retries ?? 2,
      deferredRetry = false
    ): Promise<PlayerRankSnapshot> => {
      const serverKey = serverId.toUpperCase()
      const retryCount = Math.min(2, Math.max(0, retryAllowance))
      let attempted = false
      let snapshot = this._fallback(previous, 'budget-exhausted')
      for (let attempt = 0; attempt <= retryCount; attempt++) {
        signal.throwIfAborted()
        const unavailable = this._availability(serverId) ?? circuit.get(serverKey)
        if (unavailable) return this._fallback(previous, unavailable)
        const pause =
          (requests > 0 ? limits.spacing : 0) +
          (attempt > 0 || deferredRetry
            ? (limits.retryDelay ?? 500) *
              2 ** (attempt + (deferredRetry ? 1 : 0) - 1) *
              (1 + Math.random() * 0.25)
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
        await this._repository.writePlayerAsync(serverId, puuid, snapshot, signal)
      }
      return snapshot
    }
    const result: GameRankSnapshot[] = []
    if (games.length) onProgress(0, games.length, 'loading-opponent-ranks')
    // Successful per-match observations are fixed at their original query time.
    // Uncovered matches go first, so old history cannot starve behind new arrivals.
    const usable = (snapshot: PlayerRankSnapshot | undefined) =>
      snapshot?.status === 'ok' &&
      (snapshot.solo.status !== 'missing' || snapshot.flex.status !== 'missing')
    const pending = games.map((game, index) => {
      const saved = limits.fresh ? undefined : this._repository.readGame(game.serverId, game.gameId)
      const covered =
        !limits.fresh &&
        (game.participants !== undefined
          ? game.participants.length === 10 &&
            game.participants.every(
              (player) =>
                player.puuid &&
                usable(
                  this._repository.readGamePlayer(game.serverId, game.gameId, player.puuid) ??
                    undefined
                )
            )
          : saved?.opponents.every(({ snapshot }) => usable(snapshot)))
      return { game, index, saved, covered: Number(Boolean(covered)) }
    })
    pending.sort((a, b) => a.covered - b.covered || b.index - a.index)
    for (const { game, saved } of pending) {
      signal.throwIfAborted()
      if (game.participants !== undefined) {
        const participants = game.participants
        const valid =
          participants.length === 10 &&
          participants.every(
            (p) =>
              typeof p.puuid === 'string' &&
              p.puuid.length > 0 &&
              p.puuid.length <= 256 &&
              p.puuid !== EMPTY_PUUID &&
              p.puuid.trim() === p.puuid
          ) &&
          new Set(participants.map((p) => p.puuid)).size === 10 &&
          game.opponents.length === 5 &&
          new Set(game.opponents.map((p) => p.puuid)).size === 5 &&
          game.opponents.every(
            (p) => p.puuid && participants.some((member) => member.puuid === p.puuid)
          )
        const snapshots = new Map<string, PlayerRankSnapshot>()
        const existing = new Map<string, PlayerRankSnapshot | null>()
        const queried = new Set<string>()
        const keyFor = (puuid: string) => `${game.serverId}:${puuid}`
        if (valid) {
          // One attempt per unresolved identity before spending the remaining
          // budget on retries. Authentication/circuit/deadline guards still apply.
          for (const player of participants) {
            signal.throwIfAborted()
            const puuid = player.puuid!
            const prior = this._repository.readGamePlayer(game.serverId, game.gameId, puuid)
            existing.set(puuid, prior)
            const capturedLive = this._repository.wasGamePlayerCapturedLive(
              game.serverId,
              game.gameId,
              puuid
            )
            const remembered = freshSeen.get(keyFor(puuid))
            let snapshot: PlayerRankSnapshot
            if (usable(prior ?? undefined) && (!limits.fresh || capturedLive)) snapshot = prior!
            else if (remembered)
              snapshot =
                remembered.status === 'ok'
                  ? remembered
                  : this._fallback(prior, remembered.reason ?? 'network-error')
            else {
              snapshot = await query(game.serverId, puuid, prior, 0)
              queried.add(puuid)
              freshSeen.set(
                keyFor(puuid),
                snapshot.status === 'ok'
                  ? snapshot
                  : unavailableRank(snapshot.reason!, snapshot.attemptedAt)
              )
            }
            snapshots.set(puuid, snapshot)
          }
          if ((limits.retries ?? 2) > 0) {
            for (const puuid of queried) {
              const first = snapshots.get(puuid)!
              if (first.reason !== 'network-error') continue
              const snapshot = await query(
                game.serverId,
                puuid,
                existing.get(puuid) ?? null,
                Math.min(2, limits.retries ?? 2) - 1,
                true
              )
              snapshots.set(puuid, snapshot)
              freshSeen.set(
                keyFor(puuid),
                snapshot.status === 'ok'
                  ? snapshot
                  : unavailableRank(snapshot.reason!, snapshot.attemptedAt)
              )
            }
          }
        }
        const playerSnapshots = valid
          ? participants.map((player) => {
              const puuid = player.puuid!
              const prior = existing.get(puuid)
              return {
                puuid,
                snapshot: snapshots.get(puuid)!,
                capturedDuringGame:
                  usable(prior ?? undefined) &&
                  this._repository.wasGamePlayerCapturedLive(game.serverId, game.gameId, puuid)
              }
            })
          : undefined
        result.push({
          serverId: game.serverId,
          gameId: game.gameId,
          ...(valid ? { identities: game.opponents.map((p) => p.puuid), playerSnapshots } : {}),
          ranks: {
            version: 1,
            source: 'SGP leagues-ledge (current snapshot)',
            serverId: game.serverId,
            ...(saved?.capture ? { capture: saved.capture } : {}),
            opponents: Array.from({ length: 5 }, (_, slot) => {
              const player = game.opponents[slot]
              const entry = playerSnapshots?.find((p) => p.puuid === player?.puuid)
              return {
                slot: slot + 1,
                role: player?.role ?? null,
                champion: player?.champion ?? null,
                snapshot:
                  entry?.snapshot ?? unavailableRank('identity-missing', new Date().toISOString()),
                capturedDuringGame: entry?.capturedDuringGame ?? false
              }
            })
          }
        })
        onProgress(result.length, games.length, 'loading-opponent-ranks')
        if (result.length % 25 === 0) await delay(0, undefined, { signal })
        continue
      }
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
        // Legacy five-slot summaries are not identity-backed ten-player facts.
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
    await this._repository.pruneAsync(signal)
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
