import { afterEach, expect, test, vi } from 'vitest'

import { performanceMetricKeys } from '../../../../../../packages/prediction-lab/src/metrics'
import { type PredictionObservation, type TeamLineup, predictionRoles } from './model'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

test('real entertainment runner uses the existing progress/done worker envelope with partial synthetic history', async () => {
  const postMessage = vi.fn()
  const scope = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage }
  vi.stubGlobal('self', scope)
  await import('./prediction.worker')
  const lineup = Object.fromEntries(
    predictionRoles.map((role, i) => [role, `Synthetic ${i}`])
  ) as TeamLineup
  const observations: PredictionObservation[] = Array.from({ length: 20 }, (_, i) => ({
    gameId: i + 1,
    timestamp: i + 1,
    date: 'Synthetic completed history',
    player: `Synthetic ${Math.floor(i / 10)}`,
    role: 'TOP',
    win: i % 2 === 0,
    metrics: performanceMetricKeys.map((metric) =>
      metric === 'winRate' ? Number(i % 2 === 0) : i % 2 === 0 ? 2 : 0
    )
  }))
  scope.onmessage!({ data: { observations, lineup, side: 'all' } })
  expect(postMessage.mock.calls.slice(0, 5).map(([message]) => message)).toEqual(
    [20, 40, 60, 80, 100].map((done) => ({ type: 'progress', done }))
  )
  const last = postMessage.mock.calls.at(-1)![0]
  expect(last).toMatchObject({
    type: 'done',
    result: {
      kind: 'entertainment',
      modelId: 'entertainment-role-profile-v2',
      status: 'available',
      calibrated: false,
      referenceGames: 20,
      referenceObservations: 20
    }
  })
  expect(last.result.features).toHaveLength(200)
  expect(last.result.score).toBeGreaterThan(0)
  expect(last.result.score).toBeLessThan(1)
  for (const key of ['probability', 'interval', 'backtest'])
    expect(last.result).not.toHaveProperty(key)
})

test('malformed worker envelope returns a typed unavailable result without exposing exception text', async () => {
  const postMessage = vi.fn()
  const scope = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage }
  vi.stubGlobal('self', scope)
  await import('./prediction.worker')
  scope.onmessage!({ data: null })
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'done',
    result: {
      status: 'unavailable',
      kind: 'entertainment',
      modelId: 'entertainment-role-profile-v2',
      calibrated: false,
      reason: 'calculation-failed',
      side: 'all',
      referenceGames: 0,
      referenceObservations: 0,
      excludedGames: 0
    }
  })
})
