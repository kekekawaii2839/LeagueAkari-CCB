import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { MemberAnalysisRepository } from '../repository'
import { MemberAnalysisPipeline } from './pipeline'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

const settings = {
  enabled: true,
  members: [{ serverId: 'TEST', gameName: 'Alpha', tagLine: 'TEST' }],
  historyDepth: 100 as const,
  scanLimitPerMember: 2000,
  historyTag: 'ranked',
  storageLimitGiB: 10,
  opggEnabled: false
}

async function waitFor(predicate: () => boolean) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition timed out')
}

function createRepository() {
  const root = mkdtempSync(join(tmpdir(), 'member-analysis-pipeline-'))
  roots.push(root)
  const repository = new MemberAnalysisRepository(root)
  repository.initialize()
  return repository
}

describe('member analysis refresh pipeline', () => {
  test('rank collection has its own label and never moves collection progress backwards', async () => {
    const jobs: { progress: number; message: string }[] = []
    const collector = {
      collect: vi.fn(
        async (options: { onProgress: (done: number, total: number, phase: string) => void }) => {
          options.onProgress(10, 10, 'loading-details')
          options.onProgress(1, 10, 'loading-opponent-ranks')
          options.onProgress(10, 10, 'loading-opponent-ranks')
          return { items: [], memberErrors: 0, rankSnapshots: [] }
        }
      )
    }
    const repository = { writeJobManifest: vi.fn(() => ({})), publishStaging: vi.fn() }
    const worker = {
      available: true,
      run: vi.fn(async () => ({ type: 'result', status: 'failed' }))
    }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository as any,
      worker as any,
      settings,
      (job) => {
        jobs.push({ progress: job.progress, message: job.message })
      }
    )
    pipeline.start()
    await waitFor(() => pipeline.get()?.status === 'failed')
    const collecting = jobs.filter((job) => /collecting|opponent-ranks/.test(job.message))
    expect(collecting).toHaveLength(4)
    ;[0.02, 0.4, 0.405, 0.45].forEach((expected, index) => {
      expect(collecting[index].progress).toBeCloseTo(expected, 8)
      if (index > 0)
        expect(collecting[index].progress).toBeGreaterThanOrEqual(collecting[index - 1].progress)
    })
    expect(collecting[2].message).toBe('opponent-ranks 1/10')
    expect(repository.publishStaging).not.toHaveBeenCalled()
  })
  test('does not publish an unsuccessful worker result or expose raw failure details', async () => {
    const collector = { collect: vi.fn(async () => ({ items: [], memberErrors: 0 })) }
    const repository = { writeJobManifest: vi.fn(() => ({})), publishStaging: vi.fn() }
    const worker = {
      available: true,
      run: vi.fn(async () => ({ type: 'result', status: 'failed', message: 'private path' }))
    }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository as any,
      worker as any,
      settings
    )
    pipeline.start()
    await waitFor(() => pipeline.get()?.status === 'failed')
    expect(repository.publishStaging).not.toHaveBeenCalled()
    expect(JSON.stringify(pipeline.get())).not.toContain('private path')
  })

  test('uses a settings snapshot and awaits collection cancellation on disposal', async () => {
    const mutable = { ...settings, members: settings.members.map((member) => ({ ...member })) }
    let rejectCollection!: (reason: unknown) => void
    const collector = {
      collect: vi.fn(
        (_options: { members: typeof settings.members }) =>
          new Promise((_, reject) => {
            rejectCollection = reject
          })
      )
    }
    const repository = { writeJobManifest: vi.fn(), publishStaging: vi.fn() }
    const worker = { available: true, dispose: vi.fn(async () => {}) }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository as any,
      worker as any,
      mutable
    )
    pipeline.start()
    mutable.members[0].gameName = 'Changed'
    expect(collector.collect.mock.calls[0][0].members[0].gameName).toBe('Alpha')
    let disposed = false
    const dispose = pipeline.dispose().then(() => {
      disposed = true
    })
    await Promise.resolve()
    expect(disposed).toBe(false)
    rejectCollection(new Error('cancelled'))
    await dispose
    expect(pipeline.get()?.status).toBe('cancelled')
    expect(repository.publishStaging).not.toHaveBeenCalled()
  })
  test('rebuilds derivation when raw matches are cached so settings changes cannot leave stale games', async () => {
    const repository = createRepository()
    const item = repository.storeRaw('TEST', 1, 420, 'abc', {}, {})
    const collector = {
      collect: vi.fn(async () => ({ items: [item], changed: [], skipped: 3, memberErrors: 0 }))
    }
    const worker = {
      available: true,
      cancel: vi.fn(),
      dispose: vi.fn(),
      run: vi.fn(async () => {
        const database = new DatabaseSync(repository.stagingAnalysisPath)
        database.exec(
          'CREATE TABLE derived_games(server_id TEXT, game_id INTEGER, payload_json TEXT);'
        )
        database.close()
        return { type: 'result', status: 'completed' }
      })
    }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository,
      worker as any,
      settings
    )
    const started = pipeline.start()
    await waitFor(() => pipeline.get(started.jobId)?.status === 'completed')
    expect(worker.run).toHaveBeenCalledOnce()
    expect(pipeline.get(started.jobId)?.message).toBe('completed')
    repository.close()
  })

  test('publishes only after a successful worker result', async () => {
    const repository = createRepository()
    const item = repository.storeRaw('TEST', 1, 420, 'abc', {}, {})
    const collector = {
      collect: vi.fn(async () => ({ items: [item], changed: [item], skipped: 0, memberErrors: 0 }))
    }
    const worker = {
      available: true,
      cancel: vi.fn(),
      dispose: vi.fn(),
      run: vi.fn(async () => {
        const database = new DatabaseSync(repository.stagingAnalysisPath)
        database.exec(
          `CREATE TABLE derived_games(server_id TEXT, game_id INTEGER, payload_json TEXT); INSERT INTO derived_games VALUES('TEST',1,'{}');`
        )
        database.close()
        return { type: 'result', status: 'completed' }
      })
    }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository,
      worker as any,
      settings
    )
    const started = pipeline.start()
    await waitFor(() => pipeline.get(started.jobId)?.status === 'completed')
    expect(repository.readGames).toBeDefined()
    expect(worker.run).toHaveBeenCalledOnce()
    repository.close()
  })

  test('passes the explicit OP.GG enrichment flag only when enabled', async () => {
    const repository = createRepository()
    const item = repository.storeRaw('TEST', 1, 420, 'abc', {}, {})
    const collector = {
      collect: vi.fn(async () => ({ items: [item], changed: [item], skipped: 0, memberErrors: 0 }))
    }
    const worker = {
      available: true,
      cancel: vi.fn(),
      dispose: vi.fn(),
      run: vi.fn(async (args: string[]) => {
        expect(args).toContain('--opgg-enabled')
        const database = new DatabaseSync(repository.stagingAnalysisPath)
        database.exec(
          'CREATE TABLE derived_games(server_id TEXT, game_id INTEGER, payload_json TEXT);'
        )
        database.close()
        return { type: 'result', status: 'completed' }
      })
    }
    const pipeline = new MemberAnalysisPipeline(collector as any, repository, worker as any, {
      ...settings,
      opggEnabled: true
    })
    const started = pipeline.start()
    await waitFor(() => pipeline.get(started.jobId)?.status === 'completed')
    expect(worker.run).toHaveBeenCalledOnce()
    repository.close()
  })

  test('preserves published data when any configured identity cannot be resolved', async () => {
    const repository = createRepository()
    const published = new DatabaseSync(repository.stagingAnalysisPath)
    published.exec(
      `CREATE TABLE derived_games(server_id TEXT, game_id INTEGER, payload_json TEXT); INSERT INTO derived_games VALUES('TEST',1,'{}');`
    )
    published.close()
    repository.publishStaging()
    const before = readFileSync(repository.currentAnalysisPath)
    const collector = {
      collect: vi.fn(async () => ({ items: [], changed: [], skipped: 0, memberErrors: 1 }))
    }
    const worker = { available: true, run: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository,
      worker as any,
      settings
    )
    const started = pipeline.start()
    await waitFor(() => pipeline.get(started.jobId)?.status === 'failed')
    expect(worker.run).not.toHaveBeenCalled()
    expect(readFileSync(repository.currentAnalysisPath)).toEqual(before)
    repository.close()
  })

  test('cancels collection at its abort boundary and leaves published data untouched', async () => {
    const repository = createRepository()
    const published = new DatabaseSync(repository.stagingAnalysisPath)
    published.exec(
      `CREATE TABLE derived_games(server_id TEXT, game_id INTEGER, payload_json TEXT); INSERT INTO derived_games VALUES('TEST',1,'{}');`
    )
    published.close()
    repository.publishStaging()
    const before = readFileSync(repository.currentAnalysisPath)
    const collector = {
      collect: vi.fn(
        ({ signal }: { signal: AbortSignal }) =>
          new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          )
      )
    }
    const worker = { available: true, run: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }
    const pipeline = new MemberAnalysisPipeline(
      collector as any,
      repository,
      worker as any,
      settings
    )
    const started = pipeline.start()
    pipeline.cancel(started.jobId)
    await waitFor(() => pipeline.get(started.jobId)?.status === 'cancelled')
    expect(worker.run).not.toHaveBeenCalled()
    expect(pipeline.get(started.jobId)?.finishedAt).not.toBeNull()
    expect(readFileSync(repository.currentAnalysisPath)).toEqual(before)
    repository.close()
  })
})

