// sort-imports-ignore
import './test-i18n'
import type {
  MemberAnalysisGame,
  MemberAnalysisOverview,
  MemberAnalysisPlayerGame
} from '@shared/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ssrContextKey, shallowReactive } from 'vue'
import { expect, test, vi } from 'vitest'
import { transformWithEsbuild } from 'vite'
import MemberRoleComparison from './MemberRoleComparison.vue'
import EvidenceMatchAction from './EvidenceMatchAction.vue'
import MemberRoleView from './MemberRoleView.vue'
import ChampionPoolPopover from './ChampionPoolPopover.vue'
import { aggregateChampions } from './analytics'
import { roleMetricMeta } from './metric-defs'
import type { MatchEvidenceSelection } from './evidence-selection'
import { uiText } from './ui-text'
import { i18next } from '@renderer-shared/i18n'
const leagueFixture = vi.hoisted(() => ({
  gameData: null as {
    champions: Record<string, { id: number; alias: string; name: string }>
  } | null
}))
vi.mock('@renderer-shared/shards/league-client/store', async () => {
  const { reactive } = await import('vue')
  leagueFixture.gameData = reactive({ champions: {} })
  return { useLeagueClientStore: () => ({ gameData: leagueFixture.gameData }) }
})

vi.mock('naive-ui', () => ({
  useThemeVars: () => ({ fontFamily: 'system-ui, sans-serif' }),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NSelect: (props: any) => h('select', props),
  NTooltip: (props: any, { slots }: any) =>
    h('tooltip', props, [slots.trigger?.(), props.show ? slots.default?.() : null]),
  NRadioGroup: (props: any, { slots }: any) => h('radio-group', props, slots.default?.()),
  NRadioButton: (props: any, { slots }: any) => h('radio', props, slots.default?.()),
  NTabs: (props: any, { slots }: any) => h('segmented-tabs', props, slots.default?.()),
  NTab: (props: any) => h('segment', props, props.tab),
  NSwitch: (props: any) => h('switch', props),
  NIcon: () => null,
  NScrollbar: (props: any, { slots }: any) => h('scrollbar', props, slots.default?.())
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: (props: any) => h('position-icon', props)
}))
vi.mock('./MemberProfileAvatar.vue', () => ({
  default: (props: any) => h('profile-avatar', props)
}))
vi.mock('./WinRateInterval.vue', () => ({ default: (props: any) => h('rate-interval', props) }))
vi.mock('./LaneGankWindowBars.vue', () => ({ default: (props: any) => h('gank-bars', props) }))
vi.mock('./components/MemberAnalysisSegments.vue', () => ({
  default: {
    props: ['modelValue', 'options', 'ariaLabel', 'ariaControls'],
    emits: ['update:modelValue'],
    setup:
      (props: any, { emit }: any) =>
      () =>
        h('member-segments', {
          ...props,
          'onUpdate:modelValue': (value: string | number) => emit('update:modelValue', value)
        })
  }
}))
vi.mock('./MetricHelp.vue', () => ({ default: (props: any) => h('metric-help', props) }))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))

// Compile the actual SFC template for a synthetic Vue host (no native window,
// browser, filesystem data API, or copied production interaction logic).
const descriptor = parse(
  readFileSync(new URL('./MemberRoleComparison.vue', import.meta.url), 'utf8')
).descriptor
const compiledTemplate = compile(descriptor.template!.content, {
  mode: 'function',
  prefixIdentifiers: true,
  expressionPlugins: ['typescript'],
  bindingMetadata: compileScript(descriptor, { id: 'role-evidence-behavior' }).bindings
}).code
MemberRoleComparison.render = new Function(
  'Vue',
  (await transformWithEsbuild(compiledTemplate, 'role-template.ts', { loader: 'ts' })).code
)(Vue)
const actionDescriptor = parse(
  readFileSync(new URL('./EvidenceMatchAction.vue', import.meta.url), 'utf8')
).descriptor
EvidenceMatchAction.render = new Function(
  'Vue',
  compile(actionDescriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(actionDescriptor, { id: 'shared-evidence-behavior' }).bindings
  }).code
)(Vue)
const fullRoleDescriptor = parse(
  readFileSync(new URL('./MemberRoleView.vue', import.meta.url), 'utf8')
).descriptor
MemberRoleView.render = new Function(
  'Vue',
  (
    await transformWithEsbuild(
      compile(fullRoleDescriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        expressionPlugins: ['typescript'],
        bindingMetadata: compileScript(fullRoleDescriptor, { id: 'full-role-evidence' }).bindings
      }).code,
      'full-role-template.ts',
      { loader: 'ts' }
    )
  ).code
)(Vue)
const heroDescriptor = parse(
  readFileSync(new URL('./ChampionPoolPopover.vue', import.meta.url), 'utf8')
).descriptor
ChampionPoolPopover.render = new Function(
  'Vue',
  (
    await transformWithEsbuild(
      compile(heroDescriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        expressionPlugins: ['typescript'],
        bindingMetadata: compileScript(heroDescriptor, { id: 'hero-evidence' }).bindings
      }).code,
      'hero-template.ts',
      { loader: 'ts' }
    )
  ).code
)(Vue)
type Node = {
  type: string
  props: Record<string, any>
  text: string
  children: Node[]
  parent: Node | null
}
const node = (type: string): Node =>
  Object.assign(
    { type, props: {}, text: '', children: [], parent: null },
    {
      focus() {},
      querySelector() {
        return null
      },
      querySelectorAll() {
        return []
      }
    }
  )
