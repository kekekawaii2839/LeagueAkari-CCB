import { renderToString } from '@vue/server-renderer'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSSRApp, h, reactive } from 'vue'

import { type OpggContext, provideOpgg, useOpgg } from './context'

const api = vi.hoisted(() => ({
  loadPatches: vi.fn(),
  loadOverview: vi.fn(),
  loadDetails: vi.fn(),
  setPreferences: vi.fn(),
  updatePreferences: vi.fn(),
  setSummonerSpells: vi.fn(),
  setRunes: vi.fn(),
  writeItemSets: vi.fn()
}))
const league = reactive({
  gameflow: { phase: 'ChampSelect', session: null },
  champSelect: { session: { theirTeam: [{ championId: 24 }, { championId: 103 }] } as any }
})
const dataStore = reactive({
  settings: {
    preferredSource: 'opgg',
    preferences: {
      mode: 'ranked',
      position: 'top',
      region: 'global',
      tier: 'emerald_plus'
    }
  },
  availability: { sources: { opgg: { enabled: true }, qq101: { enabled: true } } }
})
const messages = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn() }))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => api }))
vi.mock('@opgg-window/shards/opgg', () => ({ OpggRenderer: class {} }))
vi.mock('@renderer-shared/shards/champion-data', () => ({ ChampionDataRenderer: class {} }))
vi.mock('@opgg-window/shards/opgg/store', () => ({
  useOpggStore: () => ({ savedPreferences: { flashPosition: 'auto' }, frontendSettings: {} })
}))
vi.mock('@renderer-shared/shards/auto-champ-config/store', () => ({
  useAutoChampConfigStore: () => ({ settings: {} })
}))
vi.mock('@renderer-shared/shards/champion-data/store', () => ({
  useChampionDataStore: () => dataStore
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => league
}))
vi.mock('./utils/loadout', () => ({ useLoadout: () => api, hasItemsSets: () => false }))
vi.mock('naive-ui', () => ({ useMessage: () => messages }))
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const performance = {
  games: 100,
  wins: 50,
  winRate: 0.5,
  pickRate: 0.1,
  banRate: 0.1,
  kda: 3,
  rank: 1,
  rankChange: 0,
  strengthTier: 1,
  averagePlacement: null,
  firstPlaceRate: null
}
const metadata = { source: 'opgg', mode: 'ranked', patch: '16.22', dataDate: null, updatedAt: null }
const item = (id: number, position = 'top') => ({
  championId: id,
  position,
  performance,
  counterChampionIds: []
})
const success = (data: unknown) => ({
  status: 'success',
  data,
  preferredSource: 'opgg',
  effectiveSource: 'opgg',
  fallbackReason: null,
  attempts: []
})
const overview = (id: number, position = 'top') =>
  success({ metadata, sections: { champions: [item(id, position)] } })

async function harness() {
  let context!: OpggContext
  const app = createSSRApp({
    setup() {
      provideOpgg()
      return () =>
        h({
          setup() {
            context = useOpgg()
            return () => null
          }
        })
    }
  })
  await renderToString(app)
  await context.refresh()
  vi.clearAllMocks()
  return context
}

beforeEach(() => {
  vi.resetAllMocks()
  league.gameflow.phase = 'ChampSelect'
  league.champSelect.session = { theirTeam: [{ championId: 24 }, { championId: 103 }] }
  dataStore.settings.preferredSource = 'opgg'
  dataStore.settings.preferences.mode = 'ranked'
  api.loadPatches.mockResolvedValue(success(['16.22']))
  api.loadOverview.mockImplementation(async (q) => overview(24, q.position))
  api.loadDetails.mockImplementation(async (q, id) =>
    success({ metadata, championId: id, summary: item(id, q.position), sections: {} })
  )
})

test('opens enemy details before self pick, clears prior matchup, and never applies a loadout', async () => {
  const c = await harness()
  await c.changeMatchupChampion(103)
  expect(c.matchupChampionId.value).toBe(103)
  expect(await c.openEnemyChampion(24)).toBe(true)
  expect(c.currentTab.value).toBe('champion')
  expect(c.champion.value?.data.summary.id).toBe(24)
  expect(c.matchupChampionId.value).toBeNull()
  expect(c.position.value).toBe('top')
  expect(api.loadDetails.mock.lastCall?.[0]).not.toHaveProperty('targetChampionId')
  for (const apply of [api.setRunes, api.setSummonerSpells, api.writeItemSets])
    expect(apply).not.toHaveBeenCalled()
})

