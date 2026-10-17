// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createPinia } from 'pinia'
import { expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MemberAnalysisFilters from './MemberAnalysisFilters.vue'
vi.mock('./advanced-filter-motion', () => ({
  createAdvancedFilterMotion: () => ({
    cancel: vi.fn(),
    run: (
      _controls: unknown,
      _content: unknown,
      _open: boolean,
      _fresh: boolean,
      done: () => void
    ) => done()
  })
}))
vi.mock('naive-ui', () =>
  Object.fromEntries(
    ['NButton', 'NInput', 'NInputNumber', 'NSelect'].map((kind) => [
      kind,
      (props: any, { slots }: any) => h('control', { ...props, kind }, slots.default?.())
    ])
  )
)
const descriptor = parse(
  readFileSync(new URL('./MemberAnalysisFilters.vue', import.meta.url), 'utf8')
).descriptor
MemberAnalysisFilters.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'member-filter-behavior' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)
type HostNode = {
  type: string
  style: { display: string }
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  focus: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
}
const node = (type: string): HostNode => ({
  type,
  style: { display: '' },
  text: '',
  props: {},
  children: [],
  parent: null,
  focus: vi.fn(),
  scrollIntoView: vi.fn()
})

function harness(compact = false) {
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
  store.filters.query = 'SYNTHETIC_TEST_ONLY'
  store.filters.durationMin = 17
  store.filters.durationMax = 43
  const disabled = ref(true),
    root = node('root')
  const app = renderer.createApp({
    render: () => h(MemberAnalysisFilters, { disabled: disabled.value, embedded: true, compact })
  })
  app.use(pinia)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
  return { store, disabled, all: () => walk(root), dispose: () => app.unmount() }
}
test('advanced toggle remains available while every field/reset stays disabled and no filter value is emitted', async () => {
  const f = harness()
  try {
    const original = JSON.stringify({
      filters: f.store.filters,
      sample: f.store.sampleSize,
      side: f.store.analysisSide
    })
    const toggle = () =>
      f
        .all()
        .find(
          (n) =>
            n.props.kind === 'NButton' &&
            n.props['aria-controls'] === 'member-analysis-advanced-filters'
        )!
    const fields = () =>
      f.all().filter((n) => ['NInput', 'NInputNumber', 'NSelect'].includes(n.props.kind))
    const reset = () => f.all().find((n) => n.props.kind === 'NButton' && n !== toggle())!
    expect(fields()).toHaveLength(12)
    // Embedded primary controls use the native medium size of the adjacent
    // refresh/settings buttons, including their input line-height and padding.
    for (const label of ['搜索对局、成员或英雄', '样本范围', '阵营', '结果'])
      expect(fields().find((field) => field.props['aria-label'] === label)?.props.size).toBe(
        'medium'
      )
    expect(toggle().props.size).toBe('medium')
    expect(reset().props.size).toBe('medium')
    expect(fields().every((field) => field.props.disabled === true)).toBe(true)
    expect(reset().props.disabled).toBe(true)
    expect(Boolean(toggle().props.disabled)).toBe(false)
    expect(toggle().props['aria-expanded']).toBe(false)
    toggle().props.onClick()
    await nextTick()
    expect(toggle().props['aria-expanded']).toBe(true)
    expect(fields().every((field) => field.props.disabled === true)).toBe(true)
    expect(reset().props.disabled).toBe(true)
    expect(
      JSON.stringify({
        filters: f.store.filters,
        sample: f.store.sampleSize,
        side: f.store.analysisSide
      })
    ).toBe(original)
    f.disabled.value = false
    await nextTick()
    f.disabled.value = true
    await nextTick()
    expect(toggle().props['aria-expanded']).toBe(true)
    expect(fields().every((field) => field.props.disabled === true)).toBe(true)
    toggle().props.onClick()
    await nextTick()
    expect(toggle().props['aria-expanded']).toBe(false)
    expect(
      JSON.stringify({
        filters: f.store.filters,
        sample: f.store.sampleSize,
        side: f.store.analysisSide
      })
    ).toBe(original)
  } finally {
    f.dispose()
  }
})

test('compact disclosure keeps applied values and reset available without a summary paragraph', async () => {
  const f = harness(true)
  try {
    const before = JSON.stringify({
      filters: f.store.filters,
      sample: f.store.sampleSize,
      side: f.store.analysisSide
    })
    const toggle = () =>
      f.all().find((n) => n.props['aria-controls'] === 'member-analysis-filter-controls')!
    for (const open of [true, false, true]) {
      toggle().props.onClick()
      await nextTick()
      expect(toggle().props['aria-expanded']).toBe(open)
      expect(f.all().some((n) => n.type === 'p')).toBe(false)
      expect(
        f
          .all()
          .some(
            (n) =>
              n.props.kind === 'NButton' && n.children.some((child) => child.text.includes('重置'))
          )
      ).toBe(true)
      expect(
        JSON.stringify({
          filters: f.store.filters,
          sample: f.store.sampleSize,
          side: f.store.analysisSide
        })
      ).toBe(before)
    }
  } finally {
    f.dispose()
  }
})

test('advanced pointer focus clears on mouse exit without changing expansion or keyboard semantics', async () => {
  const f = harness()
  try {
    const toggle = () =>
      f.all().find((n) => n.props['aria-controls'] === 'member-analysis-advanced-filters')!
    const blur = vi.fn()
    const leave = () => toggle().props.onMouseleave({ currentTarget: { blur } })
    // A real mouse click opens/closes the disclosure, then moving away releases
    // only its focus. No extra outside click or filter mutation is needed.
    for (const open of [true, false]) {
      toggle().props.onClick({ detail: 1 })
      await nextTick()
      expect(toggle().props['aria-expanded']).toBe(open)
      leave()
      expect(toggle().props['aria-expanded']).toBe(open)
    }
    expect(blur).toHaveBeenCalledTimes(2)
    // Tab focus/keyboard-generated clicks have detail 0. Native NButton owns
    // Enter/Space activation; this component neither prevents nor blurs them.
    for (const key of ['Tab', 'Enter', ' ']) {
      const preventDefault = vi.fn()
      toggle().props.onKeydown({ key, preventDefault })
      toggle().props.onClick({ detail: 0 })
      await nextTick()
      leave()
      expect(preventDefault).not.toHaveBeenCalled()
    }
    expect(blur).toHaveBeenCalledTimes(2)
    // A keyboard interaction after mouse activation supersedes the pointer
    // intent, even while the pointer remains over the button.
    toggle().props.onClick({ detail: 1 })
    await nextTick()
    const expanded = toggle().props['aria-expanded']
    toggle().props.onKeydown({ key: 'Escape' })
    leave()
    expect(blur).toHaveBeenCalledTimes(2)
    expect(toggle().props['aria-expanded']).toBe(expanded)
    expect(toggle().props.focusable).not.toBe(false)
    expect(toggle().props.keyboard).not.toBe(false)
  } finally {
    f.dispose()
  }
})
