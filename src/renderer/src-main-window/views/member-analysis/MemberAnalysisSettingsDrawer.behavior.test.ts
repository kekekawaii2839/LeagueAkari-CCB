// sort-imports-ignore
import './test-i18n'
import { describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { i18next } from '@renderer-shared/i18n'
import type { MemberAnalysisSettings } from '@shared/shards/member-analysis'
import MemberAnalysisSettingsDrawer from './MemberAnalysisSettingsDrawer.vue'

vi.mock('@renderer-shared/composables/useSgpTagOptions', () => ({
  ALL_SGPTAG_VALUE: '<akari:all>',
  useSgpTagOptions: () => ({ value: [] })
}))
vi.mock('naive-ui', () => {
  const stub =
    (kind: string) =>
    (props: any, { slots }: any) =>
      h('control', { ...props, kind }, [slots.default?.(), slots.footer?.()])
  return Object.fromEntries(
    [
      'NAlert',
      'NButton',
      'NDrawer',
      'NDrawerContent',
      'NFormItem',
      'NInput',
      'NInputNumber',
      'NSelect',
      'NSwitch'
    ].map((kind) => [kind, stub(kind)])
  )
})

type Node = {
  type: string
  props: Record<string, any>
  children: Node[]
  parent: Node | null
  text: string
}
const node = (type: string): Node =>
  Object.assign(
    { type, props: {}, children: [], parent: null, text: '' },
    {
      scrollIntoView() {},
      focus() {},
      closest() {
        return null
      },
      querySelector() {
        return null
      },
      querySelectorAll() {
        return []
      }
    }
  )
function fixture(): MemberAnalysisSettings {
  return {
    enabled: true,
    members: Array.from({ length: 5 }, (_, i) => ({
      serverId: 'SYNTHETIC',
      gameName: `Member${i}`,
      tagLine: 'TEST'
    })),
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false,
    experimentalPredictionEnabled: false
  }
}
// Node Vitest imports SFCs in SSR mode; compile the real template for the
// synthetic Vue host rather than copy component logic or assert source strings.
const descriptor = parse(
  readFileSync(new URL('./MemberAnalysisSettingsDrawer.vue', import.meta.url), 'utf8')
).descriptor
const bindings = compileScript(descriptor, { id: 'settings-behavior' }).bindings
MemberAnalysisSettingsDrawer.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: bindings
  }).code
)(Vue)
function harness() {
  const renderer = createRenderer<Node, Node>({
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
      const i = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    }
  })
  const props = reactive({
    show: true,
    settings: fixture(),
    saving: false,
    storageStatus: null,
    cleanupPreview: null,
    cleaning: false,
    saveError: ''
  })
  const save = vi.fn()
  const close = vi.fn()
  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(MemberAnalysisSettingsDrawer, { ...props, onSave: save, 'onUpdate:show': close })
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = (): Node[] => {
    const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  const control = (kind: string, predicate: (n: Node) => boolean = () => true) =>
    all().find((n) => n.props.kind === kind && predicate(n))!
  const name = () => control('NInput', (n) => n.props['aria-label'] === '成员名称')
  const button = () => control('NButton', (n) => n.props.type === 'primary')
  const editName = async (value: string) => {
    name().props['onUpdate:value'](value)
    await nextTick()
  }
  const submit = () => button().props.onClick()
  return { props, root, app, all, control, name, button, editName, submit, save, close }
}