test('finds a supported statistical lane when enemy is absent from the current lane', async () => {
  const c = await harness()
  api.loadOverview.mockImplementation(async (q) =>
    overview(q.position === 'middle' ? 103 : 24, q.position)
  )
  expect(await c.openEnemyChampion(103)).toBe(true)
  expect(c.position.value).toBe('mid')
  expect(c.championId.value).toBe(103)
  expect(api.loadDetails.mock.lastCall?.[0].position).toBe('middle')
  expect(messages.info).toHaveBeenCalledOnce()
})

test('rejects unrevealed enemies, non-BP sessions, unsupported modes and duplicate loading clicks', async () => {
  const c = await harness()
  expect(await c.openEnemyChampion(999)).toBe(false)
  league.gameflow.phase = 'InProgress'
  expect(await c.openEnemyChampion(24)).toBe(false)
  league.gameflow.phase = 'ChampSelect'
  dataStore.settings.preferredSource = 'qq101'
  c.mode.value = 'classic'
  expect(await c.openEnemyChampion(24)).toBe(false)
  dataStore.settings.preferredSource = 'opgg'
  c.mode.value = 'ranked'
  c.isLoading.value = true
  expect(await c.openEnemyChampion(24)).toBe(false)
  expect(api.loadDetails).not.toHaveBeenCalled()
})

test('missing or failed details preserve the list and allow retry', async () => {
  const c = await harness()
  const oldOverview = c.overview.value
  expect(await c.openEnemyChampion(103)).toBe(false)
  expect(c.currentTab.value).toBe('champions')
  expect(c.overview.value).toBe(oldOverview)
  expect(messages.info).toHaveBeenCalledOnce()
  api.loadDetails.mockRejectedValueOnce(new Error('offline'))
  expect(await c.openEnemyChampion(24)).toBe(false)
  expect(c.overview.value).toBe(oldOverview)
  expect(c.isDataUnavailable.value).toBe(false)
  expect(c.isLoading.value).toBe(false)
  expect(await c.openEnemyChampion(24)).toBe(true)
})

test.each(['cancel', 'phase', 'enemy'] as const)(
  'does not navigate on stale completion: %s',
  async (reason) => {
    const c = await harness()
    let release!: (value: unknown) => void
    api.loadDetails.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve
        })
    )
    const pending = c.openEnemyChampion(24)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    if (reason === 'cancel') c.cancel()
    if (reason === 'phase') league.gameflow.phase = 'InProgress'
    if (reason === 'enemy') league.champSelect.session = { theirTeam: [] }
    release(success({ metadata, championId: 24, summary: item(24), sections: {} }))
    expect(await pending).toBe(false)
    expect(c.currentTab.value).toBe('champions')
    expect(c.championId.value).toBeNull()
  }
)

test('failed browsing preserves source metadata and unavailable state until an atomic success', async () => {
  const c = await harness()
  c.effectiveSource.value = 'qq101'
  c.fallbackReason.value = 'request-failed'
  c.isDataUnavailable.value = true
  api.loadDetails.mockResolvedValueOnce({
    status: 'unavailable',
    data: null,
    effectiveSource: null,
    fallbackReason: 'request-failed',
    attempts: [{ outcome: 'failed' }]
  })
  expect(await c.openEnemyChampion(24)).toBe(false)
  expect(c.effectiveSource.value).toBe('qq101')
  expect(c.fallbackReason.value).toBe('request-failed')
  expect(c.isDataUnavailable.value).toBe(true)
  expect(await c.openEnemyChampion(24)).toBe(true)
  expect(c.effectiveSource.value).toBe('opgg')
  expect(c.fallbackReason.value).toBeNull()
  expect(c.isDataUnavailable.value).toBe(false)
})

test('opening a listed enemy reuses the already visible same-scope overview without another list request', async () => {
  const c = await harness()
  let release!: (value: unknown) => void
  api.loadDetails.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const pending = c.openEnemyChampion(24)
  await vi.waitFor(() => expect(release).toBeTypeOf('function'))
  expect(api.loadOverview).not.toHaveBeenCalled()
  expect(c.isLoading.value).toBe(true)
  release(success({ metadata, championId: 24, summary: item(24), sections: {} }))
  expect(await pending).toBe(true)
  expect(c.currentTab.value).toBe('champion')
})
test('force refresh never substitutes the cached list for a fresh request', async () => {
  const c = await harness()
  await c.openEnemyChampion(24)
  api.loadOverview.mockClear()
  await c.refresh()
  expect(api.loadOverview).toHaveBeenCalledOnce()
})
