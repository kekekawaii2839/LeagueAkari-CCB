import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

import type { NativePredictionRequest } from './native-prediction-executor'
import { NativePredictionExecutor } from './native-prediction-executor'

const factory = vi.hoisted(() => vi.fn())
vi.mock('./native-prediction-worker?nodeWorker', () => ({ default: factory }))

class WorkerFixture extends EventEmitter {
  terminate = vi.fn(async () => 0)
}
const request = (): NativePredictionRequest => ({
  observations: [],
  lineup: {
    TOP: 'synthetic-a',
    JUNGLE: 'synthetic-b',
    MIDDLE: 'synthetic-c',
    BOTTOM: 'synthetic-d',
    UTILITY: 'synthetic-e'
  },
  side: 'all',
  dataCutoffMs: Date.now() - 1
})
const available = () => ({
  status: 'available',
  probability: 0.6,
  modelId: 'baseline',
  estimateKind: 'reference',
  trainingRows: 100,
  bootstrapSuccess: 100,
  interval: [0.4, 0.7]
})
let worker: WorkerFixture
beforeEach(() => {
  worker = new WorkerFixture()
  factory.mockReset().mockReturnValue(worker)
})
afterEach(() => vi.useRealTimers())

test('snapshot hash, fixed worker resources, unavailable result and complete cleanup', async () => {
  const executor = new NativePredictionExecutor(),
    input = request(),
    serialized = JSON.stringify(input),
    pending = executor.execute(input)
  input.lineup.TOP = 'mutated'
  expect(factory.mock.calls[0][0].workerData.lineup.TOP).toBe('synthetic-a')
  expect(factory.mock.calls[0][0].resourceLimits).toEqual({ maxOldGenerationSizeMb: 256 })
  worker.emit('message', { status: 'unavailable', reason: 'synthetic' })
  const result = await pending
  expect(result.status).toBe('completed')
  expect(result.inputHash).toBe(createHash('sha256').update(serialized).digest('hex'))
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(worker.listenerCount('message')).toBe(0)
  expect(worker.listenerCount('error')).toBe(0)
})

test('busy until successful worker is confirmed reaped, then reusable', async () => {
  let release: (value: number) => void = () => {}
  worker.terminate.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const executor = new NativePredictionExecutor(),
    pending = executor.execute(request())
  worker.emit('message', available())
  expect(await executor.execute(request())).toMatchObject({ status: 'failed', reasonCode: 'busy' })
  release(0)
  expect((await pending).status).toBe('completed')
  const next = new WorkerFixture()
  factory.mockReturnValue(next)
  const second = executor.execute(request())
  next.emit('message', { status: 'unavailable', reason: 'synthetic' })
  expect((await second).status).toBe('completed')
})

test('abort wins cancellation/completion/error race exactly once and only after termination', async () => {
  const executor = new NativePredictionExecutor(),
    controller = new AbortController(),
    pending = executor.execute(request(), { signal: controller.signal })
  controller.abort()
  worker.emit('message', available())
  worker.emit('error', Error('private identity'))
  expect(await pending).toMatchObject({ status: 'failed', reasonCode: 'aborted' })
  expect(worker.terminate).toHaveBeenCalledOnce()
})

test('timeout is fixed 30 seconds, keeps cap occupied through termination', async () => {
  vi.useFakeTimers()
  let release: (value: number) => void = () => {}
  worker.terminate.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const executor = new NativePredictionExecutor(),
    pending = executor.execute(request())
  await vi.advanceTimersByTimeAsync(29999)
  expect(worker.terminate).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(worker.terminate).toHaveBeenCalledOnce()
  expect(await executor.execute(request())).toMatchObject({ reasonCode: 'busy' })
  release(0)
  expect(await pending).toMatchObject({ reasonCode: 'timeout' })
})

test('error and premature exit remain generic and both reclaim lifecycle', async () => {
  for (const event of ['error', 'exit']) {
    worker = new WorkerFixture()
    factory.mockReturnValue(worker)
    const pending = new NativePredictionExecutor().execute(request())
    worker.emit(event, event === 'error' ? Error('private raw reason') : 1)
    const result = await pending
    expect(result).toMatchObject({ status: 'failed', reasonCode: 'worker-error' })
    expect(JSON.stringify(result)).not.toContain('private raw reason')
    expect(worker.terminate).toHaveBeenCalledOnce()
  }
})

