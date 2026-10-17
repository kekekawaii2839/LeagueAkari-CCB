import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'
import { afterEach, expect, test, vi } from 'vitest'

import { PublishedIdentitiesExecutor } from './published-identities-executor'
import type { PublishedIdentityBatch } from './published-identities-source'

const batch: PublishedIdentityBatch = {
  dataRoot: 'C:/SYNTHETIC_TEST_ONLY',
  tasks: [{ serverId: 'TEST', gameId: 1, checksum: 'x', payload: '{}', ambiguous: 1 }],
  members: []
}
class Fixture extends EventEmitter {
  postMessage = vi.fn()
  ref = vi.fn()
  unref = vi.fn()
  get requestId() {
    return this.postMessage.mock.calls.at(-1)?.[0].requestId
  }
  terminate = vi.fn(async () => {
    this.emit('exit', 0)
    return 0
  })
}
afterEach(() => vi.useRealTimers())
const output = [{ gameId: 1, status: 'identity-unavailable', members: [] }]
async function turn() {
  await Promise.resolve()
  await Promise.resolve()
}
test('successful worker reply is reusable and verifies main scope at boundaries and finish', async () => {
  const worker = new Fixture()
  const valid = vi.fn()
  const executor = new PublishedIdentitiesExecutor(() => worker as unknown as Worker)
  const pending = executor.execute(batch, valid)
  await turn()
  worker.emit('message', { type: 'boundary', requestId: worker.requestId })
  worker.emit('message', { type: 'completed', requestId: worker.requestId, games: output })
  await expect(pending).resolves.toEqual(output)
  expect(valid.mock.calls.length).toBeGreaterThanOrEqual(3)
  expect(worker.terminate).not.toHaveBeenCalled()
  expect(worker.unref).toHaveBeenCalledTimes(1)
  expect(worker.listenerCount('message')).toBe(0)
  await executor.dispose()
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})
test('a publication/configuration change at worker boundary rejects old reply and terminates worker', async () => {
  const worker = new Fixture()
  let current = true
  const executor = new PublishedIdentitiesExecutor(() => worker as unknown as Worker)
  const pending = executor.execute(batch, () => {
    if (!current) throw new Error('changed')
  })
  await turn()
  current = false
  worker.emit('message', { type: 'boundary', requestId: worker.requestId })
  await expect(pending).rejects.toThrow('Stale published identities request')
  expect(worker.terminate).toHaveBeenCalledTimes(1)
  await executor.dispose()
})
test('dispose rejects queued requests and terminates both active workers without launching queued work', async () => {
  const workers: Fixture[] = []
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Fixture()
    workers.push(worker)
    return worker as unknown as Worker
  })
  const outcomes = Array.from({ length: 6 }, () =>
    executor
      .execute(batch, () => {})
      .then(
        () => false,
        () => true
      )
  )
  await turn()
  expect(workers).toHaveLength(2)
  await executor.dispose()
  expect(await Promise.all(outcomes)).toEqual([true, true, true, true, true, true])
  expect(workers.every((worker) => worker.terminate.mock.calls.length === 1)).toBe(true)
  await expect(executor.execute(batch, () => {})).rejects.toThrow('unavailable')
})
test('error, malformed reply and timeout return fixed errors and always terminate', async () => {
  vi.useFakeTimers()
  for (const mode of ['error', 'malformed', 'timeout']) {
    const worker = new Fixture()
    const executor = new PublishedIdentitiesExecutor(() => worker as unknown as Worker)
    const pending = executor.execute(batch, () => {})
    const outcome = pending.catch((error) => error.message)
    await turn()
    if (mode === 'error') worker.emit('error', new Error('secret-identity-private-path'))
    else if (mode === 'malformed')
      worker.emit('message', {
        type: 'completed',
        requestId: worker.requestId,
        games: [{ ...output[0], gameId: 2 }]
      })
    else await vi.advanceTimersByTimeAsync(30_000)
    expect(await outcome).not.toContain('secret-identity')
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    await executor.dispose()
  }
})
test('dispose during entry loading terminates subsequently created worker before accepting results', async () => {
  let finish!: (worker: Worker) => void
  const worker = new Fixture()
  const executor = new PublishedIdentitiesExecutor(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const outcome = executor
    .execute(batch, () => {})
    .then(
      () => false,
      () => true
    )
  const disposed = executor.dispose()
  finish(worker as unknown as Worker)
  await disposed
  expect(await outcome).toBe(true)
  expect(worker.terminate).toHaveBeenCalledTimes(1)
})

test('actual Node worker termination on shutdown rejects request and leaves no live thread', async () => {
  const worker = new Worker(
    'const {parentPort}=require("node:worker_threads");parentPort.on("message", request=>setInterval(()=>parentPort.postMessage({type:"boundary",requestId:request.requestId}),10))',
    { eval: true }
  )
  const executor = new PublishedIdentitiesExecutor(() => worker)
  const outcome = executor
    .execute(batch, () => {})
    .then(
      () => false,
      () => true
    )
  await new Promise<void>((resolve) => worker.once('online', resolve))
  await executor.dispose()
  expect(await outcome).toBe(true)
  expect(worker.threadId).toBe(-1)
})

test('actual failed Node worker returns fixed failure and has exited before request settles', async () => {
  const worker = new Worker('throw new Error("PRIVATE_SYNTHETIC_TEST_ONLY")', { eval: true })
  const executor = new PublishedIdentitiesExecutor(() => worker)
  const reason = await executor.execute(batch, () => {}).catch((error) => error.message)
  expect(reason).toBe('Identity worker failed')
  expect(worker.threadId).toBe(-1)
  expect(worker.listenerCount('error')).toBe(0)
  await executor.dispose()
})

test('real thread serves successive pages and ignores a late earlier request without restarting modules', async () => {
  const workers: Worker[] = []
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Worker(
      `const {parentPort}=require('node:worker_threads');
      let previous=0;
      parentPort.on('message',({requestId,batch})=>{
        if(previous) parentPort.postMessage({type:'completed',requestId:previous,games:[{gameId:999,status:'identity-unavailable',members:[]}]});
        previous=requestId;
        parentPort.postMessage({type:'boundary',requestId});
        parentPort.postMessage({type:'completed',requestId,games:batch.tasks.map(task=>({gameId:task.gameId,status:'identity-unavailable',members:[]}))});
      });`,
      { eval: true }
    )
    workers.push(worker)
    return worker
  })
  try {
    expect(await executor.execute(batch, () => {})).toEqual(output)
    const threadId = workers[0].threadId
    const second = {
      ...batch,
      tasks: [{ ...batch.tasks[0], gameId: 2 }],
      members: [{ slot: 1, serverId: 'TEST', puuid: 'CHANGED_SYNTHETIC_ONLY' }]
    }
    expect(await executor.execute(second, () => {})).toEqual([{ ...output[0], gameId: 2 }])
    expect(workers).toHaveLength(1)
    expect(workers[0].threadId).toBe(threadId)
  } finally {
    await executor.dispose()
  }
  expect(workers[0].threadId).toBe(-1)
})

