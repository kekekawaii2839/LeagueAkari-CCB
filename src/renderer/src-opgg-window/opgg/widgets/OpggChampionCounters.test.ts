// sort-imports-ignore
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { beforeEach, expect, test, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref } from 'vue'
import Counters from './OpggChampionCounters.vue'

function snapshot() {
  const heroes = [
    { champion_id: 24, win: 40, play: 100, lane_kill_rate: 0.2 as number | null },
    { champion_id: 39, win: 48, play: 100, lane_kill_rate: 0.8 as number | null },
    { champion_id: 777, win: 49, play: 100, lane_kill_rate: null as number | null },
    { champion_id: 86, win: 60, play: 100, lane_kill_rate: 0.1 as number | null },
    { champion_id: 55, win: 70, play: 100, lane_kill_rate: 0.5 as number | null },
    { champion_id: 99, win: 10, play: 100, lane_kill_rate: 0 as number | null }
  ]
  return {
    data: {
      summary: { id: 266, positions: [{ name: 'TOP', counters: heroes.slice(0, 3) }] },
      counters: heroes
    },
    meta: { version: '16.22' }
  }
}
const context = {
  champion: ref<ReturnType<typeof snapshot> | null>(snapshot()),
  matchupChampionId: ref<number | null>(null),
  position: ref('top'),
  mode: ref('ranked'),
  region: ref('global'),
  tier: ref('emerald_plus'),
  effectiveSource: ref('opgg'),
  isLoading: ref(false),
  setTab: vi.fn()
}
const load = vi.fn<(...args: any[]) => Promise<any>>(() => {
  throw new Error('Switches must not request matchup data')
})
const pool = {
  championIds: ref(new Set<number>()),
  status: ref('ready'),
  role: ref<string | undefined>(undefined),
  refresh: vi.fn()
}
vi.mock('./champion-pool-controller', () => ({ useChampionPool: () => pool }))
vi.mock('../context', () => ({ useOpgg: () => context }))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => ({ loadLaneKillRate: load }) }))
vi.mock('@renderer-shared/shards/champion-data', () => ({ ChampionDataRenderer: class {} }))
vi.mock('@renderer-shared/components/LcuImage.vue', () => ({ default: () => null }))
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({
  NButton: {
    setup(_: any, { slots, attrs }: any) {
      return () => h('button', attrs, slots.default?.())
    }
  },
  useThemeVars: () =>
    ref({
      baseColor: '#FFF',
      successColorPressed: '#008000',
      errorColor: '#ff8080',
      errorColorPressed: '#ff0000'
    }),
  NSwitch: {
    props: ['value', 'disabled'],
    emits: ['update:value'],
    setup(props: any, { slots, emit }: any) {
      return () =>
        h(
          'button',
          {
            disabled: props.disabled,
            onClick: () => {
              if (!props.disabled) emit('update:value', !props.value)
            }
          },
          props.value ? slots.checked?.() : slots.unchecked?.()
        )
    }
  }
}))
const descriptor = parse(
  readFileSync(new URL('./OpggChampionCounters.vue', import.meta.url), 'utf8')
).descriptor
Counters.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'opgg-counters' }).bindings
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
  const app = renderer.createApp(Counters)
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