function game(id: number, gd15: number | null, kp: number | null): MemberAnalysisGame {
  const row = {
    player: 'Synthetic A#TEST_ONLY',
    role: 'TOP',
    champion: 'Gwen',
    minutes: 30,
    kills: 0,
    deaths: 0,
    assists: 0,
    gd15,
    kp,
    damageShare: null,
    goldShare: null,
    fbPart: null,
    ftPart: null
  } as MemberAnalysisPlayerGame
  return {
    gameId: id,
    timestamp: id,
    date: '2026-01-01',
    duration: 1800,
    side: 'Blue',
    win: true,
    patch: '26.1',
    roster: '',
    players: [row],
    jungle: null,
    laneGankDeaths: null,
    eventDecision: null
  } as MemberAnalysisGame
}
function harness(games: MemberAnalysisGame[], shared = false, fullRole = false, hero = false) {
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
      n.parent = null
    }
  })
  const pinia = createPinia()
  const store = useMemberAnalysisStore(pinia)
  store.overview = { games, gameCount: games.length, firstRun: false } as MemberAnalysisOverview
  const root = node('root')
  const sharedProps = shallowReactive({
    evidence: {
      games,
      publishedGeneration: store.overviewGeneration,
      available: true,
      source: 'Synthetic · gd15',
      metricLabel: '15 分钟经济差'
    } as MatchEvidenceSelection
  })
  const fullRoleProps = shallowReactive({ active: true })
  const app = renderer.createApp({
    render: () =>
      shared
        ? h(EvidenceMatchAction, sharedProps)
        : hero
          ? h(ChampionPoolPopover, {
              pool: {
                key: 'synthetic-top',
                player: 'Synthetic A#TEST_ONLY',
                role: 'TOP',
                games: games.length,
                heroCount: 2,
                unidentifiedGames: 0,
                rows: aggregateChampions(games)
              },
              roleLabel: '上路',
              championId: () => -1,
              championName: (name) => name,
              initialChampion: 'Gwen',
              evidenceContext: {
                games,
                publishedGeneration: sharedProps.evidence.publishedGeneration
              }
            })
          : fullRole
            ? h(MemberRoleView, fullRoleProps)
            : h(MemberRoleComparison)
  })
  app.use(pinia)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = (): Node[] => {
    const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  const evidence = () => all().find((n) => n.type === 'button' && n.props.size === 'small')!
  return { app, store, all, evidence, sharedProps, fullRoleProps }
}

test('member chart retains identity and metrics without an expansion control', async () => {
  const f = harness([game(900001, 0, null), game(900002, -500, 0)])
  try {
    const before = JSON.stringify({ filters: f.store.filters, sample: f.store.sampleSize })
    const identities = f.all().filter((n) => n.props.class === 'member-identity')
    expect(identities).toHaveLength(1)
    expect(identities.every((n) => n.type === 'div' && !n.props.onClick)).toBe(true)
    expect(f.all().some((n) => n.props['aria-controls'])).toBe(false)
    expect(f.all().some((n) => n.props.class === 'member-detail')).toBe(false)
    expect(
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    ).not.toContain('↗')
    const selector = f.all().find((n) => n.type === 'select')!
    expect(selector.props.options).toEqual(
      expect.arrayContaining([
        { value: 'gd15', label: roleMetricMeta.gd15.label },
        { value: 'kp', label: roleMetricMeta.kp.label }
      ])
    )
    expect(selector.props.options).toHaveLength(23)
    selector.props['onUpdate:value']('kp')
    await nextTick()
    expect(f.store.matchNavigation).toBeNull()
    expect(JSON.stringify({ filters: f.store.filters, sample: f.store.sampleSize })).toBe(before)
  } finally {
    f.app.unmount()
  }
})

test('comparison units appear once in the existing help without an exposed toolbar unit', async () => {
  const f = harness([game(900065, 100, 0.5)])
  try {
    const select = () => f.all().find((n) => n.type === 'select')!
    const help = () => f.all().find((n) => n.type === 'metric-help')!
    const text = () =>
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    for (const { value } of select().props.options) {
      select().props['onUpdate:value'](value)
      await nextTick()
      const meta = roleMetricMeta[value]
      const expected = [meta.description ?? meta.label, meta.unit ? `（${meta.unit}）` : '']
        .filter(Boolean)
        .join(' · ')
      expect(help().props.definition).toBe(expected)
      if (meta.unit) {
        expect(help().props.definition.split(`（${meta.unit}）`)).toHaveLength(2)
        expect(text()).not.toContain(`（${meta.unit}）`)
      }
      if (value === 'gd15' || value === 'gpm') expect(text()).not.toContain('金币')
    }
  } finally {
    f.app.unmount()
  }
})

