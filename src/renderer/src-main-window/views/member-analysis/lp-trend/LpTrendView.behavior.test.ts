// sort-imports-ignore
import '../test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { DatasetController, LinearScale, Scale } from 'chart.js'
import { createPinia } from 'pinia'
import { expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, KeepAlive, nextTick, ref, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import type {
  MemberAnalysisRankObservationHistoryRequest,
  MemberAnalysisRankObservationHistoryPage,
  MemberAnalysisResult
} from '@shared/shards/member-analysis'
import type { QueueRank } from '@shared/shards/member-analysis/opponent-ranks'
import LpTrendView from './LpTrendView.vue'

const io = vi.hoisted(() => ({
  read: vi.fn(),
  refresh: vi.fn(),
  cancel: vi.fn(),
  observers: 0,
  resolvePaints: 0,
  disconnects: 0,
  themeVars: null as Vue.Ref<{ fontFamily: string; textColor1: string; cardColor: string }> | null
}))
vi.mock('@vicons/material', () => ({ RefreshRound: () => null, CloseRound: () => null }))
vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => ({
    getRankObservationHistory: io.read,
    refreshCurrentRanks: io.refresh,
    cancelCurrentRankRefresh: io.cancel
  })
}))
vi.mock('vue-chartjs', () => ({ Line: (props: Record<string, unknown>) => h('chart', props) }))
vi.mock('naive-ui', () => ({
  useThemeVars: () =>
    (io.themeVars = Vue.ref({
      fontFamily: 'system-ui, sans-serif',
      textColor1: '#eeeeee',
      cardColor: '#202020'
    })),
  ...Object.fromEntries(
    ['NAlert', 'NButton', 'NEmpty', 'NIcon', 'NSelect', 'NSpin'].map((kind) => [
      kind,
      (props: any, { slots }: any) =>
        h('control', { ...props, kind }, [slots.default?.(), slots.extra?.()])
    ])
  )
}))

const descriptor = parse(
  readFileSync(new URL('./LpTrendView.vue', import.meta.url), 'utf8')
).descriptor
LpTrendView.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'lp-trend-behavior' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)

type HostNode = {
  style: { color: string }
  type: string
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  focus: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
}
const node = (type: string): HostNode => ({
  style: { color: '' },
  type,
  text: '',
  props: {},
  children: [],
  parent: null,
  focus: vi.fn(),
  scrollIntoView: vi.fn()
})
type Request = MemberAnalysisRankObservationHistoryRequest
type Reply = MemberAnalysisResult<MemberAnalysisRankObservationHistoryPage>
function page(
  request: Request,
  points: MemberAnalysisRankObservationHistoryPage['points'] = []
): Reply {
  return {
    ok: true,
    value: {
      memberSlot: request.memberSlot,
      serverId: 'SYNTHETIC',
      status: 'available',
      identityResolvedAt: '2026-10-13T00:00:00Z',
      queue: request.queue,
      source: 'SGP leagues-ledge query-time observations',
      coverage: 'successful-query-observations-only',
      points,
      pagination: { nextCursor: null }
    }
  }
}
const rank = (lp: number): QueueRank => ({
  status: 'ranked',
  rank: { tier: 'GOLD', division: 'IV', leaguePoints: lp }
})
const settle = async () => {
  for (let i = 0; i < 25; i++) await nextTick()
}
function harness(
  options: {
    enabled?: boolean
    flag?: boolean
    active?: boolean
    reader?: (request: Request) => Promise<Reply>
  } = {}
) {
  io.read.mockReset()
  io.read.mockImplementation(options.reader ?? (async (request: Request) => page(request)))
  io.refresh.mockReset()
  io.cancel.mockReset()
  io.cancel.mockResolvedValue({ ok: true, value: { cancelled: true } })
  io.observers = io.disconnects = io.resolvePaints = 0
  vi.stubGlobal('document', { documentElement: { dataset: { theme: 'dark' } } })
  vi.stubGlobal('getComputedStyle', (element?: HostNode) => ({
    color: element?.style.color ? 'rgb(' + ++io.resolvePaints + ',120,160)' : 'rgb(230,230,230)',
    getPropertyValue: () => 'rgb(120,120,120)'
  }))
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor() {
        io.observers++
      }
      observe() {}
      disconnect() {
        io.disconnects++
      }
    }
  )
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: node,
    createComment: node,
    createText: (text) => ({ ...node('text'), text }),
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
  const pinia = createPinia()
  const store = useMemberAnalysisStore(pinia)
  store.settings = {
    enabled: options.enabled ?? true,
    experimentalLpTrendEnabled: options.flag ?? true,
    members: Array.from({ length: 5 }, (_, i) => ({
      serverId: 'SYNTHETIC',
      gameName: `SyntheticMember${i}`,
      tagLine: 'TEST_ONLY'
    })),
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false
  }
  const active = ref(options.active ?? true)
  const routeVisible = ref(true)
  const Page = { render: () => h(LpTrendView, { active: active.value }) }
  const root = node('root')
  const app = renderer.createApp({
    render: () => h(KeepAlive, null, { default: () => (routeVisible.value ? h(Page) : null) })
  })
  app.use(pinia)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
  const all = () => walk(root)
  const control = (kind: string, predicate: (n: HostNode) => boolean = () => true) =>
    all().find((n) => n.props.kind === kind && predicate(n))!
  return {
    store,
    active,
    routeVisible,
    all,
    control,
    chart: () => all().find((n) => n.type === 'chart')!,
    dispose: () => {
      app.unmount()
      vi.unstubAllGlobals()
    }
  }
}