test('real reused thread crash is closed and the next request creates a new thread', async () => {
  const workers: Worker[] = []
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Worker(
      `const {parentPort}=require('node:worker_threads');
      parentPort.on('message',({requestId,batch})=>{
        if(batch.dataRoot==='CRASH_SYNTHETIC_ONLY') throw new Error('PRIVATE_SYNTHETIC_ONLY');
        parentPort.postMessage({type:'completed',requestId,games:batch.tasks.map(task=>({gameId:task.gameId,status:'identity-unavailable',members:[]}))});
      });`,
      { eval: true }
    )
    workers.push(worker)
    return worker
  })
  try {
    await executor.execute(batch, () => {})
    await expect(
      executor.execute({ ...batch, dataRoot: 'CRASH_SYNTHETIC_ONLY' }, () => {})
    ).rejects.toThrow('Identity worker failed')
    expect(workers[0].threadId).toBe(-1)
    expect(await executor.execute(batch, () => {})).toEqual(output)
    expect(workers).toHaveLength(2)
  } finally {
    await executor.dispose()
  }
  expect(workers.every((worker) => worker.threadId === -1)).toBe(true)
})

test('idle expiry releases a reusable worker and subsequent request rebuilds it', async () => {
  vi.useFakeTimers()
  const workers: Fixture[] = []
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Fixture()
    workers.push(worker)
    return worker as unknown as Worker
  })
  const first = executor.execute(batch, () => {})
  await turn()
  workers[0].emit('message', { type: 'completed', requestId: workers[0].requestId, games: output })
  await first
  await vi.advanceTimersByTimeAsync(15_000)
  expect(workers[0].terminate).toHaveBeenCalledTimes(1)
  const second = executor.execute(batch, () => {})
  await turn()
  expect(workers).toHaveLength(2)
  workers[1].emit('message', { type: 'completed', requestId: workers[1].requestId, games: output })
  await second
  await executor.dispose()
})

