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
import type { MatchEvidenceSelection } from './evidence-selection'
import { uiText } from './ui-text'
import { i18next } from '@renderer-shared/i18n'

vi.mock('naive-ui', () => ({
  useThemeVars: () => ({ fontFamily: 'system-ui, sans-serif' }),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NSelect: (props: any) => h('select', props),
  NRadioGroup: (props: any, { slots }: any) => h('radio-group', props, slots.default?.()),
  NRadioButton: (props: any, { slots }: any) => h('radio', props, slots.default?.()),
  NSwitch: (props: any) => h('switch', props),
  NIcon: () => null,
  NScrollbar: (props: any, { slots }: any) => h('scrollbar', props, slots.default?.())
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: () => null
}))
vi.mock('./WinRateInterval.vue', () => ({ default: () => null }))
vi.mock('./MetricHelp.vue', () => ({ default: () => null }))
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
            ? h(MemberRoleView)
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
  const selectMember = async () => {
    all()
      .find((n) => n.type === 'button' && n.props['aria-controls'])!
      .props.onClick()
    await nextTick()
  }
  return { app, store, all, evidence, selectMember, sharedProps }
}

test('current metric action sends only its support set without changing global controls', async () => {
  const f = harness([
    game(900001, 0, null),
    game(900002, -500, 0),
    game(900003, 200, null),
    game(900004, null, 0.5),
    game(900005, null, 0.8)
  ])
  try {
    const before = JSON.stringify({ filters: f.store.filters, sample: f.store.sampleSize })
    await f.selectMember()
    f.evidence().props.onClick()
    expect(f.store.matchListScope?.gameIds).toEqual([900003, 900002, 900001])
    expect(f.store.matchNavigation).toBeNull()
    f.all()
      .find((n) => n.type === 'select')!
      .props['onUpdate:value']('kp')
    await nextTick()
    f.evidence().props.onClick()
    expect(f.store.matchListScope?.gameIds).toEqual([900005, 900004, 900002])
    expect(f.store.matchListScope?.publishedGeneration).toBe(f.store.overviewGeneration)
    expect(JSON.stringify({ filters: f.store.filters, sample: f.store.sampleSize })).toBe(before)
  } finally {
    f.app.unmount()
  }
})

test('single support locates that game; missing metric disables navigation', async () => {
  const f = harness([game(900011, 0, null)])
  try {
    await f.selectMember()
    f.evidence().props.onClick()
    expect(f.store.matchNavigation?.gameId).toBe(900011)
    expect(f.store.matchListScope).toBeNull()
    f.all()
      .find((n) => n.type === 'select')!
      .props['onUpdate:value']('kp')
    await nextTick()
    expect(f.evidence().props.disabled).toBe(true)
    const old = f.store.matchNavigation
    f.evidence().props.onClick()
    expect(f.store.matchNavigation).toBe(old)
  } finally {
    f.app.unmount()
  }
})