test('reads its own empty history without an analysis overview and without polling', async () => {
  const f = harness()
  try {
    await settle()
    expect(f.store.overview).toBeNull()
    expect(
      io.read.mock.calls.map(([request]) => [
        request.memberSlot,
        request.queue,
        request.pageSize,
        request.cursor
      ])
    ).toEqual([1, 2, 3, 4, 5].map((slot) => [slot, 'flex', 100, null]))
    expect(f.control('NEmpty').props.description).toBe('尚无段位与胜点记录')
    await settle()
    expect(io.read).toHaveBeenCalledTimes(5)
    expect(f.chart()).toBeUndefined()
    expect(f.all().some((node) => node.type === 'details' || node.type === 'summary')).toBe(false)
  } finally {
    f.dispose()
  }
})

test('current-rank button uses only the dedicated action, prevents double clicks and merges fresh facts without losing older pages', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
  })
  try {
    f.store.loading = false
    await settle()
    let finish!: (value: unknown) => void
    io.refresh.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const button = () => f.control('NButton', (n) => n.props['aria-label'] === '更新当前段位')
    const updating = button().props.onClick()
    await nextTick()
    expect(button().props.loading).toBe(true)
    await button().props.onClick()
    expect(io.refresh).toHaveBeenCalledTimes(1)
    expect(Object.keys(io.refresh.mock.calls[0][0])).toEqual(['requestId'])
    io.read.mockImplementation(async (request: Request) =>
      page(request, [{ fetchedAt: '2026-10-15T01:00:00Z', queueRank: rank(10) }])
    )
    finish({
      ok: true,
      value: {
        requestId: io.refresh.mock.calls[0][0].requestId,
        status: 'completed',
        members: Array.from({ length: 5 }, (_, i) => ({
          memberSlot: i + 1,
          status: i === 4 ? 'failed' : 'updated'
        }))
      }
    })
    await updating
    await settle()
    expect(io.read).toHaveBeenCalledTimes(10)
    expect(f.chart().props.data.datasets[0].data.map((point: { y: number }) => point.y)).toEqual([
      1200, 1210
    ])
    expect(f.all().some((n) => n.text.includes('已查询 4/5 位成员当前段位'))).toBe(true)
    expect(f.all().some((n) => n.text.includes('未更新：5. SyntheticMember4#TEST_ONLY'))).toBe(true)
    expect(button().props.disabled).toBe(true)
  } finally {
    f.dispose()
  }
})

test('account scope changes do not merge a previous account history into newly collected facts', async () => {
  const f = harness({
    reader: async (request) => {
      const reply = page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
      if (reply.ok) reply.value.identityKey = 'a'.repeat(64)
      return reply
    }
  })
  try {
    f.store.loading = false
    await settle()
    io.refresh.mockResolvedValue({ ok: true, value: { status: 'completed', members: [] } })
    io.read.mockImplementation(async (request: Request) => {
      const reply = page(request, [{ fetchedAt: '2026-10-15T01:00:00Z', queueRank: rank(30) }])
      if (reply.ok) reply.value.identityKey = 'b'.repeat(64)
      return reply
    })
    await f.control('NButton', (n) => n.props['aria-label'] === '更新当前段位').props.onClick()
    await settle()
    expect(f.chart().props.data.datasets[0].data.map((point: { y: number }) => point.y)).toEqual([
      1230
    ])
  } finally {
    f.dispose()
  }
})

test('leaving while updating cancels only that operation and late replies do not re-read or alter the chart', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
  })
  try {
    f.store.loading = false
    await settle()
    let finish!: (value: unknown) => void
    io.refresh.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const operation = f
      .control('NButton', (n) => n.props['aria-label'] === '更新当前段位')
      .props.onClick()
    await nextTick()
    f.active.value = false
    await settle()
    expect(io.cancel).toHaveBeenCalledWith(io.refresh.mock.calls[0][0])
    finish({ ok: true, value: { status: 'completed', members: [] } })
    await operation
    await settle()
    expect(io.read).toHaveBeenCalledTimes(5)
    expect(f.chart()).toBeUndefined()
  } finally {
    f.dispose()
  }
})

