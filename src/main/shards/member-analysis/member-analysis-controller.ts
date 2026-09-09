import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION,
  type MemberAnalysisCapabilities,
  type MemberAnalysisCleanupPreview,
  type MemberAnalysisErrorCode,
  type MemberAnalysisFilters,
  type MemberAnalysisJob,
  type MemberAnalysisOverview,
  type MemberAnalysisResult,
  type MemberAnalysisSettings,
  type MemberAnalysisSettingsUpdate,
  type MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'

import type { MemberAnalysisMainContext } from './context'

const METHODS: MemberAnalysisCapabilities['methods'] = [
  'getCapabilities',
  'getOverview',
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
  constructor(private readonly _context: MemberAnalysisMainContext) {}

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
    return this._success(this._settings())
  }

  getOverview(request?: {
    filters?: MemberAnalysisFilters
    pagination?: { cursor: string | null; pageSize: number }
  }): MemberAnalysisResult<MemberAnalysisOverview> {
    const unavailable = this._requireEnabled()
    if (unavailable) return unavailable

    let snapshot
    try {
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
    return this._success({
      contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
      dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
      firstRun: snapshot.total === 0,
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

  getStorageStatus(): MemberAnalysisResult<MemberAnalysisStorageStatus> {
    if (!this._context.runtime.initialized)
      return this._failure('NOT_INITIALIZED', 'Member analysis is not initialized', true)
    return this._success(
      this._context.repository.storageStatus(this._context.settings.storageLimitGiB)
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
      opggEnabled: this._context.settings.opggEnabled
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
