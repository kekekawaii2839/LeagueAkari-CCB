// sort-imports-ignore
// Register locale mocks before importing renderer components.
import './test-i18n'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import MemberAnalysis from './MemberAnalysis.vue'

const renderer = vi.hoisted(() => ({
  reload: vi.fn(),
  updateSettings: vi.fn()
}))

vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => renderer
}))

vi.mock('vue-router', () => ({
  RouterLink: (_: unknown, { slots }: { slots: Record<string, Function> }) => slots.default?.(),
  useRoute: () => ({ params: { section: 'roles' } }),
  useRouter: () => ({ replace: vi.fn() })
}))

vi.mock('./MemberAnalysisHeader.vue', () => ({ default: { setup: () => () => null } }))
vi.mock('./MemberAnalysisFilters.vue', () => ({ default: { setup: () => () => null } }))
vi.mock('./MemberAnalysisSettingsDrawer.vue', () => ({
  default: { setup: () => () => null }
}))
vi.mock('./ChampionView.vue', () => ({ default: { setup: () => () => null } }))
vi.mock('./MatchesView.vue', () => ({ default: { setup: () => () => null } }))
vi.mock('naive-ui', () => {
  const Stub = (props: Record<string, unknown>, { slots }: { slots: Record<string, Function> }) => [
    String(props.title ?? ''),
    String(props.description ?? ''),
    String(props.tab ?? ''),
    slots.default?.(),
    slots.footer?.()
  ]
  return {
    NAlert: Stub,
    NIcon: Stub,
    NButton: Stub,
    NDataTable: Stub,
    NEmpty: Stub,
    NProgress: Stub,
    NPopover: Stub,
    NRadioButton: Stub,
    NRadioGroup: Stub,
    NResult: Stub,
    NCard: Stub,
    NSelect: Stub,
    NSpin: Stub,
    NStatistic: Stub,
    NSwitch: Stub,
    NTabPane: Stub,
    NTabs: Stub
  }
})

const emptyOverview = {
  contractVersion: 1 as const,
  dataVersion: 4 as const,
  firstRun: false,
  generatedAt: null,
  source: 'SGP 对局历史与详情',
  gameCount: 0,
  playerCount: 0,
  collectionAudit: null,
  games: [],
  pagination: { nextCursor: null }
}

async function renderState(
  state: 'feature-disabled' | 'first-run' | 'loading' | 'empty' | 'error' | 'ready',
  theme: { mode: 'light' | 'dark'; id: string } = { mode: 'light', id: 'light' }
) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMemberAnalysisStore()
  store.loading = state === 'loading'
  store.settings = {
    enabled: state !== 'feature-disabled',
    members: [],
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false
  }
  store.capabilities = {
    contractVersion: 1,
    dataVersion: 4,
    featureEnabled: state !== 'feature-disabled',
    workerAvailable: true,
    methods: [
      'getCapabilities',
      'getOverview',
      'getSettings',
      'updateSettings',
      'startRefresh',
      'getJob',
      'cancelJob',
      'getStorageStatus',
      'previewCleanup',
      'confirmCleanup'
    ]
  }
  store.overview =
    state === 'first-run'
      ? { ...emptyOverview, firstRun: true }
      : state === 'ready'
        ? { ...emptyOverview, gameCount: 1, playerCount: 1 }
        : emptyOverview
  store.error =
    state === 'error'
      ? { code: 'INTERNAL_ERROR', message: 'synthetic degraded state', retryable: true }
      : null

  const app = createSSRApp({
    render: () =>
      h('div', { 'data-theme': theme.mode, 'data-theme-id': theme.id }, h(MemberAnalysis))
  })
  app.use(pinia)
  return renderToString(app)
}

describe('member analysis native page', () => {
  beforeEach(() => vi.clearAllMocks())

  test.each([
    ['feature-disabled', '成员分析已关闭'],
    ['first-run', '尚未生成分析数据'],
    ['loading', '正在初始化成员分析'],
    ['empty', '当前筛选范围内没有可显示的对局'],
    ['error', 'synthetic degraded state'],
    ['ready', '成员分路']
  ] as const)('renders the %s state', async (state, expectedText) => {
    expect(await renderState(state)).toContain(expectedText)
  })

  test('keeps detailed metrics and gank evidence available alongside the comparison', async () => {
    const html = await renderState('ready')
    expect(html).toContain('15 分钟经济差')
    expect(html).toContain('完整指标与事件明细')
    expect(html).toContain('蓝红方拆分')
    expect(html).toContain('被抓统计')
  })

  test.each([
    ['light', 'light'],
    ['light', 'butter'],
    ['dark', 'dark'],
    ['dark', 'graphite'],
    ['dark', 'cyber'],
    ['light', 'sakura'],
    ['light', 'mint'],
    ['dark', 'aurora']
  ] as const)('renders under %s/%s theme attributes', async (mode, id) => {
    const html = await renderState('first-run', { mode, id })
    expect(html).toContain(`data-theme=\"${mode}\"`)
    expect(html).toContain(`data-theme-id=\"${id}\"`)
  })
})
