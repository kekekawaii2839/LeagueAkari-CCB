// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import ScatterView from './ScatterView.vue'

const data = vi.hoisted(() => ({ roles: null as any, matches: null as any, table: null as any }))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ roles: data.roles, games: ref([]) })
}))
vi.mock('./scatter-analysis', async (original) => ({
  ...(await original<object>()),
  matchScatterRows: () => data.matches.value
}))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('./ScatterFitSummary.vue', () => ({ default: () => null }))
vi.mock('./MemberAnalysisMetricTable.vue', () => ({
  default: (props: any) => {
    data.table = props
    return null
  }
}))
vi.mock('naive-ui', () => ({
  NSelect: () => null,
  NSwitch: () => null,
  NCheckbox: () => null,
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.())
}))

type HostNode = {
  type: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  text: string
  scrollIntoView: () => void
  focus: () => void
  closest: () => null
  querySelector: () => null
  querySelectorAll: () => HostNode[]
  isConnected: boolean
}
const node = (type: string): HostNode => ({
  type,
  props: {},
  children: [],
  parent: null,
  text: '',
  scrollIntoView() {},
  focus() {},
  closest: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  isConnected: true
})
const descriptor = parse(
  readFileSync(new URL('./ScatterView.vue', import.meta.url), 'utf8')
).descriptor
ScatterView.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'scatter-selection' }).bindings
  }).code
)(Vue)
const row = (player: string, x: number, gameId: number | null = null) => ({
  player,
  role: 'MIDDLE',
  games: 2,
  damageConversion: x,
  winRate: 0.5,
  gameId,
  date: '2026-01-01',
  champion: 'Synthetic',
  result: '胜'
})
function harness(match = false) {
  const store = useMemberAnalysisStore()
  store.scatterViewState.matchMode = match
  if (match)
    store.overview = {
      games: [
        { gameId: 101, players: [] },
        { gameId: 102, players: [] }
      ]
    } as any
  const renderer = createRenderer<HostNode, HostNode>({
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
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
      n.isConnected = false
    }
  })
  const root = node('root'),
    app = renderer.createApp({ render: () => h(ScatterView) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = () => {
    const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  const select = async (index: number) => {
    data.table.columns[0].render(data.table.rows[index]).props.onClick({ currentTarget: null })
    await nextTick()
  }
  const selected = (index: number) =>
    data.table.columns[0].render(data.table.rows[index]).props['aria-pressed']
  return { store, all, select, selected, dispose: () => app.unmount() }
}
describe('real scatter component selection survives readable reloads', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    data.roles = ref([row('Synthetic A', 0), row('Synthetic B', 1)])
    data.matches = ref([row('Synthetic A', 0, 101), row('Synthetic B', 1, 102)])
  })
  test('remaps a valid selected member by identity rather than a stale array index', async () => {
    const host = harness()
    try {
      await host.select(0)
      expect(host.selected(0)).toBe(true)
      data.roles.value = [row('Synthetic B', 1), row('Synthetic A', 2)]
      await nextTick()
      expect(host.selected(0)).toBe(false)
      expect(host.selected(1)).toBe(true)
      data.roles.value = [row('Synthetic B', 1)]
      await nextTick()
      expect(host.selected(0)).toBe(false)
      expect(host.all().some((n) => n.props.role === 'status' && n.text.length > 0)).toBe(true)
    } finally {
      host.dispose()
    }
  })
  test('keeps valid selected match and expanded detail through replacement, clearing true ambiguity', async () => {
    const host = harness(true)
    try {
      await host.select(0)
      const button = host.all().find((n) => n.type === 'button' && n.props['aria-controls'])!
      button.props.onClick({ currentTarget: button })
      await nextTick()
      expect(host.all().some((n) => n.props['aria-label'] === '对局 101 详情')).toBe(true)
      host.store.overview = { ...host.store.overview! }
      data.matches.value = [row('Synthetic B', 1, 102), row('Synthetic A', 2, 101)]
      await nextTick()
      expect(host.selected(1)).toBe(true)
      expect(host.all().some((n) => n.props['aria-label'] === '对局 101 详情')).toBe(true)
      host.store.overview = {
        ...host.store.overview!,
        games: [
          { gameId: 101, players: [] },
          { gameId: 101, players: [] }
        ]
      } as any
      data.matches.value = [...data.matches.value.map((r: any) => ({ ...r }))]
      await nextTick()
      expect(host.all().some((n) => n.props['aria-label'] === '对局 101 详情')).toBe(false)
    } finally {
      host.dispose()
    }
  })
})
