// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { beforeEach, expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref } from 'vue'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import BanStatisticsView from './BanStatisticsView.vue'

const data = { games: ref<MemberAnalysisGame[]>([]) }
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({ champions: { name: (id: number) => `Hero ${id}` } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('naive-ui', () => ({
  ...Object.fromEntries(
    ['NButton', 'NInput', 'NPagination'].map((kind) => [
      kind,
      (props: any, { slots }: any) => h('control', { ...props, kind }, slots.default?.())
    ])
  ),
  NEmpty: (props: any, { slots }: any) => h('empty', {}, [props.description, slots.extra?.()])
}))
const descriptor = parse(
  readFileSync(new URL('./BanStatisticsView.vue', import.meta.url), 'utf8')
).descriptor
BanStatisticsView.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'ban-statistics' }).bindings
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
  focus: vi.fn()
})
function harness() {
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
  const app = renderer.createApp(BanStatisticsView)
  app.provide(Vue.ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
  return {
    all: () => walk(root),
    text: () =>
      walk(root)
        .map((n) => n.text)
        .join(' '),
    control: (kind: string) => walk(root).find((n) => n.props.kind === kind)!,
    dispose: () => app.unmount()
  }
}
const match = (own: number[] | null, enemy: number[] | null) =>
  ({ bans: { own, enemy } }) as MemberAnalysisGame
beforeEach(() => {
  data.games.value = []
})

test('shows valid match denominators, excludes missing sides, and changes banning team without changing data', async () => {
  data.games.value = [match([1, 2], [1]), match([2], null), match([], [])]
  const f = harness()
  try {
    expect(f.text()).toContain('有效 2/3 场')
    expect(f.text()).toContain('50.0%')
    expect(f.text()).toContain('1/2 场')
    expect(f.text()).toContain('未采集 1 场')
    expect(f.text()).not.toContain('统计口径')
    f.all()
      .find((n) => n.props.kind === 'NButton' && n.children.some((c) => c.text === '己方'))!
      .props.onClick()
    await nextTick()
    expect(f.text()).toContain('有效 3/3 场')
    expect(f.text()).toContain('66.7%')
    expect(f.text()).toContain('2/3 场')
    expect(data.games.value).toHaveLength(3)
  } finally {
    f.dispose()
  }
})

test('keeps observed zero-ban matches distinct from unavailable records', async () => {
  data.games.value = [match([], [])]
  const f = harness()
  try {
    expect(f.text()).toContain('有效对局未禁用英雄')
    expect(f.text()).not.toContain('0.0%')
    data.games.value = [match(null, null)]
    await nextTick()
    expect(f.text()).toContain('当前范围尚无可用禁用记录')
    expect(f.text()).not.toContain('0.0%')
  } finally {
    f.dispose()
  }
})

test('paginates ordered heroes, searches all pages and resets pagination for new conditions', async () => {
  data.games.value = [
    match(
      Array.from({ length: 18 }, (_, i) => i + 1),
      []
    )
  ]
  const f = harness()
  try {
    expect(f.all().filter((n) => n.type === 'tr' && n.parent?.type === 'tbody')).toHaveLength(15)
    f.control('NPagination').props['onUpdate:page'](2)
    await nextTick()
    expect(f.all().filter((n) => n.type === 'tr' && n.parent?.type === 'tbody')).toHaveLength(3)
    expect(f.text()).toContain('Hero 18')
    f.control('NInput').props['onUpdate:value']('Hero 2')
    await nextTick()
    expect(f.all().filter((n) => n.type === 'tr' && n.parent?.type === 'tbody')).toHaveLength(1)
    expect(f.text()).toContain('Hero 2')
    f.control('NInput').props['onUpdate:value']('not-a-hero')
    await nextTick()
    expect(f.text()).toContain('当前搜索没有匹配的英雄')
    const clear = f
      .all()
      .find(
        (n) => n.props.kind === 'NButton' && n.children.some((c) => c.text.includes('清除搜索'))
      )!
    clear.props.onClick()
    await nextTick()
    expect(f.all().filter((n) => n.type === 'tr' && n.parent?.type === 'tbody')).toHaveLength(15)
  } finally {
    f.dispose()
  }
})

test('sorts the displayed heroes with accessible headers and preserves sample counts', async () => {
  data.games.value = [match([1, 2], []), match([2], [])]
  const f = harness()
  try {
    const rows = () => f.all().filter((n) => n.type === 'tr' && n.parent?.type === 'tbody')
    const text = (n: Node): string => n.text + n.children.map(text).join(' ')
    expect(text(rows()[0])).toContain('Hero 2')
    const header = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('禁用场数：'))!
    header.props.onClick()
    await nextTick()
    expect(text(rows()[0])).toContain('Hero 1')
    expect(
      f.all().find((n) => n.type === 'th' && n.props['aria-sort'] === 'ascending')
    ).toBeTruthy()
    expect(f.text()).toContain('1/2 场')
    expect(f.text()).not.toContain('统计口径')
    expect(f.text()).not.toContain('与蓝方、红方无关')
    expect(f.text()).not.toContain('缓存')
  } finally {
    f.dispose()
  }
})
