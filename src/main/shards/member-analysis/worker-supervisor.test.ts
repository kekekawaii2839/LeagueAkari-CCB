import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'

import { MemberAnalysisWorkerSupervisor } from './worker-supervisor'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('member analysis worker supervisor', () => {
  test('rejects success output followed by an abnormal process exit', async () => {
    const supervisor = new MemberAnalysisWorkerSupervisor(
      {
        command: process.execPath,
        prefixArgs: [
          '-e',
          `process.stdout.write('{"type":"result","status":"completed"}\\n', () => process.exit(1))`
        ]
      },
      null
    )
    await expect(supervisor.run([], () => {})).rejects.toThrow('worker exited with code 1')
    expect(supervisor.running).toBe(false)
  })

  test('drains final output before accepting successful completion', async () => {
    const supervisor = new MemberAnalysisWorkerSupervisor(
      {
        command: process.execPath,
        prefixArgs: [
          '-e',
          `process.stdout.write('x'.repeat(128 * 1024) + '\\n'); process.stdout.write('{"type":"result","status":"completed"}\\n')`
        ]
      },
      null
    )
    await expect(supervisor.run([], () => {})).resolves.toMatchObject({ status: 'completed' })
    expect(supervisor.running).toBe(false)
  })
  test('uses argv without a shell and completes graceful cancellation without an orphan', async () => {
    const root = mkdtempSync(join(tmpdir(), 'member-analysis-worker-'))
    roots.push(root)
    const script = join(root, 'worker.cjs')
    writeFileSync(
      script,
      `process.stdout.write('{"type":"ready"}\\n');
       process.stdin.setEncoding('utf8');
       process.stdin.on('data', value => {
         if (value.includes('cancel')) {
           process.stdout.write('{"type":"result","status":"cancelled"}\\n');
           process.exit(2);
         }
       });
       setInterval(() => {}, 1000);`
    )
    const messages: string[] = []
    const supervisor = new MemberAnalysisWorkerSupervisor(
      { command: process.execPath, prefixArgs: [script] },
      null,
      10_000
    )
    const resultPromise = supervisor.run([], (message) => messages.push(message.type))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(supervisor.cancel()).toBe(true)
    await expect(resultPromise).resolves.toMatchObject({ type: 'result', status: 'cancelled' })
    expect(messages).toEqual(['ready', 'result'])
    expect(supervisor.running).toBe(false)
    await expect(supervisor.dispose()).resolves.toBeUndefined()
  })

  test('turns the hard deadline into graceful cancellation before termination', async () => {
    const root = mkdtempSync(join(tmpdir(), 'member-analysis-timeout-'))
    roots.push(root)
    const script = join(root, 'worker.cjs')
    writeFileSync(
      script,
      `process.stdin.setEncoding('utf8');
       process.stdin.on('data', value => {
         if (value.includes('timeout')) {
           process.stdout.write('{"type":"result","status":"cancelled"}\\n');
           process.exit(2);
         }
       });
       setInterval(() => {}, 1000);`
    )
    const supervisor = new MemberAnalysisWorkerSupervisor(
      { command: process.execPath, prefixArgs: [script] },
      null,
      100
    )
    await expect(supervisor.run([], () => {})).resolves.toMatchObject({ status: 'cancelled' })
    expect(supervisor.running).toBe(false)
  })
})
