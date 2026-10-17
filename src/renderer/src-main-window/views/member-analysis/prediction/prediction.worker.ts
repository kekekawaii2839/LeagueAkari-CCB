import { runEntertainmentPrediction } from './adaptive'
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
    const result = runEntertainmentPrediction(
      data.observations,
      data.lineup,
      (done) => scope.postMessage({ type: 'progress', done }),
      data.side
    )
    scope.postMessage({ type: 'done', result })
  } catch {
    scope.postMessage({
      type: 'done',
      result: {
        status: 'unavailable',
        kind: 'entertainment',
        modelId: 'entertainment-role-profile-v2',
        calibrated: false,
        reason: 'calculation-failed',
        side: ['all', 'Blue', 'Red'].includes(data?.side ?? 'all') ? (data?.side ?? 'all') : 'all',
        referenceGames: 0,
        referenceObservations: 0,
        excludedGames: 0
      }
    })
  }
}
