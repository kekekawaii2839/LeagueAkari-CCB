import { parentPort, workerData } from 'node:worker_threads'

import type { RankPublicationRequest } from './rank-publication-executor'
import { OpponentRankRepository } from './repository'

if (parentPort) {
  const request = workerData as RankPublicationRequest
  const repository = new OpponentRankRepository(request.path)
  try {
    repository.openExisting()
    repository.publishGames(request.games, request.publicationId)
    parentPort.postMessage({ completed: true })
  } catch {
    // Only a fixed outcome leaves the worker; no paths, identities or raw errors.
    process.exitCode = 1
  } finally {
    repository.close()
    parentPort.close()
  }
}