test.each([
  ['kp', 0.583, [80, 60, 40, 20, 0]],
  ['goldShare', 0.24, [30, 20, 10, 0]],
  ['damageShare', 0.27, [30, 20, 10, 0]],
  ['takenShare', 0.42, [60, 40, 20, 0]]
] as const)(
  'adapts %s on one nice zero-based scale including the highest side series',
  async (metric, maximum, ticks) => {
    const blue = game(900066, 0, 0.1)
    const red = { ...game(900067, 0, 0.1), side: 'Red' as const }
    Object.assign(blue.players[0], { [metric]: maximum })
    Object.assign(red.players[0], { [metric]: 0.1 })
    for (const sample of [blue, red])
      sample.players.push({ ...sample.players[0], player: 'Synthetic B#TEST_ONLY', [metric]: 0.2 })
    const f = harness([blue, red])
    try {
      f.all()
        .find((n) => n.type === 'select')!
        .props['onUpdate:value'](metric)
      await nextTick()
      const actualTicks = f
        .all()
        .filter((n) => String(n.props.class).split(' ').includes('axis-tick'))
        .map((n) =>
          Number(n.children.find((child) => child.type === 'span')!.text.replace('%', ''))
        )
      expect(actualTicks).toEqual(ticks)
      const plots = f.all().filter((n) => n.props.role === 'img' && n.props['data-series'])
      const highest = plots.find(
        (n) => n.props['data-series'] === '蓝方' && n.props['aria-label'].includes('Synthetic A')
      )!
      const bar = highest.children.find((n) =>
        String(n.props.class).split(' ').includes('plot-bar')
      )!
      expect(Number.parseFloat(bar.props.style.height)).toBeCloseTo(
        (maximum / (ticks[0] / 100)) * 100
      )
      for (const plot of plots) {
        const bar = plot.children.find((n) => String(n.props.class).split(' ').includes('plot-bar'))
        if (bar) {
          expect(Number.parseFloat(bar.props.style.height)).toBeGreaterThanOrEqual(0)
          expect(Number.parseFloat(bar.props.style.height)).toBeLessThanOrEqual(100)
        }
      }
      expect(ticks[0]).toBeLessThan(100)
      expect(ticks[0]).toBeGreaterThan(maximum * 100)
    } finally {
      f.app.unmount()
    }
  }
)

test.each([
  ['near 100%', 0.99, 100],
  ['all zero', 0, 10],
  ['all missing', null, 10]
] as const)('retains percentage boundary semantics for %s', async (_name, value, maximumTick) => {
  const f = harness([game(900068, 0, value)])
  try {
    f.all()
      .find((n) => n.type === 'select')!
      .props['onUpdate:value']('kp')
    await nextTick()
    const ticks = f
      .all()
      .filter((n) => String(n.props.class).split(' ').includes('axis-tick'))
      .map((n) => Number(n.children.find((child) => child.type === 'span')!.text.replace('%', '')))
    expect(ticks[0]).toBe(maximumTick)
    expect(ticks.at(-1)).toBe(0)
    expect(new Set(ticks).size).toBe(ticks.length)
    const bars = f.all().filter((n) => String(n.props.class).split(' ').includes('plot-bar'))
    if (value === null) {
      expect(bars).toHaveLength(0)
      expect(
        f.all().some((n) => n.props.role === 'img' && n.props['aria-label'].includes('—，0 场'))
      ).toBe(true)
    } else {
      expect(bars).toHaveLength(2)
      for (const bar of bars)
        expect(Number.parseFloat(bar.props.style.height)).toBeCloseTo(
          (value / (maximumTick / 100)) * 100
        )
    }
  } finally {
    f.app.unmount()
  }
})

test('win rate alone retains the fixed 0–100% scale even when every side is below 40%', async () => {
  const samples = Array.from({ length: 6 }, (_, index) => ({
    ...game(900070 + index, 0, 0.2),
    side: index < 3 ? ('Blue' as const) : ('Red' as const),
    win: index % 3 === 0
  }))
  const f = harness(samples)
  try {
    f.all()
      .find((n) => n.type === 'select')!
      .props['onUpdate:value']('winRate')
    await nextTick()
    const ticks = f
      .all()
      .filter((n) => String(n.props.class).split(' ').includes('axis-tick'))
      .map((n) => Number(n.children.find((child) => child.type === 'span')!.text.replace('%', '')))
    expect(ticks).toEqual([100, 75, 50, 25, 0])
  } finally {
    f.app.unmount()
  }
})

test('chart splits total/blue/red values with exact valid counts and missingness', async () => {
  const f = harness([game(900051, 100, 0.5), { ...game(900052, -300, null), side: 'Red' }])
  try {
    const plots = () => f.all().filter((n) => n.props['data-series'] && n.props.role === 'img')
    expect(plots().map((n) => n.props['data-series'])).toEqual(['合计', '蓝方', '红方'])
    expect(plots()[0].props['aria-label']).toContain('−100，2 场')
    expect(plots()[1].props['aria-label']).toContain('+100，1 场')
    expect(plots()[2].props['aria-label']).toContain('−300，1 场')
    f.all()
      .find((n) => n.type === 'select')!
      .props['onUpdate:value']('kp')
    await nextTick()
    expect(plots()[0].props['aria-label']).toContain('50.0%，1 场')
    expect(plots()[2].props['aria-label']).toContain('—，0 场')
    expect(plots()[2].children.some((n) => n.props.class === 'plot-bar')).toBe(false)
    expect(
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    ).not.toContain('场有效')
  } finally {
    f.app.unmount()
  }
})

