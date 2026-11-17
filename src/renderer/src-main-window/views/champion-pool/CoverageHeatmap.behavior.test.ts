// sort-imports-ignore
import '../member-analysis/test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick } from 'vue'
import CoverageHeatmap from './CoverageHeatmap.vue'
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({ t: (key: string, args: unknown) => key + ' ' + JSON.stringify(args) })
}))
vi.mock('./CoverageCellDetails.vue', () => ({
  default: {
    props: ['champion', 'target', 'cell', 'ownRole', 'patch', 'fetchedAt'],
    setup:
      (props: any, { attrs }: any) =>
      () =>
        h('cell-details', { ...props, ...attrs })
  }
}))
vi.mock('naive-ui', () => ({
  NPopover: {
    props: ['show'],
    setup: (props: any, { slots, expose }: any) => {
      expose({ syncPosition: () => {} })
      return () => h('popover', props, props.show ? slots.default?.() : [])
    }
  },
  useThemeVars: () => ({
    value: { successColor: '#22aa55', errorColor: '#dd3344', bodyColor: '#ffffff' }
  })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
const descriptor = parse(
  readFileSync(new URL('./CoverageHeatmap.vue', import.meta.url), 'utf8')
).descriptor
CoverageHeatmap.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'coverage-test' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)
type Node = {
  type: string
  text: string
  props: Record<string, any>
  children: Node[]
  parent: Node | null
  focus: () => void
}
const node = (type: string): Node => ({
  type,
  text: '',
  props: {},
  children: [],
  parent: null,
  focus: () => {}
})

test('clicking a cell opens structured details without hover text or a footer line', async () => {
  const renderer = createRenderer<Node, Node>({
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
    }
  })

  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(CoverageHeatmap, {
        champions: [{ id: 1, name: 'Synthetic A' }],
        targets: [
          {
            championId: 2,
            name: 'Synthetic B',
            role: 'TOP',
            mode: 'matchup',
            pickRate: 0.1,
            status: 'complete',
            cells: [{ championId: 1, state: 'available', deltaPp: 2, games: 100 }]
          }
        ] as any,
        ownRole: 'MID',
        patch: '16.22',
        fetchedAt: '2026-11-16T00:00:00.000Z',
        resolveName: (_id: number, fallback: string) => fallback
      })
  })
  app.provide(Vue.ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
  try {
    const button = walk(root).find((n) => n.type === 'button')!
    const description = button.props['aria-label']
    expect(description).toContain('Synthetic A')
    expect(description).toContain('Synthetic B')
    expect(button.props.title).toBeUndefined()
    expect(button.props['aria-expanded']).toBe(false)
    const focus = vi.fn()
    await button.props.onClick({
      currentTarget: {
        getBoundingClientRect: () => ({ left: 10, bottom: 20 }),
        isConnected: true,
        focus
      }
    })
    await nextTick()
    expect(button.props['aria-pressed']).toBe(true)
    expect(button.props['aria-label']).toBe(description)
    expect(button.props['aria-expanded']).toBe(true)
    const panel = walk(root).find((n) => n.type === 'cell-details')!
    expect(panel.props.cell).toMatchObject({ games: 100, deltaPp: 2 })
    expect(panel.props.ownRole).toBe('MID')
    panel.props.onClose()
    await nextTick()
    expect(button.props['aria-expanded']).toBe(false)
    expect(focus).toHaveBeenCalled()
    expect(walk(root).some((n) => n.type === 'cell-details')).toBe(false)
    expect(walk(root).some((n) => n.type === 'p' || n.props.role === 'status')).toBe(false)
  } finally {
    app.unmount()
  }
})
