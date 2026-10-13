// sort-imports-ignore
import '../test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createPinia } from 'pinia'
import { expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, KeepAlive, nextTick, ref, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import WinPrediction from './WinPrediction.vue'

const workers = vi.hoisted(() => ({ instances: [] as any[], failStartup: false }))
const messages = vi.hoisted(() => ({ calls: [] as any[] }))
vi.mock('./prediction.worker?worker', () => ({
  default: class {
    onmessage: any
    onerror: any
    terminate = vi.fn()
    postMessage = vi.fn()
    constructor() {
      if (workers.failStartup) throw new Error('synthetic startup failure')
      workers.instances.push(this)
    }
  }
}))
vi.mock('./observations', () => ({ predictionObservations: () => [] }))
vi.mock('../MemberAnalysisMetricTable.vue', () => ({ default: () => h('table') }))
vi.mock('../MetricHelp.vue', () => ({ default: () => h('span') }))
vi.mock('naive-ui', () => ({
  useMessage: () =>
    Object.fromEntries(
      ['info', 'success', 'warning', 'error'].map((type) => [
        type,
        (content: () => string, options: any) => {
          const item = { type, content, options, destroy: vi.fn() }
          messages.calls.push(item)
          return item
        }
      ])
    ),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NSelect: (props: any) => h('select', props),
  NProgress: (props: any) => h('progress', props)
}))

// Exercise the real SFC template and lifecycle in a synthetic host (no DOM/CDP).
const descriptor = parse(
  readFileSync(new URL('./WinPrediction.vue', import.meta.url), 'utf8')
).descriptor
WinPrediction.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'prediction-behavior' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)

type HostNode = {
  type: string
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  focus: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
}
const node = (type: string): HostNode => ({
  type,
  text: '',
  props: {},
  children: [],
  parent: null,
  focus: vi.fn(),
  scrollIntoView: vi.fn()
})
function harness() {
  workers.instances = []
  workers.failStartup = false
  messages.calls = []
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
    enabled: true,
    experimentalPredictionEnabled: true,
    opggEnabled: false,
    members: Array.from({ length: 5 }, (_, i) => ({
      serverId: 'SYNTHETIC',
      gameName: `SyntheticMember${i}`,
      tagLine: 'TEST_ONLY'
    })),
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10
  }
  Object.assign(store.predictionViewState.lineup, {
    TOP: 'SyntheticMember0#TEST_ONLY',
    JUNGLE: 'SyntheticMember1#TEST_ONLY',
    MIDDLE: 'SyntheticMember2#TEST_ONLY',
    BOTTOM: 'SyntheticMember3#TEST_ONLY',
    UTILITY: 'SyntheticMember4#TEST_ONLY'
  })
  const routeVisible = ref(true)
  const tabVisible = ref(true)
  const root = node('root')
  const captured = new Set<HostNode>()
  const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
  // KeepAlive caches components, not elements, just like the production RouterView.
  const Page = {
    render: () =>
      h('section', { style: tabVisible.value ? '' : 'display:none' }, [
        h(WinPrediction, { active: tabVisible.value })
      ])
  }
  const routeApp = renderer.createApp({
    render: () =>
      h(KeepAlive, null, {
        default: () => (routeVisible.value ? h(Page) : null)
      })
  })
  routeApp.use(pinia)
  routeApp.provide(ssrContextKey, { modules: new Set() })
  routeApp.mount(root)
  const all = () => {
    const nodes = walk(root)
    nodes.forEach((n) => captured.add(n))
    return nodes
  }
  const start = () =>
    all()
      .find((n) => n.type === 'button' && n.props.type === 'primary')!
      .props.onClick()
  return { app: routeApp, store, root, routeVisible, tabVisible, all, captured, start }
}
const available = () => ({
  status: 'available',
  estimateKind: 'reference',
  modelId: 'baseline',
  probability: 0.5,
  interval: null,
  totalGames: 30,
  testGames: 10,
  lineupHistoryGames: 0,
  lineupHistoryWins: 0,
  validation: { brier: 0.25, logLoss: 0.69, bins: [] },
  baseline: { brier: 0.25, logLoss: 0.69 },
  profiles: [],
  target: [],
  usedMetrics: []
})

test.each([true, false])(
  'continues across hidden tabs and cached routes; completion visible=%s never focuses or scrolls',
  async (finishVisible) => {
    const f = harness()
    try {
      f.start()
      const worker = workers.instances[0]
      expect(f.store.predictionTaskStatus).toBe('running')
      f.tabVisible.value = false
      await nextTick()
      expect(messages.calls.map((n) => n.type)).toEqual(['info'])
      expect(messages.calls[0].options).toEqual({ closable: true, duration: 3500 })
      expect(worker.terminate).not.toHaveBeenCalled()
      worker.onmessage({ data: { type: 'progress', done: 30 } })
      await nextTick()
      expect(messages.calls).toHaveLength(1)
      f.routeVisible.value = false
      await nextTick()
      expect(worker.terminate).not.toHaveBeenCalled()
      if (finishVisible) {
        f.routeVisible.value = true
        f.tabVisible.value = true
        await nextTick()
      }
      worker.onmessage({ data: { type: 'done', result: available() } })
      await nextTick()
      expect(f.store.predictionTaskStatus).toBe('completed')
      expect(messages.calls.map((n) => n.type)).toEqual(
        finishVisible ? ['info'] : ['info', 'success']
      )
      expect(messages.calls[0].destroy).toHaveBeenCalledTimes(1)
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      f.routeVisible.value = true
      f.tabVisible.value = true
      await nextTick()
      expect(workers.instances).toHaveLength(1)
      expect(worker.postMessage).toHaveBeenCalledTimes(1)
      expect(messages.calls).toHaveLength(finishVisible ? 1 : 2)
      expect(f.all().some((n) => n.text.includes('已完成'))).toBe(true)
      for (const n of f.captured) {
        expect(n.focus).not.toHaveBeenCalled()
        expect(n.scrollIntoView).not.toHaveBeenCalled()
      }
    } finally {
      f.app.unmount()
    }
  }
)

