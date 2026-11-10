// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import {
  createRenderer,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  ref,
  ssrContextKey
} from 'vue'
import { beforeEach, expect, test, vi } from 'vitest'
import CombinationView from './CombinationView.vue'
import EarlyConversionView from './EarlyConversionView.vue'
import MemberAnalysisSegments from './components/MemberAnalysisSegments.vue'

vi.mock('naive-ui', () => ({
  NTabs: defineComponent({
    props: ['value'],
    emits: ['update:value'],
    setup(_props, { slots, emit }) {
      provide('segment-select', (value: string | number) => emit('update:value', value))
      return () => h('track', {}, slots.default?.())
    }
  }),
  NTab: defineComponent({
    props: ['name', 'tab', 'disabled'],
    setup(props, { attrs }) {
      const select = inject<(value: string | number) => void>('segment-select')!
      return () => h('button', { ...attrs, onClick: () => select(props.name) }, props.tab)
    }
  }),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NPopover: () => null,
  NSelect: () => null,
  NRadioButton: () => null,
  NRadioGroup: () => null
}))
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => ({ overviewGeneration: 1 })
}))
vi.mock('./PairView.vue', () => ({
  default: defineComponent({ setup: () => () => h('pair-page') })
}))
vi.mock('./SynergyView.vue', () => ({
  default: defineComponent({ setup: () => () => h('synergy-page') })
}))
vi.mock('./MemberAnalysisEvidenceTable.vue', () => ({ default: () => null }))
vi.mock('./MetricHelp.vue', () => ({ default: () => null }))
vi.mock('./WinRateInterval.vue', () => ({ default: () => null }))
const data = { games: ref([]), conversion: ref([]), pairs: ref([]), synergy: ref([]) }
beforeEach(() => {
  Object.values(data).forEach((value) => {
    value.value = []
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
for (const [component, path] of [
  [CombinationView, './CombinationView.vue'],
  [EarlyConversionView, './EarlyConversionView.vue'],
  [MemberAnalysisSegments, './components/MemberAnalysisSegments.vue']
] as const) {
  const descriptor = parse(readFileSync(new URL(path, import.meta.url), 'utf8')).descriptor
  const code = compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    expressionPlugins: ['typescript'],
    bindingMetadata: compileScript(descriptor, { id: path }).bindings
  }).code
  component.render = new Function(
    'Vue',
    (await transformWithEsbuild(code, 'page.ts', { loader: 'ts' })).code
  )(Vue)
}
type Host = {
  type: string
  props: Record<string, any>
  text: string
  parent: Host | null
  children: Host[]
  scrollLeft: number
  focus: () => void
  closest: () => null
  querySelectorAll: () => Host[]
  getBoundingClientRect: () => { left: number; right: number }
}
const walk = (n: Host): Host[] => [n, ...n.children.flatMap(walk)]
function node(type: string): Host {
  const n: Host = {
    type,
    props: {},
    text: '',
    parent: null,
    children: [],
    scrollLeft: 0,
    focus() {},
    closest: () => null,
    querySelectorAll: () => walk(n).filter((x) => x.props.role === 'tab'),
    getBoundingClientRect: () => ({ left: 0, right: 500 })
  }
  return n
}
function harness(component: typeof CombinationView | typeof EarlyConversionView) {
  const renderer = createRenderer<Host, Host>({
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
    patchProp: (n, key, _old, value) => {
      n.props[key] = value
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = parent
      const i = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    }
  })
  const root = node('root')
  const view = ref<'pairs' | 'synergy'>('pairs')
  const change = vi.fn((value: 'pairs' | 'synergy') => {
    view.value = value
  })
  const app = renderer.createApp({
    render: () =>
      component === CombinationView
        ? h(CombinationView, { view: view.value, 'onUpdate:view': change })
        : h(component)
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const tabs = () => walk(root).filter((n) => n.props.role === 'tab')
  const selected = () => tabs().findIndex((n) => n.props['aria-selected'])
  const click = async (i: number) => {
    tabs()[i].props.onClick()
    await nextTick()
  }
  const key = async (i: number, key: string) => {
    await tabs()[i].props.onKeydown({ key, preventDefault() {} })
    await nextTick()
  }
  return { root, tabs, selected, app, click, key, change, view }
}
test('combination follows shell destinations without nested tabs and retains child instances', async () => {
  const f = harness(CombinationView)
  try {
    expect(f.tabs()).toHaveLength(0)
    const pair = walk(f.root).find((n) => n.type === 'pair-page')
    expect(pair).toBeDefined()
    f.view.value = 'synergy'
    await nextTick()
    expect(f.tabs()).toHaveLength(0)
    const synergy = walk(f.root).find((n) => n.type === 'synergy-page')
    expect(synergy).toBeDefined()
    f.view.value = 'pairs'
    await nextTick()
    expect(walk(f.root).find((n) => n.type === 'pair-page') === pair).toBe(true)
    f.view.value = 'synergy'
    await nextTick()
    expect(walk(f.root).find((n) => n.type === 'synergy-page') === synergy).toBe(true)
  } finally {
    f.app.unmount()
  }
})

test('early tabs preserve original string timing and selection across filtered empty data', async () => {
  const f = harness(EarlyConversionView)
  try {
    expect(f.selected()).toBe(0)
    await f.click(1)
    expect(f.selected()).toBe(1)
    data.games.value = []
    await nextTick()
    expect(f.selected()).toBe(1)
    await f.key(1, 'ArrowLeft')
    expect(f.selected()).toBe(0)
    await f.key(0, 'End')
    expect(f.selected()).toBe(1)
  } finally {
    f.app.unmount()
  }
})
