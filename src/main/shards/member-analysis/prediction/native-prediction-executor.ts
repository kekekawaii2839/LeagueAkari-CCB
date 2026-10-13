import { createHash } from 'node:crypto'
import type { Worker } from 'node:worker_threads'

import {
  type CandidateId,
  predictionCandidates
} from '../../../../../packages/prediction-lab/src/legacy/backtest'
import {
  type PredictionObservation,
  type TeamLineup,
  predictionRoles
} from '../../../../../packages/prediction-lab/src/legacy/model'
import type { PredictionSide } from '../../../../../packages/prediction-lab/src/legacy/side-history'
import { performanceMetricKeys } from '../../../../../packages/prediction-lab/src/metrics'

export interface NativePredictionRequest {
  observations: PredictionObservation[]
  lineup: TeamLineup
  side: PredictionSide
  dataCutoffMs: number
}
/** Internal forecast summary, not the full product UI/backtest payload or an IPC contract. */
export type NativePredictionResult =
  | {
      status: 'available'
      probability: number
      modelId: CandidateId
      estimateKind: 'reference' | 'lineup'
      trainingRows: number
      bootstrapSuccess: number
      interval: readonly [number, number] | null
    }
  | { status: 'unavailable'; reason: string }

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
const isCount = (value: unknown, maximum: number): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
function isNativeResult(message: unknown): message is NativePredictionResult {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return false
  const value = message as Record<string, unknown>
  if (value.status === 'unavailable')
    return (
      Object.keys(value).length === 2 &&
      typeof value.reason === 'string' &&
      value.reason.trim().length > 0 &&
      value.reason.length <= 2048
    )
  if (value.status !== 'available' || Object.keys(value).length !== 7) return false
  if (
    !isProbability(value.probability) ||
    !predictionCandidates.some((candidate) => candidate.id === value.modelId) ||
    (value.estimateKind !== 'reference' && value.estimateKind !== 'lineup') ||
    !isCount(value.trainingRows, 500) ||
    value.trainingRows === 0 ||
    !isCount(value.bootstrapSuccess, 100)
  )
    return false
  const reference = value.modelId === 'baseline' || value.modelId === 'recent'
  if (value.estimateKind !== (reference ? 'reference' : 'lineup')) return false
  return value.bootstrapSuccess < 80
    ? value.interval === null
    : Array.isArray(value.interval) &&
        value.interval.length === 2 &&
        Array.from(value.interval).every(isProbability) &&
        value.interval[0] <= value.interval[1]
}
type FailureReason =
  'busy' | 'invalid-input' | 'aborted' | 'timeout' | 'worker-error' | 'invalid-output'
export type NativePredictionOutcome =
  | {
      status: 'completed'
      result: NativePredictionResult
      inputHash: string
      observedAtMs: number
    }
  | { status: 'failed'; reasonCode: FailureReason; inputHash?: string; observedAtMs: number }

function validate(request: NativePredictionRequest, now: number) {
  if (
    !request ||
    Object.keys(request).length !== 4 ||
    !['all', 'Blue', 'Red'].includes(request.side) ||
    !Number.isSafeInteger(request.dataCutoffMs) ||
    request.dataCutoffMs < 0 ||
    request.dataCutoffMs > now ||
    !request.lineup ||
    Object.keys(request.lineup).length !== 5 ||
    predictionRoles.some(
      (role) =>
        typeof request.lineup[role] !== 'string' ||
        !request.lineup[role].trim() ||
        request.lineup[role].length > 96
    ) ||
    new Set(Object.values(request.lineup)).size !== 5 ||
    !Array.isArray(request.observations) ||
    request.observations.length > 2500
  )
    throw Error('Invalid request')
  for (const observation of request.observations) {
    if (
      !observation ||
      !Number.isSafeInteger(observation.gameId) ||
      observation.gameId < 0 ||
      !Number.isFinite(observation.timestamp) ||
      observation.timestamp < 0 ||
      observation.timestamp >= request.dataCutoffMs ||
      typeof observation.date !== 'string' ||
      observation.date.length > 96 ||
      typeof observation.player !== 'string' ||
      !observation.player.trim() ||
      observation.player.length > 96 ||
      !predictionRoles.includes(observation.role) ||
      typeof observation.win !== 'boolean' ||
      (observation.side !== undefined && !['Blue', 'Red'].includes(observation.side)) ||
      !Array.isArray(observation.metrics) ||
      observation.metrics.length !== performanceMetricKeys.length ||
      Array.from(observation.metrics).some((v) => v !== null && !Number.isFinite(v))
    )
      throw Error('Invalid observation')
  }
}

/** Native lifecycle only; not IPC, persistence or evidence of historical as-of availability. */
export class NativePredictionExecutor {
  private _active = false

  async execute(
    request: NativePredictionRequest,
    { signal }: { signal?: AbortSignal } = {}
  ): Promise<NativePredictionOutcome> {
    const observedAtMs = Date.now()
    const failure = (reasonCode: FailureReason, inputHash?: string): NativePredictionOutcome => ({
      status: 'failed',
      reasonCode,
      inputHash,
      observedAtMs
    })
    if (this._active) return Promise.resolve(failure('busy'))
    if (signal?.aborted) return Promise.resolve(failure('aborted'))
    let snapshot: NativePredictionRequest, inputHash: string
    try {
      snapshot = structuredClone(request)
      validate(snapshot, observedAtMs)
      const serialized = JSON.stringify(snapshot)
      if (Buffer.byteLength(serialized) > 4 * 1024 * 1024) throw Error('Input bound')
      inputHash = createHash('sha256').update(serialized).digest('hex')
    } catch {
      return Promise.resolve(failure('invalid-input'))
    }
    this._active = true
    let worker: Worker
    try {
      // Only execution loads the bundler entry; ordinary shard imports must
      // never evaluate it inside an unrelated worker thread (such as Vitest).
      const { default: createWorker } = await import('./native-prediction-worker?nodeWorker')
      if (signal?.aborted) {
        this._active = false
        return failure('aborted', inputHash)
      }
      worker = createWorker({
        workerData: snapshot,
        resourceLimits: { maxOldGenerationSizeMb: 256 }
      })
    } catch {
      this._active = false
      return failure('worker-error', inputHash)
    }
    return new Promise((resolveOutcome) => {
      let settling = false,
        exited = false
      let confirmExit: () => void = () => {}
      const exitConfirmed = new Promise<void>((resolve) => {
        confirmExit = resolve
      })
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        worker.removeAllListeners('message')
        worker.removeAllListeners('error')
        worker.removeAllListeners('exit')
      }
      const finish = async (outcome: NativePredictionOutcome) => {
        if (settling) return
        settling = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        try {
          await worker.terminate()
        } catch {
          if (!exited) await exitConfirmed
        }
        cleanup()
        this._active = false
        resolveOutcome(outcome)
      }
      const abort = () => {
        void finish(failure('aborted', inputHash))
      }
      const timer = setTimeout(() => {
        void finish(failure('timeout', inputHash))
      }, 30000)
      worker.on('exit', () => {
        exited = true
        confirmExit()
        void finish(failure('worker-error', inputHash))
      })
      worker.on('error', () => {
        void finish(failure('worker-error', inputHash))
      })
      worker.on('message', (message: unknown) => {
        if (!isNativeResult(message)) {
          void finish(failure('invalid-output', inputHash))
          return
        }
        void finish({
          status: 'completed',
          result: message,
          inputHash,
          observedAtMs
        })
      })
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
    })
  }
}
