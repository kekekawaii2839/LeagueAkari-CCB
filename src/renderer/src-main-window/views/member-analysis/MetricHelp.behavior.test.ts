// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { afterEach, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, nextTick, reactive, ref, ssrContextKey } from 'vue'
import MetricHelp from './MetricHelp.vue'
import MemberAnalysisHeader from './MemberAnalysisHeader.vue'
import CombinationView from './CombinationView.vue'

vi.mock('@vicons/material', () => ({
  AnalyticsRound: () => null,
  InfoOutlined: () => null,
  RefreshRound: () => null,
  SettingsRound: () => null
}))
vi.mock('./PairView.vue', () => ({ default: () => null }))
vi.mock('./SynergyView.vue', () => ({ default: () => null }))
vi.mock('./components/MemberAnalysisSegments.vue', () => ({ default: () => null }))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ games: ref([]), pairs: ref([]), synergy: ref([]) })
}))
vi.mock('naive-ui', () => ({
  NIcon: (props: any) => h('svg', { 'aria-hidden': props['aria-hidden'] }),
  NButton: defineComponent({
    setup:
      (_, { attrs, slots }) =>
      () =>
        h('button', attrs, slots.default?.())
  }),
  NPopover: defineComponent({
    props: { show: Boolean },
    emits: ['update:show'],
    setup:
      (props, { emit, slots }) =>
      () =>
        h(
          'popover',
          {
            open: props.show,
            onOutside: () => emit('update:show', false)
          },
          [
            h('trigger', { onClick: () => emit('update:show', !props.show) }, slots.trigger?.()),
            props.show ? h('content', slots.default?.()) : null
          ]
        )
  })
}))

