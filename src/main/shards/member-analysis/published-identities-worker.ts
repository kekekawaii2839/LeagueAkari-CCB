import { parentPort } from 'node:worker_threads'

import {
  type PublishedIdentityBatch,
  projectPublishedIdentityBatch
} from './published-identities-source'

if (parentPort) {
  const port = parentPort
  let busy = false
  port.on('message', (message: { requestId: number; batch: PublishedIdentityBatch }) => {
    if (busy || !Number.isSafeInteger(message?.requestId) || message.requestId <= 0) {
      port.postMessage({ type: 'failed', requestId: message?.requestId })
      return
    }
    busy = true
    void projectPublishedIdentityBatch(message.batch, () =>
      port.postMessage({ type: 'boundary', requestId: message.requestId })
    ).then(
      (games) => {
        busy = false
        port.postMessage({ type: 'completed', requestId: message.requestId, games })
      },
      () => {
        busy = false
        port.postMessage({ type: 'failed', requestId: message.requestId })
      }
    )
  })
}