test('required summary failure is safe, never publishes, and does not leak into the next job', async () => {
  const collector = { collect: vi.fn(async () => ({ items: [], memberErrors: 0 })) }
  const repository = { writeJobManifest: vi.fn(() => ({})), publishStaging: vi.fn() }
  let attempt = 0
  const worker = {
    available: true,
    run: vi.fn(
      async (
        _args: string[],
        onMessage: (message: { type: 'error'; code: string; message: string }) => void
      ) => {
        onMessage({
          type: 'error',
          code: attempt++ === 0 ? 'SUMMARY_STAT_UNAVAILABLE' : 'UNKNOWN_WORKER_CODE',
          message: 'private raw diagnostic'
        })
        throw Error('private raw failure')
      }
    )
  }
  const pipeline = new MemberAnalysisPipeline(
    collector as any,
    repository as any,
    worker as any,
    settings
  )
  pipeline.start()
  await waitFor(() => pipeline.get()?.status === 'failed')
  expect(pipeline.get()?.error).toEqual({
    code: 'SUMMARY_STAT_UNAVAILABLE',
    message: 'Required match summary statistics unavailable'
  })
  expect(repository.publishStaging).not.toHaveBeenCalled()
  pipeline.start()
  await waitFor(() => pipeline.get()?.status === 'failed')
  expect(pipeline.get()?.error).toEqual({
    code: 'PIPELINE_FAILED',
    message: 'Member analysis refresh failed'
  })
  expect(repository.publishStaging).not.toHaveBeenCalled()
})
