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
import ConversionView from './ConversionView.vue'
import { aggregateConversion } from './analytics'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { uiText } from './ui-text'

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
  NSelect: (props: any) => h('select-control', props),
  NRadioButton: () => null,
  NRadioGroup: () => null
}))
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => ({ overviewGeneration: 1, navigateToMatch: navigate })
}))
vi.mock('./SynergyHeroStats.vue', () => ({
  default: (props: any) => h('shared-hero-stats', props)
}))
vi.mock('./EvidenceMatchAction.vue', () => ({ default: () => h('removed-action') }))
vi.mock('./MemberAnalysisEvidenceTable.vue', () => ({
  default: (props: any) => h('evidence-table', props)
}))
vi.mock('./MetricHelp.vue', () => ({ default: () => null }))
vi.mock('./WinRateInterval.vue', () => ({ default: () => null }))
const data = {
  games: ref<MemberAnalysisGame[]>([]),
  conversion: ref<ReturnType<typeof aggregateConversion>>([])
}
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
const descriptor = parse(
  readFileSync(new URL('./ConversionView.vue', import.meta.url), 'utf8')
).descriptor
ConversionView.render = new Function(
  'Vue',
  (
    await transformWithEsbuild(
      compile(descriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        expressionPlugins: ['typescript'],
        bindingMetadata: compileScript(descriptor, { id: 'event-layout' }).bindings
      }).code,
      'pair-template.ts',
      { loader: 'ts' }
    )
  ).code
)(Vue)
type Host = {
  type: string
  props: Record<string, any>
  text: string
  parent: Host | null
  children: Host[]
  scrollLeft: number
  focus: () => void
  closest: (selector: string) => any
  querySelector: () => null
  querySelectorAll: () => Host[]
  getClientRects: () => unknown[]
  getBoundingClientRect: () => {
    left: number
    right: number
    top: number
    bottom: number
    height: number
  }
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
    closest: (selector: string) => (selector === '.member-analysis-scroll' ? scroller : content),
    querySelector: () => null,
    querySelectorAll: () => walk(n).filter((x) => x.props.role === 'tab'),
    getClientRects: () => [{}],
    getBoundingClientRect: () => {
      const comparison = n.props['aria-label'] === '事件结果指标'
      const top = (comparison ? 200 : regionTop) - scroller.scrollTop
      return { left: 0, right: 1200, top, bottom: top + 200, height: 200 }
    }
  }
  return n
}
function harness() {
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
  const open = vi.fn()
  const app = renderer.createApp({ render: () => h(ConversionView) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  return { root, app, open, all: () => walk(root) }
}
const navigate = vi.fn()
const callbacks: (() => void)[] = []
const mutationCallbacks: (() => void)[] = []
let regionTop = 400
const scroller = { clientHeight: 1000, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }) }
const content = {}
test('evidence uses measured remaining height, keeps all matches and navigation inside keyboard-accessible region', async () => {
  vi.stubGlobal('getComputedStyle', () => ({ paddingBottom: '24px' }))
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        mutationCallbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        callbacks.push(callback)
      }
      observe() {}
      disconnect() {}
    }
  )
  const games = Array.from({ length: 25 }, (_, i): MemberAnalysisGame => ({
    gameId: 9001 + i,
    timestamp: i,
    date: '2026-10-14',
    patch: '26.20',
    win: true,
    side: 'Blue',
    duration: 1800,
    roster: '合成成员1 / 合成成员2 / 合成成员3 / 合成成员4 / 合成成员5',
    metricSemantics: 'current-v5',
    dragon15Diff: null,
    grub15Diff: null,
    objectiveFight15Diff: null,
    counterMean: null,
    upperGold15: null,
    botGold15: null,
    gold20Diff: null,
    tower20Diff: null,
    jungle: null,
    laneGankDeaths: null,
    players: [],
    eventDecision: null
  }))
  data.games.value = games
  data.conversion.value = aggregateConversion(games)
  const f = harness()
  try {
    expect(
      f
        .all()
        .filter((n) => n.type === 'h3')
        .map((n) => n.text)
    ).toEqual(['击杀后的兑现', '死亡代价', '资源团', '跨图交换'])
    expect(f.all().some((n) => n.props.role === 'tab')).toBe(false)
    const metricButtons = () =>
      f
        .all()
        .filter(
          (n) => n.type === 'button' && String(n.props['aria-label']).includes('查看对应对局')
        )
    expect(metricButtons()).toHaveLength(30) // 15 metrics × total / blue; both former extras included.
    for (const label of ['场均丢塔', '场均终结赏金', '资源团胜率', '交换延迟']) {
      const button = metricButtons().find((n) =>
        String(n.props['aria-label']).startsWith(`总计，${label}，`)
      )!
      button.props.onClick({ currentTarget: button })
      await nextTick()
      await nextTick()
      const table = f.all().find((n) => n.type === 'evidence-table')!
      expect(table.props.columns[0].title).toBe(label)
      expect(table.props.games).toHaveLength(25)
      button.props.onClick({ currentTarget: button })
      await nextTick()
      expect(f.all().some((n) => n.type === 'evidence-table')).toBe(false)
    }
    const metric = f
      .all()
      .find((n) => n.type === 'button' && String(n.props['aria-label']).includes('查看对应对局'))!
    metric.props.onClick({ currentTarget: metric })
    await nextTick()
    await nextTick()
    const region = f.all().find((n) => n.type === 'section' && n.props.role === 'region')!
    expect(region.props.tabindex).toBe('0')
    expect(region.props['aria-label']).toBe(uiText('matchingGames'))
    expect(callbacks).toHaveLength(1)
    callbacks.forEach((callback) => callback())
    await nextTick()
    expect(f.all().find((n) => n.type === 'evidence-table')!.props['viewport-height']).toBe(568)
    const table = f.all().find((n) => n.type === 'evidence-table')!
    expect(table.props.games).toHaveLength(25)
    table.props['navigate-to-match'](games[0])
    expect(navigate).toHaveBeenCalledWith(9001, expect.any(String))
    scroller.scrollTop = 120
    callbacks.forEach((callback) => callback())
    await nextTick()
    expect(callbacks).toHaveLength(1)
    callbacks.forEach((callback) => callback())
    await nextTick()
    expect(f.all().find((n) => n.type === 'evidence-table')!.props['viewport-height']).toBe(568)
    scroller.clientHeight = 700
    callbacks.forEach((callback) => callback())
    await nextTick()
    expect(f.all().find((n) => n.type === 'evidence-table')!.props['viewport-height']).toBe(268)
    scroller.clientHeight = 480
    callbacks.forEach((callback) => callback())
    await nextTick()
    expect(f.all().find((n) => n.type === 'evidence-table')!.props['viewport-height']).toBe(128)
    expect(table.props.games).toHaveLength(25)
    expect(table.props.columns[0].align).toBe('right')
    expect(f.all().some((n) => n.text === uiText('eventWindowNote'))).toBe(false)
    expect(f.all().some((n) => n.text === uiText('eventGameNote'))).toBe(false)
    scroller.clientHeight = 1000
    const outer = Vue.markRaw({ parentElement: Vue.markRaw(scroller), kind: 'outer' })
    const inner = Vue.markRaw({ parentElement: outer, kind: 'inner' })
    const panel = f.all().find((n) => String(n.props.class).includes('ma-panel'))!
    Object.defineProperty(panel, 'parentElement', { value: inner, configurable: true })
    vi.stubGlobal('getComputedStyle', (element: any) =>
      element.kind === 'inner'
        ? { paddingBottom: '10px', borderBottomWidth: '1px', marginBottom: '8px' }
        : { paddingBottom: '24px', borderBottomWidth: '0px', marginBottom: '0px' }
    )
    callbacks.forEach((callback) => callback())
    await nextTick()
    expect(f.all().find((n) => n.type === 'evidence-table')!.props['viewport-height']).toBe(525)
    // Banner insertion moves the evidence without resizing the root or owner.
    regionTop = 448
    mutationCallbacks.forEach((callback) => callback())
    await nextTick()
    expect(f.all().find((n) => n.type === 'evidence-table')!.props['viewport-height']).toBe(477)
  } finally {
    f.app.unmount()
    vi.unstubAllGlobals()
  }
})
