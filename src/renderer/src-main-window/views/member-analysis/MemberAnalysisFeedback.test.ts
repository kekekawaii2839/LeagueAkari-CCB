// sort-imports-ignore
import './test-i18n'

import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import type { MemberAnalysisSettings } from '@shared/shards/member-analysis'
import { unavailableRank } from '@shared/shards/member-analysis/opponent-ranks'
import ChampionView from './ChampionView.vue'
import MemberAnalysisHeader from './MemberAnalysisHeader.vue'
import MemberAnalysisSettingsDrawer from './MemberAnalysisSettingsDrawer.vue'
import OpponentRankDetails from './opponent-ranks/OpponentRankDetails.vue'

const callbacks = vi.hoisted(() => ({
  buttons: [] as { text: string; disabled: boolean; click?: Function }[]
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/composables/useSgpTagOptions', () => ({
  ALL_SGPTAG_VALUE: '<akari:all>',
  useSgpTagOptions: () => ({ value: [] })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({ champions: { name: (id: number) => String(id) } })
}))
vi.mock('naive-ui', () => {
  const Stub = (_: unknown, { slots }: { slots: Record<string, Function> }) => slots.default?.()
  return {
    NIcon: Stub,
    NEmpty: Stub,
    NProgress: Stub,
    NResult: Stub,
    NSpin: Stub,
    NTabPane: Stub,
    NTabs: Stub,
    NAlert: Stub,
    NFormItem: Stub,
    NInput: () => null,
    NInputNumber: () => null,
    NSelect: () => null,
    NSwitch: () => null,
    NDrawer: Stub,
    NDrawerContent: (_: unknown, { slots }: { slots: Record<string, Function> }) => [
      slots.default?.(),
      slots.footer?.()
    ],
    NPopover: (_: unknown, { slots }: { slots: Record<string, Function> }) => [
      slots.trigger?.(),
      slots.default?.()
    ],
    NButton: (props: Record<string, any>, { slots }: { slots: Record<string, Function> }) => {
      const children = slots.default?.()
      callbacks.buttons.push({
        text:
          children
            ?.map((v: any) => v.children ?? '')
            .join('')
            .trim() ?? '',
        disabled: Boolean(props.disabled),
        click: props.onClick
      })
      return h('button', { disabled: props.disabled, 'aria-label': props['aria-label'] }, children)
    }
  }
})
function settings(): MemberAnalysisSettings {
  return {
    enabled: true,
    members: Array.from({ length: 5 }, (_, i) => ({
      serverId: 'TEST',
      gameName: `Synthetic ${i + 1}`,
      tagLine: 'TEST'
    })),
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false
  }
}
async function drawer(value: MemberAnalysisSettings) {
  callbacks.buttons.length = 0
  return renderToString(
    createSSRApp({
      render: () =>
        h(MemberAnalysisSettingsDrawer, {
          show: true,
          settings: value,
          saving: false,
          cleaning: false,
          storageStatus: null,
          cleanupPreview: null
        })
    })
  )
}
describe('member-analysis feedback and recovery', () => {
  test.each([null, 99, 5001])(
    'blocks invalid query limit %s without blaming complete members',
    async (limit) => {
      const value = settings()
      value.scanLimitPerMember = limit as unknown as number
      const html = await drawer(value)
      expect(html).toContain('还有 1 项设置需要填写或修正')
      expect(html).toContain('查看未完成项')
      expect(html).not.toContain('至少添加 5 名成员')
      expect(html).not.toContain('启用后至少需要五名成员')
      expect(callbacks.buttons.find((b) => b.text === '保存设置')?.disabled).toBe(true)
    }
  )
  test.each([100, 101, 5000])(
    'preserves the existing valid limit %s, without requiring multiples of 100',
    async (limit) => {
      const value = settings()
      value.scanLimitPerMember = limit
      const html = await drawer(value)
      expect(html).not.toContain('项设置需要填写或修正')
      expect(callbacks.buttons.find((b) => b.text === '保存设置')?.disabled).toBe(false)
    }
  )
  test('reports member count near the list while keeping disabled empty membership valid', async () => {
    const value = settings()
    value.members = []
    expect(await drawer(value)).toContain('至少添加 5 名成员，当前 0 名')
    value.enabled = false
    await drawer(value)
    expect(callbacks.buttons.find((b) => b.text === '保存设置')?.disabled).toBe(false)
  })
  test('counts actual missing fields and mode, instead of using the member-count error', async () => {
    const value = settings()
    value.members[2].gameName = ''
    value.members[2].tagLine = ''
    value.historyTag = ''
    const html = await drawer(value)
    expect(html).toContain('还有 3 项设置需要填写或修正')
    expect(html).not.toContain('至少添加 5 名成员')
  })
  test('provides a usable reason entry and routes member recovery to settings', async () => {
    let section: string | null | undefined
    const app = createSSRApp({
      render: () =>
        h(MemberAnalysisHeader, {
          generatedAt: null,
          loading: false,
          refreshDisabled: true,
          refreshReason: { kind: 'members', text: '当前已配置 3 名成员，至少需要 5 名。' },
          onSettings: (value) => {
            section = value
          }
        })
    })
    callbacks.buttons.length = 0
    const html = await renderToString(app)
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="刷新"/)
    expect(html).toContain('aria-label="刷新不可用原因"')
    callbacks.buttons.find((b) => b.text === '配置成员')?.click?.()
    expect(section).toBe('members')
  })
  test('shows explicit champion empty state, and reset preserves side, sample and collection settings', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useMemberAnalysisStore()
    store.settings = settings()
    store.overview = null
    store.filters.query = 'synthetic-no-match'
    store.filters.outcome = 'loss'
    store.filters.patch = '26.1'
    store.analysisSide = 'Red'
    store.sampleSize = 20
    const originalSettings = JSON.stringify(store.settings)
    const app = createSSRApp(ChampionView)
    app.use(pinia)
    callbacks.buttons.length = 0
    const html = await renderToString(app)
    expect(html).toContain('当前筛选下没有英雄数据')
    expect(html).not.toContain('0 个成员分路')
    callbacks.buttons.find((b) => b.text === '重置筛选条件')?.click?.()
    expect(store.filters.query).toBe('')
    expect(store.filters.outcome).toBe('all')
    expect(store.filters.patch).toBe('all')
    expect(store.analysisSide).toBe('Red')
    expect(store.sampleSize).toBe(20)
    expect(JSON.stringify(store.settings)).toBe(originalSettings)
  })
  test('distinguishes unqueried records from attempted requests and preserves current-snapshot limits', async () => {
    const ranks = {
      version: 1 as const,
      source: 'SGP leagues-ledge (current snapshot)' as const,
      serverId: 'TEST',
      opponents: Array.from({ length: 5 }, (_, i) => ({
        slot: i + 1,
        role: null,
        champion: null,
        snapshot: unavailableRank(
          i === 0 ? 'budget-exhausted' : 'network-error',
          '2026-10-12T12:00:00Z'
        )
      }))
    }
    const html = await renderToString(
      createSSRApp({ render: () => h(OpponentRankDetails, { ranks }) })
    )
    expect(html).toContain('本轮尚未查询，可再次刷新。 · 记录时间')
    expect(html).toContain('网络或服务超时失败（已尝试） · 尝试')
    expect(html).toContain('事后刷新快照（非比赛当时）')
    expect(html).toContain('来源：英雄联盟对局服务')
    expect(html).not.toContain('预算')
  })
})