test('hidden duplicate is rejected with nearby feedback, not expanded or scoped', async () => {
  const f = harness([game(900021, 0, 0), { ...game(900021, 10, 0.5), side: 'Red' }], true)
  try {
    f.store.analysisSide = 'Blue'
    await nextTick()
    f.sharedProps.evidence = { ...f.sharedProps.evidence, games: [f.store.overview!.games[0]] }
    await nextTick()
    f.evidence().props.onClick()
    await nextTick()
    expect(f.store.matchNavigation).toBeNull()
    expect(f.store.matchListScope).toBeNull()
    expect(f.all().find((n) => n.props.role === 'status')?.text).toContain('歧义')
  } finally {
    f.app.unmount()
  }
})

test('a previously rendered action cannot borrow a newer publication generation', async () => {
  const f = harness([game(900031, 0, 0)], true)
  try {
    const oldClick = f.evidence().props.onClick
    f.store.overview = { ...f.store.overview!, games: [game(900032, 100, 0.5)] }
    oldClick()
    expect(f.store.matchListScopeError).toBe('stale')
    expect(f.store.matchListScope).toBeNull()
    expect(f.store.matchNavigation).toBeNull()
    await nextTick()
    expect(f.evidence()).toBeDefined()
  } finally {
    f.app.unmount()
  }
})

test('publication and role changes do not revive removed chart member details', async () => {
  const f = harness([game(900035, 0, 0)])
  try {
    f.store.overview = { ...f.store.overview!, games: [game(900036, null, 0)] }
    await nextTick()
    expect(f.all().some((n) => n.props['aria-controls'] || n.props.class === 'member-detail')).toBe(
      false
    )
    f.all()
      .find((n) => n.type === 'button' && n.props['aria-pressed'] === false)!
      .props.onClick()
    await nextTick()
    expect(f.all().some((n) => n.props.role === 'status')).toBe(false)
    expect(f.store.matchNavigation).toBeNull()
  } finally {
    f.app.unmount()
  }
})

test('shared action captures its rendered metric payload and rejects old publication callbacks', async () => {
  const games = [game(900041, 0, 0), game(900042, 100, 0.5)]
  const f = harness(games, true)
  try {
    const oldClick = f.evidence().props.onClick
    f.sharedProps.evidence = {
      ...f.sharedProps.evidence,
      games: [games[1]],
      source: 'Synthetic · kp',
      metricLabel: '参团率'
    }
    await nextTick()
    oldClick()
    expect(f.store.matchListScope?.gameIds).toEqual([900041, 900042])
    expect(f.store.matchListScope?.source).toBe('Synthetic · gd15')
    f.evidence().props.onClick()
    expect(f.store.matchNavigation?.gameId).toBe(900042)
    const currentClick = f.evidence().props.onClick
    f.store.overview = { ...f.store.overview! }
    currentClick()
    expect(f.store.matchListScopeError).toBe('stale')
    expect(f.store.matchNavigation?.gameId).toBe(900042)
    await nextTick()
    expect(f.all().find((n) => n.props.role === 'status')?.text).toContain('已更新')
  } finally {
    f.app.unmount()
  }
})

test('evidence action omits normal right-hand copy but preserves unavailable reasons and navigation errors', async () => {
  const f = harness([game(900049, 0, 0)], true)
  try {
    const text = () =>
      f
        .all()
        .map((node) => node.text)
        .join(' ')
    expect(text()).not.toContain(
      uiText('evidenceCurrentMetricScope', { metric: f.sharedProps.evidence.metricLabel })
    )
    expect(f.evidence().props.disabled).toBe(false)
    f.sharedProps.evidence = { ...f.sharedProps.evidence, games: [], available: false }
    await nextTick()
    expect(f.evidence().props.disabled).toBe(true)
    expect(text()).toContain(uiText('evidenceMetricUnavailable'))
    f.sharedProps.evidence = {
      ...f.sharedProps.evidence,
      games: [game(900049, 0, 0)],
      available: true
    }
    await nextTick()
    f.store.overview = { ...f.store.overview! }
    f.evidence().props.onClick()
    await nextTick()
    expect(f.all().find((node) => node.props.role === 'status')?.text).toBe(
      uiText('scopeErrorStale')
    )
  } finally {
    f.app.unmount()
  }
})

test.each([
  ['zh-CN', '查看对应对局'],
  ['en', 'View supporting matches']
])(
  'evidence button has a fixed natural action label in %s without a match count',
  async (language, label) => {
    await i18next.changeLanguage(language)
    const games = Array.from({ length: 25 }, (_, index) => game(900100 + index, 0, 0))
    const f = harness(games, true)
    try {
      const textOf = (node: Node): string => node.text + node.children.map(textOf).join('')
      for (const count of [0, 1, 25]) {
        f.sharedProps.evidence = {
          ...f.sharedProps.evidence,
          games: games.slice(0, count),
          available: count > 0
        }
        await nextTick()
        expect(textOf(f.evidence()).trim()).toBe(label)
        expect(f.evidence().props.disabled).toBe(count === 0)
      }
      f.evidence().props.onClick()
      expect(f.store.matchListScope?.gameIds).toHaveLength(25)
      expect(f.store.matchNavigation).toBeNull()
    } finally {
      f.app.unmount()
      await i18next.changeLanguage('zh-CN')
    }
  }
)