test('explicit cancellation retains the old curve and re-reads any already committed observations', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
  })
  try {
    f.store.loading = false
    await settle()
    let finish!: (value: unknown) => void
    io.refresh.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const operation = f
      .control('NButton', (n) => n.props['aria-label'] === '更新当前段位')
      .props.onClick()
    await nextTick()
    f.control('NButton', (n) => n.props['aria-label'] === '取消更新当前段位').props.onClick()
    await settle()
    expect(io.cancel).toHaveBeenCalledWith(io.refresh.mock.calls[0][0])
    finish({ ok: true, value: { status: 'cancelled', members: [] } })
    await operation
    await settle()
    expect(io.read).toHaveBeenCalledTimes(10)
    expect(f.chart().props.data.datasets[0].data[0].y).toBe(1200)
    expect(f.all().some((n) => n.text.includes('更新已取消，已取得的记录仍保留'))).toBe(true)
  } finally {
    f.dispose()
  }
})

test('source failure never clears old observations or starts a complete analysis refresh', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
  })
  try {
    f.store.loading = false
    await settle()
    io.refresh.mockRejectedValueOnce(new Error('Synthetic unavailable'))
    await f.control('NButton', (n) => n.props['aria-label'] === '更新当前段位').props.onClick()
    await settle()
    expect(io.read).toHaveBeenCalledTimes(5)
    expect(f.chart().props.data.datasets[0].data[0].y).toBe(1200)
    expect(io.cancel).toHaveBeenCalledTimes(1)
    expect(f.all().some((n) => n.text.includes('暂未完成更新'))).toBe(true)
  } finally {
    f.dispose()
  }
})

test.each([{ enabled: false }, { flag: false }, { active: false }])(
  'does not read when ineligible: %j',
  async (options) => {
    const f = harness(options)
    try {
      await settle()
      expect(io.read).not.toHaveBeenCalled()
      expect(f.chart()).toBeUndefined()
    } finally {
      f.dispose()
    }
  }
)

test.each(['away', 'disabled', 'flag', 'unmount'] as const)(
  'invalidates a pending callback on %s and never requests the next member',
  async (change) => {
    let complete!: (reply: Reply) => void
    const f = harness({
      reader: () =>
        new Promise((resolve) => {
          complete = resolve
        })
    })
    try {
      expect(io.read).toHaveBeenCalledTimes(1)
      if (change === 'away') f.routeVisible.value = false
      else if (change === 'disabled') f.store.settings!.enabled = false
      else if (change === 'flag') f.store.settings!.experimentalLpTrendEnabled = false
      else f.dispose()
      await nextTick()
      complete(
        page(io.read.mock.calls[0][0], [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(50) }])
      )
      await settle()
      expect(io.read).toHaveBeenCalledTimes(1)
      expect(f.chart()).toBeUndefined()
    } finally {
      if (change !== 'unmount') f.dispose()
    }
  }
)

test('narrows the selected member scale while retaining identity and restoring the common scale', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [
        { fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(request.memberSlot * 10) },
        { fetchedAt: '2026-10-13T03:00:00Z', queueRank: rank(request.memberSlot * 10 + 5) }
      ])
  })
  try {
    await settle()
    const allChart = f.chart().props
    expect(allChart.data.datasets).toHaveLength(5)
    const scale = { min: allChart.options.scales.y.min, max: allChart.options.scales.y.max }
    const secondMemberColor = allChart.data.datasets[1].borderColor
    const boundaryPlugin = allChart.plugins[0]
    f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value'](2)
    await nextTick()
    expect(f.chart().props.data.datasets).toHaveLength(1)
    expect(f.chart().props.data.datasets[0].borderColor).toBe(secondMemberColor)
    expect({
      min: f.chart().props.options.scales.y.min,
      max: f.chart().props.options.scales.y.max
    }).not.toEqual(scale)
    expect(f.chart().props.options.scales.y.max - f.chart().props.options.scales.y.min).toBe(100)
    expect(f.chart().props.options.scales.y.title.text).toBe('段位')
    expect(f.chart().props.plugins[0]).toBe(boundaryPlugin)
    expect(f.chart().props.data.datasets[0].spanGaps).toBe(false)
    expect(f.chart().props.data.datasets[0].tension).toBe(0)
    expect(io.observers).toBe(1)
    f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value']('all')
    await nextTick()
    expect({
      min: f.chart().props.options.scales.y.min,
      max: f.chart().props.options.scales.y.max
    }).toEqual(scale)
    f.control('NSelect', (n) => n.props['aria-label'] === '排位相关模式').props['onUpdate:value'](
      'solo'
    )
    await settle()
    expect(io.read.mock.calls.slice(5).every(([request]) => request.queue === 'solo')).toBe(true)
    expect(io.read).toHaveBeenCalledTimes(10)
    for (const n of f.all()) {
      expect(n.focus).not.toHaveBeenCalled()
      expect(n.scrollIntoView).not.toHaveBeenCalled()
    }
  } finally {
    f.dispose()
  }
  expect(io.disconnects).toBe(1)
})

