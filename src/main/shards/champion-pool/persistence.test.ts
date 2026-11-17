import { DRAFT_ROLES } from '@shared/shards/member-analysis/champion-pool/scoring'
import { randomUUID } from 'node:crypto'
import { promises as fileSystem } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'

import { ChampionPoolController } from './controller'
import type { CachedDataset } from './dataset'
import { ChampionPoolPersistence } from './persistence'
import type { PoolSource, SourceCatalog } from './source'

function fixture() {
  const scope = {
    source: 'lolalytics' as const,
    patch: '16.22',
    tier: 'emerald_plus',
    region: 'all',
    queueId: 420
  }
  const catalog: SourceCatalog = {
    scope,
    slugs: { '1': 'a', '2': 'b', '3': 'c', '4': 'd' },
    baselines: DRAFT_ROLES.flatMap((role) =>
      [1, 2, 3, 4].map((championId) => ({
        scope,
        championId,
        role,
        games: 100,
        reportedWinRate: 0.5,
        pickRate: 0.25,
        pickRateDenominator: 'same-role-games' as const
      }))
    )
  }
  const source: PoolSource = {
    catalog: vi.fn(async () => structuredClone(catalog)),
    reports: vi.fn(async (_c, role, id) =>
      DRAFT_ROLES.flatMap((otherRole) =>
        (['matchup', 'synergy'] as const)
          .filter((mode) => mode !== 'synergy' || role !== otherRole)
          .map((mode) => ({
            scope,
            championId: id,
            ownRole: role,
            otherRole,
            mode,
            pairs: [1, 2, 3, 4]
              .filter((target) => target !== id)
              .map((target) => ({
                championId: target,
                games: 40,
                reportedWinRate: 0.5 + (id - 2) * 0.03
              }))
          }))
      )
    )
  }
  return { catalog, source }
}
function ready<T>(v: { status: 'ready'; data: T } | { status: 'error'; code: string }) {
  if (v.status !== 'ready') throw Error(v.code)
  return v.data
}
async function temporary(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'pool-store-'))
  try {
    await work(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
describe('userData pool persistence', () => {
  it('round-trips larger pools in the existing preferences format and preserves other roles', async () =>
    temporary(async (root) => {
      const store = new ChampionPoolPersistence(root)
      await store.savePool('TOP', [1, 2])
      const ids = Array.from({ length: 30 }, (_, index) => index + 1)
      await store.savePool('MID', ids)
      await store.flush()
      const restored = new ChampionPoolPersistence(root)
      expect(await restored.getPreferences()).toMatchObject({
        lastRole: 'MID',
        pools: { TOP: [1, 2], MID: ids }
      })
      await expect(restored.savePool('MID', [1, 1])).rejects.toThrow()
      expect((await restored.getPreferences()).pools.MID).toEqual(ids)
    }))

  it('keeps the previous pool and cleans its temp when atomic publication fails', async () =>
    temporary(async (root) => {
      const store = new ChampionPoolPersistence(root)
      await store.savePool('MID', [1])
      const previous = await readFile(join(root, 'preferences.json'), 'utf8')
      const failure = vi
        .spyOn(fileSystem, 'rename')
        .mockRejectedValueOnce(new Error('synthetic rename failure'))
      try {
        await expect(store.savePool('MID', [2])).rejects.toThrow('storage')
      } finally {
        failure.mockRestore()
      }
      expect(await readFile(join(root, 'preferences.json'), 'utf8')).toBe(previous)
      expect((await readdir(root)).some((name) => name.endsWith('.tmp'))).toBe(false)
      await store.savePool('MID', [3])
      expect((await store.getPreferences()).pools.MID).toEqual([3])
    }))
  it('rejects a feature root replaced by a junction after initialization', async (context) =>
    temporary(async (root) => {
      const store = new ChampionPoolPersistence(root),
        moved = `${root}-original`,
        external = `${root}-external`
      await store.savePool('MID', [1])
      await mkdir(external)
      const sentinel = JSON.stringify({
        schemaVersion: 1,
        lastRole: 'SUP',
        pools: { TOP: [], JUNGLE: [], MID: [], ADC: [], SUP: [3] }
      })
      await writeFile(join(external, 'preferences.json'), sentinel)
      await rename(root, moved)
      let linked = false
      try {
        try {
          await symlink(external, root, 'junction')
          linked = true
        } catch (e) {
          if (['EPERM', 'EACCES', 'ENOTSUP'].includes((e as NodeJS.ErrnoException).code || '')) {
            context.skip('junction unavailable in this environment')
            return
          }
          throw e
        }
        await expect(store.getPreferences()).rejects.toThrow('storage')
        await expect(store.savePool('MID', [2])).rejects.toThrow('storage')
        expect(await readFile(join(external, 'preferences.json'), 'utf8')).toBe(sentinel)
      } finally {
        if (linked) await unlink(root)
        await rename(moved, root)
        await rm(external, { recursive: true, force: true })
      }
    }))
  it('removes only exact regular-file crash orphans before new writes', async () =>
    temporary(async (root) => {
      const orphan = `.cache-emerald_plus-all-MID.json.gz.${randomUUID()}.tmp`,
        unrelated = '.legacy-notes.tmp'
      await writeFile(join(root, orphan), 'synthetic partial cache')
      await writeFile(join(root, unrelated), 'leave this alone')
      const store = new ChampionPoolPersistence(root)
      await store.savePool('MID', [1])
      expect(await readdir(root)).not.toContain(orphan)
      expect(await readFile(join(root, unrelated), 'utf8')).toBe('leave this alone')
    }))
  it('restores each role and serializes rapid writes without losing another role', async () =>
    temporary(async (root) => {
      const store = new ChampionPoolPersistence(root)
      await Promise.all([
        store.savePool('MID', [1]),
        store.savePool('SUP', [4, 3]),
        store.savePool('MID', [2, 1])
      ])
      const reopened = new ChampionPoolPersistence(root)
      expect(await reopened.getPreferences()).toMatchObject({
        lastRole: 'MID',
        pools: { MID: [2, 1], SUP: [4, 3], TOP: [] }
      })
      await reopened.savePool('MID', [])
      expect((await reopened.getPreferences()).pools.MID).toEqual([])
      expect((await readdir(root)).some((f) => f.endsWith('.tmp'))).toBe(false)
    }))
  it('preserves malformed and future preferences instead of silently resetting them', async () =>
    temporary(async (root) => {
      const store = new ChampionPoolPersistence(root)
      for (const text of ['{broken', JSON.stringify({ schemaVersion: 99 })]) {
        await writeFile(join(root, 'preferences.json'), text)
        await expect(store.getPreferences()).rejects.toThrow('storage')
        await expect(store.savePool('MID', [1])).rejects.toThrow()
        expect(await readFile(join(root, 'preferences.json'), 'utf8')).toBe(text)
      }
    }))
  it('reopens coverage and full-role z without network, including source scope and nulls', async () =>
    temporary(async (root) => {
      const f = fixture(),
        store = new ChampionPoolPersistence(root),
        first = new ChampionPoolController(f.source, () => 100000, store)
      const catalog = ready(await first.catalog(1, 'a', 'MID', false))
      const partial = ready(await first.coverage(1, 'b', catalog.datasetId, [1, 2]))
      expect(partial.reference).toEqual({ completed: 2, total: 4 })
      expect(partial.targets.every((t) => t.top3?.score === null)).toBe(true)
      const full = ready(await first.prepareReference(1, 'c', catalog.datasetId, [1, 2]))
      expect(full.reference).toEqual({ completed: 4, total: 4 })
      expect(full.targets.some((t) => t.top3?.score !== null)).toBe(true)
      const saveCache = vi.spyOn(store, 'saveCache')
      expect(ready(await first.coverage(1, 'warm', catalog.datasetId, [1, 2])).targets).toEqual(
        full.targets
      )
      expect(saveCache).not.toHaveBeenCalled()
      expect(f.source.reports).toHaveBeenCalledTimes(4)
      const offline: PoolSource = {
        catalog: vi.fn(async () => {
          throw Error('offline')
        }),
        reports: vi.fn(async () => {
          throw Error('offline')
        })
      }
      const reopened = new ChampionPoolController(
        offline,
        () => 100000 + 7 * 60 * 60 * 1000,
        new ChampionPoolPersistence(root)
      )
      const restored = ready(await reopened.catalog(1, 'd', 'MID', false))
      expect(restored).toMatchObject({ datasetId: catalog.datasetId, stale: true, patch: '16.22' })
      expect(ready(await reopened.coverage(1, 'e', restored.datasetId, [1, 2])).targets).toEqual(
        full.targets
      )
      expect(offline.catalog).not.toHaveBeenCalled()
      expect(offline.reports).not.toHaveBeenCalled()
    }))
  it('checkpoints validated anchors on cancellation and resumes only missing references', async () =>
    temporary(async (root) => {
      const f = fixture(),
        store = new ChampionPoolPersistence(root),
        controller = new ChampionPoolController(f.source, () => 100000, store)
      const catalog = ready(await controller.catalog(1, 'a', 'MID', false))
      await controller.coverage(1, 'b', catalog.datasetId, [1])
      const original = f.source.reports
      let resumed!: ChampionPoolController
      let finishThird!: () => void
      const thirdReport = new Promise<void>((resolve) => {
        finishThird = resolve
      })
      const resumeSource: PoolSource = {
        ...f.source,
        reports: vi.fn(async (c, r, id, signal) => {
          const reports = await original(c, r, id, signal)
          if (id !== 2) await thirdReport
          return reports
        })
      }
      resumed = new ChampionPoolController(resumeSource, () => 100000, store)
      const c = ready(await resumed.catalog(1, 'restore', 'MID', false))
      const pending = resumed.prepareReference(1, 'prepare', c.datasetId, [1])
      await vi.waitFor(() =>
        expect(resumed.progress(1, 'prepare')).toEqual({ completed: 2, total: 4 })
      )
      resumed.cancel(1, 'prepare')
      finishThird()
      expect(await pending).toMatchObject({
        code: 'cancelled'
      })
      expect((await store.loadCache('MID'))?.heroes.map((h) => h.id)).toEqual([1, 2])
      vi.mocked(f.source.reports).mockClear()
      const third = new ChampionPoolController(
        f.source,
        () => 100000,
        new ChampionPoolPersistence(root)
      )
      const disk = ready(await third.catalog(1, 'next', 'MID', false))
      const done = ready(await third.prepareReference(1, 'final', disk.datasetId, [1]))
      expect(done.reference).toEqual({ completed: 4, total: 4 })
      expect(f.source.reports).toHaveBeenCalledTimes(2)
    }))
  it('recovers a previous cache after corruption and refuses unknown versions', async () =>
    temporary(async (root) => {
      const f = fixture(),
        store = new ChampionPoolPersistence(root)
      const data: CachedDataset = {
        schemaVersion: 1,
        method: 'raw-odds-residual-v1',
        id: randomUUID(),
        role: 'MID',
        time: 100,
        source: f.catalog,
        heroes: []
      }
      await store.saveCache(data)
      await store.saveCache({ ...data, id: randomUUID(), time: 200 })
      await writeFile(join(root, 'cache-emerald_plus-all-MID.json.gz'), 'broken')
      expect((await store.loadCache('MID'))?.id).toBe(data.id)
      const future = gzipSync(JSON.stringify({ ...data, schemaVersion: 99 }))
      await writeFile(join(root, 'cache-emerald_plus-all-MID.json.gz'), future)
      await expect(store.loadCache('MID')).rejects.toThrow('storage')
      await expect(store.saveCache(data)).rejects.toThrow('storage')
      expect(await readFile(join(root, 'cache-emerald_plus-all-MID.json.gz'))).toEqual(future)
    }))
  it('rejects corrupt matrix scope without damaging saved pools', async () =>
    temporary(async (root) => {
      const f = fixture(),
        store = new ChampionPoolPersistence(root)
      await store.savePool('MID', [1])
      const bad = structuredClone(f.catalog)
      bad.baselines[0].scope = { ...bad.baselines[0].scope, patch: '16.21' }
      await expect(
        store.saveCache({
          schemaVersion: 1,
          method: 'raw-odds-residual-v1',
          id: randomUUID(),
          role: 'MID',
          time: 100,
          source: bad,
          heroes: []
        })
      ).rejects.toThrow()
      expect((await store.getPreferences()).pools.MID).toEqual([1])
    }))
})

it('reads legacy v1 triples without fabricating pair rates, and explicit refresh replaces them with source rates', async () =>
  temporary(async (root) => {
    const f = fixture()
    const store = new ChampionPoolPersistence(root)
    const first = new ChampionPoolController(f.source, () => 100000, store)
    const catalog = ready(await first.catalog(1, 'catalog', 'MID', false))
    const fresh = ready(await first.coverage(1, 'coverage', catalog.datasetId, [1]))
    const firstCell = fresh.targets.find(
      (t) => t.mode === 'matchup' && t.role === 'MID' && t.championId === 2
    )!.cells[0]
    expect(firstCell).toMatchObject({ ownWinRate: 0.5, targetWinRate: 0.5, pairWinRate: 0.47 })
    const legacy = (await store.loadCache('MID'))!
    for (const hero of legacy.heroes)
      for (const block of hero.blocks)
        block.pairs = block.pairs.map(([id, delta, games]) => [id, delta, games])
    await store.saveCache(legacy)
    expect((await store.loadCache('MID'))!.heroes[0].blocks[0].pairs[0]).toHaveLength(3)
    const offline: PoolSource = {
      catalog: vi.fn(async () => {
        throw new Error('offline')
      }),
      reports: vi.fn(async () => {
        throw new Error('offline')
      })
    }
    const reopened = new ChampionPoolController(
      offline,
      () => 100000,
      new ChampionPoolPersistence(root)
    )
    const restored = ready(await reopened.catalog(1, 'restore', 'MID', false))
    const old = ready(await reopened.coverage(1, 'old', restored.datasetId, [1]))
    expect(
      old.targets.find((t) => t.mode === 'matchup' && t.role === 'MID' && t.championId === 2)!
        .cells[0]
    ).toMatchObject({
      ownWinRate: 0.5,
      targetWinRate: 0.5,
      pairWinRate: null
    })
    expect(offline.catalog).not.toHaveBeenCalled()
    expect(offline.reports).not.toHaveBeenCalled()
    const refreshable = new ChampionPoolController(
      f.source,
      () => 200000,
      new ChampionPoolPersistence(root)
    )
    ready(await refreshable.catalog(1, 'cached', 'MID', false))
    const updated = ready(await refreshable.catalog(1, 'refresh', 'MID', true))
    expect(updated.datasetId).not.toBe(catalog.datasetId)
    const updatedCoverage = ready(await refreshable.coverage(1, 'new', updated.datasetId, [1]))
    expect(
      updatedCoverage.targets.find(
        (t) => t.mode === 'matchup' && t.role === 'MID' && t.championId === 2
      )!.cells[0].pairWinRate
    ).toBe(0.47)
    const saved = (await store.loadCache('MID'))!
    expect(saved.schemaVersion).toBe(1)
    expect(saved.heroes[0].blocks[0].pairs[0]).toHaveLength(4)
    expect(saved.heroes[0].blocks[0].pairs[0][3]).toBe(0.47)
  }))

it('validates additive pair rates before publication and keeps valid old source rates intact', async () =>
  temporary(async (root) => {
    const f = fixture()
    const store = new ChampionPoolPersistence(root)
    const controller = new ChampionPoolController(f.source, () => 100000, store)
    const catalog = ready(await controller.catalog(1, 'catalog', 'MID', false))
    ready(await controller.coverage(1, 'coverage', catalog.datasetId, [1]))
    const good = (await store.loadCache('MID'))!
    for (const reportedWinRate of [-0.01, 1.01, '0.5']) {
      const invalid = structuredClone(good)
      invalid.heroes[0].blocks[0].pairs[0][3] = reportedWinRate as number
      await expect(store.saveCache(invalid)).rejects.toThrow()
      expect(await store.loadCache('MID')).toEqual(good)
    }
    const zeroSample = structuredClone(good)
    zeroSample.heroes[0].blocks[0].pairs[0] = [2, null, 0, 0.5]
    await expect(store.saveCache(zeroSample)).rejects.toThrow()
    expect(await store.loadCache('MID')).toEqual(good)
  }))
