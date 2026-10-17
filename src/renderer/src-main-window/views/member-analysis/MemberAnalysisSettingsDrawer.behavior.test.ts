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
vi.mock('@vicons/fluent', () => ({ ReOrderDotsVertical20Regular: () => null }))
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
      'NIcon',
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
      tagLine: 'TESTONLY'
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
)({
  ...Vue,
  // This host has no DOM/layout engine. Keep actual keyed children and behavior;
  // FLIP positioning and reduced-motion are checked in the native fixture.
  TransitionGroup: Vue.defineComponent({
    setup(_props, { slots }) {
      return () => h('div', slots.default?.())
    }
  })
})
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
  test('moves complete member identities with stable row nodes and saves the order across reopen', async () => {
    const f = harness()
    const rows = () => f.all().filter((n) => n.props['data-member-row'] !== undefined)
    const names = () =>
      f.all().filter((n) => n.props.kind === 'NInput' && n.props['aria-label'] === '成员名称')
    try {
      const original = fixture().members
      const firstRow = rows()[0]
      const firstInput = names()[0]
      const handle = f.all().find((n) => n.props.class === 'member-drag-handle')!
      const transfer = {
        effectAllowed: '',
        dropEffect: '',
        setData: vi.fn(),
        getData: () => String(firstRow.props['data-member-row'])
      }
      handle.props.onDragstart({ dataTransfer: transfer, preventDefault: vi.fn() })
      const over = { dataTransfer: transfer, preventDefault: vi.fn() }
      rows()[1].props.onDragover(over)
      expect(over.preventDefault).toHaveBeenCalledOnce()
      await rows()[1].props.onDrop(over)
      handle.props.onDragend()
      expect(transfer.setData).toHaveBeenCalledWith(
        'application/x-akari-member-order',
        String(firstRow.props['data-member-row'])
      )
      await nextTick()
      expect(rows()[1]).toBe(firstRow)
      expect(names()[1]).toBe(firstInput)
      expect(names().map((n) => n.props.value)).toEqual([
        'Member1',
        'Member0',
        'Member2',
        'Member3',
        'Member4'
      ])
      // Editing the moved row must still update its own identity, not its former slot.
      names()[1].props['onUpdate:value']('Moved member')
      await nextTick()
      f.submit()
      const [submitted, complete] = f.save.mock.calls[0]
      expect(submitted.members).toEqual([
        original[1],
        { ...original[0], gameName: 'Moved member' },
        ...original.slice(2)
      ])
      expect(f.props.settings.members).toEqual(original)
      complete(submitted)
      await nextTick()
      f.props.settings = submitted
      f.props.show = false
      await nextTick()
      f.props.show = true
      await nextTick()
      expect(names().map((n) => n.props.value)).toEqual([
        'Member1',
        'Moved member',
        'Member2',
        'Member3',
        'Member4'
      ])
      expect(f.close).toHaveBeenCalledWith(false)
    } finally {
      f.app.unmount()
    }
  })
  test('keyboard handle preserves same-name tags, boundaries and save locks without visible move buttons', async () => {
    const f = harness()
    const handles = () => f.all().filter((n) => n.props.class === 'member-drag-handle')
    const key = (index: number, value: string) =>
      handles()[index].props.onKeydown({ key: value, preventDefault: vi.fn() })
    try {
      f.props.settings.members[0].gameName = 'Same Synthetic'
      f.props.settings.members[0].tagLine = 'TAG_A'
      f.props.settings.members[1].gameName = 'Same Synthetic'
      f.props.settings.members[1].tagLine = 'TAG_B'
      await nextTick()
      key(0, 'ArrowUp')
      key(4, 'ArrowDown')
      key(1, 'ArrowUp')
      await nextTick()
      f.submit()
      const [submitted, complete] = f.save.mock.calls[0]
      expect(submitted.members.slice(0, 2).map((m: any) => m.tagLine)).toEqual(['TAG_B', 'TAG_A'])
      expect(submitted.members).toHaveLength(5)
      key(0, 'End')
      await nextTick()
      expect(handles().every((n) => n.props.disabled)).toBe(true)
      complete(submitted)
      await nextTick()
      expect(handles()[0].props['aria-label']).toContain('#TAG_B')
      expect(handles()[1].props['aria-label']).toContain('#TAG_A')
      key(0, 'End')
      await nextTick()
      expect(handles()[4].props['aria-label']).toContain('#TAG_B')
      key(4, 'Home')
      await nextTick()
      expect(handles()[0].props['aria-label']).toContain('#TAG_B')
      f.props.saving = true
      await nextTick()
      expect(handles().every((n) => n.props.disabled && !n.props.draggable)).toBe(true)
      expect(f.all().some((n) => n.props['data-member-move'])).toBe(false)
      expect(f.all().some((n) => n.props.title === '隐私与本地数据')).toBe(false)
    } finally {
      f.app.unmount()
    }
  })
  test('cancels a native drag on Escape, dragend or pending save and ignores external drops', async () => {
    const f = harness()
    const rows = () => f.all().filter((n) => n.props['data-member-row'] !== undefined)
    const handles = () => f.all().filter((n) => n.props.class === 'member-drag-handle')
    const transfer = {
      setData: vi.fn(),
      getData: () => String(rows()[0].props['data-member-row']),
      effectAllowed: '',
      dropEffect: ''
    }
    const drag = { dataTransfer: transfer, preventDefault: vi.fn() }
    try {
      const before = rows().map((n) => n.props['aria-label'])
      handles()[0].props.onDragstart(drag)
      rows()[0].props.onKeydown({
        key: 'Escape',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      })
      await rows()[1].props.onDrop(drag)
      handles()[0].props.onDragstart(drag)
      handles()[0].props.onDragend()
      await rows()[1].props.onDrop(drag)
      await rows()[1].props.onDrop({
        dataTransfer: { getData: () => 'external' },
        preventDefault: vi.fn()
      })
      await nextTick()
      expect(rows().map((n) => n.props['aria-label'])).toEqual(before)
      handles()[0].props.onDragstart(drag)
      f.submit()
      await nextTick()
      await rows()[1].props.onDrop(drag)
      expect(rows().map((n) => n.props['aria-label'])).toEqual(before)
      f.save.mock.calls[0][1](null)
      await nextTick()
      expect(handles()[0].props.draggable).toBe(true)
    } finally {
      f.app.unmount()
    }
  })
  test('previews native dragover before release but commits only on drop and restores cancelled previews', async () => {
    const f = harness()
    const rows = () => f.all().filter((n) => n.props['data-member-row'] !== undefined)
    const handles = () => f.all().filter((n) => n.props.class === 'member-drag-handle')
    const labels = () => rows().map((n) => n.props['aria-label'])
    const begin = () => {
      const key = String(rows()[0].props['data-member-row'])
      const event = {
        dataTransfer: { setData: vi.fn(), getData: () => key, effectAllowed: '', dropEffect: '' },
        preventDefault: vi.fn()
      }
      handles()[0].props.onDragstart(event)
      rows()[1].props.onDragover(event)
      return event
    }
    try {
      const original = labels()
      const event = begin()
      await nextTick()
      expect(labels()[0]).toContain('Member1#TESTONLY')
      expect(labels()[1]).toContain('Member0#TESTONLY')
      // Repeated dragover on the same animated target must not toggle back.
      rows()[0].props.onDragover(event)
      await nextTick()
      expect(labels()[0]).toContain('Member1#TESTONLY')
      expect(labels()[1]).toContain('Member0#TESTONLY')
      expect(f.save).not.toHaveBeenCalled()
      // A save during a preview must never acknowledge unconfirmed visual order.
      f.submit()
      expect(f.save.mock.calls[0][0].members).toEqual(fixture().members)
      f.save.mock.calls[0][1](null)
      await nextTick()
      expect(labels()).toEqual(original)
      begin()
      await nextTick()
      handles()[1].props.onDragend()
      await nextTick()
      expect(labels()).toEqual(original)
      begin()
      await nextTick()
      rows()[1].props.onKeydown({
        key: 'Escape',
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      })
      await nextTick()
      expect(labels()).toEqual(original)
      const confirmed = begin()
      await nextTick()
      // The source itself is now under the held pointer; it remains a valid drop target.
      await rows()[1].props.onDrop(confirmed)
      await nextTick()
      f.submit()
      expect(f.save.mock.calls[1][0].members.map((m: any) => m.gameName)).toEqual([
        'Member1',
        'Member0',
        'Member2',
        'Member3',
        'Member4'
      ])
      expect(event.preventDefault).toHaveBeenCalled()
    } finally {
      f.app.unmount()
    }
  })
  test('accepts move on internal dragenter and capture-phase child dragovers but rejects external or locked sessions', async () => {
    const f = harness()
    const list = () => f.all().find((n) => n.props.class === 'member-order-list')!
    const handle = () => f.all().find((n) => n.props.class === 'member-drag-handle')!
    const createEvent = (target: string) => ({
      target: { tagName: target },
      dataTransfer: { effectAllowed: '', dropEffect: 'none', setData: vi.fn() },
      preventDefault: vi.fn()
    })
    try {
      const external = createEvent('INPUT')
      list().props.onDragenterCapture(external)
      expect(external.preventDefault).not.toHaveBeenCalled()
      expect(external.dataTransfer.dropEffect).toBe('none')
      const start = createEvent('BUTTON')
      handle().props.onDragstart(start)
      expect(start.dataTransfer.effectAllowed).toBe('move')
      for (const target of ['INPUT', 'SVG', 'BUTTON', 'DIV']) {
        const entered = createEvent(target)
        list().props.onDragenterCapture(entered)
        list().props.onDragenter(entered)
        list().props.onDragoverCapture(entered)
        expect(entered.preventDefault).toHaveBeenCalledTimes(3)
        expect(entered.dataTransfer.dropEffect).toBe('move')
      }
      await nextTick()
      const deleteButton = f.control('NButton', (n) => n.props.type === 'error')
      expect(deleteButton.props.disabled).toBe(false)
      expect(deleteButton.props['aria-disabled']).toBe(true)
      const count = f.all().filter((n) => n.props['data-member-row'] !== undefined).length
      await deleteButton.props.onClick()
      await nextTick()
      expect(f.all().filter((n) => n.props['data-member-row'] !== undefined)).toHaveLength(count)
      f.props.saving = true
      await nextTick()
      const locked = createEvent('INPUT')
      list().props.onDragenterCapture(locked)
      list().props.onDragoverCapture(locked)
      expect(locked.preventDefault).not.toHaveBeenCalled()
      expect(locked.dataTransfer.dropEffect).toBe('none')
      expect(handle().props.disabled).toBe(true)
    } finally {
      f.app.unmount()
    }
  })
  test('the ordinary enable/reference switches have accessible names', () => {
    const f = harness()
    try {
      expect(
        f.control('NSwitch', (n) => n.props['aria-label'] === '启用成员分析').props.value
      ).toBe(true)
      expect(
        f.control('NSwitch', (n) => n.props['aria-label'] === 'OP.GG 公共参考数据')
      ).toBeDefined()
    } finally {
      f.app.unmount()
    }
  })
  test('defaults the LP experiment off in an older settings draft and explicitly saves the selected flag', async () => {
    const f = harness()
    try {
      const flag = f.control(
        'NSwitch',
        (n) => n.props['aria-labelledby'] === 'experimental-lp-trend-label'
      )
      expect(flag.props.value).toBe(false)
      flag.props['onUpdate:value'](true)
      await nextTick()
      f.submit()
      expect(f.save).toHaveBeenCalledTimes(1)
      expect(f.save.mock.calls[0][0].experimentalLpTrendEnabled).toBe(true)
    } finally {
      f.app.unmount()
    }
  })
  test('defaults the version trend experiment off in an older settings draft and explicitly saves the selected flag', async () => {
    const f = harness()
    try {
      const flag = f.control(
        'NSwitch',
        (n) => n.props['aria-labelledby'] === 'experimental-version-trend-label'
      )
      expect(flag.props.value).toBe(false)
      flag.props['onUpdate:value'](true)
      await nextTick()
      f.submit()
      expect(f.save).toHaveBeenCalledTimes(1)
      expect(f.save.mock.calls[0][0].experimentalVersionTrendEnabled).toBe(true)
    } finally {
      f.app.unmount()
    }
  })

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
