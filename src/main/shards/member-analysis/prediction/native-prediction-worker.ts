import { parentPort, workerData } from 'node:worker_threads'

import { runAdaptiveWinPrediction } from '../../../../../packages/prediction-lab/src/legacy/adaptive'
import type { NativePredictionRequest, NativePredictionResult } from './native-prediction-executor'

if (parentPort) {
  try {
    const request = workerData as NativePredictionRequest
    const result = runAdaptiveWinPrediction(
      request.observations,
      request.lineup,
      () => {},
      request.side
    )
    const summary: NativePredictionResult =
      result.status === 'available'
        ? {
            status: result.status,
            probability: result.probability,
            modelId: result.modelId,
            estimateKind: result.estimateKind,
            trainingRows: result.trainingRows,
            bootstrapSuccess: result.bootstrapSuccess,
            interval: result.interval
          }
        : { status: result.status, reason: result.reason }
    parentPort.postMessage(summary)
  } catch {
    // Never forward exception messages, identities or raw inputs.
    process.exitCode = 1
  } finally {
    parentPort.close()
  }
}