test.each(['experimentalPredictionEnabled', 'enabled'] as const)(
  'disabling %s while away terminates once and ignores late completion',
  async (key) => {
    const f = harness()
    try {
      f.start()
      const worker = workers.instances[0]
      f.routeVisible.value = false
      await nextTick()
      f.store.settings![key] = false
      await nextTick()
      expect(worker.terminate).toHaveBeenCalledTimes(1)
      expect(f.store.predictionTaskStatus).toBe('idle')
      expect(messages.calls[0].destroy).toHaveBeenCalledTimes(1)
      worker.onmessage({ data: { type: 'done', result: available() } })
      await nextTick()
      expect(f.store.predictionTaskStatus).toBe('idle')
      expect(messages.calls).toHaveLength(1)
      f.app.unmount()
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    } finally {
      f.app.unmount()
    }
  }
)

test('distinguishes unavailable results from runtime/startup failures and permits retry', async () => {
  const f = harness()
  try {
    f.start()
    workers.instances[0].onmessage({
      data: { type: 'done', result: { status: 'unavailable', reason: '回测样本不足（合成）' } }
    })
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('unavailable')
    f.start()
    workers.instances[1].onerror()
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('failed')
    expect(f.all().some((n) => n.text.includes('本地预测计算失败'))).toBe(true)
    workers.failStartup = true
    f.start()
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('failed')
    expect(f.all().some((n) => n.text.includes('无法启动本地计算任务'))).toBe(true)
  } finally {
    f.app.unmount()
  }
})

test('explicit cancel and real unmount each terminate their active worker once', async () => {
  const f = harness()
  f.start()
  f.tabVisible.value = false
  await nextTick()
  f.all()
    .find((n) => n.type === 'button' && n.children.some((c) => c.text.includes('取消计算')))!
    .props.onClick()
  expect(f.store.predictionTaskStatus).toBe('idle')
  expect(workers.instances[0].terminate).toHaveBeenCalledTimes(1)
  expect(messages.calls[0].destroy).toHaveBeenCalledTimes(1)
  f.tabVisible.value = true
  await nextTick()
  f.start()
  f.tabVisible.value = false
  await nextTick()
  f.app.unmount()
  expect(messages.calls[1].destroy).toHaveBeenCalledTimes(1)
  expect(workers.instances[1].terminate).toHaveBeenCalledTimes(1)
  expect(f.store.predictionTaskStatus).toBe('idle')
})

test.each(['unavailable', 'error'] as const)(
  'background %s uses one native message without replaying on return',
  async (outcome) => {
    const f = harness()
    try {
      f.start()
      f.routeVisible.value = false
      await nextTick()
      const worker = workers.instances[0]
      if (outcome === 'error') worker.onerror()
      else
        worker.onmessage({
          data: { type: 'done', result: { status: 'unavailable', reason: '回测样本不足（合成）' } }
        })
      await nextTick()
      expect(messages.calls.map((n) => n.type)).toEqual([
        'info',
        outcome === 'error' ? 'error' : 'warning'
      ])
      expect(messages.calls[1].content()).toContain(outcome === 'error' ? '计算失败' : '结果不可用')
      f.routeVisible.value = true
      await nextTick()
      f.routeVisible.value = false
      await nextTick()
      expect(messages.calls).toHaveLength(2)
      expect(messages.calls[1].destroy).toHaveBeenCalledTimes(1)
    } finally {
      f.app.unmount()
    }
  }
)

test('returning then leaving a running task does not repeat its info; input invalidation destroys it', async () => {
  const f = harness()
  try {
    f.start()
    f.tabVisible.value = false
    await nextTick()
    f.tabVisible.value = true
    await nextTick()
    f.tabVisible.value = false
    await nextTick()
    expect(messages.calls).toHaveLength(1)
    f.store.predictionViewState.side = 'Blue'
    await nextTick()
    expect(messages.calls[0].destroy).toHaveBeenCalledTimes(1)
    expect(workers.instances[0].terminate).toHaveBeenCalledTimes(1)
    expect(f.store.predictionTaskStatus).toBe('idle')
    f.tabVisible.value = true
    await nextTick()
    f.start()
    f.tabVisible.value = false
    await nextTick()
    expect(messages.calls).toHaveLength(2)
    f.app.unmount()
    expect(messages.calls[1].destroy).toHaveBeenCalledTimes(1)
  } finally {
    f.app.unmount()
  }
})