test('invalid/nonfinite worker probabilities fail closed', async () => {
  for (const output of [
    null,
    { status: 'unknown' },
    { ...available(), probability: NaN },
    { ...available(), probability: 2 },
    { ...available(), modelId: 'unknown' },
    { ...available(), estimateKind: ['reference'] },
    { ...available(), estimateKind: 'lineup' },
    { ...available(), trainingRows: -1 },
    { ...available(), trainingRows: 501 },
    { ...available(), bootstrapSuccess: 101 },
    { ...available(), interval: [0.8, 0.2] },
    { ...available(), interval: [NaN, 0.7] },
    { ...available(), interval: Array(2) },
    { ...available(), interval: null },
    { ...available(), bootstrapSuccess: 79 },
    { ...available(), extra: 'not-in-contract' }
  ]) {
    worker = new WorkerFixture()
    factory.mockReturnValue(worker)
    const pending = new NativePredictionExecutor().execute(request())
    worker.emit('message', output)
    expect(await pending).toMatchObject({ reasonCode: 'invalid-output' })
  }
})

test('available summary retains uncertainty, endpoints and low-bootstrap null explicitly', async () => {
  for (const output of [
    available(),
    { ...available(), probability: 0, interval: [0, 1] },
    { ...available(), probability: 1, bootstrapSuccess: 79, interval: null },
    { ...available(), modelId: 'lineup', estimateKind: 'lineup' }
  ]) {
    worker = new WorkerFixture()
    factory.mockReturnValue(worker)
    const pending = new NativePredictionExecutor().execute(request())
    worker.emit('message', output)
    expect(await pending).toMatchObject({ status: 'completed', result: output })
  }
})

test('worker status cannot coerce and incomplete or branch-mismatched results fail closed', async () => {
  for (const output of [
    { status: ['available'] },
    { status: 'available', probability: 0.6 },
    { status: 'unavailable' },
    { status: 'unavailable', reason: 'synthetic', probability: 0.6 }
  ]) {
    worker = new WorkerFixture()
    factory.mockReturnValue(worker)
    const pending = new NativePredictionExecutor().execute(request())
    worker.emit('message', output)
    expect(await pending).toMatchObject({ reasonCode: 'invalid-output' })
  }
})

test('sparse metrics and explicit undefined are equally invalid before worker creation', async () => {
  for (const metrics of [Array(40), Array(40).fill(undefined)]) {
    const input = request()
    input.observations = [
      {
        gameId: 1,
        timestamp: 1,
        date: 'synthetic',
        player: 'synthetic-a',
        role: 'TOP',
        win: true,
        metrics
      }
    ]
    expect(await new NativePredictionExecutor().execute(input)).toMatchObject({
      reasonCode: 'invalid-input'
    })
  }
  expect(factory).not.toHaveBeenCalled()
})

test('spawn failure releases cap and suppresses exception payload', async () => {
  factory.mockImplementation(() => {
    throw Error('private failure')
  })
  const executor = new NativePredictionExecutor()
  expect(await executor.execute(request())).toMatchObject({ reasonCode: 'worker-error' })
  factory.mockReturnValue(worker)
  const pending = executor.execute(request())
  worker.emit('message', { status: 'unavailable', reason: 'synthetic' })
  expect((await pending).status).toBe('completed')
})

test('future cutoff, ties, malformed roster/metrics and excessive population never spawn', async () => {
  const invalid = [
    { ...request(), dataCutoffMs: Date.now() + 10000 },
    { ...request(), lineup: { ...request().lineup, TOP: 'synthetic-b' } },
    { ...request(), observations: Array(2501).fill({}) }
  ]
  const observation = {
    gameId: 1,
    timestamp: 1,
    date: 'synthetic',
    player: 'synthetic-a',
    role: 'TOP' as const,
    win: true,
    metrics: Array(40).fill(0)
  }
  invalid.push({ ...request(), dataCutoffMs: 1, observations: [observation] })
  invalid.push({ ...request(), observations: [{ ...observation, metrics: [] }] })
  for (const input of invalid)
    expect(
      await new NativePredictionExecutor().execute(input as NativePredictionRequest)
    ).toMatchObject({ reasonCode: 'invalid-input' })
  expect(factory).not.toHaveBeenCalled()
})

test('already aborted request never creates a worker', async () => {
  const controller = new AbortController()
  controller.abort()
  expect(
    await new NativePredictionExecutor().execute(request(), { signal: controller.signal })
  ).toMatchObject({ reasonCode: 'aborted' })
  expect(factory).not.toHaveBeenCalled()
})

test('failed terminate never releases busy slot before independent exit confirmation', async () => {
  worker.terminate.mockRejectedValue(Error('private terminate'))
  const executor = new NativePredictionExecutor(),
    pending = executor.execute(request())
  worker.emit('message', { status: 'unavailable', reason: 'synthetic' })
  await Promise.resolve()
  await Promise.resolve()
  expect(await executor.execute(request())).toMatchObject({ reasonCode: 'busy' })
  worker.emit('exit', 1)
  expect((await pending).status).toBe('completed')
  expect(worker.listenerCount('exit')).toBe(0)
})
