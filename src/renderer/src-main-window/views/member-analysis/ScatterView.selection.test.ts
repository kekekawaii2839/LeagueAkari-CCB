// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { createPinia, setActivePinia } from 'pinia'
import ts from 'typescript'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import ScatterView from './ScatterView.vue'

const data = vi.hoisted(() => ({
  roles: null as any,
  matches: null as any,
  table: null as any,
  matchCalls: 0,
  groupCalls: 0,
  fitModels: [] as any[],
  formatCalls: [] as { value: unknown; format: string | undefined }[]
}))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ roles: data.roles, games: ref([]) })
}))
vi.mock('./scatter-analysis', async (original) => ({
  ...(await original<object>()),
  matchScatterRows: () => {
    data.matchCalls++
    return data.matches.value
  }
}))
vi.mock('./metric-defs', async (original) => {
  const actual = await original<typeof import('./metric-defs')>()
  return {
    ...actual,
    formatMetric: (value: unknown, format?: import('./metric-defs').MetricFormat) => {
      data.formatCalls.push({ value, format })
      return actual.formatMetric(value, format)
    }
  }
})
vi.mock('./visualization', async (original) => {
  const actual = await original<typeof import('./visualization')>()
  return {
    ...actual,
    groupScatterPoints: (...args: Parameters<typeof actual.groupScatterPoints>) => {
      data.groupCalls++
      return actual.groupScatterPoints(...args)
    }
  }
})
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('./ScatterFitSummary.vue', () => ({
  default: (props: any) => {
    data.fitModels = props.models
    return null
  }
}))
vi.mock('./ScatterExactTable.vue', () => ({
  default: (props: any) => {
    data.table = props
    return null
  }
}))
vi.mock('naive-ui', () => ({
  NSelect: () => null,
  NSwitch: () => null,
  NCheckbox: () => null,
  NInputNumber: (props: any) =>
    h('input', {
      type: 'number',
      value: props.value,
      min: props.min,
      step: props.step,
      'aria-label': props['aria-label'],
      onInput: (event: { target: { value: string } }) =>
        props['onUpdate:value']?.(event.target.value === '' ? null : Number(event.target.value))
    }),
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
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'scatter-selection' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
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
const windowHost = () => Object.assign(new EventTarget(), { innerWidth: 1416, innerHeight: 834 })
function harness(match = false, active = ref(true), layout?: (n: HostNode) => HostNode) {
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
    createElement: (type) => {
      // The ordinary custom-host cases retain their SSR dimension path. Attach
      // real window events when host nodes mount, before onMounted registers.
      // The explicit native-geometry case supplies this host before setup.
      if (typeof window === 'undefined') vi.stubGlobal('window', windowHost())
      const element = node(type)
      return layout ? layout(element) : element
    },
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
      // SVG tabindex is a DOM attribute: numeric bindings serialize to text.
      // Keep callbacks, booleans and every other host prop in their real form.
      if (key === 'tabindex') {
        if (value === null || value === undefined) delete n.props[key]
        else n.props[key] = String(value)
      } else n.props[key] = value
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
    app = renderer.createApp({ render: () => h(ScatterView, { active: active.value }) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = () => {
    const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  const select = async (index: number) => {
    const point = all().filter((n) => n.props.role === 'button')[index]
    point.props.onClick({ currentTarget: point })
    await nextTick()
  }
  const selected = (index: number) => !!data.table['row-class-name'](data.table.rows[index])
  return { store, all, select, selected, dispose: () => app.unmount() }
}
describe('real scatter component selection survives readable reloads', () => {
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    setActivePinia(createPinia())
    data.formatCalls = []
    data.roles = ref([row('Synthetic A', 0), row('Synthetic B', 1)])
    data.matches = ref([row('Synthetic A', 0, 101), row('Synthetic B', 1, 102)])
  })
  test('native first SVG waits for actual table geometry without grouping at provisional dimensions', async () => {
    const frames: FrameRequestCallback[] = []
    let notifyMutation = () => {}
    vi.stubGlobal(
      'MutationObserver',
      class {
        constructor(callback: () => void) {
          notifyMutation = callback
        }
        observe() {}
        disconnect() {}
      }
    )
    let width = 661
    const header = { offsetHeight: 0, isConnected: true }
    const rowGeometry = { offsetHeight: 0, isConnected: true }
    vi.stubGlobal('window', windowHost())
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('getComputedStyle', () => ({ rowGap: '12', paddingTop: '0', paddingBottom: '0' }))
    const layout = (element: HostNode) =>
      Object.assign(element, {
        clientHeight: 345,
        clientWidth: 661,
        closest: (selector: string) => (selector === '.member-analysis-scroll' ? element : null),
        querySelector: (selector: string) =>
          selector === '.n-data-table-thead'
            ? header
            : selector === '.n-data-table-tbody > tr'
              ? rowGeometry
              : null
      })
    data.groupCalls = 0
    const host = harness(true, ref(true), layout)
    const svg = () => host.all().filter((n) => n.type === 'svg' && n.props.role === 'img')
    try {
      expect(data.groupCalls).toBe(0)
      frames.shift()!(0)
      await nextTick()
      expect(svg()).toHaveLength(0)
      expect(data.groupCalls).toBe(0)
      // The virtual table mounts its first real data row after the initial budget.
      header.offsetHeight = 33
      rowGeometry.offsetHeight = 38
      notifyMutation()
      frames.shift()!(1)
      await nextTick()
      await nextTick()
      expect(svg()).toHaveLength(1)
      expect(data.groupCalls).toBe(1)
      const formats = data.formatCalls.length
      width = 800
      for (const element of host.all()) Object.assign(element, { clientWidth: width })
      notifyMutation()
      frames.shift()!(2)
      await nextTick()
      expect(svg()).toHaveLength(1)
      expect(svg()[0].props.viewBox).toContain('800')
      expect(data.formatCalls).toHaveLength(formats)
    } finally {
      host.dispose()
      vi.unstubAllGlobals()
    }
  })
  test('point copy reuses values only within the current records and metric precision', async () => {
    data.matches.value = Array.from({ length: 30 }, (_, i) => row(`Member ${i}`, 0.123456, 100 + i))
    const host = harness(true)
    const point = () => host.all().find((n) => n.props.role === 'button')!
    const title = () => point().children.find((n) => n.type === 'title')!.text
    try {
      expect(title()).toContain('12.3%')
      expect(title()).toContain('负 0） 1')
      expect(point().props['aria-label']).toContain('负 0） 50.0%')
      expect(data.formatCalls.filter((call) => call.format === 'int')).toHaveLength(1)
      data.matches.value = [{ ...row('Latest record', 0.876543, 900), kda: 1.23456 }]
      await nextTick()
      expect(title()).toContain('Latest record')
      expect(title()).toContain('87.7%')
      expect(title()).not.toContain('Member 0')
      expect(data.formatCalls.filter((call) => call.format === 'int')).toHaveLength(2)
      host.store.scatterViewState.yMetric = 'kda'
      await nextTick()
      expect(title()).not.toContain('负 0）')
      expect(title()).toContain('1.23')
      expect(point().props['aria-label']).toContain('87.7%')
      data.matches.value = [{ ...row('Missing record', 1, 901), damageConversion: null }]
      await nextTick()
      expect(host.all().filter((n) => n.props.role === 'button')).toHaveLength(0)
      expect(data.table.rows[0].x).toBeNull()
      host.store.scatterViewState.yMetric = 'winRate'
      data.matches.value = [
        { ...row('Zero', 0, 910), winRate: 0 },
        { ...row('Negative zero', 1, 911), winRate: -0 },
        { ...row('Invalid', 2, 912), winRate: NaN }
      ]
      await nextTick()
      const titles = () =>
        host
          .all()
          .filter((n) => n.props.role === 'button')
          .map((n) => n.children.find((child) => child.type === 'title')!.text)
      expect(titles()).toHaveLength(2)
      expect(titles()[0]).toContain('负 0） 0')
      expect(titles()[1]).toContain('负 0） -0')
      data.matches.value = [...data.matches.value].reverse()
      await nextTick()
      expect(titles()[0]).toContain('Negative zero')
      expect(titles()[0]).toContain('负 0） -0')
      expect(titles()[1]).toContain('Zero')
    } finally {
      host.dispose()
    }
  })
  test('retains real single-match nodes and keyboard labels across member filtering and reorder', async () => {
    data.matches.value = [row('A|B', 0, 100), row('A', 1, 100), row('C', 2, 102)]
    const original = [...data.matches.value]
    const host = harness(true)
    const points = () => host.all().filter((n) => n.props.role === 'button')
    const plot = () => host.all().find((n) => n.type === 'svg' && n.props.role === 'img')!
    const label = () =>
      host
        .all()
        .find((n) => n.type === 'text' && String(n.props.class).includes('match-hover-label'))?.text
    try {
      const [first, middle, last] = points()
      await host.select(2)
      plot().props.onFocusin({ target: { closest: () => ({ getAttribute: () => '2' }) } })
      await nextTick()
      expect(label()).toBe('C')
      data.matches.value = [original[2], original[0]]
      await nextTick()
      expect(points()).toEqual([last, first])
      expect(last.props['data-scatter-point']).toBe(0)
      expect(last.props['aria-pressed']).toBe(true)
      expect(label()).toBe('C')
      expect(middle.isConnected).toBe(false)
      // The retained native node still uses the updated index for keyboard selection.
      for (const handler of [last.props.onKeydown].flat())
        handler({ key: 'Enter', preventDefault() {} })
      await nextTick()
      expect(last.props['aria-pressed']).toBe(false)
      data.matches.value = original
      await nextTick()
      expect(points()[0]).toBe(first)
      expect(points()[2]).toBe(last)
      expect(label()).toBe('C')
    } finally {
      host.dispose()
    }
  })
  test('ambiguous or invalid single-match identities keep distinct positional nodes and aggregates retain counts', async () => {
    data.matches.value = [row('Duplicate', 0, 100), row('Duplicate', 1, 100), row('No ID', 2, null)]
    const host = harness(true)
    const points = () => host.all().filter((n) => n.props.role === 'button')
    try {
      const original = [...points()]
      expect(new Set(original).size).toBe(3)
      data.matches.value = [...data.matches.value].reverse()
      await nextTick()
      expect(points()).toEqual(original)
      expect(points()[0].props['aria-label']).toContain('No ID')
      data.matches.value = [row('One', 0, 101), row('Two', 0, 102)]
      await nextTick()
      expect(points()).toHaveLength(1)
      expect(points()[0].type).toBe('g')
      expect(points()[0].children.some((n) => n.type === 'text' && n.text === '2')).toBe(true)
    } finally {
      host.dispose()
    }
  })
  test('match-only subdued identity colors remain shared by points and per-member fits', async () => {
    data.matches.value = ['Alpha', 'Beta'].flatMap((player, member) =>
      Array.from({ length: 12 }, (_, i) => ({
        ...row(player, i + member * 0.1, 1000 + member * 100 + i),
        winRate: (i + member) % 2
      }))
    )
    useMemberAnalysisStore().scatterViewState.perMember = true
    const host = harness(true)
    host.store.overview = {
      games: [{ gameId: 1000, players: [{ player: 'Alpha' }, { player: 'Beta' }] }]
    } as any
    await nextTick()
    const points = () => host.all().filter((n) => n.props.role === 'button')
    try {
      const colors = new Map(data.fitModels.map((model) => [model.player, model.color]))
      expect(colors.size).toBe(2)
      expect(new Set(colors.values()).size).toBe(2)
      for (const point of points()) {
        const player = point.props['aria-label'].includes('Alpha') ? 'Alpha' : 'Beta'
        expect(point.props.style.stroke).toBe(colors.get(player))
        expect(point.props.style.stroke).toContain('var(--scatter-match-neutral)')
      }
      expect(data.fitModels.some((model) => model.dash)).toBe(true)
      const first = points()[0]
      await host.select(0)
      expect(points()[0]).toBe(first)
      expect(first.props['aria-pressed']).toBe(true)
      expect(first.props.style.stroke).toBe(colors.get('Alpha'))
      // The user's request excludes aggregate members: no match tone is applied there.
      host.store.scatterViewState.matchMode = false
      await nextTick()
      expect(points()).toHaveLength(2)
      for (const point of points()) expect(point.props.style?.stroke).toBeUndefined()
    } finally {
      host.dispose()
    }
  })
  test('single match records keep native circle semantics while overlap groups retain their count and keyboard selection', async () => {
    const host = harness(true)
    try {
      const points = () => host.all().filter((n) => n.props.role === 'button')
      const key = async (point: HostNode, value: string) => {
        for (const handler of [point.props.onKeydown].flat())
          handler({ key: value, preventDefault() {} })
        await nextTick()
      }
      const first = points()[0]
      expect(first.type).toBe('circle')
      expect(first.props.tabindex).toBe('0')
      expect(first.props['aria-label']).toContain('Synthetic A')
      expect(first.children.filter((n) => n.type === 'title')).toHaveLength(1)
      expect(first.children.some((n) => n.type === 'circle')).toBe(false)
      await key(first, 'Enter')
      expect(host.selected(0)).toBe(true)
      await key(points()[0], ' ')
      expect(host.selected(0)).toBe(false)
      data.matches.value = [row('Synthetic A', 0, 101), row('Synthetic B', 0, 102)]
      await nextTick()
      const overlap = points()[0]
      expect(points()).toHaveLength(1)
      expect(overlap.type).toBe('g')
      expect(overlap.children.filter((n) => n.type === 'circle')).toHaveLength(2)
      expect(overlap.children.some((n) => n.type === 'text' && n.text === '2')).toBe(true)
      expect(overlap.children.find((n) => n.type === 'title')?.text).toContain('Synthetic B')
      await key(overlap, 'Enter')
      expect(host.selected(0)).toBe(true)
      expect(host.selected(1)).toBe(true)
      await host.select(0)
      expect(host.selected(0)).toBe(false)
    } finally {
      host.dispose()
    }
  })
  test('uses one pointer-transparent match label for pointer and keyboard focus without replacing points', async () => {
    data.matches.value = [row('A', 0, 101), row('B', 1, 102)]
    const host = harness(true)
    try {
      const plot = () => host.all().find((n) => n.type === 'svg' && n.props.role === 'img')!
      const labels = () =>
        host
          .all()
          .filter((n) => n.type === 'text' && String(n.props.class).includes('match-hover-label'))
      const point = host.all().find((n) => n.props.role === 'button')!
      const target = (index: number) => ({ closest: () => ({ getAttribute: () => String(index) }) })
      expect(labels()).toHaveLength(0)
      plot().props.onPointerover({ target: target(0) })
      await nextTick()
      expect(labels()).toHaveLength(1)
      expect(labels()[0].text).toBe('A')
      expect(labels()[0].props['aria-hidden']).toBe('true')
      expect(host.all().find((n) => n.props.role === 'button')).toBe(point)
      plot().props.onFocusin({ target: target(1) })
      plot().props.onPointerleave()
      await nextTick()
      expect(labels()).toHaveLength(1)
      expect(labels()[0].text).toBe('B')
      plot().props.onFocusout()
      await nextTick()
      expect(labels()).toHaveLength(0)
      expect(host.all().filter((n) => n.props.role === 'button')).toHaveLength(2)
      await host.select(1)
      expect(host.selected(1)).toBe(true)
    } finally {
      host.dispose()
    }
  })
  test('keeps retained plot nodes on unchanged return and refreshes hidden publications only on activation', async () => {
    const active = ref(true)
    const host = harness(true, active)
    try {
      await nextTick()
      const points = () => host.all().filter((n) => n.props.role === 'button')
      const first = points()[0]
      const rows = data.table.rows
      const calls = data.matchCalls
      active.value = false
      await nextTick()
      active.value = true
      await nextTick()
      expect(points()[0]).toBe(first)
      expect(data.table.rows).toBe(rows)
      active.value = false
      await nextTick()
      data.matches.value = [row('Latest synthetic', 9, 103)]
      await nextTick()
      expect(data.table.rows).toBe(rows)
      expect(points()).toHaveLength(2)
      expect(data.matchCalls).toBe(calls)
      active.value = true
      await nextTick()
      expect(data.table.rows).toHaveLength(1)
      expect(data.table.rows[0].player).toBe('Latest synthetic')
      expect(data.matchCalls).toBe(calls + 1)
      expect(points()).toHaveLength(1)
    } finally {
      host.dispose()
    }
  })
  test('remaps a valid selected member by identity rather than a stale array index', async () => {
    const host = harness()
    try {
      await host.select(0)
      expect(host.selected(0)).toBe(true)
      expect(host.all().some((n) => n.text.includes('已选'))).toBe(false)
      data.roles.value = [row('Synthetic B', 1), row('Synthetic A', 2)]
      await nextTick()
      expect(host.selected(0)).toBe(false)
      expect(host.selected(1)).toBe(true)
      data.roles.value = [row('Synthetic B', 1)]
      await nextTick()
      expect(host.selected(0)).toBe(false)
      expect(host.all().some((n) => n.props.role === 'status' && n.text.length > 0)).toBe(true)
      expect(host.all().some((n) => n.text.includes('已选'))).toBe(false)
    } finally {
      host.dispose()
    }
  })
  test('keeps selected match row through replacement without a detail entry, clearing ambiguity', async () => {
    const host = harness(true)
    try {
      await host.select(0)
      expect(host.selected(0)).toBe(true)
      expect(host.all().some((n) => n.props['aria-controls'])).toBe(false)
      host.store.overview = { ...host.store.overview! }
      data.matches.value = [row('Synthetic B', 1, 102), row('Synthetic A', 2, 101)]
      await nextTick()
      expect(host.selected(1)).toBe(true)
      data.matches.value = [...data.matches.value, row('Synthetic A', 3, 101)]
      await nextTick()
      expect(host.selected(1)).toBe(false)
      expect(host.selected(2)).toBe(false)
    } finally {
      host.dispose()
    }
  })
  test('keyboard point selection highlights every overlapping table record and toggles off', async () => {
    data.roles.value = [row('Synthetic A', 0), row('Synthetic B', 0)]
    const host = harness()
    try {
      const point = host.all().find((n) => n.props.role === 'button')!
      point.props.onKeydown[0]({ key: 'Enter', preventDefault() {}, currentTarget: point })
      await nextTick()
      expect(point.props['aria-pressed']).toBe(true)
      expect(host.selected(0)).toBe(true)
      expect(host.selected(1)).toBe(true)
      expect(data.table['selected-row-key']).toBe(data.table['row-key'](data.table.rows[0]))
      await host.select(0)
      expect(host.selected(0)).toBe(false)
      expect(host.selected(1)).toBe(false)
    } finally {
      host.dispose()
    }
  })
})
