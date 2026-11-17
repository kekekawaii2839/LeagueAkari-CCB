// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  ref,
  ssrContextKey
} from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION
} from '@shared/shards/member-analysis'
import MemberAnalysis from './MemberAnalysis.vue'

// Keep decorative icon-barrel initialization outside lifecycle assertions.
vi.mock('@vicons/carbon', () => ({ Close: () => null, ErrorFilled: () => null }))

const fixture = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  alertMounts: 0,
  success: vi.fn(),
  error: vi.fn(),
  reload: vi.fn(),
  startRefresh: vi.fn(),
  routeSection: 'roles',
  routerReplace: vi.fn()
}))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => fixture }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { section: fixture.routeSection } }),
  useRouter: () => ({ replace: fixture.routerReplace })
}))
vi.mock('./MemberAnalysisHeader.vue', () => ({
  default: (_props: unknown, { slots }: any) => h('analysis-header-probe', slots.filters?.())
}))
vi.mock('./MemberAnalysisFilters.vue', () => ({
  default: {
    props: { disabled: Boolean, embedded: Boolean },
    setup: (props: { disabled: boolean; embedded: boolean }) => () =>
      h('global-analysis-filters', { disabled: props.disabled, embedded: props.embedded })
  }
}))
vi.mock('./MemberAnalysisSettingsDrawer.vue', () => ({ default: () => null }))
// This synthetic host has no DOM geometry/observers. The native rail observer
// has its own focused lifecycle tests; keep this suite on shell reading state.
vi.mock('./table-scrollbar-inset', () => ({
  observeTableScrollbarInsets: () => () => {}
}))
vi.mock('./MemberRoleView.vue', () => ({
  default: {
    props: { active: Boolean },
    setup(props: { active: boolean }) {
      fixture.mounts++
      const choice = ref('initial')
      onBeforeUnmount(() => fixture.unmounts++)
      return () =>
        h(
          'button',
          {
            'data-probe': true,
            'data-role-active': props.active,
            onClick: () => {
              choice.value = 'sorted-selected-expanded'
            }
          },
          choice.value
        )
    }
  }
}))
vi.mock('./BanStatisticsView.vue', () => ({ default: () => null }))
vi.mock('./ChampionTierView.vue', () => ({ default: () => null }))
vi.mock('./version-trend/PatchNotesPanel.vue', () => ({ default: () => h('patch-notes-probe') }))
vi.mock('./ChampionView.vue', () => ({ default: () => null }))
vi.mock('./TeamMetricsView.vue', () => ({ default: () => h('team-metrics-probe') }))
vi.mock('./EarlyConversionView.vue', () => ({ default: () => null }))
vi.mock('./JungleView.vue', () => ({ default: () => null }))
vi.mock('./MatchesView.vue', () => ({ default: () => null }))
vi.mock('./opponent-ranks/OpponentRanksView.vue', () => ({ default: () => null }))
vi.mock('./CombinationView.vue', () => ({ default: () => null }))
vi.mock('./ScatterView.vue', () => ({ default: () => null }))
vi.mock('./prediction', () => ({ WinPrediction: () => null }))
vi.mock('./version-trend/VersionTrendPanel.vue', () => ({
  default: (props: { active: boolean }) => h('version-trend-probe', { active: props.active })
}))
vi.mock('./lp-trend/LpTrendView.vue', () => ({
  default: (props: { active: boolean }) =>
    h('lp-trend-probe', { active: props.active }, 'Synthetic own history empty state')
}))
vi.mock('naive-ui', () => {
  const stub =
    (kind: string) =>
    (props: any, { slots }: any) =>
      h('control', { ...props, kind }, [
        props.title,
        props.description,
        slots.default?.(),
        slots.footer?.()
      ])
  return {
    useMessage: () => ({ success: fixture.success, error: fixture.error }),
    ...Object.fromEntries(
      [
        'NAlert',
        'NButton',
        'NIcon',
        'NEmpty',
        'NProgress',
        'NResult',
        'NSpin',
        'NTab',
        'NTabPane',
        'NTabs'
      ].map((kind) => [kind, stub(kind)])
    ),
    NAlert: defineComponent({
      props: {
        title: String,
        type: String,
        closable: Boolean,
        onClose: Function
      },
      setup(props, { slots }) {
        const visible = ref(true)
        const instance = ++fixture.alertMounts
        return () =>
          visible.value
            ? h('control', { ...props, kind: 'NAlert', noticeInstance: instance }, [
                props.title,
                slots.default?.(),
                props.closable
                  ? h(
                      'button',
                      {
                        'aria-label': '关闭提示',
                        onClick: async () => {
                          if ((await props.onClose?.()) !== false) visible.value = false
                        }
                      },
                      '关闭'
                    )
                  : null
              ])
            : null
      }
    })
  }
})