test('role table names are plain text and gank event details remain without match-navigation actions', async () => {
  const games = [game(900051, 0, 0), { ...game(900052, 100, 0.5), side: 'Red' as const }]
  games[0].laneGankDeaths = {
    methodVersion: 1,
    status: 'available',
    events: [
      {
        victimPlayer: 'Synthetic A#TEST_ONLY',
        victimRole: 'TOP',
        victimChampion: 'Gwen',
        enemyJunglerChampion: 'Vi',
        timestampSec: 180,
        lane: 'top',
        involvement: 'assist'
      }
    ]
  }
  games[1].laneGankDeaths = { methodVersion: 1, status: 'available', events: [] }
  const f = harness(games, false, true)
  try {
    f.store.sideBreakdown = true
    await nextTick()
    const name = f.all().find((n) => n.props.class === 'member-line')!
    expect(name.children.every((n) => n.type !== 'button')).toBe(true)
    const nameText = (n: Node): string => n.text + n.children.map(nameText).join('')
    expect(nameText(name)).toBe('Synthetic A')
    const hasMetricNavigation = () =>
      f
        .all()
        .some(
          (n) => n.type === 'select' && ['核查指标', '核查边方'].includes(n.props['aria-label'])
        )
    expect(hasMetricNavigation()).toBe(false)
    f.all()
      .find((n) => n.type === 'member-segments')!
      .props['onUpdate:modelValue']('gankDeaths')
    await nextTick()
    const eventSelector = f
      .all()
      .find((n) => n.type === 'select' && n.props['aria-label'] === '选择要核查的成员分路')!
    expect(eventSelector.props.options).toHaveLength(1)
    eventSelector.props['onUpdate:value']('TOP|Synthetic A#TEST_ONLY')
    await nextTick()
    const text = f
      .all()
      .map((n) => n.text)
      .join(' ')
    expect(text).toContain('被抓事件明细')
    expect(text).toContain('3:00')
    expect(text).toContain('Vi')
    expect(text).toContain('助攻')
    const victimRole = f.all().find((n) => n.props.class === 'gank-victim-role')!
    const victimIcons = victimRole.children.filter((n) => n.type === 'position-icon')
    expect(victimIcons).toHaveLength(1)
    expect(victimIcons[0].props.position).toBe('TOP')
    expect(victimIcons[0].props['aria-hidden']).toBe('true')
    expect(nameText(victimRole)).toBe('上路')
    const eventTable = f.all().find((n) => n.props.class === 'gank-evidence__table')!
    const descendants = (n: Node): Node[] => [n, ...n.children.flatMap(descendants)]
    expect(
      descendants(eventTable)
        .filter((n) => n.type === 'th')
        .map(nameText)
    ).toEqual(['日期 / 边方', '对局', '成员英雄', '分路', '时间', '敌方打野', '参与方式'])
    const eventCells = () => descendants(eventTable).filter((n) => n.type === 'td')
    expect(eventCells().map(nameText)).toEqual([
      '2026-01-01 · 蓝方',
      '尾号 900051',
      'Gwen',
      '上路',
      '3:00',
      'Vi',
      '助攻'
    ])
    expect(eventSelector.props.value).toBe('TOP|Synthetic A#TEST_ONLY')
    expect(descendants(eventTable).filter((n) => n.type === 'position-icon')).toHaveLength(1)
    const canonicalEvents = JSON.stringify(games[0].laneGankDeaths)
    leagueFixture.gameData!.champions = {
      gwen: { id: 887, alias: 'Gwen', name: '格温' },
      vi: { id: 254, alias: 'Vi', name: '蔚' }
    }
    await nextTick()
    expect(
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    ).toContain('格温')
    expect(nameText(eventCells()[2])).toBe('格温')
    expect(nameText(eventCells()[3])).toBe('上路')
    expect(
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    ).toContain('蔚')
    leagueFixture.gameData!.champions = { gwen: { id: 887, alias: 'Gwen', name: 'Gwen' } }
    await nextTick()
    const fallbackText = f
      .all()
      .map((n) => n.text)
      .join(' ')
    expect(nameText(eventCells()[2])).toBe('Gwen')
    expect(nameText(f.all().find((n) => n.props.class === 'gank-victim-role')!)).toBe('上路')
    expect(fallbackText).toContain('Vi')
    expect(JSON.stringify(games[0].laneGankDeaths)).toBe(canonicalEvents)
    expect(hasMetricNavigation()).toBe(false)
    expect(f.all().some((n) => n.type === 'button' && n.props.size === 'small')).toBe(false)
    expect(f.store.matchListScope).toBeNull()
    expect(f.store.matchNavigation).toBeNull()
  } finally {
    f.app.unmount()
    leagueFixture.gameData!.champions = {}
  }
})

test('static role table names expose the full identity on focus and dismiss without navigation', async () => {
  const name = 'Synthetic member with a deliberately long display name#TEST_ONLY'
  const synthetic = game(900064, 0, 0)
  synthetic.players[0].player = name
  const f = harness([synthetic], false, true)
  try {
    const trigger = () => f.all().find((n) => n.props.class === 'member-name')!
    const tooltip = () => f.all().find((n) => n.type === 'tooltip')!
    const textOf = (n: Node): string => n.text + n.children.map(textOf).join('')
    expect(trigger().type).toBe('span')
    expect(trigger().props.tabindex).toBe('0')
    expect(trigger().props['aria-label']).toBe(name)
    expect(tooltip().props.show).toBe(false)
    trigger().props.onFocus()
    await nextTick()
    expect(tooltip().props.show).toBe(true)
    expect(textOf(tooltip())).toContain(name)
    trigger().props.onMouseenter()
    trigger().props.onMouseleave()
    await nextTick()
    expect(tooltip().props.show).toBe(true)
    trigger().props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
    await nextTick()
    expect(tooltip().props.show).toBe(false)
    trigger().props.onFocus()
    trigger().props.onBlur()
    await nextTick()
    expect(tooltip().props.show).toBe(false)
    expect(f.store.matchNavigation).toBeNull()
    expect(f.store.matchListScope).toBeNull()
  } finally {
    f.app.unmount()
  }
})

