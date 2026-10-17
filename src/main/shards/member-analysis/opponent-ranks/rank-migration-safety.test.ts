import { normalizeRankedStats } from '@shared/shards/member-analysis/opponent-ranks'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test, vi } from 'vitest'

import { OpponentRankRepository } from './repository'

const fault = vi.hoisted(() => ({ backup: false, restore: false }))
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    copyFileSync: (...args: Parameters<typeof actual.copyFileSync>) => {
      if (
        (fault.backup && String(args[1]).includes('.migration-v4-')) ||
        (fault.restore && String(args[1]).includes('.migration-restore-'))
      ) {
        actual.writeFileSync(args[1], 'SYNTHETIC_TEST_ONLY_PARTIAL_COPY')
        throw new Error('synthetic interrupted copy')
      }
      return actual.copyFileSync(...args)
    }
  }
})
const roots: string[] = []
afterEach(() => {
  fault.backup = false
  fault.restore = false
  vi.restoreAllMocks()
  roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true }))
})
function legacy() {
  const root = mkdtempSync(join(tmpdir(), 'akari-synthetic-rank-migration-'))
  roots.push(root)
  const path = join(root, 'ranks.sqlite3')
  const repository = new OpponentRankRepository(path)
  repository.initialize()
  const snapshot = normalizeRankedStats(
    { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'SILVER', rank: 'II', leaguePoints: 0 }] },
    '2026-10-14T06:00:00.000Z'
  )
  repository.writePlayer('TEST_ONLY', 'SYNTHETIC_TEST_ONLY_MEMBER', snapshot)
  repository.close()
  const database = new DatabaseSync(path)
  database.exec('DROP TABLE publication_receipts; PRAGMA user_version=3')
  database.close()
  return { root, path, snapshot }
}
function preserved(path: string) {
  const database = new DatabaseSync(path)
  try {
    expect(
      database.prepare('SELECT COUNT(*) AS count FROM player_observations').get()
    ).toMatchObject({ count: 1 })
    expect(database.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 3 })
  } finally {
    database.close()
  }
}
test('a partial backup copy is never used to overwrite the original database', () => {
  const value = legacy()
  fault.backup = true
  const repository = new OpponentRankRepository(value.path)
  expect(() => repository.initialize()).toThrow('synthetic interrupted copy')
  preserved(value.path)
  fault.backup = false
  repository.initialize()
  try {
    expect(repository.readPlayerHistory('TEST_ONLY', 'SYNTHETIC_TEST_ONLY_MEMBER')).toEqual([
      value.snapshot
    ])
  } finally {
    repository.close()
  }
})
test('a partial restore copy preserves both the original database and the complete backup', () => {
  const value = legacy()
  fault.restore = true
  const repository = new OpponentRankRepository(value.path)
  const fail = vi.spyOn(repository as any, '_archiveLegacy').mockImplementation(() => {
    throw new Error('synthetic migration failure')
  })
  expect(() => repository.initialize()).toThrow('synthetic interrupted copy')
  preserved(value.path)
  const backups = readdirSync(value.root).filter((name) => name.includes('.migration-v4-'))
  expect(backups).toHaveLength(1)
  preserved(join(value.root, backups[0]))
  fail.mockRestore()
  fault.restore = false
  repository.initialize()
  try {
    expect(repository.readPlayerHistory('TEST_ONLY', 'SYNTHETIC_TEST_ONLY_MEMBER')).toEqual([
      value.snapshot
    ])
  } finally {
    repository.close()
  }
})
