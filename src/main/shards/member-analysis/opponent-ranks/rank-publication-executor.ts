import type { Worker } from 'node:worker_threads'

import type { GameRankSnapshot } from './repository'

export type RankPublicationRequest = {
  path: string
  publicationId: string
  games: GameRankSnapshot[]
}

/** A dedicated connection owns the whole rank transaction; main never shares it. */
export async function executeRankPublication(request: RankPublicationRequest): Promise<void> {
  const { default: createWorker } = await import('./rank-publication-worker?nodeWorker')
  const worker: Worker = createWorker({
    workerData: request,
    resourceLimits: { maxOldGenerationSizeMb: 256 }
  })
  await new Promise<void>((resolve, reject) => {
    let acknowledged = false
    let failed = false
    const timeout = setTimeout(() => {
      failed = true
      void worker.terminate().catch(() => undefined)
    }, 60_000)
    worker.on('message', (message: unknown) => {
      acknowledged =
        typeof message === 'object' &&
        message !== null &&
        Object.keys(message).length === 1 &&
        (message as { completed?: unknown }).completed === true
    })
    worker.on('error', () => {
      failed = true
      void worker.terminate().catch(() => undefined)
    })
    // The database connection must be closed before queued main writes resume.
    worker.once('exit', (code) => {
      clearTimeout(timeout)
      worker.removeAllListeners()
      if (!failed && acknowledged && code === 0) resolve()
      else reject(new Error('Rank publication worker failed'))
    })
  })
}