test('full metrics remain visible without a collapse control and preserve all five window sorting options', async () => {
  const f = harness([game(900061, 0, 0)], false, true)
  try {
    const text = () =>
      f
        .all()
        .map((n) => n.text)
        .join(' ')
    expect(f.all().some((n) => n.type === 'details' && n.props.class === 'role-full-metrics')).toBe(
      false
    )
    expect(f.all().some((n) => n.type === 'summary')).toBe(false)
    expect(text()).not.toContain(uiText('roleFullMetrics'))
    expect(
      f
        .all()
        .some((n) => n.type === 'section' && n.props['aria-label'] === uiText('roleFullMetrics'))
    ).toBe(true)
    expect(text()).not.toContain('参考样本线')
    expect(text()).not.toContain('全部分路 · 蓝红方拆分')
    const winRateCell = f.all().find((n) => n.props.class === 'rate-cell')!
    expect(winRateCell.children.map((n) => n.type)).toEqual(['rate-interval', 'div'])
    expect(winRateCell.children[0].props.games).toBe(1)
    expect(winRateCell.children[0].props.wins).toBe(1)
    const goldHelp = f
      .all()
      .find((n) => n.type === 'metric-help' && n.props.label === roleMetricMeta.gd15.label)!
    expect(goldHelp.props.definition).toContain('金币')
    const headerText = f
      .all()
      .filter((n) => n.props.class === 'metric-heading-name')
      .map((n) => n.text)
      .join(' ')
    expect(headerText).toContain(roleMetricMeta.gd15.label.replace('（金币）', ''))
    expect(headerText).not.toContain('（金币）')
    const segments = f.all().find((n) => n.type === 'member-segments')!
    expect(segments.props.options.map((option: any) => option.value)).toEqual([
      'core',
      'combat',
      'efficiency',
      'vision',
      'utility',
      'lane',
      'skirmish',
      'objectives',
      'gankDeaths'
    ])
    segments.props['onUpdate:modelValue']('gankDeaths')
    await nextTick()
    const keys = [
      'laneGankBefore3',
      'laneGankMinute3',
      'laneGankMinute4',
      'laneGankMinute5To10',
      'laneGankMinute10To14'
    ]
    expect(
      f
        .all()
        .some((n) => n.type === 'select' && n.props['aria-label'] === uiText('roleGankWindowSort'))
    ).toBe(false)
    const help = f
      .all()
      .find((n) => n.type === 'metric-help' && n.props.label === uiText('roleGankWindows'))!
    expect(help).toBeDefined()
    expect(help.props.definition).toBe(
      keys.map((key) => roleMetricMeta[key].description).join('；')
    )
    // Help has its own target rather than becoming a sort button or upper title.
    expect(help.parent!.type).toBe('div')
    expect(help.parent!.parent!.type).toBe('th')
    const direction = () =>
      help.parent!.children.find((n) => n.type === 'span' && n.props['aria-hidden'] === 'true')!
        .text
    expect(direction()).toBe('↕')
    for (const key of keys) {
      const button = () =>
        f
          .all()
          .find(
            (n) =>
              n.type === 'button' && n.props['aria-label']?.startsWith(roleMetricMeta[key].label)
          )!
      button().props.onClick()
      await nextTick()
      expect(button().props['aria-pressed']).toBe(true)
      expect(direction()).toBe('↓')
      expect(f.all().some((n) => n.type === 'th' && n.props['aria-sort'] === 'descending')).toBe(
        true
      )
      button().props.onClick()
      await nextTick()
      expect(f.all().some((n) => n.type === 'th' && n.props['aria-sort'] === 'ascending')).toBe(
        true
      )
      expect(direction()).toBe('↑')
      button().props.onClick()
      await nextTick()
      expect(button().props['aria-pressed']).toBe(false)
      expect(direction()).toBe('↕')
    }
    expect(f.all().filter((n) => n.type === 'gank-bars').length).toBeGreaterThan(0)
    f.store.sideBreakdown = true
    await nextTick()
    const bars = f.all().filter((n) => n.type === 'gank-bars')
    expect(bars).toHaveLength(1)
    expect(bars[0].props.values).toHaveLength(5)
    expect(bars[0].props.breakdown.map((item: any) => item.tone)).toEqual(['blue', 'red'])
    expect(bars[0].props.breakdown.every((item: any) => item.values.length === 5)).toBe(true)
  } finally {
    f.app.unmount()
  }
})