for (const [component, file] of [
  [MetricHelp, 'MetricHelp.vue'],
  [MemberAnalysisHeader, 'MemberAnalysisHeader.vue'],
  [CombinationView, 'CombinationView.vue']
] as const) {
  const descriptor = parse(readFileSync(new URL('./' + file, import.meta.url), 'utf8')).descriptor
  component.render = new Function(
    'Vue',
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      bindingMetadata: compileScript(descriptor, { id: file }).bindings
    }).code
  )(Vue)
}
type Host = {
  type: string
  props: Record<string, any>
  children: Host[]
  parent: Host | null
  text: string
  visible: boolean
  focus: ReturnType<typeof vi.fn>
  parentElement: Host | null
  getClientRects: () => number[]
  closest: () => null
  querySelectorAll: () => Host[]
}
const documentState = {
  activeElement: null as Host | null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn()
}
const observers: { callback: () => void; disconnect: ReturnType<typeof vi.fn> }[] = []
function node(type: string): Host {
  const item: any = {
    type,
    props: {},
    children: [],
    parent: null,
    text: '',
    visible: true,
    closest: () => null,
    querySelectorAll: () => []
  }
  Object.defineProperty(item, 'parentElement', { get: () => item.parent })
  item.getClientRects = () => {
    for (let current = item; current; current = current.parent) if (!current.visible) return []
    return [1]
  }
  item.focus = vi.fn(() => {
    documentState.activeElement = item
  })
  return item
}
function harness(component: any, props: Record<string, any>) {
  documentState.addEventListener.mockClear()
  documentState.removeEventListener.mockClear()
  observers.length = 0
  vi.stubGlobal('document', documentState)
  vi.stubGlobal(
    'MutationObserver',
    class {
      disconnect = vi.fn()
      constructor(public callback: () => void) {
        observers.push(this)
      }
      observe() {}
    }
  )
  const renderer = createRenderer<Host, Host>({
    createElement: node,
    createComment: node,
    createText: (text) => ({ ...node('text'), text }),
    setText: (n, t) => {
      n.text = t
    },
    setElementText: (n, t) => {
      n.text = t
      n.children = []
    },
    patchProp: (n, k, _, v) => {
      n.props[k] = v
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert(n, p, a) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = p
      const i = a ? p.children.indexOf(a) : -1
      p.children.splice(i < 0 ? p.children.length : i, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    }
  })
  const root = node('root'),
    state = reactive(props),
    app = renderer.createApp({ render: () => h(component, state) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: Host): Host[] => [n, ...n.children.flatMap(walk)]
  const all = () => walk(root),
    popover = () => all().find((n) => n.type === 'popover')!
  const open = async () => {
    all()
      .find((n) => n.type === 'trigger')!
      .props.onClick()
    await nextTick()
  }
  return { root, state, all, popover, open, dispose: () => app.unmount() }
}
afterEach(() => vi.unstubAllGlobals())
const text = (n: Host): string => n.text + n.children.map(text).join('')
const escape = () => ({ key: 'Escape', preventDefault: vi.fn(), stopPropagation: vi.fn() })

test('text and icon-only help retain a single accessible name with decorative SVG', async () => {
  const f = harness(MetricHelp, { label: '样本指标', definition: '合成定义', iconOnly: false })
  try {
    const trigger = () => f.all().find((n) => n.type === 'button')!
    expect(text(trigger())).toBe('样本指标')
    expect(f.all().filter((n) => n.type === 'svg')).toHaveLength(1)
    expect(f.all().find((n) => n.type === 'svg')?.props['aria-hidden']).toBe('true')
    f.state.iconOnly = true
    await nextTick()
    expect(text(trigger())).toBe('')
    expect(trigger().props['aria-label']).toBe('样本指标说明')
    await f.open()
    expect(f.popover().props.open).toBe(true)
    expect(text(f.all().find((n) => n.type === 'content')!)).toBe('合成定义')
  } finally {
    f.dispose()
  }
})

test('metric explanations contain only definition content, dismiss outside and Escape restores the visible trigger', async () => {
  const f = harness(MetricHelp, { label: '样本指标', definition: '合成指标定义。', iconOnly: true })
  try {
    await f.open()
    const content = f.all().find((n) => n.type === 'content')!
    expect(text(content)).toBe('合成指标定义。')
    expect(
      content.children.flatMap((n) => [n, ...n.children]).some((n) => n.type === 'button')
    ).toBe(false)
    f.popover().props.onOutside()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    await f.open()
    const listener = documentState.addEventListener.mock.calls.at(-1)![1] as (event: any) => void
    listener(escape())
    await nextTick()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    expect(documentState.activeElement?.props['aria-label']).toBe('样本指标说明')
  } finally {
    f.dispose()
  }
})
test('a hidden lazy pane dismisses its explanation and disposes observers without focusing the hidden trigger', async () => {
  const f = harness(MetricHelp, { label: '指标', definition: '定义', iconOnly: true })
  try {
    await f.open()
    const trigger = f.all().find((n) => n.type === 'button')!
    trigger.focus.mockClear()
    f.root.visible = false
    observers.at(-1)!.callback()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    expect(trigger.focus).not.toHaveBeenCalled()
    expect(observers.at(-1)!.disconnect).toHaveBeenCalledOnce()
    expect(documentState.removeEventListener).toHaveBeenCalledWith('keydown', expect.any(Function))
  } finally {
    f.dispose()
  }
})
test('refresh-reason help keeps configuration recovery but has no redundant close action', async () => {
  const f = harness(MemberAnalysisHeader, {
    generatedAt: null,
    loading: false,
    refreshDisabled: true,
    refreshReason: { kind: 'members', text: '合成成员配置限制。' }
  })
  try {
    await f.open()
    let content = f.all().find((n) => n.type === 'content')!
    expect(text(content)).toContain('合成成员配置限制。')
    expect(
      content.children
        .flatMap((n) => [n, ...n.children])
        .filter((n) => n.type === 'button')
        .map(text)
    ).toEqual(['配置成员'])
    f.popover().props.onOutside()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    await f.open()
    const reason = f.all().find((n) => n.props['aria-label'] === '刷新不可用原因')!
    reason.props.onKeydown(escape())
    await nextTick()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    expect(reason.focus).toHaveBeenCalled()
    f.state.refreshReason = { kind: 'service', text: '合成服务暂不可用。' }
    await nextTick()
    await f.open()
    content = f.all().find((n) => n.type === 'content')!
    expect(text(content)).toBe('合成服务暂不可用。')
    expect(
      content.children.flatMap((n) => [n, ...n.children]).some((n) => n.type === 'button')
    ).toBe(false)
  } finally {
    f.dispose()
  }
})
test('combination scope explanation has no close button, supports outside dismissal and closes when its view changes', async () => {
  const f = harness(CombinationView, { view: 'pairs', contextNote: '合成范围状态' })
  try {
    await f.open()
    const content = f.all().find((n) => n.type === 'content')!
    expect(text(content)).toContain('合成范围状态')
    expect(
      content.children.flatMap((n) => [n, ...n.children]).some((n) => n.type === 'button')
    ).toBe(false)
    f.popover().props.onOutside()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    await f.open()
    f.all()
      .find((n) => n.props.class === 'combination-scope-content')!
      .props.onKeydown(escape())
    await nextTick()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    expect(documentState.activeElement?.props.class).toBe('combination-scope-help')
    await f.open()
    const scopeTrigger = f.all().find((n) => n.props.class === 'combination-scope-help')!
    scopeTrigger.props.onKeydown(escape())
    await nextTick()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
    expect(documentState.activeElement).toBe(scopeTrigger)
    await f.open()
    f.state.view = 'synergy'
    await nextTick()
    await nextTick()
    expect(f.popover().props.open).toBe(false)
  } finally {
    f.dispose()
  }
})