test('distinguishes unresolved identity from no observations and transport failure', async () => {
  const f = harness({
    reader: async (request) => {
      const reply = page(request)
      if (reply.ok) reply.value.status = 'identity-unresolved'
      return reply
    }
  })
  try {
    await settle()
    expect(f.control('NEmpty').props.description).toBe('成员身份尚未解析')
    io.read.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
    })
    f.control('NSelect', (n) => n.props['aria-label'] === '排位相关模式').props['onUpdate:value'](
      'solo'
    )
    await settle()
    expect(f.control('NAlert').props.title).toBe('记录读取失败，请重试。')
    expect(io.read).toHaveBeenCalledTimes(10)
  } finally {
    f.dispose()
  }
})

test('only loads older cursor pages on explicit request and retains anomalous facts as plot gaps', async () => {
  const cursor = 'abcdefghijklmnopqrstuvwxyz012345'
  const f = harness({
    reader: async (request) => {
      const reply = page(request, [
        {
          fetchedAt: request.cursor ? '2026-10-12T01:00:00Z' : '2026-10-13T01:00:00Z',
          queueRank: rank(request.cursor ? 120 : 20)
        }
      ])
      if (reply.ok) reply.value.pagination.nextCursor = request.cursor ? null : cursor
      return reply
    }
  })
  try {
    await settle()
    expect(io.read).toHaveBeenCalledTimes(5)
    f.control('NButton', (n) =>
      n.children.some((c) => c.text.includes('加载更早记录'))
    ).props.onClick()
    await settle()
    expect(io.read).toHaveBeenCalledTimes(10)
    expect(io.read.mock.calls.slice(5).every(([request]) => request.cursor === cursor)).toBe(true)
    expect(f.all().filter((n) => n.props.kind === 'NSelect')).toHaveLength(2)
    expect(f.chart().props.data.datasets[0].data[0]).toEqual({
      x: Date.parse('2026-10-12T01:00:00Z'),
      y: Number.NaN
    })
  } finally {
    f.dispose()
  }
})

test('a failed older page retains that member facts while other members append, without automatic retries', async () => {
  const f = harness({
    reader: async (request) => {
      if (request.cursor && request.memberSlot === 2)
        return {
          ok: false,
          error: { code: 'INVALID_ARGUMENT', message: 'Synthetic cursor expired', retryable: false }
        }
      const reply = page(request, [
        {
          fetchedAt: request.cursor ? '2026-10-12T01:00:00Z' : '2026-10-13T01:00:00Z',
          queueRank: rank(20)
        }
      ])
      if (reply.ok)
        reply.value.pagination.nextCursor = request.cursor
          ? null
          : 'abcdefghijklmnopqrstuvwxyz012345'
      return reply
    }
  })
  try {
    await settle()
    f.control('NButton', (n) =>
      n.children.some((c) => c.text.includes('加载更早记录'))
    ).props.onClick()
    await settle()
    expect(io.read).toHaveBeenCalledTimes(10)
    expect(
      f.chart().props.data.datasets.map((dataset: { data: unknown[] }) => dataset.data.length)
    ).toEqual([2, 1, 2, 2, 2])
    expect(f.control('NAlert')).toBeTruthy()
    await settle()
    expect(io.read).toHaveBeenCalledTimes(10)
  } finally {
    f.dispose()
  }
})

test('suspends chart and IO while another tab is active, retaining older pages without a record picker', async () => {
  const f = harness({
    reader: async (request) => {
      const reply = page(request, [
        {
          fetchedAt: request.cursor ? '2026-10-12T01:00:00Z' : '2026-10-13T01:00:00Z',
          queueRank: rank(request.cursor ? 0 : 20)
        }
      ])
      if (reply.ok)
        reply.value.pagination.nextCursor = request.cursor
          ? null
          : 'abcdefghijklmnopqrstuvwxyz012345'
      return reply
    }
  })
  try {
    await settle()
    f.control('NButton', (n) =>
      n.children.some((c) => c.text.includes('加载更早记录'))
    ).props.onClick()
    await settle()
    expect(f.all().filter((n) => n.props.kind === 'NSelect')).toHaveLength(2)
    f.active.value = false
    await settle()
    expect(f.chart()).toBeUndefined()
    expect(io.read).toHaveBeenCalledTimes(10)
    f.active.value = true
    await settle()
    expect(io.read).toHaveBeenCalledTimes(10)
    expect(f.chart().props.data.datasets[0].data[0].y).toBe(1200)
    expect(
      f
        .chart()
        .props.data.datasets.every((dataset: { data: unknown[] }) => dataset.data.length === 2)
    ).toBe(true)
    f.control('NSelect', (n) => n.props['aria-label'] === '排位相关模式').props['onUpdate:value'](
      'solo'
    )
    await settle()
    expect(io.read).toHaveBeenCalledTimes(15)
    expect(f.chart().props.data.datasets[0].data).toHaveLength(1)
  } finally {
    f.dispose()
  }
})

