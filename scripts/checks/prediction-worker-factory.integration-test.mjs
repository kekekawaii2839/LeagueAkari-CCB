import { build } from 'electron-vite'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

const root = fileURLToPath(new URL('../../', import.meta.url))
const request = () => ({
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

test(
  'real Electron main bundler factory launches, cancels, reaps and reuses the prediction worker',
  { timeout: 60000 },
  async () => {
    const previousEnvironment = process.env.NODE_ENV_ELECTRON_VITE
    const temp = mkdtempSync(path.join(tmpdir(), 'akari-worker-factory-'))
    try {
      const config = {
        main: {
          build: {
            outDir: temp,
            rollupOptions: {
              input: path.join(
                root,
                'src/main/shards/member-analysis/prediction/native-prediction-executor.ts'
              ),
              preserveEntrySignatures: 'strict',
              output: {
                entryFileNames: 'executor.cjs',
                chunkFileNames: '[name]-[hash].cjs',
                format: 'cjs'
              }
            }
          }
        }
      }
      const configFile = path.join(temp, 'electron.vite.config.mjs')
      writeFileSync(configFile, `export default ${JSON.stringify(config)}`)
      await build({ configFile, root, ignoreConfigWarning: true })
      const { NativePredictionExecutor } = createRequire(import.meta.url)(
        path.join(temp, 'executor.cjs')
      )
      console.log('Generated files:', readdirSync(temp))
      console.log(
        'Factory imports:',
        readFileSync(path.join(temp, 'executor.cjs'), 'utf8')
          .split('\n')
          .filter((line) => line.includes('import(') || line.includes('require("./'))
      )
      const workerPath = readdirSync(temp).find((file) =>
        file.startsWith('native-prediction-worker-')
      )
      assert.ok(workerPath)
      const malformed = new Worker(path.join(temp, workerPath), { workerData: null })
      const messages = []
      malformed.on('message', (message) => messages.push(message))
      const exitCode = await new Promise((resolve, reject) => {
        malformed.once('error', reject)
        malformed.once('exit', resolve)
      })
      assert.equal(exitCode, 1, 'real entry catches malformed input and exits with generic failure')
      assert.deepEqual(messages, [], 'worker must not forward raw exception details')
      const executor = new NativePredictionExecutor()
      const controller = new AbortController()
      const cancelled = executor.execute(request(), { signal: controller.signal })
      controller.abort()
      assert.equal((await cancelled).reasonCode, 'aborted')
      const complete = await executor.execute(request())
      assert.equal(complete.status, 'completed')
      assert.equal(complete.result.status, 'unavailable')
      assert.equal((await executor.execute(request())).status, 'completed')
      const active = new AbortController()
      const pending = executor.execute(request(), { signal: active.signal })
      await new Promise((resolve) => setImmediate(resolve))
      active.abort()
      assert.equal((await pending).reasonCode, 'aborted')
      assert.equal((await executor.execute(request())).status, 'completed')
    } finally {
      if (previousEnvironment === undefined) delete process.env.NODE_ENV_ELECTRON_VITE
      else process.env.NODE_ENV_ELECTRON_VITE = previousEnvironment
      assert.equal(path.dirname(path.resolve(temp)), path.resolve(tmpdir()))
      assert.ok(path.basename(temp).startsWith('akari-worker-factory-'))
      rmSync(temp, { recursive: true, force: true })
    }
  }
)
