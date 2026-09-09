import type { MemberAnalysisJob, MemberAnalysisSettings } from '@shared/shards/member-analysis'
import { randomUUID } from 'node:crypto'

import type { MemberAnalysisCollector } from './collector'
import type { MemberAnalysisRepository } from './repository'
import type { MemberAnalysisWorkerSupervisor, WorkerMessage } from './worker-supervisor'

export class MemberAnalysisPipeline {
  private _job: MemberAnalysisJob | null = null
  private _abortController: AbortController | null = null
  private _accepting = true
  private _execution: Promise<void> | null = null

  constructor(
    private readonly _collector: MemberAnalysisCollector,
    private readonly _repository: MemberAnalysisRepository,
    private readonly _worker: MemberAnalysisWorkerSupervisor,
    private readonly _settings: MemberAnalysisSettings,
    private readonly _onJobChanged: (job: MemberAnalysisJob) => void = () => {}
  ) {}

  get workerAvailable() {
    return this._worker.available
  }

  start(): MemberAnalysisJob {
    if (!this._accepting) throw new Error('pipeline is shutting down')
    if (this._job && !['completed', 'failed', 'cancelled'].includes(this._job.status)) {
      throw new Error('job already running')
    }
    const jobId = `ma-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    this._abortController = new AbortController()
    this._job = {
      jobId,
      status: 'starting',
      progress: 0,
      message: 'starting',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      checkpointAt: null,
      error: null
    }
    this._emit()
    const settings = {
      ...this._settings,
      members: this._settings.members.map((member) => ({ ...member }))
    }
    this._execution = this._execute(this._job, this._abortController.signal, settings)
    return structuredClone(this._job)
  }

  get(jobId?: string) {
    if (!this._job || (jobId && this._job.jobId !== jobId)) return null
    return structuredClone(this._job)
  }

  cancel(jobId?: string) {
    if (!this._job || (jobId && this._job.jobId !== jobId)) return null
    if (['completed', 'failed', 'cancelled'].includes(this._job.status)) return this.get(jobId)
    this._abortController?.abort(new Error('cancelled'))
    this._worker.cancel('cancelled')
    this._update({ message: 'cancelling' })
    return this.get(jobId)
  }

  async dispose() {
    this._accepting = false
    this._abortController?.abort(new Error('shutdown'))
    await this._worker.dispose()
    await this._execution
  }

  private async _execute(
    job: MemberAnalysisJob,
    signal: AbortSignal,
    settings: MemberAnalysisSettings
  ) {
    try {
      this._update({ status: 'collecting', progress: 0.02, message: 'collecting' })
      const collected = await this._collector.collect({
        members: settings.members,
        historyDepth: settings.historyDepth,
        scanLimitPerMember: settings.scanLimitPerMember,
        historyTag: settings.historyTag,
        signal,
        onProgress: (processed, total) =>
          this._update({
            progress: total ? 0.05 + (processed / total) * 0.4 : 0.45,
            message: `collecting ${processed}/${total}`,
            checkpointAt: new Date().toISOString()
          })
      })
      if (signal.aborted) throw signal.reason
      if (collected.memberErrors > 0)
        throw new Error(`failed to resolve ${collected.memberErrors} configured member(s)`)
      const paths = this._repository.writeJobManifest(job.jobId, collected.items, collected.audit)
      this._update({ status: 'analyzing', progress: 0.5, message: 'analyzing' })
      const message = await this._worker.run(
        [
          '--job-id',
          job.jobId,
          '--data-root',
          this._repository.dataRoot,
          '--manifest',
          paths.manifest,
          '--staging',
          paths.staging,
          '--current',
          paths.current,
          '--checkpoint',
          paths.checkpoint,
          ...(settings.opggEnabled ? ['--opgg-enabled'] : [])
        ],
        (value) => this._handleWorkerMessage(value)
      )
      if (signal.aborted || message.status === 'cancelled') throw new Error('cancelled')
      if (message.type !== 'result' || message.status !== 'completed')
        throw new Error('worker did not complete successfully')
      this._update({ status: 'publishing', progress: 0.95, message: 'publishing' })
      this._repository.publishStaging()
      this._finish('completed', 'completed')
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.message === 'cancelled')) {
        this._finish('cancelled', 'cancelled')
        return
      }
      this._finish('failed', 'failed', {
        code: 'PIPELINE_FAILED',
        message: 'Member analysis refresh failed'
      })
    }
  }

  private _handleWorkerMessage(message: WorkerMessage) {
    if (message.type === 'progress') {
      const processed = Number(message.processed ?? 0)
      const total = Number(message.total ?? 0)
      this._update({
        status: 'analyzing',
        progress: total ? 0.5 + (processed / total) * 0.4 : 0.9,
        message: `analyzing ${processed}/${total}`,
        checkpointAt: new Date().toISOString()
      })
    }
  }

  private _finish(
    status: 'completed' | 'failed' | 'cancelled',
    message: string,
    error: MemberAnalysisJob['error'] = null
  ) {
    this._update({
      status,
      progress: status === 'completed' ? 1 : (this._job?.progress ?? 0),
      message,
      finishedAt: new Date().toISOString(),
      error
    })
    this._abortController = null
  }

  private _update(value: Partial<MemberAnalysisJob>) {
    if (!this._job) return
    Object.assign(this._job, value)
    this._emit()
  }

  private _emit() {
    if (this._job) this._onJobChanged(structuredClone(this._job))
  }
}