test('role group selection uses shared segments and rejects unknown values while retaining state across inactive panes', async () => {
  const f = harness([game(900062, 0, 0)], false, true)
  try {
    const segments = () => f.all().find((n) => n.type === 'member-segments')!
    expect(segments().props.modelValue).toBe('core')
    expect(segments().props.ariaControls).toBe('role-group-panel')
    for (const value of ['combat', 'gankDeaths', 'core', 'gankDeaths']) {
      segments().props['onUpdate:modelValue'](value)
      await nextTick()
      expect(segments().props.modelValue).toBe(value)
    }
    for (const value of ['unknown-group', '__proto__', 3]) {
      segments().props['onUpdate:modelValue'](value)
      await nextTick()
      expect(segments().props.modelValue).toBe('gankDeaths')
    }
    f.fullRoleProps.active = false
    await nextTick()
    f.fullRoleProps.active = true
    await nextTick()
    expect(segments().props.modelValue).toBe('gankDeaths')
  } finally {
    f.app.unmount()
  }
})

test('hero pick share and blue-side records stay exact without removed match-navigation controls', async () => {
  const games = [
    game(900061, 0, 0),
    { ...game(900062, 100, 0.5), side: 'Red' as const },
    game(900063, 50, 0.5)
  ]
  games[2].players[0].champion = 'Ornn'
  const f = harness(games, false, false, true)
  try {
    await nextTick()
    expect(f.all().some((n) => n.type === 'button' && 'secondary' in n.props)).toBe(false)
    expect(
      f
        .all()
        .some(
          (n) => n.type === 'select' && ['核查指标', '核查边方'].includes(n.props['aria-label'])
        )
    ).toBe(false)
    const text = f
      .all()
      .map((n) => n.text)
      .join(' ')
    expect(text).toContain(`${uiText('poolPickRate')} 66.7%`)
    expect(text).toContain(uiText('poolRecord', { wins: 2, games: 2 }))
    expect(text).toContain(uiText('poolBlue', { rate: '100.0%', count: 1 }))
    expect(text).toContain(uiText('poolRed', { rate: '100.0%', count: 1 }))
    expect(f.store.matchListScope).toBeNull()
    expect(f.store.matchNavigation).toBeNull()
  } finally {
    f.app.unmount()
  }
})

test('all five roles remain selectable with stable selection, not-applicable jungle gank and isolated evidence', async () => {
  const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
  const games = roles.map((role, index) => {
    const fixture = game(910001 + index, 0, 0.5)
    fixture.players[0].role = role
    fixture.laneGankDeaths = { methodVersion: 1, status: 'available', events: [] }
    return fixture
  })
  const f = harness(games, false, true)
  try {
    const select = () => f.all().find((n) => n.props['aria-label'] === '选择表格分路')!
    const tables = () => f.all().filter((n) => n.type === 'table' && n.props.class === 'role-table')
    expect(select().props.options.map((o: any) => [o.value, o.label, o.role])).toEqual(
      roles.map((role, i) => [role, ['上路', '打野', '中路', '下路', '辅助'][i], role])
    )
    expect(select().props.value).toBe('TOP')
    const descendants = (n: Node): Node[] => [n, ...n.children.flatMap(descendants)]
    const sort = () =>
      descendants(tables()[0]).find(
        (n) => n.type === 'button' && n.props['aria-label']?.startsWith('样本：')
      )!
    sort().props.onClick()
    await nextTick()
    for (const role of roles) {
      select().props['onUpdate:value'](role)
      await nextTick()
      expect(select().props.value).toBe(role)
      expect(tables()).toHaveLength(1)
      expect(
        descendants(tables()[0]).some(
          (n) => n.type === 'th' && n.props['aria-sort'] === 'descending'
        )
      ).toBe(true)
    }
    select().props['onUpdate:value']('JUNGLE')
    f.all()
      .find((n) => n.type === 'member-segments')!
      .props['onUpdate:modelValue']('gankDeaths')
    await nextTick()
    expect(select().props.value).toBe('JUNGLE')
    expect(select().props.options.map((o: any) => o.value)).toEqual(roles)
    expect(tables()).toHaveLength(0)
    expect(f.all().some((n) => n.text.includes('被抓统计不适用于打野分路。'))).toBe(true)
    expect(f.all().some((n) => n.props['aria-label'] === '选择要核查的成员分路')).toBe(false)
    select().props['onUpdate:value']('TOP')
    await nextTick()
    const evidence = () => f.all().find((n) => n.props['aria-label'] === '选择要核查的成员分路')!
    expect(evidence().props.options.every((o: any) => o.role === 'TOP')).toBe(true)
    select().props['onUpdate:value']('BOTTOM')
    await nextTick()
    expect(evidence().props.options.every((o: any) => o.role === 'BOTTOM')).toBe(true)
    expect(evidence().props.value).toBe('BOTTOM|Synthetic A#TEST_ONLY')
    f.store.overview = { ...f.store.overview!, games: [games[0]] }
    await nextTick()
    expect(select().props.value).toBe('BOTTOM')
    expect(select().props.options.map((o: any) => o.value)).toEqual(roles)
    expect(tables()).toHaveLength(0)
    expect(f.all().some((n) => n.text.includes('当前筛选下没有分路数据。'))).toBe(true)
    f.store.overview = { ...f.store.overview!, games: [] }
    await nextTick()
    expect(tables()).toHaveLength(0)
    expect(select().props.value).toBe('BOTTOM')
    expect(select().props.options.map((o: any) => o.value)).toEqual(roles)
    expect(f.all().some((n) => n.text.includes('当前筛选下没有分路数据。'))).toBe(true)
    f.store.overview = { ...f.store.overview!, games }
    select().props['onUpdate:value']('JUNGLE')
    f.all()
      .find((n) => n.type === 'member-segments')!
      .props['onUpdate:modelValue']('core')
    await nextTick()
    expect(select().props.value).toBe('JUNGLE')
    expect(tables()).toHaveLength(1)
  } finally {
    f.app.unmount()
  }
})

