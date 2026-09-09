import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

export type WorkerLaunch = { command: string; prefixArgs: string[] }
export type WorkerMessage = {
  type: 'ready' | 'progress' | 'warning' | 'result' | 'error'
  [key: string]: unknown
}

export function resolveWorkerLaunch(options: {
  packaged: boolean
  resourcesPath: string
  developmentPython?: string
  sourceRoot: string
}): WorkerLaunch | null {
  if (options.packaged) {
    const command = join(
      options.resourcesPath,
      'member-analysis',
      'worker',
      'member-analysis-worker.exe'
    )
    return existsSync(command) ? { command, prefixArgs: [] } : null
  }
  if (!options.developmentPython || !existsSync(options.developmentPython)) return null
  return {
    command: options.developmentPython,
    prefixArgs: [
      '-I',
      join(options.sourceRoot, 'python', 'member_analysis', 'src', 'member_analysis', 'worker.py')
    ]
  }
}

export class MemberAnalysisWorkerSupervisor {
  private _child: ChildProcessWithoutNullStreams | null = null
  private _cancelTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly _launch: WorkerLaunch | null,
    private readonly _pythonPath: string | null,
    private readonly _timeoutMs = 15 * 60_000
  ) {}

  get available() {
    return Boolean(this._launch)
  }

  get running() {
    return this._child !== null
  }

  run(args: string[], onMessage: (message: WorkerMessage) => void): Promise<WorkerMessage> {
    if (!this._launch) return Promise.reject(new Error('worker is unavailable'))
    if (this._child) return Promise.reject(new Error('worker is already running'))
    const launch = this._launch
    return new Promise((resolve, reject) => {
      const child = spawn(launch.command, [...launch.prefixArgs, ...args], {
        shell: false,
        windowsHide: true,
        env: this._pythonPath
          ? { ...process.env, PYTHONPATH: this._pythonPath, PYTHONNOUSERSITE: '1' }
          : { ...process.env }
      })
      this._child = child
      let finalMessage: WorkerMessage | null = null
      let processError: Error | null = null
      let stderr = ''
      const timeout = setTimeout(() => {
        this.cancel('timeout')
      }, this._timeoutMs)
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line) as WorkerMessage
          if (!['ready', 'progress', 'warning', 'result', 'error'].includes(message.type)) return
          onMessage(message)
          if (message.type === 'result' || message.type === 'error') finalMessage = message
        } catch {
          // Unstructured stdout is intentionally ignored and never forwarded to application logs.
        }
      })
      child.stderr.on('data', (chunk) => {
        if (stderr.length < 2048) stderr += String(chunk).slice(0, 2048 - stderr.length)
      })
      child.stdin.on('error', () => {
        // Cancellation can race worker shutdown; never let a closed pipe crash main.
      })
      child.once('error', (error) => {
        processError = error
      })
      child.once('close', (code) => {
        clearTimeout(timeout)
        lines.close()
        this._clearChild()
        if (processError) reject(new Error('worker process failed'))
        else if (
          finalMessage?.type === 'result' &&
          ((finalMessage.status === 'completed' && code === 0) ||
            (finalMessage.status === 'cancelled' && (code === 0 || code === 2)))
        )
          resolve(finalMessage)
        else
          reject(new Error(`worker exited with code ${code}${stderr ? ': stderr withheld' : ''}`))
      })
    })
  }

  cancel(reason = 'cancelled') {
    const child = this._child
    if (!child) return false
    if (this._cancelTimer) return true
    if (!child.stdin.destroyed && child.stdin.writable)
      child.stdin.write(`${JSON.stringify({ type: 'cancel', reason })}\n`)
    this._cancelTimer = setTimeout(() => {
      if (this._child === child) child.kill()
    }, 5000)
    return true
  }

  async dispose() {
    const child = this._child
    if (!child) return
    this.cancel('shutdown')
    await new Promise<void>((resolve) => {
      const force = setTimeout(() => {
        if (this._child === child) child.kill('SIGKILL')
        resolve()
      }, 8000)
      child.once('close', () => {
        clearTimeout(force)
        resolve()
      })
    })
  }

  private _clearChild() {
    if (this._cancelTimer) clearTimeout(this._cancelTimer)
    this._cancelTimer = null
    this._child = null
  }
}