test('legend exposes each plotted line pattern and marker shape without relying only on color', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(20) }])
  })
  try {
    await settle()
    const lines = f.all().filter((n) => n.type === 'line')
    const datasets = f.chart().props.data.datasets
    expect(lines.map((n) => n.props['stroke-dasharray'])).toEqual(
      datasets.map((dataset: { borderDash: number[] }) => dataset.borderDash.join(' '))
    )
    expect(datasets.map((dataset: { pointStyle: string }) => dataset.pointStyle)).toEqual([
      'circle',
      'rect',
      'triangle',
      'rectRot',
      'star'
    ])
    expect(f.all().filter((n) => n.type === 'circle')).toHaveLength(1)
    const paths = f
      .all()
      .filter((n) => n.type === 'path')
      .map((n) => n.props.d)
    expect(new Set(paths).size).toBe(4)
  } finally {
    f.dispose()
  }
})

test('reading order is filters then member legend then chart, without a duplicate chart heading', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(20) }])
  })
  try {
    await settle()
    const nodes = f.all()
    const filters = nodes.filter((n) => n.props.kind === 'NSelect')
    expect(filters).toHaveLength(2)
    expect(nodes.indexOf(filters.at(-1)!)).toBeLessThan(nodes.findIndex((n) => n.type === 'li'))
    expect(nodes.indexOf(nodes.filter((n) => n.type === 'li').at(-1)!)).toBeLessThan(
      nodes.indexOf(f.chart())
    )
    expect(nodes.some((n) => n.type === 'h3')).toBe(false)
  } finally {
    f.dispose()
  }
})

test.each([
  {
    name: 'promotion',
    ranks: [
      { status: 'ranked', rank: { tier: 'BRONZE', division: 'I', leaguePoints: 99 } },
      { status: 'ranked', rank: { tier: 'SILVER', division: 'IV', leaguePoints: 10 } }
    ],
    values: [799, 810]
  },
  {
    name: 'stable high master',
    ranks: [
      { status: 'ranked', rank: { tier: 'MASTER', division: null, leaguePoints: 1420 } },
      { status: 'ranked', rank: { tier: 'MASTER', division: null, leaguePoints: 1420 } }
    ],
    values: [4220, 4220]
  },
  {
    name: 'zero with missing middle',
    ranks: [
      rank(0),
      { status: 'ranked', rank: { tier: 'GOLD', division: 'IV', leaguePoints: null } },
      rank(10)
    ],
    values: [1200, Number.NaN, 1210]
  }
])(
  'selected $name uses its own time extent and padded rank extent, without changing coordinates',
  async ({ ranks, values }) => {
    const f = harness({
      reader: async (request) =>
        page(
          request,
          request.memberSlot === 1
            ? ranks.map((queueRank, index) => ({
                fetchedAt: new Date(Date.UTC(2026, 9, 13, 1 + index)).toISOString(),
                queueRank: queueRank as QueueRank
              }))
            : [
                {
                  fetchedAt: '2025-01-01T00:00:00Z',
                  queueRank: {
                    status: 'ranked',
                    rank: { tier: 'IRON', division: 'IV', leaguePoints: 0 }
                  }
                },
                {
                  fetchedAt: '2027-01-01T00:00:00Z',
                  queueRank: {
                    status: 'ranked',
                    rank: { tier: 'MASTER', division: null, leaguePoints: 9999 }
                  }
                }
              ]
        )
    })
    try {
      await settle()
      const common = f.chart().props.options.scales
      f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value'](1)
      await settle()
      const { data, options } = f.chart().props
      expect(data.datasets[0].data.map((point: { y: number }) => point.y)).toEqual(values)
      expect(options.scales.x.min).toBe(Date.UTC(2026, 9, 13, 1))
      expect(options.scales.x.max).toBe(Date.UTC(2026, 9, 13, ranks.length))
      const finite = values.filter(Number.isFinite)
      expect(options.scales.y.min).toBeLessThanOrEqual(Math.min(...finite))
      expect(options.scales.y.max).toBeGreaterThanOrEqual(Math.max(...finite))
      expect(options.scales.y.max - options.scales.y.min).toBeGreaterThanOrEqual(100)
      expect(options.scales.y.max - options.scales.y.min).toBeLessThanOrEqual(150)
      expect(options.scales.y.ticks.callback(options.scales.y.min)).toContain('LP')
      f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value'](
        'all'
      )
      await settle()
      expect(f.chart().props.options.scales.x.min).toBe(common.x.min)
      expect(f.chart().props.options.scales.y.max).toBe(common.y.max)
      expect(io.read).toHaveBeenCalledTimes(5)
    } finally {
      f.dispose()
    }
  }
)

