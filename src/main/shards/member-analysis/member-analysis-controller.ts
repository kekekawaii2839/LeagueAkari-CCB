import {
  type MemberAnalysisCurrentRankRefreshRequest,
  MemberAnalysisCurrentRankRefreshRequestSchema,
  type MemberAnalysisCurrentRankRefreshResult,
  type MemberAnalysisPublishedMemberIdentitiesPage,
  type MemberAnalysisPublishedMemberIdentitiesRequest,
  MemberAnalysisPublishedMemberIdentitiesRequestSchema
} from '@shared/shards/member-analysis'
import {
  type MemberAnalysisRankObservationHistoryPage,
  MemberAnalysisRankObservationHistoryPageSchema,
  type MemberAnalysisRankObservationHistoryRequest,
  MemberAnalysisRankObservationHistoryRequestSchema
} from '@shared/shards/member-analysis'
import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION,
  type MemberAnalysisCapabilities,
  type MemberAnalysisCleanupPreview,
  type MemberAnalysisErrorCode,
  type MemberAnalysisFilters,
  type MemberAnalysisJob,
  type MemberAnalysisMatchDetails,
  type MemberAnalysisMatchOverview,
  type MemberAnalysisOverview,
  type MemberAnalysisResult,
  type MemberAnalysisSettings,
  type MemberAnalysisSettingsUpdate,
  type MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'
import { createHash } from 'node:crypto'

import type { MemberAnalysisMainContext } from './context'
import { PublishedIdentitiesLoader } from './published-identities-loader'

const METHODS: MemberAnalysisCapabilities['methods'] = [
  'getCapabilities',
  'getOverview',
  'getMatchDetails',
  'getMatchOverview',
  'getRankObservationHistory',
  'refreshCurrentRanks',
  'cancelCurrentRankRefresh',
  'getPublishedMemberIdentities',
  'getSettings',
  'updateSettings',
  'startRefresh',
  'getJob',
  'cancelJob',
  'getStorageStatus',
  'previewCleanup',
  'confirmCleanup'
]

export class MemberAnalysisController {
  private readonly _publishedIdentities: PublishedIdentitiesLoader
  constructor(private readonly _context: MemberAnalysisMainContext) {
    this._publishedIdentities = new PublishedIdentitiesLoader(
      _context.repository,
      () => {
        if (!_context.settings.enabled || !_context.runtime.initialized)
          throw new Error('Stale published identities request')
        return _context.settings.members
      },
      undefined,
      _context.currentProfileIcons
    )
  }

  async dispose() {
    await this._context.currentRankRefresh?.dispose()
    this._context.currentProfileIcons?.dispose()
    await this._publishedIdentities.dispose()
  }

  getCapabilities(): MemberAnalysisResult<MemberAnalysisCapabilities> {
    return this._success({
      contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
      dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
      featureEnabled: this._context.settings.enabled,
      workerAvailable: this._context.pipeline.workerAvailable,
      methods: METHODS
    })
  }

  getSettings(): MemberAnalysisResult<MemberAnalysisSettings> {
    if (!this._context.runtime.initialized) {
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    }
    return this._success(this._settings())
  }