const rates = (f: ReturnType<typeof harness>) => f.text().match(/\d+\.\d+%|—/g) ?? []
const toggle = async (
  f: ReturnType<typeof harness>,
  label: 'counterMetric' | 'counterScope' | 'onlyPool'
) => {
  f.all()
    .find((n) => n.type === 'button' && n.props['aria-label'] === `opgg.champion.${label}`)!
    .props.onClick()
  await nextTick()
}
beforeEach(() => {
  pool.championIds.value = new Set()
  pool.role.value = undefined
  pool.status.value = 'ready'
  load.mockReset().mockImplementation(() => {
    throw Error('Completed switches must not request data')
  })
  context.setTab.mockClear()
  context.champion.value = snapshot()
  context.position.value = 'top'
  context.isLoading.value = false
  context.matchupChampionId.value = null
})
test('switches every completed view immediately without requests, partial values or gradual reordering', async () => {
  const f = harness()
  try {
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    await toggle(f, 'counterMetric')
    expect(rates(f)).toEqual(['20.00%', '10.00%', '0.00%'])
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(['80.00%', '50.00%', '20.00%', '10.00%', '0.00%', '—'])
    await toggle(f, 'counterMetric')
    expect(rates(f)).toEqual(['70.00%', '60.00%', '49.00%', '48.00%', '40.00%', '10.00%'])
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    for (let i = 0; i < 3; i++) {
      await toggle(f, 'counterScope')
      await toggle(f, 'counterMetric')
      await toggle(f, 'counterScope')
      await toggle(f, 'counterMetric')
    }
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    expect(load).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})
test('changes the unfavorable identity set with the metric and keeps clicks attached to sorted heroes', async () => {
  const f = harness()
  try {
    await toggle(f, 'counterMetric')
    f.all()
      .find((n) => n.type === 'div' && n.props.onClick)!
      .props.onClick()
    expect(context.setTab).toHaveBeenLastCalledWith('champion', 24)
    await toggle(f, 'counterScope')
    f.all()
      .find((n) => n.type === 'div' && n.props.onClick)!
      .props.onClick()
    expect(context.setTab).toHaveBeenLastCalledWith('champion', 39)
  } finally {
    f.dispose()
  }
})
test('shows an empty unfavorable view for no observed lane disadvantages without losing either switch', async () => {
  for (const c of context.champion.value!.data.counters)
    c.lane_kill_rate = c.champion_id === 777 ? null : 0.5
  const f = harness()
  try {
    await toggle(f, 'counterMetric')
    expect(rates(f)).toEqual([])
    expect(f.text()).toContain('opgg.champion.noLaneKillDisadvantages')
    expect(f.all().filter((n) => n.type === 'button')).toHaveLength(2)
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(['50.00%', '50.00%', '50.00%', '50.00%', '50.00%', '—'])
    expect(
      f
        .all()
        .filter((n) => n.props.style && 'color' in n.props.style)
        .every((n) => n.props.style.color === undefined)
    ).toBe(true)
  } finally {
    f.dispose()
  }
})
test('retains the completed snapshot during reload and atomically replaces every precomputed combination', async () => {
  const f = harness()
  try {
    await toggle(f, 'counterMetric')
    await toggle(f, 'counterScope')
    context.isLoading.value = true
    await nextTick()
    const previous = rates(f)
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(previous)
    expect(
      f
        .all()
        .filter((n) => n.type === 'button')
        .every((n) => n.props.disabled)
    ).toBe(true)
    const next = snapshot()
    for (const c of next.data.counters) c.lane_kill_rate = c.champion_id === 777 ? null : 0.4
    next.data.summary.positions[0].counters = [next.data.counters[3]]
    context.champion.value = next
    context.isLoading.value = false
    await nextTick()
    expect(rates(f)).toEqual(['40.00%', '40.00%', '40.00%', '40.00%', '40.00%', '—'])
    await toggle(f, 'counterScope')
    expect(rates(f)).toHaveLength(5)
    await toggle(f, 'counterMetric')
    expect(rates(f)).toEqual(['60.00%'])
    expect(load).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

test('does not confuse wholly unavailable lane rates with an observed absence of disadvantages', async () => {
  for (const c of context.champion.value!.data.counters) c.lane_kill_rate = null
  const f = harness()
  try {
    await toggle(f, 'counterMetric')
    expect(f.text()).toContain('opgg.champion.laneKillUnavailable')
    expect(rates(f)).toEqual([])
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(['—', '—', '—', '—', '—', '—'])
  } finally {
    f.dispose()
  }
})

test('pool filtering preserves existing metric values, ordering and champion navigation', async () => {
  pool.role.value = 'TOP'
  pool.championIds.value = new Set([24, 39, 55, 123, 266])
  const f = harness()
  try {
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    await toggle(f, 'onlyPool')
    expect(rates(f)).toEqual(['40.00%', '48.00%'])
    expect(f.text()).toContain('opgg.champion.poolMatchupMissing')
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(['70.00%', '48.00%', '40.00%'])
    f.all()
      .find((n) => n.type === 'div' && n.props.onClick)!
      .props.onClick()
    expect(context.setTab).toHaveBeenLastCalledWith('champion', 55)
    await toggle(f, 'counterMetric')
    expect(rates(f)).toEqual(['80.00%', '50.00%', '20.00%'])
    await toggle(f, 'onlyPool')
    expect(rates(f)).toEqual(['80.00%', '50.00%', '20.00%', '10.00%', '0.00%', '—'])
    expect(load).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

test('pool updates and role changes apply without changing the source snapshot; clearing restores normal view', async () => {
  pool.role.value = 'TOP'
  pool.championIds.value = new Set([24])
  const f = harness()
  try {
    await toggle(f, 'onlyPool')
    expect(rates(f)).toEqual(['40.00%'])
    pool.championIds.value = new Set([777])
    await nextTick()
    expect(rates(f)).toEqual(['49.00%'])
    pool.championIds.value = new Set([55])
    await nextTick()
    expect(rates(f)).toEqual([])
    expect(f.text()).toContain('opgg.champion.poolNoMatches')
    await toggle(f, 'counterScope')
    expect(rates(f)).toEqual(['70.00%'])
    pool.championIds.value = new Set()
    await nextTick()
    expect(rates(f)).toHaveLength(6)
    expect(f.text()).not.toContain('opgg.champion.poolNotConfigured')
    expect(f.text()).not.toContain('opgg.champion.poolLoading')
    expect(f.text()).not.toContain('opgg.champion.poolUnavailable')
    pool.status.value = 'loading'
    await nextTick()
    expect(f.text()).toContain('opgg.champion.poolLoading')
    pool.status.value = 'error'
    await nextTick()
    expect(f.text()).toContain('opgg.champion.poolUnavailable')
    expect(rates(f)).toHaveLength(6)
  } finally {
    f.dispose()
  }
})

test('missing rates load only after metric selection, without blocking the hero details or changing win-rate data', async () => {
  for (const counter of context.champion.value!.data.counters)
    Reflect.deleteProperty(counter, 'lane_kill_rate')
  let release!: (value: unknown) => void
  load.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  const f = harness()
  try {
    expect(load).not.toHaveBeenCalled()
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    await toggle(f, 'counterMetric')
    expect(load).toHaveBeenCalledTimes(3)
    expect(context.isLoading.value).toBe(false)
    expect(f.text()).toContain('opgg.champion.laneKillLoading')
    expect(f.text()).not.toContain('opgg.champion.laneKillUnavailable')
    const signals = load.mock.calls.map((call: any) => call[3].signal)
    await toggle(f, 'counterMetric')
    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    release({ status: 'success', effectiveSource: 'opgg', data: 0.9 })
    await flushPromises()
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
  } finally {
    f.dispose()
  }
})
test('failed lazy enrichment keeps all win values and a retry action, then recovers atomically', async () => {
  for (const counter of context.champion.value!.data.counters)
    Reflect.deleteProperty(counter, 'lane_kill_rate')
  load.mockRejectedValue(new Error('offline'))
  const f = harness()
  try {
    await toggle(f, 'counterMetric')
    await flushPromises()
    expect(f.text()).toContain('opgg.champion.laneKillPartial')
    expect(context.isLoading.value).toBe(false)
    load.mockResolvedValue({ status: 'success', effectiveSource: 'opgg', data: 0.2 })
    f.all()
      .find(
        (n) =>
          n.type === 'button' && n.children.some((child) => child.text === 'opgg.filters.refresh')
      )!
      .props.onClick()
    await flushPromises()
    expect(f.text()).not.toContain('opgg.champion.laneKillPartial')
    expect(rates(f)).toEqual(['20.00%', '20.00%', '20.00%', '20.00%', '20.00%', '20.00%'])
    const calls = load.mock.calls.length
    await toggle(f, 'counterMetric')
    expect(rates(f)).toEqual(['40.00%', '48.00%', '49.00%'])
    await toggle(f, 'counterMetric')
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(calls)
  } finally {
    f.dispose()
  }
})