test('a single member with no drawable observations has no fabricated zero chart', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [
        {
          fetchedAt: '2026-10-13T01:00:00Z',
          queueRank:
            request.memberSlot === 1
              ? { status: 'ranked', rank: { tier: 'GOLD', division: 'IV', leaguePoints: null } }
              : rank(20)
        }
      ])
  })
  try {
    await settle()
    f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value'](1)
    await settle()
    expect(f.chart()).toBeUndefined()
    expect(f.all().some((n) => n.text.includes('该观测暂不能绘图'))).toBe(true)
  } finally {
    f.dispose()
  }
})

test('real Chart.js tick generation for a broad unbounded LP range is snapped to readable integer rank ticks', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [
        {
          fetchedAt: '2026-10-13T01:00:00Z',
          queueRank: { status: 'ranked', rank: { tier: 'IRON', division: 'IV', leaguePoints: 0 } }
        },
        {
          fetchedAt: '2026-10-13T02:00:00Z',
          queueRank: {
            status: 'ranked',
            rank: { tier: 'MASTER', division: null, leaguePoints: 9999 }
          }
        }
      ])
  })
  try {
    await settle()
    const options = f.chart().props.options.scales.y
    const axis = {
      options,
      min: options.min,
      max: options.max,
      getTickLimit: () => 12,
      _maxDigits: () => 50,
      isHorizontal: () => false,
      ticks: [] as { value: number }[]
    }
    axis.ticks = Reflect.apply(LinearScale.prototype.buildTicks, axis, [])
    options.afterBuildTicks(axis)
    expect(axis.ticks.every((tick) => Number.isInteger(tick.value) && tick.value % 100 === 0)).toBe(
      true
    )
    expect(new Set(axis.ticks.map((tick) => tick.value)).size).toBe(axis.ticks.length)
    expect(
      axis.ticks
        .map((tick) => options.ticks.callback(tick.value))
        .every((label: string) => label.length > 0 && !label.includes('.'))
    ).toBe(true)
    expect(axis.ticks.at(-1)?.value).toBe(12800)
  } finally {
    f.dispose()
  }
})

test('formats distinct close-time and multi-year ticks without losing their distinguishing precision', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [
        { fetchedAt: '2025-10-13T01:00:05Z', queueRank: rank(20) },
        { fetchedAt: '2026-10-13T01:00:45Z', queueRank: rank(40) }
      ])
  })
  try {
    await settle()
    const tick = f.chart().props.options.scales.x.ticks.callback
    const alignment = Reflect.get(Scale.prototype, '_getXAxisLabelAlignment')
    expect(
      Reflect.apply(
        alignment,
        {
          options: { position: 'bottom', ticks: f.chart().props.options.scales.x.ticks },
          labelRotation: 0
        },
        []
      )
    ).toBe('inner')
    for (const values of [
      [Date.parse('2026-10-13T01:00:05Z'), Date.parse('2026-10-13T01:00:45Z')],
      [Date.parse('2026-10-13T01:00:05.100Z'), Date.parse('2026-10-13T01:00:05.200Z')],
      [Date.parse('2025-10-13T01:00:05Z'), Date.parse('2026-10-13T01:00:05Z')]
    ]) {
      const ticks = values.map((value) => ({ value }))
      expect(new Set(values.map((value, index) => tick(value, index, ticks))).size).toBe(2)
    }
  } finally {
    f.dispose()
  }
})

test('feeds real Chart.js object parsing safe time points for missing LP without bridging gaps', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [
        { fetchedAt: '2026-10-13T01:00:05Z', queueRank: rank(0) },
        {
          fetchedAt: '2026-10-13T01:00:25Z',
          queueRank: {
            status: 'ranked',
            rank: { tier: 'GOLD', division: 'IV', leaguePoints: null }
          }
        },
        { fetchedAt: '2026-10-13T01:00:45Z', queueRank: rank(40) }
      ])
  })
  try {
    await settle()
    const data = f.chart().props.data.datasets[0].data
    const parse = Reflect.get(DatasetController.prototype, 'parseObjectData')
    const scale = {
      parse: (value: unknown, index: number) =>
        Reflect.apply(LinearScale.prototype.parse, {}, [value, index])
    }
    const parsed = Reflect.apply(parse, { _parsing: {} }, [
      { xScale: scale, yScale: scale },
      data,
      0,
      data.length
    ])
    expect(parsed).toEqual([
      { x: Date.parse('2026-10-13T01:00:05Z'), y: 1200 },
      { x: Date.parse('2026-10-13T01:00:25Z'), y: null },
      { x: Date.parse('2026-10-13T01:00:45Z'), y: 1240 }
    ])
    expect(f.chart().props.data.datasets[0].spanGaps).toBe(false)
  } finally {
    f.dispose()
  }
})

