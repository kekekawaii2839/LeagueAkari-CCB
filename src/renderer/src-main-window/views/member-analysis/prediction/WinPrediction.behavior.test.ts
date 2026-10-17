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
import { i18next } from '@renderer-shared/i18n'
import WinPrediction from './WinPrediction.vue'
import { predictionFeatures } from './model'
import { uiText } from '../ui-text'

const workers = vi.hoisted(() => ({ instances: [] as any[], failStartup: false }))
const messages = vi.hoisted(() => ({ calls: [] as any[] }))
const metricTables = vi.hoisted(() => ({ items: [] as any[] }))
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
vi.mock('../MemberAnalysisMetricTable.vue', () => ({
  default: (props: any) => {
    metricTables.items.push(props)
    return h('table')
  }
}))
vi.mock('../MetricHelp.vue', () => ({
  default: (props: any) => h('span', { 'data-definition': props.definition }, props.label)
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: (props: any) => h('position-icon', props)
}))
vi.mock('@vicons/fluent', () => ({
  ChevronDown20Regular: () => h('chevron-icon', { 'data-direction': 'down' }),
  ChevronRight20Regular: () => h('chevron-icon', { 'data-direction': 'right' })
}))
vi.mock('naive-ui', () => ({
  NIcon: (props: any, { slots }: any) => h('i', props, slots.default?.()),
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
  NSelect: {
    props: { clearable: Boolean },
    setup(props: any, { attrs }: any) {
      return () => h('select', { ...attrs, clearable: props.clearable })
    }
  },
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
  metricTables.items = []
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
  kind: 'entertainment',
  calibrated: false,
  modelId: 'entertainment-role-profile-v2',
  side: 'all',
  score: 0.63,
  latentIndex: 0.53,
  referenceGames: 30,
  referenceObservations: 150,
  excludedGames: 0,
  profiles: [
    {
      role: 'TOP',
      member: 'SyntheticMember0#TEST_ONLY',
      sameRoleGames: 0,
      otherRoleGames: 8,
      borrowedEquivalentWeight: 2,
      usedMetrics: 1,
      missingMetrics: 1,
      notApplicableMetrics: 0,
      unsupportedMetrics: 38,
      roleIndex: 0,
      roleScore: 0.5,
      contribution: 0
    }
  ],
  features: predictionFeatures.map((feature, i) => ({
    ...feature,
    member: 'SyntheticMember0#TEST_ONLY',
    group: 'combat',
    status: i === 0 ? 'used' : 'missing',
    referenceN: 30,
    sameRoleN: 0,
    otherRoleN: 8,
    borrowedEquivalentWeight: i === 0 ? 2 : 0,
    sameRoleMean: null,
    otherRoleMeanZ: i === 0 ? 0 : null,
    standardizedValue: i === 0 ? 0 : null,
    correlation: i === 0 ? 0.2 : null,
    directionWeight: i === 0 ? 0.1 : null,
    contribution: i === 0 ? 0 : null
  })),
  groups: [],
  topDrivers: [],
  support: { usedFeatures: 4, applicableFeatures: 180, supportedRoles: 2, supportedGroups: 3 }
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

test('unavailable data explains support, while worker and startup errors allow retry', async () => {
  const f = harness()
  try {
    f.start()
    workers.instances[0].onmessage({
      data: {
        type: 'done',
        result: { ...available(), status: 'unavailable', reason: 'no-history' }
      }
    })
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('unavailable')
    const text = () =>
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    expect(text()).toContain(uiText('predictionReasonHistory'))
    const action = f
      .all()
      .find(
        (n) =>
          n.type === 'button' &&
          n.children.some((c) => c.text.includes(uiText('predictionViewSupport')))
      )!
    await action.props.onClick()
    await nextTick()
    expect(
      f.all().find((n) => n.props['aria-controls'] === 'prediction-method')!.props['aria-expanded']
    ).toBe(true)
    f.start()
    workers.instances[1].onerror()
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('failed')
    workers.failStartup = true
    f.start()
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('failed')
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
          data: { type: 'done', result: { status: 'unavailable', reason: 'no-history' } }
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

test('English inputs and errors update without resetting a running prediction', async () => {
  const f = harness()
  try {
    f.start()
    const worker = workers.instances[0]
    await i18next.changeLanguage('en')
    await nextTick()
    const text = () =>
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    const controls = f.all().filter((n) => n.type === 'select')
    expect(controls[0].props['aria-label']).toBe('Top member ID')
    expect(controls[4].props['aria-label']).toBe('Support member ID')
    expect(controls[5].props.options.map((o: any) => o.label)).toEqual([
      'Both sides',
      'Blue side',
      'Red side'
    ])
    expect(text()).toContain('Calculate entertainment prediction')
    expect(text()).toContain('Cancel calculation')
    expect(worker.terminate).not.toHaveBeenCalled()
    worker.onerror()
    await nextTick()
    expect(text()).toContain('Local prediction failed. Please retry.')
    await i18next.changeLanguage('zh-CN')
    await nextTick()
    expect(text()).toContain('本地预测计算失败，请重试。')
  } finally {
    f.app.unmount()
    await i18next.changeLanguage('zh-CN')
  }
})

test('empty lineup sends null to the native select so its placeholder remains visible', async () => {
  const f = harness()
  try {
    f.store.predictionViewState.lineup.TOP = ''
    await nextTick()
    const select = () => f.all().filter((n) => n.type === 'select')[0]
    expect(select().props.value).toBeNull()
    expect(select().props.placeholder).toBe('选择成员')
    select().props['onUpdate:value']('SyntheticMember0#TEST_ONLY')
    await nextTick()
    expect(f.store.predictionViewState.lineup.TOP).toBe('SyntheticMember0#TEST_ONLY')
    expect(select().props.value).toBe('SyntheticMember0#TEST_ONLY')
    select().props['onUpdate:value'](null)
    await nextTick()
    expect(f.store.predictionViewState.lineup.TOP).toBe('')
    expect(select().props.value).toBeNull()
  } finally {
    f.app.unmount()
  }
})

test('role logos decorate only the five static headings without altering member select identities', () => {
  const f = harness()
  try {
    const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
    const labels = f.all().filter((node) => node.props.class === 'prediction-role-label')
    expect(labels).toHaveLength(5)
    expect(
      f
        .all()
        .filter((n) => n.type === 'position-icon')
        .map((n) => n.props.position)
    ).toEqual(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
    for (const label of labels) {
      const descendants = walk(label)
      expect(descendants.filter((node) => node.type === 'position-icon')).toHaveLength(1)
      expect(descendants.some((node) => node.props['aria-hidden'] === 'true')).toBe(true)
    }
    const selects = f
      .all()
      .filter((node) => node.type === 'select')
      .slice(0, 5)
    expect(selects).toHaveLength(5)
    expect(
      selects.every((node) => !walk(node).some((child) => child.type === 'position-icon'))
    ).toBe(true)
    expect(
      selects.every((node) =>
        node.props.options.every(
          (option: any) => typeof option.label === 'string' && typeof option.value === 'string'
        )
      )
    ).toBe(true)
    const settings = f.store.settings
    if (!settings) throw new Error('Synthetic prediction settings were not initialized')
    expect(settings.experimentalPredictionEnabled).toBe(true)
  } finally {
    f.app.unmount()
  }
})
test('entertainment value retains honest labels and exposes support rather than scientific validation', async () => {
  const f = harness()
  try {
    f.start()
    workers.instances[0].onmessage({ data: { type: 'done', result: available() } })
    await nextTick()
    const text = () =>
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    expect(text()).toContain('63.0%')
    expect(text()).toContain(uiText('predictionEntertainmentDisclaimer'))
    expect(text()).not.toContain('95%')
    expect(text()).not.toContain('Brier')
    expect(f.all().some((n) => n.props.id === 'prediction-features')).toBe(false)
    const evidence = f.all().find((n) => n.props['aria-controls'] === 'prediction-method')!
    evidence.props.onClick()
    await nextTick()
    const features = f.all().find((n) => n.props['aria-controls'] === 'prediction-features')!
    features.props.onClick()
    await nextTick()
    expect(f.all().some((n) => n.props.id === 'prediction-features')).toBe(true)
    const table = [...metricTables.items]
      .reverse()
      .find((n) => n.rows?.length === predictionFeatures.length)
    expect(table.rows).toHaveLength(200)
    const status = table.columns.find((n: any) => n.key === 'status')
    expect(status.render(table.rows[0])).toBe(uiText('inputUsed'))
    expect(status.render(table.rows[1])).toBe(uiText('predictionStatusMissing'))
    const contribution = table.columns.find((n: any) => n.key === 'contribution')
    expect(contribution.render(table.rows[0])).toBe('0.00')
    expect(contribution.render(table.rows[1])).toBe('—')
    expect(text()).toContain('2 / 5')
  } finally {
    f.app.unmount()
  }
})

test('evidence disclosure retains its name, expanded state and decorative chevron direction through repeated toggles', async () => {
  const f = harness()
  try {
    const button = () =>
      f
        .all()
        .find(
          (node) => node.type === 'button' && node.props['aria-controls'] === 'prediction-method'
        )!
    const walk = (node: HostNode): HostNode[] => [node, ...node.children.flatMap(walk)]
    for (const expanded of [false, true, false, true, false]) {
      expect(button().props['aria-expanded']).toBe(expanded)
      const content = walk(button())
      expect(content.some((node) => node.text === '数据与说明')).toBe(true)
      expect(
        content
          .filter((node) => node.type === 'chevron-icon')
          .map((node) => node.props['data-direction'])
      ).toEqual([expanded ? 'down' : 'right'])
      expect(content.some((node) => node.props['aria-hidden'] === 'true')).toBe(true)
      expect(f.all().some((node) => node.props.id === 'prediction-method')).toBe(expanded)
      button().props.onClick()
      await nextTick()
    }
  } finally {
    f.app.unmount()
  }
})

test('a full lineup can directly swap occupied members atomically without changing identities', async () => {
  const f = harness()
  try {
    const inputs = () =>
      f
        .all()
        .filter((n) => n.type === 'select')
        .slice(0, 5)
    expect(inputs().every((n) => n.props.clearable === true)).toBe(true)
    expect(inputs().every((n) => n.props.options.every((o: any) => !o.disabled))).toBe(true)
    const before = { ...f.store.predictionViewState.lineup }
    const published: string[][] = []
    const stop = Vue.watch(
      () => f.store.predictionViewState.lineup,
      (value) => published.push(Object.values(value)),
      { flush: 'sync' }
    )
    inputs()[0].props['onUpdate:value'](before.MIDDLE)
    await nextTick()
    expect(f.store.predictionViewState.lineup).toEqual({
      ...before,
      TOP: before.MIDDLE,
      MIDDLE: before.TOP
    })
    expect(published).toHaveLength(1)
    expect(
      published.every(
        (values) => new Set(values.filter(Boolean)).size === values.filter(Boolean).length
      )
    ).toBe(true)
    stop()
  } finally {
    f.app.unmount()
  }
})

test('clearing disables calculation, and moving into an empty slot clears its previous role', async () => {
  const f = harness()
  try {
    const inputs = () =>
      f
        .all()
        .filter((n) => n.type === 'select')
        .slice(0, 5)
    const member = f.store.predictionViewState.lineup.MIDDLE
    inputs()[0].props['onUpdate:value'](null)
    await nextTick()
    expect(inputs()[0].props.value).toBeNull()
    expect(
      f.all().find((n) => n.type === 'button' && n.props.type === 'primary')!.props.disabled
    ).toBe(true)
    inputs()[0].props['onUpdate:value'](member)
    await nextTick()
    expect(f.store.predictionViewState.lineup.TOP).toBe(member)
    expect(f.store.predictionViewState.lineup.MIDDLE).toBe('')
    expect(inputs()[2].props.value).toBeNull()
  } finally {
    f.app.unmount()
  }
})

test('replacement accepts only current configured identities and never mutates member settings', async () => {
  const f = harness()
  try {
    const settings = f.store.settings!
    f.store.settings = {
      ...settings,
      members: settings.members.map((m, i) =>
        i === 0 ? { ...m, gameName: 'SyntheticReplacement' } : m
      )
    }
    await nextTick()
    const update = () => f.all().filter((n) => n.type === 'select')[0].props['onUpdate:value']
    const settingsBefore = JSON.stringify(f.store.settings)
    const before = { ...f.store.predictionViewState.lineup }
    update()('UnknownSynthetic#TEST_ONLY')
    await nextTick()
    expect(f.store.predictionViewState.lineup).toEqual(before)
    update()('SyntheticReplacement#TEST_ONLY')
    await nextTick()
    expect(f.store.predictionViewState.lineup.TOP).toBe('SyntheticReplacement#TEST_ONLY')
    expect(JSON.stringify(f.store.settings)).toBe(settingsBefore)
  } finally {
    f.app.unmount()
  }
})

test('same selection preserves a running task; exchanging roles invalidates it and ignores late results', async () => {
  const f = harness()
  try {
    f.start()
    const worker = workers.instances[0]
    const inputs = () =>
      f
        .all()
        .filter((n) => n.type === 'select')
        .slice(0, 5)
    inputs()[0].props['onUpdate:value'](f.store.predictionViewState.lineup.TOP)
    await nextTick()
    expect(worker.terminate).not.toHaveBeenCalled()
    expect(f.store.predictionTaskStatus).toBe('running')
    inputs()[0].props['onUpdate:value'](f.store.predictionViewState.lineup.MIDDLE)
    await nextTick()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(f.store.predictionTaskStatus).toBe('idle')
    worker.onmessage({ data: { type: 'done', result: available() } })
    await nextTick()
    expect(f.store.predictionTaskStatus).toBe('idle')
    expect(f.all().some((n) => n.props.class === 'prediction-result')).toBe(false)
    f.start()
    workers.instances[1].onmessage({ data: { type: 'done', result: available() } })
    await nextTick()
    expect(f.all().some((n) => n.props.class === 'prediction-result')).toBe(true)
    inputs()[0].props['onUpdate:value'](null)
    await nextTick()
    expect(f.all().some((n) => n.props.class === 'prediction-result')).toBe(false)
  } finally {
    f.app.unmount()
  }
})
