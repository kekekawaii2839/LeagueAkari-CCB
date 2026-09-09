import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { Dep, IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import type {
  MemberAnalysisCapabilities,
  MemberAnalysisCleanupPreview,
  MemberAnalysisJob,
  MemberAnalysisOverview,
  MemberAnalysisResult,
  MemberAnalysisSettings,
  MemberAnalysisSettingsUpdate,
  MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'
import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION,
  MemberAnalysisUpdateSettingsRequestSchema
} from '@shared/shards/member-analysis'

import { useMemberAnalysisStore } from './store'

export const MEMBER_ANALYSIS_RENDERER_NAMESPACE = 'member-analysis-renderer'
const MEMBER_ANALYSIS_MAIN_NAMESPACE = 'member-analysis-main'

@Shard(MemberAnalysisRenderer.id)
export class MemberAnalysisRenderer implements IAkariShardInitDispose {
  static readonly id = MEMBER_ANALYSIS_RENDERER_NAMESPACE

  constructor(@Dep(AkariIpcRenderer) private readonly _ipc: AkariIpcRenderer) {
    this.startRefresh = this.startRefresh.bind(this)
    this.cancelRefresh = this.cancelRefresh.bind(this)
  }

  private _stopJobEvents: (() => void) | null = null
  private _reloadGeneration = 0

  async onInit() {
    this._stopJobEvents = this._ipc.onEvent(
      MEMBER_ANALYSIS_MAIN_NAMESPACE,
      'job-progress',
      (job: MemberAnalysisJob) => {
        const store = useMemberAnalysisStore()
        store.job = job
        if (job.status === 'completed') void this.reload()
      }
    )
    await this.reload()
  }

  async reload() {
    const generation = ++this._reloadGeneration
    const store = useMemberAnalysisStore()
    store.loading = true
    store.error = null

    try {
      const capabilities = await this._call<MemberAnalysisCapabilities>('getCapabilities')
      if (generation !== this._reloadGeneration) return
      if (!capabilities.ok) {
        store.error = capabilities.error
        return
      }
      if (
        capabilities.value.contractVersion !== MEMBER_ANALYSIS_CONTRACT_VERSION ||
        capabilities.value.dataVersion !== MEMBER_ANALYSIS_DATA_VERSION
      )
        throw new Error('Unsupported member analysis version')
      store.capabilities = capabilities.value

      const settings = await this._call<MemberAnalysisSettings>('getSettings')
      if (generation !== this._reloadGeneration) return
      if (!settings.ok) {
        store.error = settings.error
        return
      }
      store.settings = settings.value

      const storage = await this._call<MemberAnalysisStorageStatus>('getStorageStatus')
      if (generation !== this._reloadGeneration) return
      if (storage.ok) store.storageStatus = storage.value

      if (!settings.value.enabled) return

      const overview = await this._loadOverview()
      if (generation !== this._reloadGeneration) return
      if (!overview.ok) {
        store.error = overview.error
        return
      }
      store.overview = overview.value
    } catch (error) {
      if (generation !== this._reloadGeneration) return
      store.error = {
        code: 'INTERNAL_ERROR',
        message: 'Member analysis could not be loaded',
        retryable: true
      }
    } finally {
      if (generation === this._reloadGeneration) store.loading = false
    }
  }

  async onDispose() {
    this._reloadGeneration += 1
    this._stopJobEvents?.()
    this._stopJobEvents = null
  }

  async startRefresh() {
    const store = useMemberAnalysisStore()
    const result = await this._call<MemberAnalysisJob>('startRefresh', undefined)
    if (result.ok) store.job = result.value
    else store.error = result.error
    return result
  }

  async cancelRefresh() {
    const store = useMemberAnalysisStore()
    const result = await this._call<MemberAnalysisJob>(
      'cancelJob',
      store.job ? { jobId: store.job.jobId } : undefined
    )
    if (result.ok) store.job = result.value
    else store.error = result.error
    return result
  }

  async updateSettings(settings: MemberAnalysisSettingsUpdate) {
    const store = useMemberAnalysisStore()
    const request = MemberAnalysisUpdateSettingsRequestSchema.parse(settings)
    const result = await this._call<MemberAnalysisSettings>('updateSettings', request)
    if (!result.ok) {
      store.error = result.error
      return result
    }

    this._reloadGeneration += 1
    store.loading = false
    store.settings = result.value
    store.capabilities = store.capabilities
      ? { ...store.capabilities, featureEnabled: result.value.enabled }
      : null
    store.overview = null
    store.error = null
    if (result.value.enabled) await this.reload()
    return result
  }

  async previewCleanup() {
    const store = useMemberAnalysisStore()
    const result = await this._call<MemberAnalysisCleanupPreview>('previewCleanup')
    if (result.ok) store.cleanupPreview = result.value
    else store.error = result.error
    return result
  }

  async confirmCleanup(previewId: string) {
    const store = useMemberAnalysisStore()
    const result = await this._call<MemberAnalysisStorageStatus>('confirmCleanup', { previewId })
    if (result.ok) {
      store.storageStatus = result.value
      store.cleanupPreview = null
    } else store.error = result.error
    return result
  }

  private async _loadOverview(): Promise<MemberAnalysisResult<MemberAnalysisOverview>> {
    let cursor: string | null = null
    let combined: MemberAnalysisOverview | null = null
    const seen = new Set<string>()
    do {
      const page = await this._call<MemberAnalysisOverview>('getOverview', {
        pagination: { cursor, pageSize: 100 }
      })
      if (!page.ok) return page
      if (
        page.value.contractVersion !== MEMBER_ANALYSIS_CONTRACT_VERSION ||
        page.value.dataVersion !== MEMBER_ANALYSIS_DATA_VERSION
      )
        throw new Error('Unsupported member analysis version')
      if (combined === null) combined = page.value
      else {
        if (
          combined.generatedAt !== page.value.generatedAt ||
          combined.gameCount !== page.value.gameCount ||
          combined.source !== page.value.source
        )
          throw new Error('Member analysis changed during pagination')
        combined.games.push(...page.value.games)
        combined.pagination = page.value.pagination
      }
      cursor = page.value.pagination.nextCursor
      if (cursor && seen.has(cursor)) {
        return {
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Pagination cursor repeated', retryable: true }
        }
      }
      if (cursor) seen.add(cursor)
    } while (cursor && seen.size < 1000)
    if (cursor) {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Pagination safety limit reached before overview completed',
          retryable: true
        }
      }
    }
    return { ok: true, value: combined! }
  }

  private async _call<T>(method: string, ...args: unknown[]): Promise<MemberAnalysisResult<T>> {
    try {
      return await this._ipc.call<MemberAnalysisResult<T>>(
        MEMBER_ANALYSIS_MAIN_NAMESPACE,
        method,
        ...args
      )
    } catch {
      return {
        ok: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Member analysis request failed',
          retryable: true
        }
      }
    }
  }
}
