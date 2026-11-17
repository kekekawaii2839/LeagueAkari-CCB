import type { PoolResult } from '@shared/shards/champion-pool/coverage'
import type { LolalyticsPairReport } from '@shared/shards/member-analysis/champion-pool/lolalytics'
import { DRAFT_ROLES, type DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import { describe, expect, it, vi } from 'vitest'

import { ChampionPoolController } from './controller'
import type { PoolSource, SourceCatalog } from './source'

function ready<T>(result: PoolResult<T>): T {
  if (result.status !== 'ready') throw new Error(result.code)
  return result.data
}
function fixture(ids = [1, 2, 3]) {
  let time = 100000
  const scope = {
    source: 'lolalytics' as const,
    patch: '16.22',
    tier: 'emerald_plus',
    region: 'all',
    queueId: 420
  }
  const catalog: SourceCatalog = {
    scope,
    slugs: Object.fromEntries(ids.map((id) => [String(id), `synthetic-${id}`])),
    baselines: DRAFT_ROLES.flatMap((role) =>
      ids.map((championId) => ({
        scope,
        role,
        championId,
        games: 100,
        reportedWinRate: 0.5,
        pickRate: 1 / 3,
        pickRateDenominator: 'same-role-games' as const
      }))
    )
  }
  const source: PoolSource = {
    catalog: vi.fn(async () => structuredClone(catalog)),
    reports: vi.fn(async (_c, role, championId) =>
      DRAFT_ROLES.flatMap((otherRole) =>
        (['matchup', 'synergy'] as const)
          .filter((mode) => mode !== 'synergy' || role !== otherRole)
          .map((mode) => ({
            scope,
            championId,
            ownRole: role,
            otherRole,
            mode,
            pairs: ids
              .filter((id) => id !== championId)
              .map((id) => ({
                championId: id,
                games: 50,
                reportedWinRate: championId === 1 ? 0.55 : 0.45
              }))
          }))
      )
    )
  }
  const controller = new ChampionPoolController(source, () => time)
  return {
    controller,
    source,
    catalog,
    advance: () => {
      time += 7 * 60 * 60 * 1000
    }
  }
}
describe('champion pool service', () => {
  it('analyzes and prepares the reference for pools larger than eight without truncation', async () => {
    const ids = Array.from({ length: 12 }, (_, index) => index + 1)
    const f = fixture(ids)
    const catalog = ready(await f.controller.catalog(1, 'catalog', 'MID', false))
    const coverage = ready(await f.controller.coverage(1, 'coverage', catalog.datasetId, ids))
    expect(coverage.champions.map((champion) => champion.id)).toEqual(ids)
    expect(coverage.targets.every((target) => target.cells.length === ids.length)).toBe(true)
    const reference = ready(
      await f.controller.prepareReference(1, 'reference', catalog.datasetId, ids)
    )
    expect(reference.champions.map((champion) => champion.id)).toEqual(ids)
    expect(reference.reference).toEqual({ completed: ids.length, total: ids.length })
    expect(f.source.reports).toHaveBeenCalledTimes(ids.length)
  })

  it('overlaps hero loads and stops in-flight siblings on a source rate limit', async () => {
    const f = fixture(),
      catalog = ready(await f.controller.catalog(1, 'catalog', 'MID', false))
    const limited = { isAxiosError: true, response: { status: 429 } }
    const stopped: number[] = []
    vi.mocked(f.source.reports).mockImplementation(async (_source, _role, id, signal) => {
      if (id === 1) throw limited
      return new Promise((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            stopped.push(id)
            reject(signal.reason)
          },
          { once: true }
        )
      })
    })
    expect(await f.controller.prepareReference(1, 'reference', catalog.datasetId, [1])).toEqual({
      status: 'error',
      code: 'rate-limit'
    })
    expect(stopped).toEqual([2, 3])
  })

  it('reports owner-bound reference progress and clears it after cancellation', async () => {
    const f = fixture(),
      catalog = ready(await f.controller.catalog(1, 'catalog', 'MID', false))
    await f.controller.coverage(1, 'pool', catalog.datasetId, [1])
    let release!: (reports: LolalyticsPairReport[]) => void
    vi.mocked(f.source.reports).mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const pending = f.controller.prepareReference(1, 'reference', catalog.datasetId, [1])
    await Promise.resolve()
    expect(f.controller.progress(1, 'reference')).toEqual({ completed: 1, total: 3 })
    expect(f.controller.progress(2, 'reference')).toBeNull()
    f.controller.cancel(1, 'reference')
    release([])
    expect(await pending).toMatchObject({ code: 'cancelled' })
    expect(f.controller.progress(1, 'reference')).toBeNull()
  })
  it('loads five enemy/four teammate blocks and retains fetched hero reports', async () => {
    const f = fixture(),
      c = ready(await f.controller.catalog(1, 'a', 'MID', false))
    const data = ready(await f.controller.coverage(1, 'b', c.datasetId, [1, 2]))
    expect(new Set(data.targets.map((t) => `${t.mode}:${t.role}`)).size).toBe(9)
    expect(
      data.targets.find((t) => t.mode === 'matchup' && t.role === 'MID' && t.championId === 1)
    ).toMatchObject({ status: 'uncovered', bestChampionId: 2 })
    expect(
      data.targets.find((t) => t.mode === 'synergy' && t.role === 'TOP' && t.championId === 3)
    ).toMatchObject({ status: 'covered', bestChampionId: 1, bestDeltaPp: expect.closeTo(5) })
    expect(data.fetchedAt).toBe(c.fetchedAt)
    await f.controller.coverage(1, 'c', c.datasetId, [1, 2])
    expect(f.source.reports).toHaveBeenCalledTimes(2)
    await f.controller.coverage(1, 'd', c.datasetId, [1])
    await f.controller.coverage(1, 'e', c.datasetId, [2])
    expect(f.source.reports).toHaveBeenCalledTimes(2)
  })
  it('preserves stale cache offline and rejects duplicate or non-role heroes', async () => {
    const f = fixture(),
      c = ready(await f.controller.catalog(1, 'a', 'MID', false))
    expect(await f.controller.coverage(1, 'b', c.datasetId, [1, 1])).toMatchObject({
      status: 'error'
    })
    expect(await f.controller.coverage(1, 'c', c.datasetId, [999])).toMatchObject({
      status: 'error'
    })
    f.advance()
    expect((await f.controller.coverage(1, 'd', c.datasetId, [1])).status).toBe('ready')
    const cached = ready(await f.controller.catalog(1, 'stale', 'MID', false))
    expect(cached).toMatchObject({ datasetId: c.datasetId, stale: true })
    const next = ready(await f.controller.catalog(1, 'e', 'MID', true))
    expect(next.datasetId).not.toBe(c.datasetId)
  })
  it('failed refresh preserves previous dataset and no cancelled partial report is cached', async () => {
    const f = fixture(),
      c = ready(await f.controller.catalog(1, 'a', 'MID', false))
    vi.mocked(f.source.catalog).mockRejectedValueOnce(new Error('network'))
    expect(await f.controller.catalog(1, 'b', 'MID', true)).toEqual({
      status: 'error',
      code: 'network'
    })
    let finish!: (reports: LolalyticsPairReport[]) => void
    vi.mocked(f.source.reports).mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const pending = f.controller.coverage(1, 'c', c.datasetId, [1])
    await Promise.resolve()
    f.controller.cancel(2, 'c') // another window cannot cancel this owner
    expect(await f.controller.catalog(2, 'd', 'TOP', false)).toEqual({
      status: 'error',
      code: 'busy'
    })
    f.controller.cancel(1, 'c')
    finish([])
    expect(await pending).toEqual({ status: 'error', code: 'cancelled' })
    expect((await f.controller.coverage(1, 'e', c.datasetId, [1])).status).toBe('ready')
    expect(f.source.reports).toHaveBeenCalledTimes(2)
  })
  it('does not turn absent target reports into zero-valued answers', async () => {
    const f = fixture(),
      c = ready(await f.controller.catalog(1, 'a', 'MID', false))
    vi.mocked(f.source.reports).mockImplementationOnce(async (catalog, role, id, signal) => {
      const reports = await fixture().source.reports(catalog, role, id, signal)
      return reports.map((report) => ({ ...report, pairs: [] }))
    })
    const data = ready(await f.controller.coverage(1, 'b', c.datasetId, [1]))
    expect(
      data.targets
        .filter((t) => t.championId !== 1)
        .every((t) => t.status === 'unknown' && t.bestDeltaPp === null)
    ).toBe(true)
  })
  it('keeps selected role independent of catalog cache', async () => {
    const f = fixture(),
      a = ready(await f.controller.catalog(1, 'a', 'MID', false))
    const b = ready(await f.controller.catalog(1, 'b', 'SUP', false))
    expect(b.role).toBe('SUP' satisfies DraftRole)
    expect(await f.controller.coverage(1, 'c', a.datasetId, [1])).toMatchObject({ code: 'expired' })
  })
})

