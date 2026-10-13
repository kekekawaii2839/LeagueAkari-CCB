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

const fixture = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  alertMounts: 0,
  reload: vi.fn(),
  startRefresh: vi.fn()
}))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => fixture }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { section: 'roles' } }),
  useRouter: () => ({ replace: vi.fn() })
}))
vi.mock('./MemberAnalysisHeader.vue', () => ({ default: () => null }))
vi.mock('./MemberAnalysisFilters.vue', () => ({ default: () => null }))
vi.mock('./MemberAnalysisSettingsDrawer.vue', () => ({ default: () => null }))
vi.mock('./MemberRoleView.vue', () => ({
  default: {
    setup() {
      fixture.mounts++
      const choice = ref('initial')
      onBeforeUnmount(() => fixture.unmounts++)
      return () =>
        h(
          'button',
          {
            'data-probe': true,
            onClick: () => {
              choice.value = 'sorted-selected-expanded'
            }
          },
          choice.value
        )
    }
  }
}))
vi.mock('./ChampionView.vue', () => ({ default: () => null }))
vi.mock('./ConversionView.vue', () => ({ default: () => null }))
vi.mock('./EarlyConversionView.vue', () => ({ default: () => null }))
vi.mock('./JungleView.vue', () => ({ default: () => null }))
vi.mock('./MatchesView.vue', () => ({ default: () => null }))
vi.mock('./opponent-ranks/OpponentRanksView.vue', () => ({ default: () => null }))
vi.mock('./CombinationView.vue', () => ({ default: () => null }))
vi.mock('./ScatterView.vue', () => ({ default: () => null }))
vi.mock('./prediction', () => ({ WinPrediction: () => null }))
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
    ...Object.fromEntries(
      [
        'NAlert',
        'NButton',
        'NIcon',
        'NEmpty',
        'NProgress',
        'NResult',
        'NSpin',
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

function harness(count = 1) {
  setActivePinia(createPinia())
  const store = useMemberAnalysisStore()
  store.loading = false
  store.settings = { enabled: true, members: [] } as any
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
const notices = (host: ReturnType<typeof harness>) =>
  host
    .all()
    .filter(
      (n) =>
        n.props.role === 'status' &&
        descendants(n).some((child) => child.props['aria-label'] === '关闭提示')
    )
const closeNotice = (notice: HostNode) =>
  descendants(notice).find((n) => n.props['aria-label'] === '关闭提示')!.props.onClick

describe('published analysis background reload lifecycle', () => {
  test('job retry uses collection refresh with the same availability guards, not an overview read', async () => {
    const host = harness()
    try {
      host.store.job = {
        jobId: 'synthetic-retry',
        status: 'failed',
        error: { code: 'PIPELINE_FAILED', message: 'Synthetic' }
      } as any
      await nextTick()
      const retry = () =>
        descendants(notices(host)[0]).find(
          (n) => n.props.kind === 'NButton' && !n.props['aria-label']
        )!
      expect(retry().props.disabled).toBe(true)
      expect(retry().props.title).toBeTruthy()
      host.store.settings = {
        enabled: true,
        members: Array.from({ length: 5 }, (_, i) => ({ riotId: `Synthetic${i}#TEST_ONLY` }))
      } as any
      host.store.capabilities = { workerAvailable: true } as any
      await nextTick()
      expect(retry().props.disabled).toBe(false)
      retry().props.onClick()
      expect(fixture.startRefresh).toHaveBeenCalledTimes(1)
      expect(fixture.reload).not.toHaveBeenCalled()
      host.store.loading = true
      await nextTick()
      expect(retry().props.disabled).toBe(true)
    } finally {
      host.dispose()
    }
  })
  test('closes each retained-results failure notice independently without clearing domain failure or reading state', async () => {
    const host = harness()
    try {
      const previous = host.store.overview
      const probe = host.all().find((n) => n.props['data-probe'])!
      probe.props.onClick()
      host.store.overview = { ...host.store.overview!, generatedAt: '2026-10-13T01:00:00Z' }
      const published = host.store.overview
      host.store.job = {
        jobId: 'synthetic-job-1',
        status: 'failed',
        error: { code: 'PIPELINE_FAILED', message: 'Synthetic failure' }
      } as any
      host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic failure', retryable: true }
      const failure = host.store.error
      await nextTick()
      const alerts = notices(host)
      expect(alerts).toHaveLength(2)
      expect(host.all().some((n) => n.props.kind === 'NAlert')).toBe(false)
      expect(host.all().filter((n) => n.props['aria-label'] === '关闭提示')).toHaveLength(2)
      closeNotice(alerts[0])()
      await nextTick()
      expect(notices(host)).toHaveLength(1)
      host
        .all()
        .find((n) => n.props['aria-label'] === '关闭提示')!
        .props.onClick()
      await nextTick()
      await nextTick()
      expect(notices(host)).toHaveLength(0)
      expect(host.store.error === failure).toBe(true)
      expect(host.store.job?.status).toBe('failed')
      expect(host.store.overview === published).toBe(true)
      expect(host.store.overview?.generatedAt).not.toBe(previous?.generatedAt)
      expect(host.all().find((n) => n.props['data-probe']) === probe).toBe(true)
      expect(probe.text).toBe('sorted-selected-expanded')
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
  test('same-message new failures get new alert instances and an old close callback cannot hide the replacement', async () => {
    const host = harness()
    try {
      const error = {
        code: 'INTERNAL_ERROR' as const,
        message: 'Synthetic identical failure',
        retryable: true
      }
      host.store.error = error
      await nextTick()
      const first = notices(host)[0]
      const closeFirst = closeNotice(first)
      closeFirst()
      host.store.error = { ...error }
      await nextTick()
      const second = notices(host)[0]
      expect(second === first).toBe(false)
      closeFirst()
      await nextTick()
      expect(notices(host)[0] === second).toBe(true)
      closeNotice(second)()
      await nextTick()
      expect(notices(host)).toHaveLength(0)
      host.store.loading = true
      host.store.error = null
      host.store.error = error
      host.store.loading = false
      await nextTick()
      expect(notices(host)).toHaveLength(1)
    } finally {
      host.dispose()
    }
  })
  test('job identity and failed-entry epochs reopen fresh failures but not duplicate events', async () => {
    const host = harness()
    try {
      const failed = {
        jobId: 'synthetic-job-1',
        status: 'failed',
        error: { code: 'PIPELINE_FAILED', message: 'Synthetic same reason' }
      }
      host.store.job = failed as any
      await nextTick()
      const closeOld = closeNotice(notices(host)[0])
      closeOld()
      await nextTick()
      host.store.job = { ...failed, error: { ...failed.error } } as any
      await nextTick()
      expect(notices(host)).toHaveLength(0)
      host.store.job = { ...failed, jobId: 'synthetic-job-2' } as any
      await nextTick()
      closeOld()
      await nextTick()
      const second = notices(host)[0]
      closeNotice(second)()
      host.store.job = { ...failed, jobId: 'synthetic-job-2', status: 'starting' } as any
      host.store.job = { ...failed, jobId: 'synthetic-job-2' } as any
      await nextTick()
      expect(notices(host)[0] === second).toBe(false)
      expect(host.store.job?.status).toBe('failed')
    } finally {
      host.dispose()
    }
  })
  test('retains the retry action and leaves first-load/no-overview errors non-dismissible', async () => {
    const host = harness()
    try {
      host.store.error = { code: 'INTERNAL_ERROR', message: 'Synthetic failure', retryable: true }
      await nextTick()
      host
        .all()
        .find((n) => n.props.kind === 'NButton' && n.props.onClick)!
        .props.onClick()
      expect(fixture.reload).toHaveBeenCalledTimes(1)
      host.store.overview = null
      host.store.job = {
        jobId: 'synthetic-first-job',
        status: 'failed',
        error: { code: 'PIPELINE_FAILED', message: 'Synthetic failure' }
      } as any
      await nextTick()
      const initial = host.all().filter((n) => n.props.kind === 'NAlert')
      expect(initial).toHaveLength(2)
      expect(initial.every((n) => !n.props.closable)).toBe(true)
      expect(host.all().some((n) => n.props['aria-label'] === '关闭提示')).toBe(false)
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
      expect(host.all().find((n) => n.props.kind === 'NTabs')!.props.value).toBe('matches')
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
        expect(notices(host).length > 0).toBe(outcome === 'failure')
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
      expect(notices(host)).toHaveLength(1)
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
      expect(
        host.all().some((n) => n.props.title?.includes('原始对局缺少必需统计，本次未更新'))
      ).toBe(true)
      expect(
        host.all().some((n) => n.props['aria-label']?.includes('原始对局缺少必需统计，本次未更新'))
      ).toBe(true)
      expect(text()).not.toContain('private field diagnostic')
      host.store.overview = null
      await nextTick()
      expect(text()).not.toContain('已保留上一版')
      expect(text()).toContain('刷新失败，本次未更新')
    } finally {
      host.dispose()
    }
  })

  test('does not imply a new publication when re-reading the same overview generation', async () => {
    const host = harness()
    try {
      host.store.overview = { ...host.store.overview! }
      await nextTick()
      expect(
        host
          .all()
          .map((n) => n.text)
          .join(' ')
      ).not.toContain('分析已更新')
      host.store.overview = { ...host.store.overview!, generatedAt: '2026-10-13T01:00:00Z' }
      await nextTick()
      expect(
        host
          .all()
          .map((n) => n.text)
          .join(' ')
      ).toContain('分析已更新')
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
