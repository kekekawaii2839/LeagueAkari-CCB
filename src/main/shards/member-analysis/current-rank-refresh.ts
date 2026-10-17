import type {
  MemberAnalysisCurrentRankRefreshResult,
  MemberAnalysisResult,
  MemberAnalysisSettings
} from '@shared/shards/member-analysis'
import { MemberAnalysisCurrentRankRefreshResultSchema } from '@shared/shards/member-analysis'
import type { PlayerRankSnapshot } from '@shared/shards/member-analysis/opponent-ranks'

import type { MemberAnalysisRepository } from './repository'

type Member = MemberAnalysisSettings['members'][number]
type Identity = { serverId: string; puuid: string }
export interface CurrentRankRefreshSource {
  session(): string | null
  resolve(member: Member, signal: AbortSignal): Promise<string | null>
  capture(
    players: Identity[],
    signal: AbortSignal,
    assertCurrent: () => void,
    onSnapshot: (player: Identity, snapshot: PlayerRankSnapshot) => void
  ): Promise<void>
}

/** A single bounded fixed-roster action. Never starts the analysis worker or mutates old facts. */
export class CurrentRankRefresh {
  private _active: {
    requestId: string
    abort: AbortController
    promise: Promise<MemberAnalysisResult<MemberAnalysisCurrentRankRefreshResult>>
  } | null = null
  private _nextAllowedAt = 0
  private _disposed = false
  constructor(
    private readonly _repository: Pick<MemberAnalysisRepository, 'recordMember'>,
    private readonly _settings: () => Pick<
      MemberAnalysisSettings,
      'enabled' | 'experimentalLpTrendEnabled' | 'members'
    >,
    private readonly _source: CurrentRankRefreshSource,
    private readonly _now = () => Date.now()
  ) {}

  start(requestId: string): Promise<MemberAnalysisResult<MemberAnalysisCurrentRankRefreshResult>> {
    const fail = (
      code: 'JOB_ALREADY_RUNNING' | 'FEATURE_DISABLED' | 'INTERNAL_ERROR',
      message: string
    ) =>
      Promise.resolve<MemberAnalysisResult<MemberAnalysisCurrentRankRefreshResult>>({
        ok: false,
        error: { code, message, retryable: true }
      })
    const settings = this._settings()
    if (this._disposed || !settings.enabled || !settings.experimentalLpTrendEnabled)
      return fail('FEATURE_DISABLED', 'Current rank collection is disabled')
    if (this._active)
      return this._active.requestId === requestId
        ? this._active.promise
        : fail('JOB_ALREADY_RUNNING', 'Current ranks are already updating')
    if (this._now() < this._nextAllowedAt)
      return fail('JOB_ALREADY_RUNNING', 'Wait briefly before updating current ranks again')
    const session = this._source.session()
    if (!session) return fail('INTERNAL_ERROR', 'Current rank source is not connected')
    const members = settings.members.map((member) => ({
      serverId: member.serverId,
      gameName: member.gameName,
      tagLine: member.tagLine
    }))
    if (!members.length || members.length > 20)
      return fail('INTERNAL_ERROR', 'Configured members are unavailable')
    const abort = new AbortController()
    const promise = this._execute(requestId, members, session, abort).finally(() => {
      this._active = null
      this._nextAllowedAt = this._now() + 5000
    })
    this._active = { requestId, abort, promise }
    return promise
  }

  cancel(requestId?: string): boolean {
    if (!this._active || (requestId !== undefined && requestId !== this._active.requestId))
      return false
    this._active.abort.abort()
    return true
  }
  async dispose() {
    this._disposed = true
    this.cancel()
    await this._active?.promise
  }

  private async _execute(
    requestId: string,
    members: Member[],
    session: string,
    abort: AbortController
  ): Promise<MemberAnalysisResult<MemberAnalysisCurrentRankRefreshResult>> {
    const startedAt = new Date(this._now()).toISOString()
    const rosterKey = (rows: Member[]) =>
      JSON.stringify(rows.map((member) => [member.serverId, member.gameName, member.tagLine]))
    const fingerprint = rosterKey(members)
    const assertCurrent = () => {
      const settings = this._settings()
      if (
        this._disposed ||
        !settings.enabled ||
        !settings.experimentalLpTrendEnabled ||
        this._source.session() !== session ||
        rosterKey(settings.members) !== fingerprint
      )
        abort.abort()
      abort.signal.throwIfAborted()
    }
    const results: MemberAnalysisCurrentRankRefreshResult['members'] = members.map((_, index) => ({
      memberSlot: index + 1,
      status: 'cancelled',
      fetchedAt: null,
      reason: 'cancelled'
    }))
    const identities = new Map<string, { identity: Identity; slots: number[] }>()
    const timer = setTimeout(() => abort.abort(), 45000)
    let cancelled = false
    try {
      for (const [index, member] of members.entries()) {
        assertCurrent()
        try {
          const puuid = await this._source.resolve(member, abort.signal)
          assertCurrent()
          if (!puuid) {
            results[index] = {
              memberSlot: index + 1,
              status: 'failed',
              fetchedAt: null,
              reason: 'identity-unresolved'
            }
            continue
          }
          // An unsuccessful lookup never clears a previously resolved identity/history.
          this._repository.recordMember(
            member.serverId,
            member.gameName,
            member.tagLine,
            puuid,
            null
          )
          const identity = { serverId: member.serverId.toUpperCase(), puuid },
            key = JSON.stringify([identity.serverId, identity.puuid])
          const existing = identities.get(key)
          if (existing) existing.slots.push(index)
          else identities.set(key, { identity, slots: [index] })
        } catch {
          assertCurrent()
          results[index] = {
            memberSlot: index + 1,
            status: 'failed',
            fetchedAt: null,
            reason: 'identity-unresolved'
          }
        }
      }
      await this._source.capture(
        [...identities.values()].map((entry) => entry.identity),
        abort.signal,
        assertCurrent,
        (identity, snapshot) => {
          const group = identities.get(JSON.stringify([identity.serverId, identity.puuid]))!
          for (const index of group.slots)
            results[index] = {
              memberSlot: index + 1,
              status: snapshot.status === 'ok' ? 'updated' : 'failed',
              fetchedAt: snapshot.status === 'ok' ? snapshot.fetchedAt : null,
              reason: snapshot.status === 'ok' ? null : (snapshot.reason ?? 'query-failed')
            }
        }
      )
      assertCurrent()
      for (const result of results)
        if (result.status === 'cancelled') {
          result.status = 'failed'
          result.reason = 'query-failed'
        }
    } catch {
      cancelled = abort.signal.aborted
      if (!cancelled)
        for (const result of results)
          if (result.status === 'cancelled') {
            result.status = 'failed'
            result.reason = 'query-failed'
          }
    } finally {
      clearTimeout(timer)
    }
    return {
      ok: true,
      value: MemberAnalysisCurrentRankRefreshResultSchema.parse({
        requestId,
        status: cancelled ? 'cancelled' : 'completed',
        startedAt,
        finishedAt: new Date(this._now()).toISOString(),
        members: results
      })
    }
  }
}
