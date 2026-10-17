import I18nextVue from 'i18next-vue'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { transformWithEsbuild } from 'vite'
import * as Vue from 'vue'
// sort-imports-ignore
import '../test-i18n'
import { vi, beforeEach, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createRenderer, createSSRApp, defineComponent, h, nextTick, ref, ssrContextKey } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { i18next } from '@renderer-shared/i18n'
import { aggregateJungle } from '../analytics'
import { jungleMeta } from '../metric-defs'
import JungleView from '../JungleView.vue'
import JungleCampTable from './JungleCampTable.vue'
import JungleCells from './JungleCells.vue'
import { jungleEvidence, evidenceKey } from './analysis'
vi.mock('naive-ui', () => ({
  NButton: defineComponent({
    setup(_props, { attrs, slots }) {
      return () => h('button', attrs, slots.default?.())
    }
  }),
  NTab: (props: Record<string, any>) =>
    h('button', { ...props, 'data-group': props.name }, props.tab),
  NTabs: (props: { value: string }, { slots }: { slots: { default: () => unknown } }) =>
    h('div', { 'data-current-group': props.value }, slots.default?.() as any),
  NSwitch: () => null
}))
vi.mock('../MemberProfileAvatar.vue', () => ({
  default: (props: any) => h('profile-avatar', props)
}))
const data = vi.hoisted(() => ({ jungle: null as any, games: null as any }))
vi.mock('../useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
const game = (camp: string | null, own: boolean | null, side = 'Blue'): MemberAnalysisGame =>
  ({
    side,
    win: false,
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    players: [
      {
        player: 'A#X',
        role: 'JUNGLE',
        minutes: 30,
        cs: 0,
        gold: 10000,
        objectiveDamage: 0,
        gd10: 0,
        gd15: null,
        xpd15: null
      }
    ],
    jungle: {
      player: 'A#X',
      startCamp: camp,
      startCampOwn: own,
      level3Gank: false,
      level4Gank: false,
      topGanks: 0,
      midGanks: 0,
      botGanks: 0,
      topZoneWeight: 0,
      midZoneWeight: 0,
      botZoneWeight: 0,
      totalZoneWeight: 0,
      gotFirstDragon: null,
      firstDragonTimeSec: null,
      dragons: 0,
      soloDragons: 0,
      voidgrubs: 0,
      heralds: 0,
      barons: 0
    }
  }) as MemberAnalysisGame
beforeEach(async () => {
  setActivePinia(createPinia())
  await i18next.changeLanguage('zh-CN')
  data.games = ref([game('red', true), game('blue', null, 'Red'), game(null, null)])
  data.jungle = ref(aggregateJungle(data.games.value))
})
const render = (component: any, props = {}) =>
  renderToString(createSSRApp({ render: () => h(component, props) }).use(I18nextVue, { i18next }))
test('jungle group switch retains four original group values and an accessible current selection', async () => {
  const text = await render(JungleView)
  expect(text).toContain('role="tablist" aria-label="打野分析类别"')
  expect(text).toContain('data-current-group="opening"')
  for (const group of ['opening', 'gank', 'objectives', 'development'])
    expect(text).toContain(`data-group="${group}"`)
  expect(text).toContain('早期抓人与方向')
  expect(text).toContain('aria-selected="true"')
})
test('main opening has own/enemy only, unknown counts remain next to their unchanged eligible denominator', async () => {
  const text = await render(JungleView)
  expect(text).toContain('归属可判定 1/2 场')
  expect(text).toContain('归属未知 1 场')
  expect(text).toContain('首营地可识别 2/3 场')
  expect(text).toContain('50.0%')
  expect(text).toContain('营地未知 1 场未计入')
  expect(text).not.toContain('首营地有效 2/3 场')
  expect(text).not.toContain('营地见完整数据')
  expect(text).not.toContain('各格比例 =')
  expect(text).not.toContain('己方 + 敌方不足')
  expect(text).not.toContain('开野归属按归属可判定场次')
  expect(text).toContain('指标口径')
  expect(text).not.toMatch(/<th[^>]*scope="row"[^>]*>归属未知<\/th>/)
})
test('side breakdown directly retains both side samples and unknown count without requiring selection', async () => {
  useMemberAnalysisStore().sideBreakdown = true
  const text = await render(JungleView)
  expect(text).toContain('蓝方')
  expect(text).toContain('红方')
  expect(text).toContain('归属可判定 0/1 场')
  expect(text).toContain('归属未知 1 场')
  expect(text).not.toContain('完整打野数据')
})
test('complete camp details retain unknown camp count/share, genuine zero, and no-data missingness', async () => {
  const e = jungleEvidence(data.games.value).get(evidenceKey('A#X', '总计'))!
  const text = await render(JungleCampTable, { evidence: e, complete: true })
  expect(text).toMatch(/<th[^>]*scope="row"[^>]*>归属未知<\/th>/)
  expect(text).toContain('1 场')
  expect(text).toContain('50.0%')
  expect(text).toContain('0 场')
  expect(text).toContain('0.0%')
  const missing = jungleEvidence([game(null, null)]).get(evidenceKey('A#X', '总计'))!
  const noData = await render(JungleCampTable, { evidence: missing })
  expect(noData).toContain('无有效营地记录')
  expect(noData).not.toContain('0.0%')
  expect(noData).not.toContain('— 无可识别营地')
})
test('gank and development keep overlapping rates, exact zero and independent snapshot missingness', async () => {
  const row = data.jungle.value[0],
    e = jungleEvidence(data.games.value).get(evidenceKey('A#X', '总计'))!,
    scales = { gank: 1, gold: 500, xp: 300, dragon15: 1, grub15: 1, objectiveFight15: 1 }
  const gank = await render(JungleCells, { row, evidence: e, group: 'gank', scales })
  expect(gank).toContain('3级抓人率')
  expect(gank).toContain('4级抓人率')
  expect(gank).toContain('0.0%')
  expect(gank).toContain('权重分母 0')
  const dev = await render(JungleCells, { row, evidence: e, group: 'development', scales })
  expect(dev).toContain('经济差 @ 10')
  expect(jungleMeta.gd10.unit).toBe('金币')
  expect(dev).toContain('有效 0/3 场')
  expect(dev).toContain('缺失 3 场')
  expect(dev).toContain('—')
  expect(dev).not.toContain('10 分钟经验差')
})
test('new English copy retains the same camp counts/denominator and main-only ownership policy', async () => {
  await i18next.changeLanguage('en')
  const text = await render(JungleView)
  expect(text).toContain('1/2 identified camps with known ownership')
  expect(text).toContain('1 camps with unknown ownership')
  expect(text).not.toContain('Valid first camps: 2/3')
  expect(text).toContain('50.0%')
  expect(text).not.toMatch(/<th[^>]*scope="row"[^>]*>Unknown ownership<\/th>/)
})

test('configured member order and stable ordinal do not follow aggregate sample ranking', async () => {
  const other = {
    ...game('red', true),
    players: game('red', true).players.map((p) => ({ ...p, player: 'B#X' })),
    jungle: { ...game('red', true).jungle!, player: 'B#X' }
  }
  data.games.value.push(other)
  data.jungle.value = aggregateJungle(data.games.value)
  useMemberAnalysisStore().settings = {
    enabled: true,
    members: [
      { serverId: 'X', gameName: 'B', tagLine: 'X' },
      { serverId: 'X', gameName: 'A', tagLine: 'X' }
    ],
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false
  }
  const text = await render(JungleView)
  expect(text.indexOf('>B</button>')).toBeLessThan(text.indexOf('>A</button>'))
  expect(text).toContain('1 场 · 0 胜 / 1 负')
})
test('empty sample has no fabricated member or camp comparison', async () => {
  data.games.value = []
  data.jungle.value = []
  const text = await render(JungleView)
  expect(text).toContain('当前样本没有打野时间线数据。')
  expect(text).not.toContain('营地归属')
})

// A minimal Vue host exercises actual handlers without claiming browser layout acceptance.
class Host {
  props: Record<string, any> = {}
  text = ''
  parent: Host | null = null
  children: Host[] = []
  isConnected = true
  scrollTop = 0
  scrollLeft = 0
  focus = vi.fn()
  scrollIntoView = vi.fn()
  scrollTo = vi.fn()
  constructor(public type: string) {
    Vue.markRaw(this)
  }
  contains(target: Host): boolean {
    return this === target || this.children.some((child) => child.contains(target))
  }
  querySelector() {
    return null
  }
  closest() {
    let node: Host | null = this
    while (node) {
      if (node.props.class === 'member-analysis-scroll') return node
      node = node.parent
    }
    return null
  }
  getBoundingClientRect() {
    return { top: 0, height: 0 }
  }
}
const walk = (node: Host): Host[] => [node, ...node.children.flatMap(walk)]
const descriptor = parse(
  readFileSync(new URL('../JungleView.vue', import.meta.url), 'utf8')
).descriptor
JungleView.render = new Function(
  'Vue',
  (
    await transformWithEsbuild(
      compile(descriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        expressionPlugins: ['typescript'],
        bindingMetadata: compileScript(descriptor, { id: 'jungle-help-test' }).bindings
      }).code,
      'jungle-template.ts',
      { loader: 'ts' }
    )
  ).code
)(Vue)
function mountInteractive() {
  const renderer = createRenderer<Host, Host>({
    createElement: (type) => new Host(type),
    createComment: (text) => Object.assign(new Host('comment'), { text }),
    createText: (text) => Object.assign(new Host('text'), { text }),
    setText: (node, text) => {
      node.text = text
    },
    setElementText: (node, text) => {
      node.text = text
      node.children = []
    },
    patchProp: (node, key, _old, value) => {
      node.props[key] = value
    },
    parentNode: (node) => node.parent,
    nextSibling: (node) => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
    insert(node, parent, anchor) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, node)
    },
    remove(node) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      node.isConnected = false
    }
  })
  const root = new Host('root')
  root.props.class = 'member-analysis-scroll'
  const app = renderer.createApp({ render: () => h(JungleView) })
  app.config.warnHandler = (message) => {
    // Child charts are SSR-only under this test transform; this host checks the parent handlers.
    if (!message.includes('missing template or render function')) throw new Error(message)
  }
  app.use(I18nextVue, { i18next })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  return { app, owner: root, all: () => walk(root) }
}