it('exposes source role-specific overall and observed pair win rates independently of residual availability', async () => {
  const f = fixture()
  const own = f.catalog.baselines.find((b) => b.role === 'MID' && b.championId === 1)!
  const enemy = f.catalog.baselines.find((b) => b.role === 'MID' && b.championId === 2)!
  const teammate = f.catalog.baselines.find((b) => b.role === 'SUP' && b.championId === 2)!
  own.reportedWinRate = 0
  own.games = 80
  enemy.reportedWinRate = 0.61
  enemy.games = 900
  teammate.reportedWinRate = 0.73
  teammate.games = 130
  const catalog = ready(await f.controller.catalog(1, 'catalog', 'MID', false))
  const coverage = ready(await f.controller.coverage(1, 'coverage', catalog.datasetId, [1]))
  const target = (mode: string, role: string) =>
    coverage.targets.find((t) => t.mode === mode && t.role === role && t.championId === 2)!
  expect(target('matchup', 'MID').cells[0]).toMatchObject({
    state: 'missing',
    deltaPp: null,
    ownWinRate: 0,
    ownGames: 80,
    targetWinRate: 0.61,
    targetGames: 900,
    pairWinRate: 0.55,
    games: 50
  })
  expect(target('synergy', 'SUP').cells[0]).toMatchObject({
    state: 'missing',
    deltaPp: null,
    ownWinRate: 0,
    ownGames: 80,
    targetWinRate: 0.73,
    targetGames: 130,
    pairWinRate: 0.55,
    games: 50
  })
})
it('zero-sample overall and pair rates stay unknown while genuine pair zero wins remain zero', async () => {
  const f = fixture()
  const baseline = f.catalog.baselines.find((b) => b.role === 'SUP' && b.championId === 2)!
  baseline.games = 0
  baseline.reportedWinRate = 0.8
  vi.mocked(f.source.reports).mockImplementationOnce(async (...args) => {
    const reports = await fixture().source.reports(...args)
    for (const report of reports)
      for (const pair of report.pairs) {
        pair.reportedWinRate = 0
        pair.games = report.mode === 'synergy' ? 0 : 12
      }
    return reports
  })
  const catalog = ready(await f.controller.catalog(1, 'catalog', 'MID', false))
  const coverage = ready(await f.controller.coverage(1, 'coverage', catalog.datasetId, [1]))
  expect(
    coverage.targets.find((t) => t.mode === 'synergy' && t.role === 'SUP' && t.championId === 2)!
      .cells[0]
  ).toMatchObject({
    targetWinRate: null,
    targetGames: 0,
    pairWinRate: null,
    games: 0
  })
  expect(
    coverage.targets.find((t) => t.mode === 'matchup' && t.role === 'MID' && t.championId === 2)!
      .cells[0]
  ).toMatchObject({
    pairWinRate: 0,
    games: 12
  })
})
