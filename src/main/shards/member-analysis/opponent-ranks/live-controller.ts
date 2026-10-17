import type { LeagueClientMain } from '@main/shards/league-client'
import type { AkariLogger } from '@main/shards/logger-factory'
import type { SgpMain } from '@main/shards/sgp'
import { EMPTY_PUUID } from '@shared/constants/common'
import type { OpponentRanks } from '@shared/shards/member-analysis/opponent-ranks'
import type { GameflowSession } from '@shared/types/league-client/gameflow'
import { type IReactionDisposer, reaction } from 'mobx'
import { setTimeout as delay } from 'node:timers/promises'

import type { MemberAnalysisSettingsState } from '../state'
import { OpponentRankLoader, type RankGameTarget } from './loader'
import type { OpponentRankRepository } from './repository'

type LiveTarget = RankGameTarget & { phase: NonNullable<OpponentRanks['capture']>['phase'] }

/** Only the local player's actual SR game; no spectator/custom/hidden identities. */
export function liveRankTarget(
  session: GameflowSession | null,
  phase: string | null,
  self: string | undefined,
  serverId: string
): LiveTarget | null {
  if (
    !session ||
    !self ||
    !serverId ||
    !['GameStart', 'InProgress', 'Reconnect'].includes(phase ?? '') ||
    session.map.id !== 11 ||
    session.gameData.isCustomGame
  )
    return null
  const { gameId, teamOne, teamTwo } = session.gameData
  if (!Number.isSafeInteger(gameId) || gameId <= 0 || teamOne.length !== 5 || teamTwo.length !== 5)
    return null
  const players = [...teamOne, ...teamTwo]
  if (
    players.some((p) => !p.puuid || p.puuid === EMPTY_PUUID) ||
    new Set(players.map((p) => p.puuid)).size !== 10
  )
    return null
  const own = teamOne.some((p) => p.puuid === self)
    ? teamOne
    : teamTwo.some((p) => p.puuid === self)
      ? teamTwo
      : null
  if (!own) return null
  const mapPlayer = (player: (typeof players)[number]) => {
    const value = (player.selectedPosition || player.selectedRole || '').toUpperCase()
    const role =
      value === 'MID'
        ? 'MIDDLE'
        : value === 'SUPPORT'
          ? 'UTILITY'
          : value === 'ADC'
            ? 'BOTTOM'
            : value
    return {
      puuid: player.puuid,
      role: (['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(role)
        ? role
        : null) as RankGameTarget['opponents'][number]['role'],
      champion: player.championId > 0 ? String(player.championId) : null
    }
  }
  const opponents = (own === teamOne ? teamTwo : teamOne).map(mapPlayer)
  return {
    serverId,
    gameId,
    opponents,
    participants: players.map(mapPlayer),
    phase: phase as LiveTarget['phase']
  }
}

/** Owns gameflow subscription, bounded retry and cancellation; never starts the analysis worker. */
export class OpponentRankLiveController {
  private _stop: IReactionDisposer | null = null
  private _abort: AbortController | null = null
  private _running = new Set<Promise<void>>()
  private _rounds = new Map<string, number>()
  constructor(
    private readonly _leagueClient: LeagueClientMain,
    private readonly _sgp: SgpMain,
    private readonly _settings: MemberAnalysisSettingsState,
    private readonly _repository: OpponentRankRepository,
    private readonly _logger: Pick<AkariLogger, 'warn'>
  ) {}
  watch() {
    this._stop?.()
    this._stop = reaction(
      () => {
        const target = this._target()
        return target
          ? JSON.stringify([
              target.serverId,
              target.gameId,
              this._leagueClient.data.summoner.me?.puuid,
              target.participants!.map((p) => p.puuid).sort()
            ])
          : null
      },
      (key) => {
        this._abort?.abort()
        if (!key) return
        const target = this._target()
        if (!target) return
        const abort = new AbortController()
        this._abort = abort
        const execution = this._run(key, target, abort.signal).catch(() => {
          if (!abort.signal.aborted)
            this._logger.warn(
              'Automatic opponent rank capture failed; manual backfill remains available'
            )
        })
        this._running.add(execution)
        void execution.finally(() => this._running.delete(execution))
      },
      { fireImmediately: true }
    )
  }
  private _target() {
    if (
      !this._settings.enabled ||
      this._leagueClient.state.connectionState !== 'connected' ||
      !this._sgp.state.isTokenReady ||
      !this._sgp.state.availability.serversSupported.common
    )
      return null
    return liveRankTarget(
      this._leagueClient.data.gameflow.session,
      this._leagueClient.data.gameflow.phase,
      this._leagueClient.data.summoner.me?.puuid,
      this._sgp.state.availability.sgpServerId ?? ''
    )
  }
  private async _run(key: string, target: LiveTarget, signal: AbortSignal) {
    const capture: NonNullable<OpponentRanks['capture']> = {
      mode: 'live',
      observedAt: new Date().toISOString(),
      phase: target.phase
    }
    const usable = (value: ReturnType<OpponentRankRepository['readGamePlayer']>) =>
      value?.status === 'ok' && (value.solo.status !== 'missing' || value.flex.status !== 'missing')
    while ((this._rounds.get(key) ?? 0) < 3) {
      signal.throwIfAborted()
      if (
        target.participants!.every(
          (player) =>
            usable(
              this._repository.readGamePlayer(target.serverId, target.gameId, player.puuid!)
            ) &&
            this._repository.wasGamePlayerCapturedLive(
              target.serverId,
              target.gameId,
              player.puuid!
            )
        )
      )
        return
      this._rounds.set(key, (this._rounds.get(key) ?? 0) + 1)
      // Keep only bounded in-memory bookkeeping; successful facts remain in SQLite.
      if (this._rounds.size > 64) this._rounds.delete(this._rounds.keys().next().value!)
      const results = await new OpponentRankLoader(this._sgp, this._repository).load(
        [target],
        signal,
        () => {},
        {
          fresh: true,
          requests: 15,
          milliseconds: 60_000,
          spacing: 150,
          timeout: 12_000,
          retries: 2
        }
      )
      signal.throwIfAborted()
      await this._repository.publishLiveGameAsync(
        target,
        { ...results[0].ranks, capture },
        results[0].playerSnapshots,
        signal
      )
      if (
        target.participants!.every(
          (player) =>
            usable(
              this._repository.readGamePlayer(target.serverId, target.gameId, player.puuid!)
            ) &&
            this._repository.wasGamePlayerCapturedLive(
              target.serverId,
              target.gameId,
              player.puuid!
            )
        )
      )
        return
      if ((this._rounds.get(key) ?? 0) < 3) await delay(15_000, undefined, { signal })
    }
  }
  async dispose() {
    this._stop?.()
    this._stop = null
    this._abort?.abort()
    await Promise.all(this._running)
    this._rounds.clear()
  }
}
