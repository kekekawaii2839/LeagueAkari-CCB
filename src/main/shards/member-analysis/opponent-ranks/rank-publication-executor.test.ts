import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { executeRankPublication } from './rank-publication-executor'

const mocked = vi.hoisted(() => ({ factory: vi.fn() }))
vi.mock('./rank-publication-worker?nodeWorker', () => ({ default: mocked.factory }))
class SyntheticWorker extends EventEmitter {
  terminate = vi.fn(async () => {
    queueMicrotask(() => this.emit('exit', 1))
    return 1
  })
}
const request = {
  path: 'SYNTHETIC_TEST_ONLY',
  publicationId: '00000000-0000-4000-8000-000000000000',
  games: []
}
afterEach(() => {
  vi.useRealTimers()
  mocked.factory.mockReset()
})
describe('rank publication worker lifecycle', () => {
  test('requires worker exit, not just acknowledgement, before releasing the caller', async () => {
    const worker = new SyntheticWorker()
    mocked.factory.mockReturnValue(worker)
    let settled = false
    const publication = executeRankPublication(request).then(() => {
      settled = true
    })
    await vi.dynamicImportSettled()
    worker.emit('message', { completed: true })
    await Promise.resolve()
    expect(settled).toBe(false)
    worker.emit('exit', 0)
    await publication
    expect(settled).toBe(true)
    expect(worker.listenerCount('message')).toBe(0)
  })
  test('does not expose raw worker errors and confirms termination', async () => {
    const worker = new SyntheticWorker()
    mocked.factory.mockReturnValue(worker)
    const publication = executeRankPublication(request)
    const rejected = expect(publication).rejects.toThrow('Rank publication worker failed')
    await vi.dynamicImportSettled()
    worker.emit('error', new Error('SYNTHETIC_PRIVATE_PATH'))
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
  test('a bounded timeout terminates the worker before failing', async () => {
    vi.useFakeTimers()
    const worker = new SyntheticWorker()
    mocked.factory.mockReturnValue(worker)
    const publication = executeRankPublication(request)
    const rejected = expect(publication).rejects.toThrow('Rank publication worker failed')
    await vi.dynamicImportSettled()
    await vi.advanceTimersByTimeAsync(60_000)
    await rejected
    expect(worker.terminate).toHaveBeenCalledOnce()
  })
})