test('gank member options preserve full long identity and expose a complete keyboard focus hint', async () => {
  const identity =
    'SYNTHETIC_TEST_ONLY_LONG_MEMBER_ABCDEFGHIJKLMNOPQRSTUVWXYZ#SYNTHETIC_TEST_ONLY_TAG'
  const fixture = game(910020, 0, 0.5)
  fixture.players[0].player = identity
  fixture.laneGankDeaths = { methodVersion: 1, status: 'available', events: [] }
  const f = harness([fixture], false, true)
  try {
    f.all()
      .find((n) => n.type === 'member-segments')!
      .props['onUpdate:modelValue']('gankDeaths')
    await nextTick()
    const select = () => f.all().find((n) => n.props['aria-label'] === '选择要核查的成员分路')!
    const option = select().props.options[0]
    expect(option.value).toBe(`TOP|${identity}`)
    expect(option.label).toBe(`上路 · ${identity}`)
    const label = select().props['render-label'](option)
    expect(label.props.title).toBe(`上路 · ${identity}`)
    expect(label.children[0].children[0].props.position).toBe('TOP')
    expect(label.children[0].children[1].children).toBe('上路')
    expect(label.children[1].children).toBe('·')
    expect(label.children[2].children).toBe(identity)
    expect(label.children[2].props.title).toBe(identity)
    expect(select().props['render-tag']({ option }).props.title).toBe(label.props.title)
    const unknown = select().props['render-label']({
      label: '未知分路 · 合成成员',
      role: 'UNKNOWN'
    })
    expect(unknown.children).toBe('未知分路 · 合成成员')
    expect(unknown.props.title).toBe('未知分路 · 合成成员')
    select().props.onFocus()
    await nextTick()
    expect(select().props['aria-description']).toBe(`上路 · ${identity}`)
    expect(f.all().some((n) => n.type === 'tooltip' && n.props.show === true)).toBe(true)
    select().props.onBlur()
    await nextTick()
    expect(f.all().some((n) => n.type === 'tooltip' && n.props.show === true)).toBe(false)
    expect(select().props.value).toBe(`TOP|${identity}`)
  } finally {
    f.app.unmount()
  }
})

test('member summary keeps identity and win evidence without fixed secondary metric rows', () => {
  const f = harness([game(920001, 0, 0)])
  try {
    const member = f.all().find((n) => n.type === 'article')!
    const children = member.children.filter((n) => n.type !== 'text' && n.type !== 'comment')
    expect(children.map((n) => n.type)).toEqual(['div', 'div', 'rate-interval', 'div', 'p'])
    expect(f.all().filter((n) => ['dl', 'dt', 'dd'].includes(n.type))).toHaveLength(0)
    expect(f.all().some((n) => n.text.includes('Synthetic A'))).toBe(true)
    expect(children[2].props).toMatchObject({ wins: 1, games: 1 })
    const options = f.all().find((n) => n.type === 'select')!.props.options
    expect(options).toHaveLength(23)
    expect(options.some((option: { value: string }) => option.value === 'kp')).toBe(true)
    expect(options.some((option: { value: string }) => option.value === 'kda')).toBe(false)
  } finally {
    f.app.unmount()
  }
})

test('member comparison binds the supplied profile icon including zero without changing ordering', async () => {
  const sample = game(930001, 0, 0.5)
  Object.assign(sample.players[0], { profileIconId: 0, profileIdentity: 'a'.repeat(64) })
  const f = harness([sample])
  try {
    f.store.overview = { ...f.store.overview!, publicationToken: 'A'.repeat(32) }
    await nextTick()
    const avatar = f.all().find((n) => n.type === 'profile-avatar')!
    expect(avatar.props['icon-id']).toBe(0)
    expect(f.all().some((n) => n.text.includes('Synthetic A'))).toBe(true)
  } finally {
    f.app.unmount()
  }
})

test('axis ticks share precision while data labels keep their original metric precision', async () => {
  const f = harness([game(950001, 600, 0), { ...game(950002, -600, 0), side: 'Red' }])
  try {
    const tickLabels = () =>
      f
        .all()
        .filter((n) => String(n.props.class).split(' ').includes('axis-tick'))
        .map((n) => n.children.find((child) => child.type === 'span')!.text)
    expect(tickLabels()).toEqual(['600', '300', '0', '-300', '-600'])
    expect(
      f.all().some((n) => n.props.role === 'img' && n.props['aria-label'].includes('0.00'))
    ).toBe(true)
    f.all()
      .find((n) => n.type === 'select')!
      .props['onUpdate:value']('kp')
    await nextTick()
    expect(tickLabels()).toEqual(['10.0%', '7.5%', '5.0%', '2.5%', '0.0%'])
    expect(
      f.all().some((n) => n.props.role === 'img' && n.props['aria-label'].includes('0.0%'))
    ).toBe(true)
  } finally {
    f.app.unmount()
  }
})