test('page wires member recovery and ordinary settings to the same drawer without stale focus', async () => {
  vi.doMock('@renderer-shared/shards', () => ({ useInstance: () => ({ reload: vi.fn() }) }))
  vi.doMock('vue-router', () => ({
    useRoute: () => ({ params: { section: 'roles' } }),
    useRouter: () => ({ replace: vi.fn() })
  }))
  for (const name of [
    'MemberAnalysisFilters',
    'ConversionView',
    'EarlyConversionView',
    'JungleView',
    'MatchesView',
    'MemberRoleView',
    'CombinationView',
    'ScatterView'
  ])
    vi.doMock('./' + name + '.vue', () => ({ default: () => null }))
  vi.doMock('./opponent-ranks/OpponentRanksView.vue', () => ({ default: () => null }))
  vi.doMock('./prediction', () => ({ WinPrediction: () => null }))
  const { default: MemberAnalysis } = await import('./MemberAnalysis.vue')
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMemberAnalysisStore()
  store.settings = settings()
  store.settings.members = store.settings.members.slice(0, 3)
  store.loading = false
  store.capabilities = { workerAvailable: true } as typeof store.capabilities
  const app = createSSRApp(MemberAnalysis)
  app.use(pinia)
  callbacks.buttons.length = 0
  const html = await renderToString(app)
  expect(html).toContain('当前已配置 3 名成员，至少需要 5 名')
  callbacks.buttons.find((button) => button.text === '配置成员')?.click?.()
  expect(store.settingsDrawerVisible).toBe(true)
  expect(store.settingsFocus).toBe('members')
  store.settingsDrawerVisible = false
  callbacks.buttons.find((button) => button.text === '设置')?.click?.()
  expect(store.settingsDrawerVisible).toBe(true)
  expect(store.settingsFocus).toBeNull()
})