  async refreshCurrentRanks(
    input: MemberAnalysisCurrentRankRefreshRequest
  ): Promise<MemberAnalysisResult<MemberAnalysisCurrentRankRefreshResult>> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    const parsed = MemberAnalysisCurrentRankRefreshRequestSchema.safeParse(input)
    if (!parsed.success)
      return this._failure('INVALID_ARGUMENT', 'Invalid current rank refresh request', false)
    const job = this._context.pipeline.get()
    if (job && !['completed', 'failed', 'cancelled'].includes(job.status))
      return this._failure(
        'JOB_ALREADY_RUNNING',
        'Wait for the analysis refresh before updating current ranks',
        true
      )
    if (!this._context.currentRankRefresh)
      return this._failure('INTERNAL_ERROR', 'Current rank collection is unavailable', true)
    return this._context.currentRankRefresh.start(parsed.data.requestId)
  }

  cancelCurrentRankRefresh(
    input: MemberAnalysisCurrentRankRefreshRequest
  ): MemberAnalysisResult<{ cancelled: boolean }> {
    const parsed = MemberAnalysisCurrentRankRefreshRequestSchema.safeParse(input)
    if (!parsed.success)
      return this._failure('INVALID_ARGUMENT', 'Invalid current rank cancellation request', false)
    return this._success({
      cancelled: this._context.currentRankRefresh?.cancel(parsed.data.requestId) ?? false
    })
  }

  async getMatchOverview(
    gameId: number
  ): Promise<MemberAnalysisResult<MemberAnalysisMatchOverview | null>> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    try {
      await this._context.repository.waitForPublication()
      const unavailableAfterWait = this._requireEnabled()
      if (unavailableAfterWait) return unavailableAfterWait
      return this._success(this._context.repository.readMatchOverview(gameId))
    } catch {
      return this._failure('INTERNAL_ERROR', 'Cached match overview could not be read', true)
    }
  }

  async getMatchDetails(
    gameId: number
  ): Promise<MemberAnalysisResult<MemberAnalysisMatchDetails | null>> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    try {
      await this._context.repository.waitForPublication()
      const unavailableAfterWait = this._requireEnabled()
      if (unavailableAfterWait) return unavailableAfterWait
      return this._success(this._context.repository.readMatchDetails(gameId))
    } catch {
      return this._failure('INTERNAL_ERROR', 'Cached match details could not be read', true)
    }
  }

  async getPublishedMemberIdentities(
    input: MemberAnalysisPublishedMemberIdentitiesRequest
  ): Promise<MemberAnalysisResult<MemberAnalysisPublishedMemberIdentitiesPage>> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    const parsed = MemberAnalysisPublishedMemberIdentitiesRequestSchema.safeParse(input)
    if (!parsed.success)
      return this._failure('INVALID_ARGUMENT', 'Invalid published identities request', false)
    try {
      await this._context.repository.waitForPublication()
      const unavailableAfterWait = this._requireEnabled()
      if (unavailableAfterWait) return unavailableAfterWait
      return this._success(await this._publishedIdentities.read(parsed.data))
    } catch (error) {
      if (
        error instanceof Error &&
        ['Invalid published identities request', 'Stale published identities request'].includes(
          error.message
        )
      )
        return this._failure(
          'INVALID_ARGUMENT',
          'Published identity snapshot changed; reload analysis',
          true
        )
      return this._failure('INTERNAL_ERROR', 'Published member identities could not be read', true)
    }
  }

  async getRankObservationHistory(
    input: MemberAnalysisRankObservationHistoryRequest
  ): Promise<MemberAnalysisResult<MemberAnalysisRankObservationHistoryPage>> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    const parsed = MemberAnalysisRankObservationHistoryRequestSchema.safeParse(input)
    if (!parsed.success)
      return this._failure('INVALID_ARGUMENT', 'Invalid rank history request', false)
    const request = parsed.data
    let member = this._context.settings.members[request.memberSlot - 1]
    if (!member) return this._failure('INVALID_ARGUMENT', 'Configured member is unavailable', false)
    try {
      await this._context.repository.waitForPublication()
      const unavailableAfterWait = this._requireEnabled()
      if (unavailableAfterWait) return unavailableAfterWait
      member = this._context.settings.members[request.memberSlot - 1]
      if (!member)
        return this._failure('INVALID_ARGUMENT', 'Configured member is unavailable', false)
      const resolved = this._context.repository.resolveConfiguredMember(
        member.serverId,
        member.gameName,
        member.tagLine
      )
      const base = {
        memberSlot: request.memberSlot,
        identityKey: resolved
          ? createHash('sha256')
              .update(JSON.stringify([member.serverId.toUpperCase(), resolved.puuid]))
              .digest('hex')
          : null,
        serverId: member.serverId,
        queue: request.queue,
        source: 'SGP leagues-ledge query-time observations' as const,
        coverage: 'successful-query-observations-only' as const
      }
      if (!resolved) {
        if (request.cursor !== null)
          return this._failure('INVALID_ARGUMENT', 'Rank history cursor is unavailable', false)
        return this._success(
          MemberAnalysisRankObservationHistoryPageSchema.parse({
            ...base,
            status: 'identity-unresolved',
            identityResolvedAt: null,
            points: [],
            pagination: { nextCursor: null }
          })
        )
      }
      const scope = createHash('sha256')
        .update(
          JSON.stringify({
            members: this._context.settings.members,
            memberSlot: request.memberSlot
          })
        )
        .digest('hex')
      const page = this._context.repository.opponentRanks.readPlayerHistoryPage(
        member.serverId,
        resolved.puuid,
        request.queue,
        request.pageSize,
        request.cursor,
        scope
      )
      return this._success(
        MemberAnalysisRankObservationHistoryPageSchema.parse({
          ...base,
          status: 'available',
          identityResolvedAt: resolved.resolvedAt,
          ...page
        })
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid rank history cursor')
        return this._failure('INVALID_ARGUMENT', 'Rank history cursor is unavailable', false)
      return this._failure('INTERNAL_ERROR', 'Rank observation history could not be read', true)
    }
  }

  async updateSettings(
    settings: MemberAnalysisSettingsUpdate
  ): Promise<MemberAnalysisResult<MemberAnalysisSettings>> {
    if (!this._context.runtime.initialized) {
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    }
    const job = this._context.pipeline.get()
    if (job && !['completed', 'failed', 'cancelled'].includes(job.status)) {
      if (settings.enabled === false) this._context.pipeline.cancel(job.jobId)
      else
        return this._failure(
          'JOB_ALREADY_RUNNING',
          'Cancel the refresh before changing settings',
          false
        )
    }
    if (settings.enabled !== undefined)
      await this._context.settingService.set('enabled', settings.enabled)
    if (settings.members !== undefined)
      await this._context.settingService.set('members', settings.members)
    if (settings.historyDepth !== undefined)
      await this._context.settingService.set('historyDepth', settings.historyDepth)
    if (settings.scanLimitPerMember !== undefined)
      await this._context.settingService.set('scanLimitPerMember', settings.scanLimitPerMember)
    if (settings.historyTag !== undefined)
      await this._context.settingService.set('historyTag', settings.historyTag)
    if (settings.storageLimitGiB !== undefined)
      await this._context.settingService.set('storageLimitGiB', settings.storageLimitGiB)
    if (settings.opggEnabled !== undefined)
      await this._context.settingService.set('opggEnabled', settings.opggEnabled)
    if (settings.experimentalPredictionEnabled !== undefined)
      await this._context.settingService.set(
        'experimentalPredictionEnabled',
        settings.experimentalPredictionEnabled
      )
    if (settings.experimentalLpTrendEnabled !== undefined)
      await this._context.settingService.set(
        'experimentalLpTrendEnabled',
        settings.experimentalLpTrendEnabled
      )
    if (settings.experimentalVersionTrendEnabled !== undefined)
      await this._context.settingService.set(
        'experimentalVersionTrendEnabled',
        settings.experimentalVersionTrendEnabled
      )
    return this._success(this._settings())
  }

  async getOverview(request?: {
    publicationToken?: string
    filters?: MemberAnalysisFilters
    pagination?: { cursor: string | null; pageSize: number }
  }): Promise<MemberAnalysisResult<MemberAnalysisOverview>> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable

    let snapshot
    try {
      await this._context.repository.waitForPublication()
      const unavailableAfterWait = this._requireEnabled()
      if (unavailableAfterWait) return unavailableAfterWait
      snapshot = this._context.repository.readGames({
        filters: request?.filters,
        cursor: request?.pagination?.cursor,
        pageSize: request?.pagination?.pageSize
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'invalid member analysis cursor')
        return this._failure('INVALID_ARGUMENT', 'Invalid overview cursor', false)
      return this._failure('INTERNAL_ERROR', 'Stored member analysis data failed validation', true)
    }
    if (request?.publicationToken && request.publicationToken !== snapshot.publicationToken)
      return this._failure('INVALID_ARGUMENT', 'Published analysis changed; reload analysis', true)
    if (snapshot.publicationToken && snapshot.games.length) {
      try {
        snapshot.games = await this._publishedIdentities.enrichProfiles(
          snapshot.games,
          snapshot.publicationToken
        )
      } catch (error) {
        // Never return a page after its publication/lifecycle has changed.
        if (
          (error instanceof Error && error.message === 'Stale published identities request') ||
          this._requireEnabled() ||
          this._context.repository.publicationToken() !== snapshot.publicationToken
        )
          return this._failure(
            'INVALID_ARGUMENT',
            'Published analysis changed; reload analysis',
            true
          )
        // Avatar metadata is optional; its local read failure must not hide statistics.
        snapshot.games = snapshot.games.map((game) => ({
          ...game,
          players: game.players.map((player) => ({
            ...player,
            profileIdentity: null,
            profileIconId: null
          }))
        }))
      }
    }
    return this._success({
      contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
      dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
      firstRun: snapshot.total === 0,
      publicationToken: snapshot.publicationToken ?? null,
      generatedAt: snapshot.generatedAt,
      source: snapshot.source,
      gameCount: snapshot.total,
      playerCount: snapshot.playerCount,
      collectionAudit: snapshot.collectionAudit,
      games: snapshot.games,
      pagination: { nextCursor: snapshot.nextCursor }
    })
  }

  startRefresh(): MemberAnalysisResult<MemberAnalysisJob> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    if (!this._context.pipeline.workerAvailable) {
      return this._failure('WORKER_UNAVAILABLE', 'The member analysis worker is unavailable', true)
    }
    if (this._context.settings.members.length < 5) {
      return this._failure('INVALID_ARGUMENT', 'At least five members must be configured', false)
    }
    try {
      // The complete analysis has priority over the lightweight current-rank action.
      this._context.currentRankRefresh?.cancel()
      return this._success(this._context.pipeline.start())
    } catch (error) {
      return this._failure(
        'JOB_ALREADY_RUNNING',
        error instanceof Error ? error.message : 'A refresh job is already running',
        false
      )
    }
  }

  getJob(jobId?: string): MemberAnalysisResult<MemberAnalysisJob> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    const job = this._context.pipeline.get(jobId)
    return job
      ? this._success(job)
      : this._failure('JOB_NOT_FOUND', 'No member analysis job exists', false)
  }

  cancelJob(jobId?: string): MemberAnalysisResult<MemberAnalysisJob> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable
    const job = this._context.pipeline.cancel(jobId)
    return job
      ? this._success(job)
      : this._failure('JOB_NOT_FOUND', 'No member analysis job exists', false)
  }

  async getStorageStatus(): Promise<MemberAnalysisResult<MemberAnalysisStorageStatus>> {
    if (!this._context.runtime.initialized)
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    return this._success(
      await this._context.repository.storageStatusAsync(this._context.settings.storageLimitGiB)
    )
  }

  previewCleanup(): MemberAnalysisResult<MemberAnalysisCleanupPreview> {
    if (!this._context.runtime.initialized)
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    return this._success(
      this._context.repository.previewCleanup(this._context.settings.storageLimitGiB)
    )
  }

  confirmCleanup(previewId: string): MemberAnalysisResult<MemberAnalysisStorageStatus> {
    if (!this._context.runtime.initialized)
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    const job = this._context.pipeline.get()
    if (job && !['completed', 'failed', 'cancelled'].includes(job.status))
      return this._failure('JOB_ALREADY_RUNNING', 'Wait for the refresh before cleanup', true)
    try {
      return this._success(
        this._context.repository.confirmCleanup(previewId, this._context.settings.storageLimitGiB)
      )
    } catch {
      return this._failure(
        'INVALID_ARGUMENT',
        'Cleanup preview is stale or cleanup is already running',
        false
      )
    }
  }

  private _requireEnabled(): MemberAnalysisResult<never> | null {
    if (!this._context.runtime.initialized) {
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    }
    if (!this._context.settings.enabled) {
      return this._failure('FEATURE_DISABLED', 'Member analysis is disabled', false)
    }
    return null
  }

  private _success<T>(value: T): MemberAnalysisResult<T> {
    return { ok: true, value }
  }

  private _settings(): MemberAnalysisSettings {
    return {
      enabled: this._context.settings.enabled,
      members: this._context.settings.members.map((member) => ({ ...member })),
      historyDepth: this._context.settings.historyDepth,
      scanLimitPerMember: this._context.settings.scanLimitPerMember,
      historyTag: this._context.settings.historyTag,
      storageLimitGiB: this._context.settings.storageLimitGiB,
      opggEnabled: this._context.settings.opggEnabled,
      experimentalPredictionEnabled: this._context.settings.experimentalPredictionEnabled,
      experimentalLpTrendEnabled: this._context.settings.experimentalLpTrendEnabled,
      experimentalVersionTrendEnabled: this._context.settings.experimentalVersionTrendEnabled
    }
  }

  private _failure(
    code: MemberAnalysisErrorCode,
    message: string,
    retryable: boolean
  ): MemberAnalysisResult<never> {
    return { ok: false, error: { code, message, retryable } }
  }
}
