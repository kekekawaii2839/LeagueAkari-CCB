import { type TrendWorkerMessage, createTrendWorkerHandler } from './worker-protocol'

const handle = createTrendWorkerHandler((reply) => self.postMessage(reply))
self.onmessage = (event: MessageEvent<TrendWorkerMessage>) => handle(event.data)
