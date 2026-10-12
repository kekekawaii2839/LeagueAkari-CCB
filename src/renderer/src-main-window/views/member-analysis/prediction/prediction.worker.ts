import { runAdaptiveWinPrediction } from './adaptive'
import { type PredictionObservation, type TeamLineup } from './model'
import type { PredictionSide } from './side-history'

const scope = self as unknown as {
  onmessage:
    | ((
        event: MessageEvent<{
          observations: PredictionObservation[]
          lineup: TeamLineup
          side?: PredictionSide
        }>
      ) => void)
    | null
  postMessage: (message: unknown) => void
}
scope.onmessage = ({ data }) => {
  try {
    const result = runAdaptiveWinPrediction(
      data.observations,
      data.lineup,
      (done) => scope.postMessage({ type: 'progress', done }),
      data.side
    )
    scope.postMessage({ type: 'done', result })
  } catch {
    scope.postMessage({
      type: 'done',
      result: { status: 'unavailable', reason: '本地计算失败，请重试或扩大有效历史范围。' }
    })
  }
}
