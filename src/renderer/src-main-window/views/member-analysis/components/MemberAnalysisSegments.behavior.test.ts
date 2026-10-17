import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { readFileSync } from 'node:fs'
import { describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import {
  createRenderer,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  reactive,
  ssrContextKey
} from 'vue'

import MemberAnalysisSegments from './MemberAnalysisSegments.vue'

// Load actual controls during module preparation, not a behavior timeout.
const actualTabs = await vi.importActual<{ default: (typeof import('naive-ui'))['NTabs'] }>(
  'naive-ui/es/tabs/src/Tabs.mjs'
)
const actualTab = await vi.importActual<{ default: (typeof import('naive-ui'))['NTab'] }>(
  'naive-ui/es/tabs/src/Tab.mjs'
)

vi.mock('naive-ui', () => ({
  NTabs: defineComponent({
    props: ['value', 'tabStyle', 'type', 'size'],
    emits: ['update:value'],
    setup:
      (_props, { slots, emit }) =>
      () =>
        h(
          'track',
          { onChoose: (value: string | number) => emit('update:value', value) },
          slots.default?.()
        )
  }),
  NTab: defineComponent({
    props: ['name', 'tab', 'disabled'],
    setup:
      (props, { attrs }) =>
      () =>
        h('tab', attrs, props.tab)
  })
}))
type Host = {
  type: string
  parent: Host | null
  children: Host[]
  props: Record<string, any>
  text: string
  focused: boolean
  scrollLeft: number
  focus: () => void
  querySelectorAll: (selector: string) => Host[]
  getBoundingClientRect: () => { left: number; right: number }
}
function node(type: string): Host {
  const item: Host = {
    type,
    parent: null,
    children: [],
    props: {},
    text: '',
    focused: false,
    scrollLeft: 0,
    focus: () => {
      item.focused = true
    },
    querySelectorAll: () => walk(item).filter((child) => child.props.role === 'tab'),
    getBoundingClientRect: () => ({ left: 0, right: 100 })
  }
  return item
}
function walk(item: Host): Host[] {
  return [item, ...item.children.flatMap(walk)]
}
const descriptor = parse(
  readFileSync(new URL('./MemberAnalysisSegments.vue', import.meta.url), 'utf8')
).descriptor
MemberAnalysisSegments.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'member-analysis-segments' }).bindings
  }).code
)(Vue)
function harness() {
  const renderer = createRenderer<Host, Host>({
    createElement: node,
    createComment: node,
    createText: (text) => ({ ...node('text'), text }),
    setText: (item, text) => {
      item.text = text
    },
    setElementText: (item, text) => {
      item.text = text
      item.children = []
    },
    patchProp: (item, key, _old, value) => {
      item.props[key] = value
    },
    parentNode: (item) => item.parent,
    nextSibling: (item) => item.parent?.children[item.parent.children.indexOf(item) + 1] ?? null,
    insert(item, parent, anchor) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1)
      item.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, item)
    },
    remove(item) {
      if (item.parent) item.parent.children.splice(item.parent.children.indexOf(item), 1)
    }
  })
  const props = reactive({
    modelValue: 'core' as string | number,
    options: [
      { value: 'core' as string | number, label: '核心表现', disabled: false },
      { value: 'blocked' as string | number, label: '不可用', disabled: true },
      { value: 20 as string | number, label: '20 分钟', disabled: false }
    ],
    slotWidth: 112,
    ariaLabel: '指标分组',
    ariaControls: 'metrics-panel'
  })
  const changed = vi.fn((value: string | number) => {
    props.modelValue = value
  })
  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(MemberAnalysisSegments, {
        ...props,
        'onUpdate:modelValue': changed
      })
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const tabs = () => walk(root).filter((item) => item.props.role === 'tab')
  const key = async (index: number, value: string) => {
    const preventDefault = vi.fn()
    await tabs()[index].props.onKeydown({ key: value, preventDefault })
    await nextTick()
    return preventDefault
  }
  return { props, root, app, tabs, key, changed }
}
describe('shared member analysis segments', () => {
  test('Naive selection emits only enabled known values and preserves numeric keys', async () => {
    const f = harness()
    try {
      const track = walk(f.root).find((item) => item.type === 'track')!
      track.props.onChoose(20)
      await nextTick()
      expect(f.props.modelValue).toBe(20)
      track.props.onChoose('blocked')
      track.props.onChoose('missing')
      expect(f.changed).toHaveBeenCalledTimes(1)
    } finally {
      f.app.unmount()
    }
  })
  test('exposes selected state, accessible name and a single tab stop, preserving number values', async () => {
    const f = harness()
    try {
      expect(walk(f.root).find((item) => item.props.role === 'tablist')?.props['aria-label']).toBe(
        '指标分组'
      )
      expect(f.tabs().map((item) => item.props.tabindex)).toEqual([0, -1, -1])
      expect(f.tabs()[0].props['aria-controls']).toBe('metrics-panel')
      expect(f.tabs()[1].props['aria-disabled']).toBe(true)
      f.props.modelValue = 20
      await nextTick()
      expect(f.tabs().map((item) => item.props['aria-selected'])).toEqual([false, false, true])
      expect(f.tabs().map((item) => item.props.tabindex)).toEqual([-1, -1, 0])
    } finally {
      f.app.unmount()
    }
  })
  test('arrows wrap and skip disabled items; Home and End select and focus enabled bounds', async () => {
    const f = harness()
    try {
      expect(await f.key(0, 'ArrowRight')).toHaveBeenCalledOnce()
      expect(f.props.modelValue).toBe(20)
      expect(f.tabs()[2].focused).toBe(true)
      await f.key(2, 'ArrowRight')
      expect(f.props.modelValue).toBe('core')
      await f.key(0, 'ArrowLeft')
      expect(f.props.modelValue).toBe(20)
      await f.key(2, 'Home')
      expect(f.props.modelValue).toBe('core')
      await f.key(0, 'End')
      expect(f.props.modelValue).toBe(20)
    } finally {
      f.app.unmount()
    }
  })
  test('Enter and Space select; disabled items and unrelated keys do not emit or intercept', async () => {
    const f = harness()
    try {
      await f.key(2, 'Enter')
      await f.key(0, ' ')
      expect(f.changed.mock.calls.map(([value]) => value)).toEqual([20, 'core'])
      expect(await f.key(1, 'Enter')).not.toHaveBeenCalled()
      expect(await f.key(0, 'Tab')).not.toHaveBeenCalled()
      expect(f.changed).toHaveBeenCalledTimes(2)
    } finally {
      f.app.unmount()
    }
  })
  test('unknown selection falls back to the first enabled tab; all disabled has no tab stop', async () => {
    const f = harness()
    try {
      f.props.modelValue = 'removed'
      await nextTick()
      expect(f.tabs().map((item) => item.props.tabindex)).toEqual([0, -1, -1])
      f.props.options.forEach((option) => {
        option.disabled = true
      })
      await nextTick()
      expect(f.tabs().every((item) => item.props.tabindex === -1)).toBe(true)
      await f.key(0, 'ArrowRight')
      expect(f.changed).not.toHaveBeenCalled()
    } finally {
      f.app.unmount()
    }
  })
  test('actual Naive NTab forwards tab semantics and keyboard attributes onto its interactive div', async () => {
    const app = createSSRApp({
      render: () =>
        h(
          actualTabs.default,
          { value: 'first', type: 'segment' },
          {
            default: () =>
              h(actualTab.default, {
                name: 'first',
                tab: '核心表现',
                role: 'tab',
                tabindex: 0,
                'aria-selected': true,
                'aria-controls': 'metrics-panel'
              })
          }
        )
    })
    const html = await renderToString(app)
    expect(html).toMatch(/class="n-tabs-tab[^\"]*"[^>]*role="tab"/)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('aria-controls="metrics-panel"')
  })
})