function stubHostDocument(reduced = false) {
  vi.stubGlobal('HTMLElement', Host)
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }))
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
}

test('opening details scrolls smoothly, cancellation stops the owner, and reduced motion skips animation', async () => {
  stubHostDocument()
  const fixture = mountInteractive()
  try {
    const expand = fixture.all().find((node) => node.props.class === 'member-expand')!
    await expand.props.onClick({ currentTarget: expand, detail: 1 })
    const detail = fixture.all().find((node) => node.props.id === 'jungle-details')!
    expect(detail.scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    fixture.owner.scrollTop = 120
    await expand.props.onClick({ currentTarget: expand, detail: 1 })
    expect(fixture.owner.scrollTo).toHaveBeenCalledWith({ top: 120, left: 0, behavior: 'instant' })
    expect(fixture.all().some((node) => node.props.id === 'jungle-details')).toBe(false)
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    await expand.props.onClick({ currentTarget: expand, detail: 0 })
    const reducedDetail = fixture.all().find((node) => node.props.id === 'jungle-details')!
    expect(reducedDetail.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant'
    })
    expect(reducedDetail.focus).toHaveBeenCalledWith({ preventScroll: true })
  } finally {
    fixture.app.unmount()
    vi.unstubAllGlobals()
  }
})