test('two workers plus eight waiting pages are bounded; invalid and oversized requests do not launch workers', async () => {
  const workers: Fixture[] = []
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Fixture()
    workers.push(worker)
    return worker as unknown as Worker
  })
  const outcomes = Array.from({ length: 10 }, () =>
    executor.execute(batch, () => {}).catch(() => null)
  )
  await turn()
  expect(workers).toHaveLength(2)
  await expect(executor.execute(batch, () => {})).rejects.toThrow('unavailable')
  await expect(
    executor.execute(
      { ...batch, tasks: Array.from({ length: 26 }, () => batch.tasks[0]) },
      () => {}
    )
  ).rejects.toThrow('unavailable')
  await executor.dispose()
  expect(await Promise.all(outcomes)).toEqual(Array(10).fill(null))
})

test('terminating threads retain capacity until exit; queued pages never create a third thread', async () => {
  const workers: Fixture[] = []
  let finish!: () => void
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Fixture()
    workers.push(worker)
    if (workers.length === 1)
      worker.terminate.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            finish = () => {
              worker.emit('exit', 0)
              resolve(0)
            }
          })
      )
    return worker as unknown as Worker
  })
  const first = executor.execute(batch, () => {}).catch(() => null)
  const second = executor.execute(batch, () => {}).catch(() => null)
  const third = executor.execute(batch, () => {}).catch(() => null)
  await turn()
  workers[0].emit('error', new Error('synthetic'))
  await turn()
  expect(workers).toHaveLength(2)
  finish()
  await first
  await turn()
  expect(workers).toHaveLength(3)
  await executor.dispose()
  await Promise.all([second, third])
})

test('an idle terminating worker plus an asynchronously creating worker consumes both slots', async () => {
  vi.useFakeTimers()
  const workers: Fixture[] = []
  let finishExit!: () => void
  let finishFactory!: () => void
  const executor = new PublishedIdentitiesExecutor(() => {
    const worker = new Fixture()
    workers.push(worker)
    if (workers.length === 1) {
      worker.terminate.mockImplementation(
        () =>
          new Promise<number>((resolve) => {
            finishExit = () => {
              worker.emit('exit', 0)
              resolve(0)
            }
          })
      )
      return worker as unknown as Worker
    }
    return new Promise<Worker>((resolve) => {
      finishFactory = () => resolve(worker as unknown as Worker)
    })
  })
  const first = executor.execute(batch, () => {})
  await turn()
  workers[0].emit('message', { type: 'completed', requestId: workers[0].requestId, games: output })
  await first
  await vi.advanceTimersByTimeAsync(15_000)
  const second = executor.execute(batch, () => {}).catch(() => null)
  const third = executor.execute(batch, () => {}).catch(() => null)
  await turn()
  expect(workers).toHaveLength(2)
  finishFactory()
  await turn()
  expect(workers).toHaveLength(2)
  const disposed = executor.dispose()
  finishExit()
  await disposed
  await Promise.all([second, third])
})
