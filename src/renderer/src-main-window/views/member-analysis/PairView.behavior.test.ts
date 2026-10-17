// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
import {
  createRenderer,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  reactive,
  ref,
  ssrContextKey
} from 'vue'
import { beforeEach, expect, test, vi } from 'vitest'
import PairView from './PairView.vue'
import MemberAnalysisSegments from './components/MemberAnalysisSegments.vue'
import { aggregatePairs } from './analytics'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { uiText } from './ui-text'
import { relatedRolePairs } from './combination-navigation'

vi.mock('naive-ui', () => ({
  NTabs: defineComponent({
    props: ['value'],
    emits: ['update:value'],
    setup(_props, { slots, emit }) {
      provide('segment-select', (value: string | number) => emit('update:value', value))
      return () => h('track', {}, slots.default?.())
    }
  }),
  NTab: defineComponent({
    props: ['name', 'tab', 'disabled'],
    setup(props, { attrs }) {
      const select = inject<(value: string | number) => void>('segment-select')!
      return () =>
        h(
          'button',
          { ...attrs, onClick: () => select(props.name) },
          typeof props.tab === 'function' ? props.tab() : props.tab
        )
    }
  }),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NPopover: () => null,
  NSelect: (props: any) => h('select-control', props),
  NRadioButton: () => null,
  NRadioGroup: () => null
}))
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => settings
}))
vi.mock('./SynergyHeroStats.vue', () => ({
  default: (props: any) => h('shared-hero-stats', props)
}))
vi.mock('./EvidenceMatchAction.vue', () => ({ default: () => h('removed-action') }))
vi.mock('./MemberAnalysisEvidenceTable.vue', () => ({ default: () => null }))
vi.mock('./MetricHelp.vue', () => ({ default: (props: any) => h('metric-help', props) }))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: defineComponent({
    props: ['position'],
    setup: (props) => () => h('position-icon', { 'data-position': props.position })
  })
}))
vi.mock('./WinRateInterval.vue', () => ({ default: () => null }))
const data = {
  games: ref<MemberAnalysisGame[]>([]),
  pairs: ref<ReturnType<typeof aggregatePairs>>([])
}
const settings = reactive({ overviewGeneration: 1, sampleSize: 20 })
beforeEach(() => {
  settings.sampleSize = 20
  Object.values(data).forEach((value) => {
    value.value = []
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
})
const descriptor = parse(
  readFileSync(new URL('./PairView.vue', import.meta.url), 'utf8')
).descriptor
PairView.render = new Function(
  'Vue',
  (
    await transformWithEsbuild(
      compile(descriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        expressionPlugins: ['typescript'],
        bindingMetadata: compileScript(descriptor, { id: 'pair-details' }).bindings
      }).code,
      'pair-template.ts',
      { loader: 'ts' }
    )
  ).code
)(Vue)
const segmentsDescriptor = parse(
  readFileSync(new URL('./components/MemberAnalysisSegments.vue', import.meta.url), 'utf8')
).descriptor
MemberAnalysisSegments.render = new Function(
  'Vue',
  compile(segmentsDescriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(segmentsDescriptor, { id: 'pair-segments' }).bindings
  }).code
)(Vue)
type Host = {
  type: string
  props: Record<string, any>
  text: string
  parent: Host | null
  children: Host[]
  scrollLeft: number
  focus: () => void
  closest: () => null
  querySelector: () => null
  querySelectorAll: () => Host[]
  getBoundingClientRect: () => { left: number; right: number }
}
const walk = (n: Host): Host[] => [n, ...n.children.flatMap(walk)]
function node(type: string): Host {
  const n: Host = {
    type,
    props: {},
    text: '',
    parent: null,
    children: [],
    scrollLeft: 0,
    focus() {},
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => walk(n).filter((x) => x.props.role === 'tab'),
    getBoundingClientRect: () => ({ left: 0, right: 500 })
  }
  return n
}
function harness(props: { linkedContext?: readonly [string, string] } = {}) {
  const renderer = createRenderer<Host, Host>({
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
    patchProp: (n, key, _old, value) => {
      n.props[key] = value
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = parent
      const i = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    }
  })
  const root = node('root')
  const open = vi.fn()
  const instance = ref<InstanceType<typeof PairView> | null>(null)
  const app = renderer.createApp({
    render: () => h(PairView, { ...props, ref: instance, 'onOpen-synergy': open })
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  return { root, app, open, instance, all: () => walk(root) }
}
test('expanded role pair retains linked member navigation and inline hero evidence without sample-query entry', async () => {
  vi.stubGlobal('document', { activeElement: null })
  const names = ['Synthetic + A#TEST_ONLY', 'Synthetic B#TEST_ONLY']
  const game = {
    gameId: 9001,
    win: true,
    side: 'Blue',
    players: names.map((player, i) => ({
      player,
      role: i === 0 ? 'TOP' : 'JUNGLE',
      champion: 'Gwen'
    }))
  } as MemberAnalysisGame
  data.games.value = [game, { ...game, gameId: 9002 }]
  data.pairs.value = aggregatePairs(data.games.value)
  const f = harness()
  try {
    const identityButtons = f.all().filter((n) => n.type === 'button' && n.props.title)
    expect(identityButtons.map((n) => n.props.title)).toEqual(names)
    expect(identityButtons.every((n) => n.props['aria-label'].includes(n.props.title))).toBe(true)
    const rowButton = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-expanded'] === false)!
    await rowButton.props.onClick({ currentTarget: rowButton, stopPropagation() {} })
    await nextTick()
    expect(f.all().find((n) => n.type === 'h3')?.text).toBe(names.join(' × '))
    const record = f.all().find((n) => n.props.class === 'ma-chart-note pair-detail-record')!
    const nodes = (node: Host): Host[] => [node, ...node.children.flatMap(nodes)]
    const text = (node: Host): string => node.text + node.children.map(text).join('')
    expect(
      nodes(record)
        .filter((n) => n.type === 'position-icon')
        .map((n) => n.props['data-position'])
    ).toEqual(['TOP', 'JUNGLE'])
    expect(text(record)).toContain('上野')
    const aggregate = data.pairs.value.find((row) => row.sideLabel === '总计')!
    expect(text(record)).toContain(
      uiText('synergyRecord', { wins: aggregate.wins, losses: aggregate.games - aggregate.wins })
    )
    expect(f.all().some((n) => n.text.includes(uiText('synergySharedGames', { count: 1 })))).toBe(
      false
    )
    expect(f.all().some((n) => n.type === 'removed-action')).toBe(false)
    expect(
      f
        .all()
        .some(
          (n) =>
            n.type === 'select-control' &&
            [uiText('evidenceMetricSelect'), uiText('evidenceSideSelect')].includes(
              n.props['aria-label']
            )
        )
    ).toBe(false)
    expect(f.all().some((n) => n.text === uiText('combinationRoleEvidenceNote'))).toBe(false)
    const help = f.all().find((n) => n.type === 'metric-help' && n.props.label === '小龙差 @ 15')
    expect(help?.props.definition).toContain('单位：条')
    const stats = f.all().find((n) => n.type === 'shared-hero-stats')?.props.stats
    expect(stats.total).toBe(2)
    expect(stats.members.map((member: { player: string }) => member.player)).toEqual(names)
    expect(stats.pairs[0].games).toBe(2)
    expect(
      f
        .all()
        .filter((n) => n.type === 'button' && n.props.title)
        .every((n) => !n.children.some((child) => child.type === 'small' && child.text === '上野'))
    ).toBe(true)
    const linked = f.all().find((n) => n.type === 'button' && n.props.disabled === false)!
    linked.props.onClick()
    expect(f.open).toHaveBeenCalledWith({
      pairType: 'upper_pair',
      pair: names.join(' + '),
      members: names
    })
  } finally {
    f.app.unmount()
  }
})

test('compact role-pair segments preserve keys, support keyboard selection and empty-filter switching', async () => {
  const f = harness()
  try {
    const tabs = () => f.all().filter((n) => n.props.role === 'tab')
    expect(tabs()).toHaveLength(3)
    const descendants = (node: Host): Host[] => [node, ...node.children.flatMap(descendants)]
    expect(
      tabs().map((tab) =>
        descendants(tab)
          .filter((n) => n.type === 'position-icon')
          .map((n) => n.props['data-position'])
      )
    ).toEqual([
      ['TOP', 'JUNGLE'],
      ['MIDDLE', 'JUNGLE'],
      ['BOTTOM', 'UTILITY']
    ])
    const text = (node: Host): string => node.text + node.children.map(text).join('')
    expect(tabs().map(text)).toEqual(['上野', '中野', '下辅'])
    expect(tabs().map((n) => n.props['aria-selected'])).toEqual([true, false, false])
    tabs()[2].props.onClick()
    await nextTick()
    expect(tabs().map((n) => n.props['aria-selected'])).toEqual([false, false, true])
    await tabs()[2].props.onKeydown({ key: 'Home', preventDefault() {} })
    await nextTick()
    expect(tabs().map((n) => n.props['aria-selected'])).toEqual([true, false, false])
    await tabs()[0].props.onKeydown({ key: 'ArrowRight', preventDefault() {} })
    await nextTick()
    expect(tabs().map((n) => n.props['aria-selected'])).toEqual([false, true, false])
  } finally {
    f.app.unmount()
  }
})

test('shared-game heading survives changing the comparison metric and returning', async () => {
  data.games.value = [
    {
      gameId: 9002,
      win: true,
      side: 'Blue',
      players: [
        { player: 'Synthetic A#TEST_ONLY', role: 'TOP', champion: 'Garen' },
        { player: 'Synthetic B#TEST_ONLY', role: 'JUNGLE', champion: 'Vi' }
      ]
    } as MemberAnalysisGame
  ]
  data.games.value.push({ ...data.games.value[0], gameId: 9003 })
  data.pairs.value = aggregatePairs(data.games.value)
  const f = harness()
  const text = (n: Host): string => n.text + n.children.map(text).join('')
  try {
    for (const metric of ['upperGold15', 'dragon15Diff', 'upperGold15']) {
      f.all()
        .find((n) => n.type === 'select-control' && n.props['aria-label'] === '组合比较指标')!
        .props['onUpdate:value'](metric)
      await nextTick()
      const headings = f
        .all()
        .filter((n) => n.type === 'th' && n.props.scope === 'col')
        .map(text)
      expect(headings.filter((label) => label.includes(uiText('synergyJointGames')))).toHaveLength(
        1
      )
      expect(headings.some((label) => /^场数/.test(label))).toBe(false)
    }
  } finally {
    f.app.unmount()
  }
})

test('role pairs apply each sample-window threshold before count, sorting and selected evidence', async () => {
  vi.stubGlobal('document', { activeElement: null })
  data.games.value = Array.from({ length: 5 }, (_, index) =>
    Array.from(
      { length: index + 1 },
      (_, gameIndex) =>
        ({
          gameId: index * 10 + gameIndex,
          win: true,
          side: 'Blue',
          players: [
            { player: `Synthetic A${index + 1}#TEST_ONLY`, role: 'TOP', champion: 'Garen' },
            { player: `Synthetic B${index + 1}#TEST_ONLY`, role: 'JUNGLE', champion: 'Vi' }
          ]
        }) as MemberAnalysisGame
    )
  ).flat()
  data.pairs.value = aggregatePairs(data.games.value)
  const original = structuredClone(Vue.toRaw(data.pairs.value))
  const f = harness()
  const identities = () => f.all().filter((n) => n.type === 'button' && n.props.title)
  try {
    expect(identities()).toHaveLength(8)
    expect(identities().some((n) => n.props.title.includes('A1#'))).toBe(false)
    const twoGames = identities().find((n) => n.props.title.includes('A2#'))!
    await twoGames.props.onClick({ currentTarget: twoGames, stopPropagation() {} })
    await nextTick()
    expect(f.all().some((n) => n.type === 'shared-hero-stats')).toBe(true)
    settings.sampleSize = 50
    await nextTick()
    expect(identities()).toHaveLength(6)
    expect(f.all().some((n) => n.type === 'shared-hero-stats')).toBe(false)
    expect(f.all().some((n) => n.text.includes(uiText('combinationSelectionUnavailable')))).toBe(
      false
    )
    settings.sampleSize = 200
    await nextTick()
    expect(identities()).toHaveLength(2)
    expect(identities()[0].props.title).toContain('A5#')
    expect(f.all().some((n) => n.text === '1 组')).toBe(true)
    expect(Vue.toRaw(data.pairs.value)).toEqual(original)
    settings.sampleSize = 20
    await nextTick()
    expect(identities()).toHaveLength(8)
    expect(f.all().some((n) => n.type === 'shared-hero-stats')).toBe(false)
  } finally {
    f.app.unmount()
  }
})

test('real navigation links without a games field retain only eligible aggregate populations', async () => {
  const members = ['Synthetic A#TEST_ONLY', 'Synthetic B#TEST_ONLY'] as const
  data.games.value = ['TOP', 'TOP', 'MIDDLE', 'MIDDLE', 'MIDDLE'].map(
    (role, index) =>
      ({
        gameId: 9100 + index,
        win: true,
        side: 'Blue',
        players: [
          { player: members[0], role, champion: 'Garen' },
          { player: members[1], role: 'JUNGLE', champion: 'Vi' }
        ]
      }) as MemberAnalysisGame
  )
  data.pairs.value = aggregatePairs(data.games.value)
  const links = relatedRolePairs(data.pairs.value, data.games.value, members)
  expect(links).toHaveLength(2)
  expect(links.every((link) => !('games' in link))).toBe(true)
  const f = harness({ linkedContext: members })
  const options = () =>
    f
      .all()
      .find(
        (n) =>
          n.type === 'select-control' && n.props['aria-label'] === uiText('combinationRelatedRoles')
      )?.props.options
  try {
    expect(options()).toHaveLength(2)
    await f.instance.value!.selectMembers(members)
    expect(f.all().find((n) => n.type === 'shared-hero-stats')?.props.stats.total).toBe(2)
    settings.sampleSize = 50
    await nextTick()
    expect(options()).toHaveLength(1)
    expect(JSON.parse(options()[0].value)[0]).toBe('mid_jg_pair')
    await f.instance.value!.selectMembers(members)
    expect(f.all().find((n) => n.type === 'shared-hero-stats')?.props.stats.total).toBe(3)
    settings.sampleSize = 100
    await nextTick()
    expect(options()).toBeUndefined()
    expect(f.all().some((n) => n.type === 'shared-hero-stats')).toBe(false)
  } finally {
    f.app.unmount()
  }
})
test('role-pair row cells toggle details once and preserve list/outer scroll when collapsing', async () => {
  vi.stubGlobal('document', { activeElement: null })
  const g = {
    gameId: 1,
    win: true,
    side: 'Blue',
    players: [
      { player: 'Synthetic A#TEST_ONLY', role: 'TOP', champion: 'Garen' },
      { player: 'Synthetic B#TEST_ONLY', role: 'JUNGLE', champion: 'Vi' }
    ]
  } as MemberAnalysisGame
  data.games.value = [g, { ...g, gameId: 2 }]
  data.pairs.value = aggregatePairs(data.games.value)
  const f = harness(),
    list = { scrollTop: 180, scrollLeft: 120 },
    outer = { scrollTop: 64, scrollLeft: 0 }
  try {
    const row = f.all().find((n) => n.type === 'tr' && n.props.onClick)!,
      button = f.all().find((n) => n.props.class === 'role-pair-select')!
    const focus = vi.fn()
    button.focus = focus
    const source = {
      matches: () => true,
      querySelector: () => button,
      closest: (selector: string) => (selector.includes('comparison-list') ? list : outer)
    }
    await row.props.onClick({ currentTarget: source, target: { closest: () => null } })
    await nextTick()
    expect(button.props['aria-expanded']).toBe(true)
    await row.props.onClick({ currentTarget: source, target: { closest: () => button } })
    await nextTick()
    expect(button.props['aria-expanded']).toBe(true)
    const view = f.all().find((n) => n.props.class === 'ma-panel ma-workspace pair-view')!
    view.getBoundingClientRect = () => {
      list.scrollTop += 64
      list.scrollLeft = 0
      outer.scrollTop += 64
      return { left: 0, right: 500 }
    }
    await row.props.onClick({ currentTarget: source, target: { closest: () => null } })
    await nextTick()
    expect(button.props['aria-expanded']).toBe(false)
    expect(list).toEqual({ scrollTop: 180, scrollLeft: 120 })
    expect(outer.scrollTop).toBe(64)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  } finally {
    f.app.unmount()
  }
})