test('repeated expansion then cancellation before render does not issue a stale detail scroll', async () => {
  stubHostDocument()
  const fixture = mountInteractive()
  try {
    const expand = fixture.all().find((node) => node.props.class === 'member-expand')!
    const opening = expand.props.onClick({ currentTarget: expand, detail: 1 })
    const cancelling = expand.props.onClick({ currentTarget: expand, detail: 1 })
    await Promise.all([opening, cancelling])
    await nextTick()
    expect(fixture.all().some((node) => node.props.id === 'jungle-details')).toBe(false)
    expect(fixture.owner.scrollTo).not.toHaveBeenCalled()
  } finally {
    fixture.app.unmount()
    vi.unstubAllGlobals()
  }
})
test('Escape dismisses definitions first, restores their trigger, then closes member details', async () => {
  let keydown: (event: any) => void = () => {}
  vi.stubGlobal('HTMLElement', Host)
  vi.stubGlobal('document', {
    addEventListener: (_type: string, handler: typeof keydown) => {
      keydown = handler
    },
    removeEventListener: vi.fn()
  })
  const fixture = mountInteractive()
  try {
    const help = fixture.all().find((node) => node.props['aria-controls'] === 'jungle-method')!
    const member = fixture.all().find((node) => node.props.class === 'member-trigger')!
    await member.props.onClick({ currentTarget: member, detail: 0 })
    await nextTick()
    help.props.onClick()
    await nextTick()
    const details = fixture.all().find((node) => node.props.id === 'jungle-details')!
    const event = { key: 'Escape', target: details, preventDefault: vi.fn() }
    keydown(event)
    await nextTick()
    expect(fixture.all().some((node) => node.props.id === 'jungle-method')).toBe(false)
    expect(fixture.all().some((node) => node.props.id === 'jungle-details')).toBe(true)
    expect(help.focus).toHaveBeenCalledWith({ preventScroll: true })
    keydown({ ...event, target: help })
    await nextTick()
    expect(fixture.all().some((node) => node.props.id === 'jungle-details')).toBe(false)
    expect(member.focus).toHaveBeenCalledWith({ preventScroll: true })
  } finally {
    fixture.app.unmount()
    vi.unstubAllGlobals()
  }
})

test('jungle member identity uses the supplied profile icon in its original bordered slot', async () => {
  const sample = {
    ...data.games.value[0],
    gameId: 940001,
    timestamp: 1,
    players: [
      { ...data.games.value[0].players[0], profileIconId: 0, profileIdentity: 'b'.repeat(64) }
    ]
  }
  useMemberAnalysisStore().overview = { games: [sample], publicationToken: 'B'.repeat(32) } as any
  const text = await render(JungleView)
  expect(text.match(/<profile-avatar[^>]+>/)?.[0]).toContain('icon-id="0"')
  expect(text.match(/<profile-avatar[^>]+>/)?.[0]).toContain('size="24"')
  expect(text).toContain('member-trigger')
})
