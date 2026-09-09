export async function initializeMemberAnalysisSafely(
  initialize: () => Promise<void>,
  onReady: () => void,
  onDegraded: (error: unknown) => void
) {
  try {
    await initialize()
    onReady()
  } catch (error) {
    onDegraded(error)
  }
}