test('only offers time coordinates and preserves all real observations without patch metadata', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [
        { fetchedAt: '2026-10-13T03:00:00Z', queueRank: rank(40) },
        { fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(10) }
      ])
  })
  try {
    await settle()
    expect(f.all().filter((n) => n.props.kind === 'NSelect')).toHaveLength(2)
    expect(f.chart().props.options.scales.x.type).toBe('linear')
    expect(f.chart().props.data.labels).toBeUndefined()
    expect(f.chart().props.data.datasets[0].data).toEqual([
      { x: Date.parse('2026-10-13T01:00:00Z'), y: 1210 },
      { x: Date.parse('2026-10-13T03:00:00Z'), y: 1240 }
    ])
    expect(
      f.chart().props.options.plugins.tooltip.callbacks.title([{ datasetIndex: 0, dataIndex: 1 }])
    ).toBe(new Date('2026-10-13T03:00:00Z').toLocaleString())
    expect(f.chart().props.options.plugins.tooltip.callbacks.footer).toBeUndefined()
    expect(io.read).toHaveBeenCalledTimes(5)
  } finally {
    f.dispose()
  }
})

test('current history refresh replaces a repeated timestamp atomically without duplicate time points', async () => {
  let refreshed = false
  const f = harness({
    reader: async (request) => {
      const reply = page(request, [
        { fetchedAt: '2026-10-13T03:00:00Z', queueRank: rank(refreshed ? 40 : 30) },
        { fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(10) }
      ])
      if (reply.ok) reply.value.identityKey = 'a'.repeat(64)
      return reply
    }
  })
  try {
    f.store.loading = false
    await settle()
    expect(f.chart().props.data.datasets[0].data.map((p: { y: number }) => p.y)).toEqual([
      1210, 1230
    ])
    io.refresh.mockImplementation(async () => {
      refreshed = true
      return { ok: true, value: { status: 'completed', members: [] } }
    })
    await f.control('NButton', (n) => n.props['aria-label'] === '更新当前段位').props.onClick()
    await settle()
    expect(f.chart().props.data.datasets[0].data).toEqual([
      { x: Date.parse('2026-10-13T01:00:00Z'), y: 1210 },
      { x: Date.parse('2026-10-13T03:00:00Z'), y: 1240 }
    ])
    expect(io.read).toHaveBeenCalledTimes(10)
  } finally {
    f.dispose()
  }
})

test('chart typography uses the app UI family with distinct axis and tooltip hierarchy', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
  })
  try {
    await settle()
    const o = f.chart().props.options
    // CSSOM supplies resolved paints: Canvas must not receive var()/light-dark() expressions.
    expect(f.chart().props.data.datasets.map((dataset: any) => dataset.borderColor)).toEqual(
      Array.from({ length: 5 }, (_, index) => 'rgb(' + (index + 1) + ',120,160)')
    )
    expect(o.font.family).toBe('system-ui, sans-serif')
    expect(o.scales.x.ticks.font).toMatchObject({
      family: 'system-ui, sans-serif',
      size: 12,
      weight: 400
    })
    expect(o.scales.y.ticks.font).toMatchObject({ size: 13, weight: 500 })
    expect(o.scales.y.title.font).toMatchObject({ size: 13, weight: 600 })
    expect(o.plugins.tooltip.titleFont).toMatchObject({ size: 13, weight: 600 })
    expect(o.plugins.tooltip.bodyFont).toMatchObject({ size: 14, weight: 400 })
    expect(o.scales.x.title.display).toBe(false)
    expect(o.scales.y.title.display).toBe(false)
    const xTitle = Object.assign(
      f.all().find((n) => n.type === 'span' && n.text === '采集时间')!,
      { style: { left: '', width: '' } }
    )
    const yTitle = Object.assign(
      f.all().find((n) => n.type === 'span' && n.text === '段位')!,
      { style: { top: '' } }
    )
    f.chart().props.plugins[1].afterLayout({
      chartArea: { left: 100.2, right: 500.2, top: 10, bottom: 300 }
    })
    expect(xTitle.style).toEqual({ left: '100px', width: '400px' })
    expect(yTitle.style.top).toBe('155px')
    expect(f.chart().props.data.datasets[0]).toMatchObject({
      borderWidth: 2.5,
      borderCapStyle: 'round',
      borderJoinStyle: 'round',
      pointRadius: 3,
      pointBorderWidth: 1.75,
      pointBackgroundColor: '#202020',
      pointHoverRadius: 5,
      pointHoverBorderWidth: 2.5,
      pointHoverBorderColor: '#202020',
      pointHitRadius: 5,
      tension: 0,
      spanGaps: false
    })
    f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value'](1)
    await settle()
    const selected = f.chart().props.data.datasets[0]
    expect(selected).toMatchObject({
      pointRadius: 3.75,
      pointBorderWidth: 2,
      pointBorderColor: '#202020',
      pointBackgroundColor: selected.borderColor,
      pointHoverRadius: 5,
      pointHoverBorderColor: '#202020',
      spanGaps: false,
      tension: 0
    })
    f.control('NSelect', (n) => n.props['aria-label'] === '全部成员').props['onUpdate:value']('all')
    await settle()
    expect(f.chart().props.data.datasets[0]).toMatchObject({
      pointRadius: 3,
      pointBorderWidth: 1.75,
      pointBackgroundColor: '#202020'
    })
    expect(o.scales.y.ticks.color).toBe('#eeeeee')
    expect(o.scales.x.title.color).toBe('#eeeeee')
    io.themeVars!.value.textColor1 = '#222222'
    await settle()
    expect(f.chart().props.options.scales.y.ticks.color).toBe('#222222')
    expect(f.chart().props.options.scales.y.title.color).toBe('#222222')
    expect(f.chart().props.options.scales.x.title.color).toBe('#222222')
  } finally {
    f.dispose()
  }
})