describe('settings draft and contract behavior', () => {
  test.each([
    ['zh-CN', '请输入 1–1000 的整数 GiB。'],
    ['en', 'Enter an integer from 1 to 1000 GiB.']
  ])('renders a localized nearby storage error in %s', async (language, message) => {
    await i18next.changeLanguage(language)
    const f = harness()
    try {
      f.control('NInputNumber', (n) => n.props.min === 1).props['onUpdate:value'](null)
      await nextTick()
      f.submit()
      await nextTick()
      const semantics = f.control('NInputNumber', (n) => n.props.min === 1).props['input-props']
      expect(f.all().find((n) => n.props.id === semantics['aria-describedby'])?.text).toBe(message)
      expect(f.save).not.toHaveBeenCalled()
    } finally {
      f.app.unmount()
      await i18next.changeLanguage('zh-CN')
    }
  })

  test('adopts external snapshots only while clean', async () => {
    const f = harness()
    try {
      const external = fixture()
      external.members[0].gameName = 'External clean'
      f.props.settings = external
      await nextTick()
      expect(f.name().props.value).toBe('External clean')
      f.control('NDrawer').props['onUpdate:show'](false)
      await nextTick()
      expect(f.close).toHaveBeenCalledWith(false)
    } finally {
      f.app.unmount()
    }
  })
  test('external close invalidates an old completion even after reopening', async () => {
    const f = harness()
    try {
      await f.editName('Submitted')
      f.submit()
      const [submitted, complete] = f.save.mock.calls[0]
      f.props.show = false
      await nextTick()
      f.props.show = true
      await nextTick()
      await f.editName('New session')
      complete(submitted)
      await nextTick()
      expect(f.name().props.value).toBe('New session')
      expect(f.close).not.toHaveBeenCalled()
    } finally {
      f.app.unmount()
    }
  })

  test.each([
    ['storage null', 'NInputNumber', (n: Node) => n.props.min === 1, null],
    ['scan fractional', 'NInputNumber', (n: Node) => n.props.min === 100, 100.5],
    ['invalid server', 'NInput', (n: Node) => n.props['aria-label'] === '服务器 ID', 'bad/server'],
    ['blank name', 'NInput', (n: Node) => n.props['aria-label'] === '成员名称', '   '],
    ['blank tag', 'NInput', (n: Node) => n.props['aria-label'] === 'Tag', '   ']
  ])(
    'rejects %s before emitting and associates a nearby field error',
    async (_label, kind, predicate, value) => {
      const f = harness()
      try {
        f.control(kind, predicate).props['onUpdate:value'](value)
        await nextTick()
        expect(f.button().props.disabled).toBe(true)
        f.submit()
        await nextTick()
        expect(f.save).not.toHaveBeenCalled()
        const input = f.control(kind, predicate)
        const semantics = input.props['input-props']
        expect(semantics['aria-invalid']).toBe(true)
        expect(
          f
            .all()
            .some(
              (n) =>
                n.props.id === semantics['aria-describedby'] && Boolean(n.text || n.children.length)
            )
        ).toBe(true)
      } finally {
        f.app.unmount()
      }
    }
  )
  test('normalizes trim once, emits an independent submission, and closes unchanged successful input', async () => {
    const f = harness()
    try {
      await f.editName('  Synthetic Name  ')
      f.submit()
      const [submitted, complete] = f.save.mock.calls[0]
      expect(submitted.members[0].gameName).toBe('Synthetic Name')
      complete(submitted)
      await nextTick()
      expect(f.name().props.value).toBe('Synthetic Name')
      expect(f.close).toHaveBeenCalledOnce()
      complete(submitted)
      expect(f.close).toHaveBeenCalledOnce()
    } finally {
      f.app.unmount()
    }
  })
  test('retains dirty input across equal and changed external snapshots, and explicitly discards', async () => {
    const f = harness()
    try {
      await f.editName('Unsaved')
      f.props.settings = fixture()
      await nextTick()
      expect(f.name().props.value).toBe('Unsaved')
      const external = fixture()
      external.members[0].gameName = 'External'
      f.props.settings = external
      await nextTick()
      expect(f.name().props.value).toBe('Unsaved')
      f.control('NDrawer').props['onUpdate:show'](false)
      await nextTick()
      expect(f.close).not.toHaveBeenCalled()
      const discard = f
        .all()
        .find((n) => n.props.kind === 'NButton' && n.children.some((c) => c.text.includes('放弃')))!
      discard.props.onClick()
      await nextTick()
      expect(f.name().props.value).toBe('External')
      expect(f.close).toHaveBeenCalledWith(false)
    } finally {
      f.app.unmount()
    }
  })
  test('continue editing dismisses the discard warning without resetting input or saving', async () => {
    const f = harness()
    try {
      await f.editName('Keep this input')
      f.control('NDrawer').props['onUpdate:show'](false)
      await nextTick()
      expect(f.all().some((n) => n.props.kind === 'NAlert' && n.props.type === 'warning')).toBe(
        true
      )
      const keepEditing = f
        .all()
        .find(
          (n) => n.props.kind === 'NButton' && n.children.some((c) => c.text.includes('继续编辑'))
        )!
      keepEditing.props.onClick()
      await nextTick()
      expect(f.all().some((n) => n.props.kind === 'NAlert' && n.props.type === 'warning')).toBe(
        false
      )
      expect(f.name().props.value).toBe('Keep this input')
      expect(f.save).not.toHaveBeenCalled()
      expect(f.close).not.toHaveBeenCalled()
    } finally {
      f.app.unmount()
    }
  })
  test('old successful submission cannot erase edits made while saving', async () => {
    const f = harness()
    try {
      await f.editName('Submitted')
      f.submit()
      const [submitted, complete] = f.save.mock.calls[0]
      await f.editName('Newer input')
      expect(submitted.members[0].gameName).toBe('Submitted')
      f.props.settings = submitted
      await nextTick()
      complete(submitted)
      await nextTick()
      expect(f.name().props.value).toBe('Newer input')
      expect(f.close).not.toHaveBeenCalled()
      f.submit()
      expect(f.save).toHaveBeenCalledTimes(2)
    } finally {
      f.app.unmount()
    }
  })
  test('failure and an unmounted completion never discard input or close another drawer', async () => {
    const f = harness()
    await f.editName('Retained')
    f.submit()
    f.save.mock.calls[0][1](null)
    await nextTick()
    expect(f.name().props.value).toBe('Retained')
    expect(f.close).not.toHaveBeenCalled()
    f.submit()
    const [submitted, complete] = f.save.mock.calls[1]
    f.app.unmount()
    complete(submitted)
    expect(f.close).not.toHaveBeenCalled()
  })
})
