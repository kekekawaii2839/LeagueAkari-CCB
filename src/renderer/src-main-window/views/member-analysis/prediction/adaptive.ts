// Compatibility bridge; implementation is owned by the standalone prediction lab.
export * from '../../../../../../packages/prediction-lab/src/legacy/adaptive'

// Separate entertainment contract; the scientific legacy path remains unchanged.
export type {
  EntertainmentPredictionResult,
  EntertainmentFeatureStatus,
  EntertainmentUnavailableReason,
  EntertainmentFeature,
  EntertainmentProfile,
  EntertainmentGroupSummary
} from '../../../../../../packages/prediction-lab/src/entertainment'
export {
  entertainmentGroups,
  runEntertainmentPrediction
} from '../../../../../../packages/prediction-lab/src/entertainment'