test('chart budgets ancestor padding, wrapped content and scroll offsets without outer overflow until minimum height', async () => {
  const f = harness({
    reader: async (request) =>
      page(request, [{ fetchedAt: '2026-10-13T01:00:00Z', queueRank: rank(0) }])
  })
  const frames = new Map<number, FrameRequestCallback>()
  let sequence = 0,
    resize = () => {},
    disconnected = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback)
    return sequence
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback
      }
      observe() {}
      disconnect() {
        disconnected++
      }
    }
  )
  const flush = async () => {
    for (const [id, callback] of [...frames]) {
      frames.delete(id)
      callback(0)
    }
    await settle()
  }
  try {
    await settle()
    let region = f.all().find((n) => n.props.role === 'img')!,
      top = 180,
      tail = 64
    const section = f.all().find((n) => n.type === 'section')!
    const height = () => parseFloat(region.props.style.height)
    const viewport = {
      clientHeight: 780,
      clientTop: 0,
      scrollTop: 0,
      get scrollHeight() {
        return Math.max(this.clientHeight, Math.ceil(top + height() + tail))
      },
      getBoundingClientRect: () => ({ top: 0 })
    }
    const wrapper = {
      parentElement: viewport,
      getBoundingClientRect: () => ({ bottom: top + height() + tail - viewport.scrollTop })
    }
    Vue.markRaw(viewport)
    Vue.markRaw(wrapper)
    Object.assign(section, {
      parentElement: wrapper,
      closest: () => viewport,
      getBoundingClientRect: () => ({ bottom: top + height() + 40 - viewport.scrollTop })
    })
    f.active.value = false
    await settle()
    f.active.value = true
    await settle()
    region = f.all().find((n) => n.props.role === 'img')!
    Object.assign(region, {
      getBoundingClientRect: () => ({
        top: top - viewport.scrollTop,
        bottom: top + height() - viewport.scrollTop,
        height: height()
      })
    })
    await flush()
    expect(region.props.style.height).toBe('535px')
    top = 180.4
    tail = 64.4
    resize()
    await flush()
    expect(region.props.style.height).toBe('534px')
    expect(viewport.scrollHeight).toBe(viewport.clientHeight)
    top = 180
    tail = 64
    resize()
    await flush()
    expect(viewport.scrollHeight).toBe(viewport.clientHeight)
    // A multiline legend/status adds height above the chart; older-history controls add tail.
    top += 40
    tail += 52
    resize()
    await flush()
    expect(region.props.style.height).toBe('443px')
    expect(viewport.scrollHeight).toBe(viewport.clientHeight)
    viewport.scrollTop = 24
    resize()
    await flush()
    expect(region.props.style.height).toBe('443px')
    viewport.clientHeight = 1400
    resize()
    await flush()
    expect(region.props.style.height).toBe('760px')
    expect(viewport.scrollHeight).toBe(viewport.clientHeight)
    viewport.clientHeight = 500
    resize()
    await flush()
    expect(region.props.style.height).toBe('320px')
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight)
    viewport.clientHeight = 780
    viewport.scrollTop = 0
    resize()
    await flush()
    resize()
    await flush()
    expect(viewport.scrollHeight).toBe(viewport.clientHeight)
    const before = disconnected
    f.active.value = false
    await settle()
    expect(disconnected).toBeGreaterThan(before)
    expect(frames.size).toBe(0)
  } finally {
    f.dispose()
    vi.unstubAllGlobals()
  }
})