type HostNode = {
  type: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  text: string
  scrollTop: number
}
const node = (type: string): HostNode => ({
  type,
  props: {},
  children: [],
  parent: null,
  text: '',
  scrollTop: 0
})
// Compile the actual SFC template for Vue's synthetic host; do not copy its
// branches into the test. Native scrolling/focus is separately runtime-tested.
const descriptor = parse(
  readFileSync(new URL('./MemberAnalysis.vue', import.meta.url), 'utf8')
).descriptor
MemberAnalysis.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'reload-behavior' }).bindings
  }).code
)(Vue)

function harness(
  count = 1,
  options: {
    section?: string
    lpEnabled?: boolean
    versionEnabled?: boolean
    initialized?: boolean
    enabled?: boolean
    noOverview?: boolean
  } = {}
) {
  setActivePinia(createPinia())
  const store = useMemberAnalysisStore()
  store.loading = options.initialized === false
  store.settings =
    options.initialized === false
      ? null
      : ({
          enabled: options.enabled ?? true,
          members: [],
          experimentalLpTrendEnabled: options.lpEnabled ?? false,
          experimentalVersionTrendEnabled: options.versionEnabled ?? false
        } as any)
  fixture.routeSection = options.section ?? 'roles'
  fixture.routerReplace.mockReset()
  store.overview = {
    contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
    dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
    generatedAt: '2026-10-13T00:00:00Z',
    source: 'Synthetic',
    firstRun: false,
    gameCount: count,
    playerCount: 5,
    collectionAudit: null,
    pagination: { nextCursor: null },
    games: count
      ? ([
          {
            gameId: 1,
            timestamp: 1,
            duration: 1800,
            date: '2026-10-13',
            patch: '26.1',
            win: true,
            side: 'Blue',
            players: []
          }
        ] as any)
      : []
  }
  fixture.mounts = fixture.unmounts = fixture.alertMounts = 0
  if (options.noOverview) store.overview = null
  fixture.success.mockReset()
  fixture.error.mockReset()
  fixture.reload.mockReset()
  fixture.startRefresh.mockReset()
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: node,
    createText: (text) => ({ ...node('text'), text }),
    createComment: node,
    setText: (n, text) => {
      n.text = text
    },
    setElementText: (n, text) => {
      n.text = text
      n.children = []
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    patchProp: (n, key, _old, value) => {
      n.props[key] = value
    },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    }
  })
  const root = node('root')
  const app = renderer.createApp({ render: () => h(MemberAnalysis) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = (): HostNode[] => {
    const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  return { store, all, dispose: () => app.unmount() }
}

const descendants = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(descendants)]

describe('published analysis background reload lifecycle', () => {
  test('analysis groups preserve leaf routes and remember the previous group selection', async () => {
    const host = harness()
    try {
      await nextTick()
      const groups = () => host.all().find((n) => n.props.class === 'analysis-group-tabs')!
      const leaves = () =>
        host.all().find((n) => n.props.kind === 'NTabs' && n.props.class === 'analysis-pane-tabs')!
      expect(
        descendants(groups())
          .filter((n) => n.props.kind === 'NTab')
          .map((n) => n.props.name)
      ).toEqual(['personal', 'combination', 'team', 'metrics', 'matches'])
      leaves().props['onUpdate:value']('champions')
      await nextTick()
      groups().props['onUpdate:value']('metrics')
      await nextTick()
      expect(leaves().props.value).toBe('scatter')
      groups().props['onUpdate:value']('personal')
      await nextTick()
      expect(leaves().props.value).toBe('champions')
      expect(fixture.unmounts).toBe(0)
      expect(
        host.all().find((n) => n.props.kind === 'NTabPane' && n.props.name === 'prediction')
      ).toBeUndefined()
    } finally {
      host.dispose()
    }
  })
  test('primary navigation exposes one tab stop and keyboard activation with focus restoration', async () => {
    const host = harness()
    try {
      await nextTick()
      const focus = vi.fn(),
        scrollIntoView = vi.fn()
      const panels = host.all().find((n) => n.props.class === 'member-analysis-navigation')!
      Object.assign(panels, { querySelector: () => ({ focus, scrollIntoView }) })
      const tab = (name: string) =>
        host
          .all()
          .find((n) => n.props.kind === 'NTab' && n.props.name === name && n.props.role === 'tab')!
          .props
      const press = async (name: string, key: string) => {
        const preventDefault = vi.fn()
        tab(name).onKeydown({ key, preventDefault })
        await nextTick()
        await nextTick()
        expect(preventDefault).toHaveBeenCalledOnce()
      }
      expect(tab('roles')).toMatchObject({ role: 'tab', tabindex: 0, 'aria-selected': true })
      expect(tab('champions').tabindex).toBe(-1)
      await press('roles', 'ArrowRight')
      expect(tab('champions').tabindex).toBe(0)
      expect(focus).toHaveBeenCalledWith({ preventScroll: true })
      expect(scrollIntoView).not.toHaveBeenCalled()
      await press('champions', 'End')
      expect(tab('jungle').tabindex).toBe(0)
      await press('jungle', 'Home')
      expect(tab('roles').tabindex).toBe(0)
      await press('roles', 'ArrowLeft')
      expect(tab('jungle').tabindex).toBe(0)
      await press('jungle', ' ')
      await press('jungle', 'Enter')
      expect(tab('jungle')['aria-selected']).toBe(true)
    } finally {
      host.dispose()
    }
  })
  test('restores independent page scroll positions after rendering and rapid tab changes', async () => {
    const host = harness()
    try {
      await nextTick()
      const owner = host.all().find((n) => n.props.class === 'member-analysis-scroll')!
      const switchTab = (section: string) =>
        host
          .all()
          .find((n) => n.props.kind === 'NTabs' && n.props.class === 'analysis-pane-tabs')!
          .props['onUpdate:value'](section)
      owner.scrollTop = 1240
      owner.props.onScroll()
      switchTab('champions')
      // Simulate the browser clamping shared scrollTop for a shorter pane.
      owner.scrollTop = 0
      await nextTick()
      await nextTick()
      expect(owner.scrollTop).toBe(0)
      owner.scrollTop = 320
      owner.props.onScroll()
      switchTab('roles')
      await nextTick()
      await nextTick()
      expect(owner.scrollTop).toBe(1240)
      switchTab('champions')
      switchTab('roles')
      await nextTick()
      await nextTick()
      expect(owner.scrollTop).toBe(1240)
      switchTab('champions')
      await nextTick()
      await nextTick()
      expect(owner.scrollTop).toBe(320)
    } finally {
      host.dispose()
    }
  })

  test('waits for the layout frame and ignores clamped intermediate scroll events across rapid switches', async () => {
    const frames = new Map<number, FrameRequestCallback>()
    let sequence = 0
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback)
      return sequence
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    const frame = () => {
      const pending = [...frames.values()]
      frames.clear()
      pending.forEach((callback) => callback(0))
    }
    const host = harness()
    try {
      await nextTick()
      const owner = host.all().find((n) => n.props.class === 'member-analysis-scroll')!
      const style = { overflowAnchor: 'auto' }
      Object.assign(owner, { style })
      const switchTab = (section: string) =>
        host
          .all()
          .find((n) => n.props.kind === 'NTabs' && n.props.class === 'analysis-pane-tabs')!
          .props['onUpdate:value'](section)
      owner.scrollTop = 1240
      owner.props.onScroll()
      switchTab('champions')
      owner.scrollTop = 0
      owner.props.onScroll()
      await nextTick()
      expect(style.overflowAnchor).toBe('none')
      frame()
      frame()
      expect(style.overflowAnchor).toBe('auto')
      owner.scrollTop = 320
      owner.props.onScroll()
      switchTab('roles')
      await nextTick()
      // The child pane's layout is not ready at nextTick: the browser has
      // clamped to the outgoing short extent. Restore on the rendering frame.
      owner.scrollTop = 100
      owner.props.onScroll()
      expect(owner.scrollTop).toBe(100)
      frame()
      expect(owner.scrollTop).toBe(1240)
      switchTab('champions')
      switchTab('roles')
      owner.scrollTop = 0
      owner.props.onScroll()
      await nextTick()
      frame()
      frame()
      expect(owner.scrollTop).toBe(1240)
      expect(style.overflowAnchor).toBe('auto')
      switchTab('champions')
      await nextTick()
      frame()
      frame()
      expect(owner.scrollTop).toBe(320)
    } finally {
      host.dispose()
      expect(frames.size).toBe(0)
      vi.unstubAllGlobals()
    }
  })

  test('opens the independent LP pane without an overview and never instantiates legacy result panes', async () => {
    const host = harness(0, { section: 'lp-trend', lpEnabled: true, noOverview: true })
    try {
      await nextTick()
      expect(host.all().find((n) => n.type === 'lp-trend-probe')?.props.active).toBe(true)
      expect(fixture.mounts).toBe(0)
      expect(host.all().some((n) => n.props.title === '尚未生成分析数据')).toBe(false)
      expect(fixture.routerReplace).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  })

  test('keeps legacy empty, loading and error states protected while the LP tab is enabled', async () => {
    const host = harness(0, { lpEnabled: true, noOverview: true })
    try {
      expect(host.all().some((n) => n.props.title === '尚未生成分析数据')).toBe(true)
      expect(fixture.mounts).toBe(0)
      host.store.loading = true
      await nextTick()
      expect(host.all().some((n) => n.props.kind === 'NSpin')).toBe(true)
      expect(fixture.mounts).toBe(0)
      host.store.loading = false
      host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
      await nextTick()
      expect(host.all().some((n) => n.props.title === '五排分析暂时不可用')).toBe(true)
      expect(fixture.mounts).toBe(0)
    } finally {
      host.dispose()
    }
  })

  test.each([{ initialized: false }, { enabled: false }])(
    'retains the initialization/disabled boundary for an LP deep link: %j',
    async (options) => {
      const host = harness(0, {
        ...options,
        section: 'lp-trend',
        lpEnabled: true,
        noOverview: true
      })
      try {
        expect(host.all().some((n) => n.type === 'lp-trend-probe')).toBe(false)
        expect(fixture.mounts).toBe(0)
        expect(
          host
            .all()
            .some((n) =>
              options.initialized === false
                ? n.props.kind === 'NSpin'
                : n.props.title === '五排分析已关闭'
            )
        ).toBe(true)
        expect(fixture.routerReplace).not.toHaveBeenCalled()
      } finally {
        host.dispose()
      }
    }
  )

  test('closing the current LP experiment keeps the route and displays a closed state; enabling does not navigate', async () => {
    const host = harness(0, { section: 'lp-trend', lpEnabled: true, noOverview: true })
    try {
      host.store.settings!.experimentalLpTrendEnabled = false
      await nextTick()
      expect(host.all().some((n) => n.props.description === '段位变化已关闭')).toBe(true)
      expect(host.all().some((n) => n.type === 'lp-trend-probe')).toBe(false)
      expect(fixture.routerReplace).not.toHaveBeenCalled()
      host.store.settings!.experimentalLpTrendEnabled = true
      await nextTick()
      expect(host.all().find((n) => n.type === 'lp-trend-probe')?.props.active).toBe(true)
      expect(fixture.routerReplace).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  })

  test('enabling LP preserves an already-ready legacy component and its local reading state', async () => {
    const host = harness()
    try {
      const probe = host.all().find((n) => n.props['data-probe'])!
      probe.props.onClick()
      host.store.settings!.experimentalLpTrendEnabled = true
      await nextTick()
      expect(host.all().find((n) => n.props['data-probe'])).toBe(probe)
      expect(probe.text).toBe('sorted-selected-expanded')
      expect(fixture.mounts).toBe(1)
      expect(fixture.unmounts).toBe(0)
      expect(fixture.routerReplace).not.toHaveBeenCalled()
      expect(host.all().find((n) => n.type === 'lp-trend-probe')?.props.active).toBe(false)
    } finally {
      host.dispose()
    }
  })

  test('uses native transient messages without changing retained data or reading state', async () => {
    const host = harness()
    try {
      expect(fixture.success).not.toHaveBeenCalled()
      expect(fixture.error).not.toHaveBeenCalled()
      const overview = host.store.overview
      const probe = host.all().find((n) => n.props['data-probe'])!
      probe.props.onClick()
      host.store.job = {
        jobId: 'synthetic-job-1',
        status: 'failed',
        error: { code: 'PIPELINE_FAILED', message: 'private diagnostic' }
      } as any
      host.store.error = { code: 'INTERNAL_ERROR', message: 'private error', retryable: true }
      await nextTick()
      expect(fixture.error).toHaveBeenCalledTimes(1)
      expect(fixture.error).toHaveBeenCalledWith(expect.stringContaining('刷新失败，本次未更新'), {
        closable: true,
        duration: 6000
      })
      expect(fixture.error.mock.calls[0][0]).not.toContain('private')
      expect(host.store.overview).toBe(overview)
      expect(host.store.error?.code).toBe('INTERNAL_ERROR')
      expect(probe.text).toBe('sorted-selected-expanded')
      expect(host.all().some((n) => n.props.role === 'status' && n.text.includes('刷新失败'))).toBe(
        false
      )
    } finally {
      host.dispose()
    }
  })

  test('new job identities and failed entries notify, duplicate events do not', async () => {
    const host = harness()
    try {
      const failed = { jobId: 'synthetic-1', status: 'failed', error: { code: 'PIPELINE_FAILED' } }
      host.store.job = failed as any
      await nextTick()
      expect(fixture.error).toHaveBeenCalledTimes(1)
      host.store.job = { ...failed } as any
      await nextTick()
      expect(fixture.error).toHaveBeenCalledTimes(1)
      host.store.job = { ...failed, jobId: 'synthetic-2' } as any
      await nextTick()
      expect(fixture.error).toHaveBeenCalledTimes(2)
      host.store.job = { ...failed, status: 'starting' } as any
      host.store.job = failed as any
      await nextTick()
      expect(fixture.error).toHaveBeenCalledTimes(3)
    } finally {
      host.dispose()
    }
  })

  test('new overview failures notify even when the safe error message is unchanged', async () => {
    const host = harness()
    try {
      const error = { code: 'INTERNAL_ERROR' as const, message: 'Synthetic', retryable: true }
      host.store.error = error
      await nextTick()
      host.store.error = { ...error }
      await nextTick()
      expect(fixture.error).toHaveBeenCalledTimes(2)
      expect(fixture.reload).not.toHaveBeenCalled()
      expect(fixture.startRefresh).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  })

  test('same-tick multi-scope validation followed by single navigation keeps the final request', async () => {
    const host = harness()
    try {
      const generation = host.store.overviewGeneration
      expect(host.store.navigateToMatches([1], 'Synthetic support', generation)).toBe(true)
      host.store.navigateToMatch(1, 'Single synthetic support')
      const request = host.store.matchNavigation
      await nextTick()
      expect(host.store.matchListScope).toBeNull()
      expect(host.store.matchNavigation).toBe(request)
      expect(
        host.all().find((n) => n.props.kind === 'NTabs' && n.props.class === 'analysis-pane-tabs')!
          .props.value
      ).toBe('matches')
      host.store.overview = { ...host.store.overview! }
      expect(host.store.navigateToMatches([1], 'Old closure', generation)).toBe(false)
      expect(host.store.matchListScopeError).toBe('stale')
      await nextTick()
      expect(host.store.matchNavigation).toBe(request)
    } finally {
      host.dispose()
    }
  })
  test.each(['success', 'failure'] as const)(
    'preserves the actual pane instance and its reading state: %s',
    async (outcome) => {
      const host = harness()
      try {
        const probe = host.all().find((n) => n.props['data-probe'])!
        const scroll = host.all().find((n) => n.props.class === 'member-analysis-scroll')!
        probe.props.onClick()
        scroll.scrollTop = 350
        await nextTick()
        host.store.loading = true
        await nextTick()
        expect(host.store.viewState).toBe('ready')
        expect(host.all().find((n) => n.props['data-probe'])).toBe(probe)
        expect(host.all().some((n) => n.props.kind === 'NSpin')).toBe(false)
        if (outcome === 'failure')
          host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
        else host.store.overview = { ...host.store.overview!, generatedAt: '2026-10-13T01:00:00Z' }
        host.store.loading = false
        await nextTick()
        expect(host.all().find((n) => n.props['data-probe'])).toBe(probe)
        expect(probe.text).toBe('sorted-selected-expanded')
        expect(scroll.scrollTop).toBe(350)
        expect(fixture.mounts).toBe(1)
        expect(fixture.unmounts).toBe(0)
        expect(fixture.error.mock.calls.length > 0).toBe(outcome === 'failure')
      } finally {
        host.dispose()
      }
    }
  )

  test('keeps a published zero-result scope on background loading and failure', async () => {
    const host = harness(0)
    try {
      host.store.loading = true
      await nextTick()
      expect(host.store.viewState).toBe('empty')
      host.store.loading = false
      host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
      await nextTick()
      expect(host.store.viewState).toBe('empty')
      expect(host.all().some((n) => n.props.kind === 'NEmpty')).toBe(true)
      expect(fixture.error).toHaveBeenCalledTimes(1)
    } finally {
      host.dispose()
    }
  })

  test('uses actual legacy semantics and the fixed missing-summary message', async () => {
    const host = harness()
    const text = () =>
      host
        .all()
        .map((n) => n.text)
        .join(' ')
    try {
      expect(text()).not.toContain('旧推导的零值')
      host.store.overview!.games[0].metricSemantics = 'legacy-unknown'
      await nextTick()
      expect(text()).toContain('旧推导的零值')
      host.store.job = {
        status: 'failed',
        error: { code: 'SUMMARY_STAT_UNAVAILABLE', message: 'private field diagnostic' }
      } as any
      await nextTick()
      expect(fixture.error).toHaveBeenCalledWith(
        expect.stringContaining('原始对局缺少必需统计，本次未更新'),
        expect.any(Object)
      )
      expect(fixture.error.mock.calls[0][0]).not.toContain('private field diagnostic')
      host.store.overview = null
      await nextTick()
      expect(text()).not.toContain('已保留上一版')
      expect(text()).toContain('刷新失败，本次未更新')
    } finally {
      host.dispose()
    }
  })

  test('notifies only for changed publications and never for a failed refresh', async () => {
    const host = harness()
    try {
      host.store.overview = { ...host.store.overview! }
      await nextTick()
      expect(fixture.success).not.toHaveBeenCalled()
      host.store.overview = { ...host.store.overview!, generatedAt: '2026-10-13T01:00:00Z' }
      await nextTick()
      expect(fixture.success).toHaveBeenCalledExactlyOnceWith('分析已更新', {
        closable: true,
        duration: 3000
      })
      host.store.loading = true
      await nextTick()
      host.store.overview = { ...host.store.overview! }
      host.store.loading = false
      await nextTick()
      expect(fixture.success).toHaveBeenCalledTimes(1)
      host.store.overview = { ...host.store.overview!, playerCount: 6 }
      await nextTick()
      expect(fixture.success).toHaveBeenCalledTimes(2)
      host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
      host.store.overview = { ...host.store.overview!, playerCount: 7 }
      await nextTick()
      expect(fixture.success).toHaveBeenCalledTimes(2)
      expect(fixture.error).toHaveBeenCalledTimes(1)
      expect(
        host
          .all()
          .map((n) => n.text)
          .join(' ')
      ).not.toContain('分析已更新')
    } finally {
      host.dispose()
    }
  })

  test('keeps the prediction tab label fixed across session-only statuses without recreating the other pane', async () => {
    const host = harness()
    try {
      host.store.settings!.experimentalPredictionEnabled = true
      for (const status of ['idle', 'running', 'completed', 'unavailable', 'failed'] as const) {
        host.store.predictionTaskStatus = status
        await nextTick()
        const tab = host
          .all()
          .find((n) => n.props.kind === 'NTabPane' && n.props.name === 'prediction')!
        expect(tab.props.tab).toBe('阵容胜率预测')
        expect(fixture.mounts).toBe(1)
        expect(fixture.unmounts).toBe(0)
      }
    } finally {
      host.dispose()
    }
  })

  test('keeps valid match selection through reload and only clears an excluded selection', async () => {
    const host = harness()
    try {
      host.store.navigateToMatch(1, 'Synthetic evidence')
      const request = host.store.matchNavigation
      host.store.loading = true
      host.store.job = { status: 'completed' } as any
      host.store.overview = { ...host.store.overview! }
      await nextTick()
      expect(host.store.matchNavigation).toBe(request)
      host.store.filters.query = 'excluded'
      await nextTick()
      expect(host.store.matchNavigation).toBeNull()
      expect(host.store.matchNavigationFeedback).not.toBe('')
    } finally {
      host.dispose()
    }
  })

  test('still initializes without published data and exits on explicit disable', async () => {
    const host = harness()
    try {
      host.store.overview = null
      host.store.loading = true
      await nextTick()
      expect(host.store.viewState).toBe('loading')
      expect(host.all().some((n) => n.props.kind === 'NSpin')).toBe(true)
      host.store.loading = false
      host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
      await nextTick()
      expect(host.store.viewState).toBe('error')
      host.store.settings!.enabled = false
      host.store.loading = true
      await nextTick()
      expect(host.store.viewState).toBe('feature-disabled')
    } finally {
      host.dispose()
    }
  })
})

test('version experiment has its own empty-state entry and closing does not navigate', async () => {
  const host = harness(0, { section: 'version-trend', versionEnabled: true, noOverview: true })
  try {
    await nextTick()
    expect(host.all().some((n) => n.type === 'version-trend-probe')).toBe(true)
    expect(fixture.mounts).toBe(0)
    host.store.settings!.experimentalVersionTrendEnabled = false
    await nextTick()
    expect(host.all().some((n) => n.type === 'version-trend-probe')).toBe(false)
    expect(fixture.routerReplace).not.toHaveBeenCalled()
    host.store.settings!.experimentalVersionTrendEnabled = true
    await nextTick()
    expect(host.all().some((n) => n.type === 'version-trend-probe')).toBe(true)
    expect(fixture.routerReplace).not.toHaveBeenCalled()
  } finally {
    host.dispose()
  }
})
test.each([{ initialized: false }, { enabled: false }])(
  'version deep link respects initial/disabled boundary %j',
  async (options) => {
    const host = harness(0, {
      ...options,
      section: 'version-trend',
      versionEnabled: true,
      noOverview: true
    })
    try {
      await nextTick()
      expect(host.all().some((n) => n.type === 'version-trend-probe')).toBe(false)
    } finally {
      host.dispose()
    }
  }
)

test.each(['lp-trend', 'version-trend'])(
  'independent trends preserve global match controls but truly disable them: %s',
  async (section) => {
    const host = harness(0, { section, lpEnabled: true, versionEnabled: true, noOverview: true })
    try {
      await nextTick()
      expect(host.all().find((n) => n.type === 'global-analysis-filters')?.props.disabled).toBe(
        true
      )
      expect(fixture.routerReplace).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  }
)

test('global source/context explanation is removed while overview metadata and controls remain', async () => {
  const host = harness()
  try {
    await nextTick()
    expect(host.all().some((n) => n.props['aria-label'] === '当前分析范围')).toBe(false)
    expect(host.all().some((n) => n.type === 'global-analysis-filters')).toBe(true)
    expect(host.store.overview?.source).toBe('Synthetic')
  } finally {
    host.dispose()
  }
})

test('the one global filter set is inside the top header instead of an independent scroll row', async () => {
  const host = harness()
  try {
    await nextTick()
    const filters = host.all().filter((n) => n.type === 'global-analysis-filters')
    expect(filters).toHaveLength(1)
    expect(filters[0].props.embedded).toBe(true)
    expect(filters[0].parent?.type).toBe('analysis-header-probe')
  } finally {
    host.dispose()
  }
})

test('roles receives explicit false active state after leaving its lazy pane', async () => {
  const host = harness()
  try {
    await nextTick()
    expect(host.all().find((n) => n.props['data-probe'])?.props['data-role-active']).toBe(true)
    host
      .all()
      .find((n) => n.props.kind === 'NTabs' && n.props.class === 'analysis-pane-tabs')!
      .props['onUpdate:value']('matches')
    await nextTick()
    expect(host.all().find((n) => n.props['data-probe'])?.props['data-role-active']).toBe(false)
    expect(fixture.mounts).toBe(1)
  } finally {
    host.dispose()
  }
})

test('renders only the active group leaves, direct combination destinations, and no redundant singleton row', async () => {
  const host = harness()
  try {
    await nextTick()
    const groups = () => host.all().find((n) => n.props.class === 'analysis-group-tabs')!
    const secondary = () => host.all().find((n) => n.props.class === 'analysis-section-tabs')
    const destinations = () =>
      secondary()
        ? descendants(secondary()!)
            .filter((n) => n.props.kind === 'NTab')
            .map((n) => n.props.name)
        : []
    expect(destinations()).toEqual(['roles', 'champions', 'jungle'])
    groups().props['onUpdate:value']('combination')
    await nextTick()
    expect(destinations()).toEqual(['pairs', 'synergy'])
    secondary()!.props['onUpdate:value']('synergy')
    await nextTick()
    expect(secondary()!.props.value).toBe('synergy')
    expect(host.all().find((n) => n.props.class === 'analysis-pane-tabs')!.props.value).toBe(
      'pairs'
    )
    groups().props['onUpdate:value']('team')
    await nextTick()
    expect(secondary()!.props.value).toBe('team-metrics')
    expect(destinations()[0]).toBe('team-metrics')
    expect(host.all().some((n) => n.type === 'team-metrics-probe')).toBe(true)
    expect(destinations()).toContain('champion-tier')
    expect(destinations()).not.toContain('synergy')
    groups().props['onUpdate:value']('combination')
    await nextTick()
    expect(secondary()!.props.value).toBe('synergy')
    groups().props['onUpdate:value']('matches')
    await nextTick()
    expect(secondary()).toBeUndefined()
    expect(host.all().find((n) => n.props.class === 'analysis-pane-tabs')!.props.value).toBe(
      'matches'
    )
    const navigation = host.all().find((n) => n.props.class === 'member-analysis-navigation')!
    expect(navigation.parent?.props.class).toBe('member-analysis-scroll')
    expect(descendants(navigation).filter((n) => n.props.kind === 'NTabs')).toHaveLength(1)
  } finally {
    host.dispose()
  }
})

test.each([
  ['collection-failed', '对局采集阶段失败'],
  ['worker-failed', '请重启开发版 Akari'],
  ['identity-worker-unavailable', '身份校验线程不可用'],
  ['identity-worker-failed', '身份校验线程执行失败'],
  ['identity-verification-failed', '成员身份校验未通过'],
  ['publication-failed', '分析结果保存阶段失败']
])(
  'job diagnostic %s shows a stable recovery stage without raw messages',
  async (diagnostic, message) => {
    const host = harness()
    try {
      host.store.job = {
        jobId: 'synthetic-diagnostic',
        status: 'failed',
        error: { code: 'PIPELINE_FAILED', diagnostic, message: 'SYNTHETIC_PRIVATE_DETAILS' }
      } as any
      await nextTick()
      const labels = fixture.error.mock.calls.map(([content]) => content).join(' ')
      expect(labels).toContain(message)
      expect(labels).not.toContain('SYNTHETIC_PRIVATE_DETAILS')
      if (diagnostic === 'identity-worker-unavailable') {
        expect(labels).toContain('同版主进程与线程')
        expect(labels).toContain('无需清理本地数据')
      }
    } finally {
      host.dispose()
    }
  }
)

vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({
    champions: {
      name: () => '',
      searchKeywords: (id: number) => (id === 1 || id === 266 ? ['合成别名', '测试昵称'] : [])
    }
  })
}))