test('hidden duplicate is rejected with nearby feedback, not expanded or scoped', async () => {
  const f = harness([game(900021, 0, 0), { ...game(900021, 10, 0.5), side: 'Red' }])
  try {
    f.store.analysisSide = 'Blue'
    await nextTick()
    await f.selectMember()
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
  const f = harness([game(900031, 0, 0)])
  try {
    await f.selectMember()
    const oldClick = f.evidence().props.onClick
    f.store.overview = { ...f.store.overview!, games: [game(900032, 100, 0.5)] }
    oldClick()
    expect(f.store.matchListScopeError).toBe('stale')
    expect(f.store.matchListScope).toBeNull()
    expect(f.store.matchNavigation).toBeNull()
    await nextTick()
    expect(f.evidence()).toBeDefined()
    expect(
      f.all().find((n) => n.type === 'button' && n.props['aria-controls'])?.props['aria-expanded']
    ).toBe(true)
  } finally {
    f.app.unmount()
  }
})

test('equal publication retains the member detail, known zero and later metric missingness do not clear it', async () => {
  const initial = game(900035, 0, 0)
  const f = harness([initial])
  try {
    await f.selectMember()
    f.store.overview = { ...f.store.overview!, games: [initial] }
    await nextTick()
    expect(
      f.all().find((n) => n.type === 'button' && n.props['aria-controls'])?.props['aria-expanded']
    ).toBe(true)
    expect(f.evidence().props.disabled).toBe(false)
    f.store.overview = { ...f.store.overview!, games: [game(900036, null, 0)] }
    await nextTick()
    expect(
      f.all().find((n) => n.type === 'button' && n.props['aria-controls'])?.props['aria-expanded']
    ).toBe(true)
    expect(f.evidence().props.disabled).toBe(true)
    const replacement = game(900037, 100, 0.5)
    replacement.players[0].player = 'Synthetic B#TEST_ONLY'
    f.store.overview = { ...f.store.overview!, games: [replacement] }
    await nextTick()
    expect(f.evidence()).toBeUndefined()
    expect(
      f.all().find((n) => n.type === 'button' && n.props['aria-controls'])?.props['aria-expanded']
    ).toBe(false)
    expect(f.all().filter((n) => n.props.role === 'status')).toHaveLength(1)
  } finally {
    f.app.unmount()
  }
})

test('explicit role change still clears selection without an invalidation warning', async () => {
  const f = harness([game(900038, 0, 0)])
  try {
    await f.selectMember()
    f.all()
      .find((n) => n.type === 'button' && n.props['aria-pressed'] === false)!
      .props.onClick()
    await nextTick()
    expect(f.evidence()).toBeUndefined()
    expect(f.all().some((n) => n.props.role === 'status')).toBe(false)
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

test('full role detail uses the actual selected metric and displayed side row', async () => {
  const games = [game(900051, 0, 0), { ...game(900052, 100, 0.5), side: 'Red' as const }]
  const f = harness(games, false, true)
  try {
    f.store.sideBreakdown = true
    await nextTick()
    f.all()
      .find((n) => n.type === 'button' && n.props.class === 'evidence-link')!
      .props.onClick()
    await nextTick()
    f.evidence().props.onClick()
    expect(f.store.matchListScope?.gameIds).toEqual([900052, 900051])
    f.all()
      .find((n) => n.type === 'select' && n.props['aria-label'] === '核查边方')!
      .props['onUpdate:value']('蓝方')
    await nextTick()
    f.evidence().props.onClick()
    expect(f.store.matchNavigation?.gameId).toBe(900051)
    expect(f.store.matchNavigation?.source).toContain('蓝方')
    const options = f
      .all()
      .find((n) => n.type === 'select' && n.props['aria-label'] === '核查指标')!.props.options
    expect(options.map((option: any) => option.value)).toEqual([
      'games',
      'winRate',
      'kda',
      'kp',
      'gd15'
    ])
  } finally {
    f.app.unmount()
  }
})

test('hero pick share includes other heroes while hero record and blue-side evidence stay exact', async () => {
  const games = [
    game(900061, 0, 0),
    { ...game(900062, 100, 0.5), side: 'Red' as const },
    game(900063, 50, 0.5)
  ]
  games[2].players[0].champion = 'Ornn'
  const f = harness(games, false, false, true)
  try {
    await nextTick()
    const open = () =>
      f
        .all()
        .find((n) => n.type === 'button' && 'secondary' in n.props)!
        .props.onClick()
    open()
    expect(f.store.matchListScope?.gameIds).toEqual([900061, 900062])
    f.all()
      .find((n) => n.type === 'select' && n.props['aria-label'] === '核查指标')!
      .props['onUpdate:value']('pickRate')
    await nextTick()
    open()
    expect(f.store.matchListScope?.gameIds).toEqual([900061, 900062, 900063])
    expect(f.store.matchListScope?.source).toContain('选用率')
    f.all()
      .find((n) => n.type === 'select' && n.props['aria-label'] === '核查指标')!
      .props['onUpdate:value']('winRate')
    await nextTick()
    f.all()
      .find((n) => n.type === 'select' && n.props['aria-label'] === '核查边方')!
      .props['onUpdate:value']('Blue')
    await nextTick()
    open()
    expect(f.store.matchNavigation?.gameId).toBe(900061)
    expect(f.store.matchNavigation?.source).toContain('蓝方')
  } finally {
    f.app.unmount()
  }
})
