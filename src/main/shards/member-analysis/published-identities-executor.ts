import { MemberAnalysisPublishedMemberIdentitiesPageSchema } from '@shared/shards/member-analysis'
import type { Worker } from 'node:worker_threads'
import { z } from 'zod'

import { ProfileIconLookupSchema } from './profile-icon-lookup'
import type { PublishedIdentityBatch, PublishedIdentityGame } from './published-identities-source'

export interface PublishedIdentityReader {
  execute(
    batch: PublishedIdentityBatch,
    assertCurrent: () => void
  ): Promise<PublishedIdentityGame[]>
  dispose?(): Promise<void>
}
type WorkerFactory = () => Worker | Promise<Worker>
type Entry = {
  batch: PublishedIdentityBatch
  assertCurrent: () => void
  resolve: (value: PublishedIdentityGame[]) => void
  reject: (error: Error) => void
}
const createWorker: WorkerFactory = async () => {
  const { default: factory } = await import('./published-identities-worker?nodeWorker')
  return factory({ resourceLimits: { maxOldGenerationSizeMb: 256 } })
}
/** At most two page workers and eight waiting requests, with guaranteed lifecycle cleanup. */
export class PublishedIdentitiesExecutor implements PublishedIdentityReader {
  private _disposed = false
  private _running = 0
  private _creating = 0
  private _requestId = 0
  private readonly _workers = new Set<Worker>()
  private readonly _idle = new Map<
    Worker,
    { timer: ReturnType<typeof setTimeout>; failed: () => void }
  >()
  private readonly _retiring = new Map<Worker, Promise<void>>()
  private readonly _queue: Entry[] = []
  private readonly _active = new Set<(error: Error) => void>()
  private readonly _operations = new Set<Promise<void>>()
  constructor(private readonly _factory: WorkerFactory = createWorker) {}
  execute(
    batch: PublishedIdentityBatch,
    assertCurrent: () => void
  ): Promise<PublishedIdentityGame[]> {
    if (this._disposed || this._queue.length >= 8 || batch.tasks.length > 25)
      return Promise.reject(new Error('Identity reader unavailable'))
    return new Promise((resolve, reject) => {
      this._queue.push({ batch, assertCurrent, resolve, reject })
      this._drain()
    })
  }
  private _drain() {
    while (
      !this._disposed &&
      this._running < 2 &&
      this._queue.length &&
      (this._idle.size > 0 || this._workers.size + this._creating < 2)
    ) {
      const entry = this._queue.shift()!
      this._running++
      const operation = this._run(entry).finally(() => {
        this._running--
        this._operations.delete(operation)
        this._drain()
      })
      this._operations.add(operation)
    }
  }
  private async _run(entry: Entry) {
    let worker: Worker
    try {
      entry.assertCurrent()
    } catch {
      entry.reject(new Error('Stale published identities request'))
      return
    }
    try {
      const available = this._idle.keys().next().value
      if (available) {
        worker = available
        this._takeIdle(worker)
      } else {
        this._creating++
        try {
          worker = await this._factory()
          this._workers.add(worker)
        } finally {
          this._creating--
        }
      }
    } catch {
      entry.reject(new Error('Identity reader unavailable'))
      return
    }
    const requestId = ++this._requestId
    await new Promise<void>((done) => {
      let settled = false
      const finish = async (error: Error | null, value: PublishedIdentityGame[] = []) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this._active.delete(abort)
        if (!error) {
          try {
            entry.assertCurrent()
          } catch {
            error = new Error('Stale published identities request')
          }
        }
        worker.removeAllListeners('message')
        worker.removeAllListeners('error')
        worker.removeAllListeners('exit')
        if (error) {
          try {
            await this._retire(worker)
          } catch {
            error = new Error('Identity worker cleanup failed')
          }
          entry.reject(error)
        } else {
          this._keepIdle(worker)
          entry.resolve(value)
        }
        done()
      }
      const abort = (error: Error) => {
        void finish(error)
      }
      const timer = setTimeout(() => abort(new Error('Identity reader timeout')), 30_000)
      this._active.add(abort)
      worker.on('exit', () => {
        if (!settled) abort(new Error('Identity worker exited'))
      })
      worker.on('error', () => abort(new Error('Identity worker failed')))
      worker.on('message', (message: unknown) => {
        if (
          message &&
          typeof message === 'object' &&
          'requestId' in message &&
          Number.isSafeInteger(message.requestId) &&
          Number(message.requestId) < requestId
        )
          return
        if (
          !message ||
          typeof message !== 'object' ||
          !('requestId' in message) ||
          message.requestId !== requestId
        ) {
          abort(new Error('Invalid identity worker reply'))
          return
        }
        try {
          entry.assertCurrent()
        } catch {
          abort(new Error('Stale published identities request'))
          return
        }
        if (!message || typeof message !== 'object' || !('type' in message)) {
          abort(new Error('Invalid identity worker reply'))
          return
        }
        if (message.type === 'boundary') return
        if (message.type !== 'completed' || !('games' in message)) {
          abort(new Error('Identity worker failed'))
          return
        }
        const result = z
          .array(
            MemberAnalysisPublishedMemberIdentitiesPageSchema.shape.games.element.extend({
              lookups: z.array(ProfileIconLookupSchema).max(5).optional()
            })
          )
          .max(25)
          .safeParse(message.games)
        if (
          !result.success ||
          result.data.length !== entry.batch.tasks.length ||
          result.data.some(
            (game, index) =>
              game.gameId !== entry.batch.tasks[index].gameId ||
              (game.lookups &&
                (new Set(game.lookups.map((row) => row.identity)).size !== game.lookups.length ||
                  game.lookups.some(
                    (row) =>
                      row.serverId !== entry.batch.tasks[index].serverId ||
                      !game.profiles?.some((profile) => profile.identity === row.identity)
                  )))
          )
        ) {
          abort(new Error('Invalid identity worker reply'))
          return
        }
        void finish(null, result.data)
      })
      // Disposal may have happened while the bundler entry/factory was loading.
      if (this._disposed) abort(new Error('Identity reader disposed'))
      else {
        try {
          entry.assertCurrent()
          worker.postMessage({ requestId, batch: entry.batch })
        } catch {
          abort(new Error('Stale published identities request'))
        }
      }
    })
  }
  private _takeIdle(worker: Worker) {
    const idle = this._idle.get(worker)
    if (!idle) return
    clearTimeout(idle.timer)
    worker.removeListener('error', idle.failed)
    worker.removeListener('exit', idle.failed)
    this._idle.delete(worker)
    worker.ref()
  }
  private _keepIdle(worker: Worker) {
    const failed = () => {
      void this._retire(worker).catch(() => undefined)
    }
    const timer = setTimeout(failed, 15_000)
    timer.unref()
    worker.unref()
    this._idle.set(worker, { timer, failed })
    worker.once('error', failed)
    worker.once('exit', failed)
  }
  private _retire(worker: Worker): Promise<void> {
    const previous = this._retiring.get(worker)
    if (previous) return previous
    this._takeIdle(worker)
    const operation = (async () => {
      let exited = worker.threadId === -1
      let confirmExit = () => {}
      const exit = new Promise<void>((resolve) => {
        confirmExit = resolve
      })
      const observe = () => {
        exited = true
        confirmExit()
      }
      worker.once('exit', observe)
      try {
        await worker.terminate()
      } catch {
        if (!exited) await exit
        throw new Error('Identity worker cleanup failed')
      } finally {
        worker.removeAllListeners()
        this._workers.delete(worker)
        this._retiring.delete(worker)
        this._drain()
      }
    })()
    this._retiring.set(worker, operation)
    return operation
  }
  async dispose() {
    this._disposed = true
    for (const entry of this._queue.splice(0)) entry.reject(new Error('Identity reader disposed'))
    for (const abort of this._active) abort(new Error('Identity reader disposed'))
    for (const worker of this._idle.keys()) void this._retire(worker).catch(() => undefined)
    await Promise.all([...this._operations, ...this._retiring.values()])
  }
}
