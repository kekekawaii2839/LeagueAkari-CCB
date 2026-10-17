// sort-imports-ignore
import './test-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSSRApp, createRenderer, h, ref, nextTick, ssrContextKey } from 'vue'
import * as Vue from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { transformWithEsbuild } from 'vite'
import { renderToString } from 'vue/server-renderer'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { aggregateSynergy } from './analytics'
import SynergyView from './SynergyView.vue'
import { uiText } from './ui-text'
import I18nextVue from 'i18next-vue'
import { i18next } from '@renderer-shared/i18n'
const data = vi.hoisted(() => ({
  synergy: null as any,
  games: null as any,
  table: null as any,
  selects: [] as any[],
  requestSort: null as string | null,
  requestFocus: null as string | null
}))
vi.mock('@vueuse/core', () => ({ useResizeObserver: () => {} }))
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: Vue.defineComponent({
    props: ['position'],
    setup: (props) => () => h('position-icon', { 'data-position': props.position })
  })
}))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('./MetricHelp.vue', () => ({
  default: (props: any) =>
    h('metric-help', { 'aria-label': props.label, 'data-definition': props.definition })
}))
vi.mock('./MemberAnalysisMetricTable.vue', () => ({
  default: (props: any) => {
    data.table = props
    return null
  }
}))
vi.mock('naive-ui', () => ({
  useThemeVars: () => ({ fontFamily: 'system-ui' }),
  NSelect: (props: any) => {
    data.selects.push(props.options)
    if (data.requestSort && props['aria-label'] === '组合排序') {
      props['onUpdate:value'](data.requestSort)
    }
    if (data.requestFocus && props['aria-label'] === '聚焦成员')
      props['onUpdate:value'](data.requestFocus)
    return h('select-control', props)
  },
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NPagination: (props: any) => h('page-control', props)
}))
const game = (id: number, names: string[], win: boolean): MemberAnalysisGame =>
  ({
    gameId: id,
    timestamp: id * 1000,
    date: '2026-01-01',
    side: 'Blue',
    win,
    players: names.map((player, i) => ({ player, role: i ? 'JUNGLE' : 'TOP', champion: 'Garen' }))
  }) as MemberAnalysisGame
const render = () => renderToString(createSSRApp(SynergyView).use(I18nextVue, { i18next }))
beforeEach(() => {
  setActivePinia(createPinia())
  data.games = ref([
    game(1, ['Member 1', 'Member 2'], true),
    game(2, ['Member 1', 'Member 2'], false),
    game(3, ['Member 1', 'Member 3'], true),
    game(4, ['Member 2', 'Member 3'], false)
  ])
  data.games.value = data.games.value.flatMap((g, i) =>
    Array.from({ length: 4 }, (_, n) => ({ ...g, gameId: 100 + i * 4 + n }))
  )
  data.synergy = ref(aggregateSynergy(data.games.value))
  data.table = null
  data.selects = []
  data.requestSort = null
  data.requestFocus = null
})

test('default comparison retains eligible pairs, exact sample, baseline and interval with no automatic selection', async () => {
  const html = await render()
  expect(html).toContain('3 组')
  expect(html).not.toContain('组合比较 ·')
  expect(html).toContain('8 场')
  expect(html).toContain('4 胜 / 4 负')
  expect(html).toContain('共同胜率 50.0%，个人基线 50.0%，共同胜率 95% 区间')
  expect(html).toContain('0.0')
  expect(html).toContain('aria-pressed="false"')
  expect(html).not.toContain('aria-pressed="true"')
  expect(html).not.toContain('个人基线来自哪里')
  expect(html).toContain('选择左侧成员组合，查看个人基线')
  expect(html).not.toContain('未选择时不显示结果')
  expect(html).not.toContain('描述性差异，不代表配合带来的因果收益。')
  expect(html).not.toContain('计算口径与低样本处理')
  expect(html).not.toContain('全部组合精确值')
  expect(html).not.toMatch(/<details[^>]*\bopen\b/)
  expect(data.table).toBeNull()
  expect(html.match(/class="pair-select"/g)).toHaveLength(3)
  const rows = html.split('<tbody')[1].split('</tbody>')[0]
  expect(rows).not.toContain('上路 / 打野')
  expect(rows).not.toContain('2/2 场')
  expect(html).toContain('成员 A')
  expect(html).toContain('成员 B')
})
test('identical participation shows actual coverage instead of a zero ranking', async () => {
  data.games.value = [
    game(1, ['Member 1', 'Member 2'], true),
    game(2, ['Member 2', 'Member 1'], false)
  ]
  data.synergy.value = aggregateSynergy(data.games.value)
  const html = await render()
  expect(html).toContain('成员出场范围相同，无法比较同队差异。')
  expect(html).toContain('与其他成员共同对局')
  expect(html).toContain('50.0%')
  expect(html).toContain('2 场')
  expect(html).not.toContain('aria-pressed')
  expect(data.table).toBeNull()
})
test('empty input retains explicit empty state and omits result controls', async () => {
  data.games.value = []
  data.synergy.value = []
  const html = await render()
  expect(html).toContain('当前范围没有可比较的数据。')
  expect(html).not.toContain('成员组合')
  expect(data.table).toBeNull()
})
test('eligible long identities and numerical zero remain while three-game pairs and low-sample hints are omitted', async () => {
  const long = 'Member Synthetic Long Name'
  data.games.value = [
    ...Array.from({ length: 4 }, (_, i) => game(i + 1, [long, 'Member 2'], false)),
    ...Array.from({ length: 3 }, (_, i) => game(i + 5, ['Member 2', 'Member 3'], true))
  ]
  const rows = aggregateSynergy(data.games.value)
  data.synergy.value = rows
  const html = await render()
  expect(html).toContain(long)
  expect(html).toContain(`title="${long}"`)
  expect(html).toContain('class="pair-member-cell"')
  expect(html).not.toContain('样本较少')
  expect(html).toContain('1 组')
  expect(html).not.toContain('3 场')
  expect(rows.map((row) => row.games).sort()).toEqual([3, 4])
  expect(html).toContain('0.0%')
  data.synergy.value = [{ ...rows[0], gamesList: [] }]
  expect(await render()).not.toContain('分路未提供')
})

test('member selector preserves complete IDs and distinguishes equal names with different tags', async () => {
  // Generate fictional identities rather than recording production IDs in fixtures.
  const name = 'Member Synthetic Long Name'
  const first = `${name}#${1111}`
  const second = `${name}#${2222}`
  const legacy = 'Member 3'
  data.games.value = [game(1, [first, second], true), game(2, [second, legacy], false)]
  data.synergy.value = aggregateSynergy(data.games.value)
  await render()
  const options = data.selects.find((items: any[]) => items?.some((item) => item.value === first))
  expect(options).toHaveLength(3)
  expect(options).toEqual(
    expect.arrayContaining([first, second, legacy].map((value) => ({ label: value, value })))
  )
})

test('member A and B sorting keep numeric name order and expose matching header direction', async () => {
  data.games.value = [
    game(1, ['Member 10', 'Member 20'], true),
    game(2, ['Member 2', 'Member 3'], false),
    game(3, ['Member 1', 'Member 9'], true)
  ]
  data.games.value = data.games.value.flatMap((g, i) =>
    Array.from({ length: 4 }, (_, n) => ({ ...g, gameId: 100 + i * 4 + n }))
  )
  data.synergy.value = aggregateSynergy(data.games.value)
  const order = (html: string) =>
    [
      ...html
        .split('<tbody')[1]
        .split('</tbody>')[0]
        .matchAll(/title="(Member \d+)"/g)
    ].map((match) => match[1])
  for (const [sort, expected] of [
    [
      'playerA:ascending',
      ['Member 1', 'Member 9', 'Member 2', 'Member 3', 'Member 10', 'Member 20']
    ],
    [
      'playerA:descending',
      ['Member 10', 'Member 20', 'Member 2', 'Member 3', 'Member 1', 'Member 9']
    ],
    [
      'playerB:descending',
      ['Member 10', 'Member 20', 'Member 1', 'Member 9', 'Member 2', 'Member 3']
    ]
  ] as const) {
    data.requestSort = sort
    const html = await render()
    expect(order(html)).toEqual(expected)
    expect(html).toContain(`aria-sort="${sort.split(':')[1]}"`)
  }
})

test('shared games and each deviation sort in both directions, with absolute magnitude and stable ties', async () => {
  const members = [
    ['Member 10', 'Member 20'],
    ['Member 2', 'Member 3'],
    ['Member 1', 'Member 9']
  ]
  let id = 0
  data.games.value = members.flatMap((pair, index) =>
    Array.from({ length: 6 - index }, () => game(++id, pair, true))
  )
  data.synergy.value = aggregateSynergy(data.games.value).map((edge, index) => ({
    ...edge,
    observedDifference: [-0.2, 0.1, -0.1][index],
    adjustedDifference: [0.01, -0.3, 0.2][index]
  }))
  const expectedNames = (indexes: number[]) => indexes.flatMap((index) => members[index])
  const order = (html: string) =>
    [
      ...html
        .split('<tbody')[1]
        .split('</tbody>')[0]
        .matchAll(/title="(Member \d+)"/g)
    ].map((match) => match[1])
  for (const [sort, indexes] of [
    ['games:descending', [0, 1, 2]],
    ['games:ascending', [2, 1, 0]],
    ['observedAbsolute:descending', [0, 1, 2]],
    ['observedAbsolute:ascending', [1, 2, 0]],
    ['adjustedAbsolute:descending', [1, 2, 0]],
    ['adjustedAbsolute:ascending', [0, 2, 1]]
  ] as const) {
    data.requestSort = sort
    const html = await render()
    expect(order(html)).toEqual(expectedNames([...indexes]))
    expect(html).toContain(`aria-sort="${sort.split(':')[1]}"`)
  }
  const options = data.selects.find((items) =>
    items?.some((item: any) => item.value === 'adjustedAbsolute:ascending')
  )
  expect(options.find((item: any) => item.value === 'observedAbsolute:ascending').label).toContain(
    '观测偏差绝对值'
  )
  expect(options.find((item: any) => item.value === 'adjustedAbsolute:descending').label).toContain(
    '收缩后偏差绝对值'
  )
})

const descriptor = parse(
  readFileSync(new URL('./SynergyView.vue', import.meta.url), 'utf8')
).descriptor
SynergyView.render = new Function(
  'Vue',
  (
    await transformWithEsbuild(
      compile(descriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        expressionPlugins: ['typescript'],
        bindingMetadata: compileScript(descriptor, { id: 'synergy-behavior' }).bindings
      }).code,
      'synergy-render.ts',
      { loader: 'ts' }
    )
  ).code
)(Vue)
type Host = {
  type: string
  props: Record<string, any>
  text: string
  parent: Host | null
  children: Host[]
  scrollLeft: number
  scrollIntoView: () => void
  isConnected: boolean
  matches: (selector: string) => boolean
  focus: () => void
  closest: () => null
  querySelector: () => Host | null
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
    scrollIntoView() {},
    isConnected: true,
    matches: (selector) => selector === type,
    focus() {},
    closest: () => null,
    querySelector: () => walk(n).find((x) => x.props.class === 'pair-select') ?? null,
    querySelectorAll: () => walk(n).filter((x) => x.props.role === 'tab'),
    getBoundingClientRect: () => ({ left: 0, right: 500 })
  }
  return n
}
function harness() {
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
  const instance = ref<InstanceType<typeof SynergyView> | null>(null)
  const app = renderer.createApp({
    render: () => h(SynergyView, { ref: instance })
  })
  app.use(I18nextVue, { i18next })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  return { root, app, open, instance, all: () => walk(root) }
}
test('whole-row cells select once, genuine controls are ignored, and filtering clears hidden selection', async () => {
  const f = harness()
  const selected = () =>
    f.all().find((n) => n.props.class === 'synergy-evidence combination-comparison-evidence')
  const row = () => f.all().find((n) => n.type === 'tr' && typeof n.props.onClick === 'function')!
  try {
    const first = row()
    await first.props.onClick({ target: { closest: () => null }, currentTarget: first })
    await nextTick()
    expect(selected()).toBeDefined()
    const button = f.all().find((n) => n.props.class === 'pair-select')!
    const selectedKey = button.props['data-combination-key']
    await first.props.onClick({ target: { closest: () => button }, currentTarget: first })
    await nextTick()
    expect(selected()).toBeDefined()
    await button.props.onClick({ currentTarget: button, stopPropagation() {} })
    await nextTick()
    expect(selected()).toBeUndefined()
    await button.props.onClick({ currentTarget: button, stopPropagation() {} })
    await nextTick()
    expect(selected()).toBeDefined()
    data.synergy.value = data.synergy.value.map((e: any) =>
      e.key === selectedKey ? { ...e, games: 3 } : e
    )
    await nextTick()
    await nextTick()
    expect(selected()).toBeUndefined()
    expect(f.all().filter((n) => n.type === 'tr' && n.props.onClick)).toHaveLength(2)
    expect(data.synergy.value.find((e: any) => e.key === selectedKey).games).toBe(3)
    await f.instance.value!.selectMembers(['Member 1', 'Member 2'])
    await nextTick()
    expect(selected()).toBeUndefined()
  } finally {
    f.app.unmount()
  }
})

test('four-game boundary is display-only and remains enforced through focus and sorting', async () => {
  let id = 0
  data.games.value = [1, 2, 3, 4].flatMap((count) =>
    Array.from({ length: count }, () => game(++id, ['Anchor', `Peer ${count}`], true))
  )
  data.synergy.value = aggregateSynergy(data.games.value)
  const raw = data.synergy.value.map((e: any) => e.games)
  data.requestSort = 'games:ascending'
  let html = await render()
  expect(html).toContain('1 组')
  expect(html).toContain('4 场')
  expect(html).not.toContain('title="Peer 3"')
  const f = harness()
  try {
    const focus = f
      .all()
      .find((n) => n.type === 'select-control' && n.props['aria-label'] === '聚焦成员')!
    focus.props['onUpdate:value']('Peer 3')
    await nextTick()
    expect(f.all().some((n) => n.text === '0 组')).toBe(true)
    expect(f.all().some((n) => n.props.class === 'pair-select')).toBe(false)
  } finally {
    f.app.unmount()
  }
  expect(data.synergy.value.map((e: any) => e.games)).toEqual(raw)
})

test('joint matches retain ten-item pagination and exact short final page', async () => {
  data.games.value = [
    ...Array.from({ length: 13 }, (_, i) => game(i + 1, ['Synthetic A', 'Synthetic B'], true)),
    game(14, ['Synthetic C', 'Synthetic D'], false)
  ]
  data.synergy.value = aggregateSynergy(data.games.value)
  const f = harness()
  const jointRows = () => {
    const table = f.all().find((n) => n.props.class === 'joint-table')!
    return walk(table)
      .find((n) => n.type === 'tbody')!
      .children.filter((n) => n.type === 'tr')
  }
  try {
    const row = f.all().find((n) => n.type === 'tr' && n.props.onClick)!
    await row.props.onClick({ target: { closest: () => null }, currentTarget: row })
    await nextTick()
    expect(jointRows()).toHaveLength(5)
    const toggle = f.all().find((n) => n.type === 'button' && n.props['aria-expanded'] === false)!
    await toggle.props.onClick()
    await nextTick()
    expect(jointRows()).toHaveLength(10)
    const pager = f.all().find((n) => n.type === 'page-control' && n.props['page-size'] === 10)!
    expect(pager.props['item-count']).toBe(13)
    pager.props['onUpdate:page'](2)
    await nextTick()
    expect(jointRows()).toHaveLength(3)
    expect(data.games.value).toHaveLength(14)
  } finally {
    f.app.unmount()
  }
})
test('common-role translation slots preserve both roles and sample totals in Chinese and English', async () => {
  for (const language of ['zh-CN', 'en']) {
    await i18next.changeLanguage(language)
    const f = harness()
    try {
      await f.instance.value!.selectMembers(['Member 1', 'Member 2'])
      await nextTick()
      const sentence = f
        .all()
        .find((node) => node.props.class === 'synergy-note synergy-role-pair')!
      const text = (node: Host): string => node.text + node.children.map(text).join('')
      expect(
        walk(sentence)
          .filter((node) => node.type === 'position-icon')
          .map((node) => node.props['data-position'])
      ).toEqual(['TOP', 'JUNGLE'])
      expect(text(sentence)).toContain('8/8')
      expect(text(sentence)).toContain(language === 'zh-CN' ? '场' : 'matches')
      expect(text(sentence)).not.toContain('{role-')
    } finally {
      f.app.unmount()
      await i18next.changeLanguage('zh-CN')
    }
  }
})

test('common-role translation retains unknown text without inventing an icon', async () => {
  data.games.value.forEach((game: MemberAnalysisGame) => {
    game.players.forEach((player) => {
      if (player.player === 'Member 1') player.role = 'NONE' as typeof player.role
    })
  })
  data.synergy.value = aggregateSynergy(data.games.value)
  const f = harness()
  try {
    await f.instance.value!.selectMembers(['Member 1', 'Member 2'])
    await nextTick()
    const sentence = f.all().find((node) => node.props.class === 'synergy-note synergy-role-pair')!
    const text = (node: Host): string => node.text + node.children.map(text).join('')
    expect(
      walk(sentence)
        .filter((node) => node.type === 'position-icon')
        .map((node) => node.props['data-position'])
    ).toEqual(['JUNGLE'])
    expect(text(sentence)).toContain(uiText('synergyUnknownRole'))
    expect(text(sentence)).toContain('8/8')
  } finally {
    f.app.unmount()
  }
})

test('joint player cells retain hero text and render only proven native role icons for both members', async () => {
  const pair = [
    'Synthetic Long Member A#TESTONLY_SYNTHETIC',
    'Synthetic Long Member B#TESTONLY_SYNTHETIC'
  ]
  const rolePairs = [
    ['TOP', 'JUNGLE'],
    ['MIDDLE', 'BOTTOM'],
    ['UTILITY', 'NONE'],
    ['TOP', 'MIDDLE'],
    ['BOTTOM', 'UTILITY'],
    ['JUNGLE', 'TOP']
  ]
  data.games.value = rolePairs.map((roles, index) => {
    const item = game(index + 1, pair, index % 2 === 0)
    item.players = item.players.map((player, member) => ({
      ...player,
      // Legacy unknown role is deliberately exercised at the display boundary.
      role: roles[member] as typeof player.role,
      champion: member === 0 ? 'SyntheticChampionLongName_TESTONLY' : 'Garen'
    }))
    return item
  })
  data.games.value.push(game(99, [pair[0], 'Synthetic Other Member#TESTONLY_SYNTHETIC'], false))
  data.synergy.value = aggregateSynergy(data.games.value)
  const before = data.synergy.value.map((row: any) => [row.key, row.games, row.wins, row.winRate])
  const f = harness()
  try {
    await f.instance.value!.selectMembers(pair as [string, string])
    await nextTick()
    const table = f.all().find((node) => node.props.class === 'joint-table')!
    const cells = walk(table).filter((node) => node.props.class === 'joint-player')
    expect(cells).toHaveLength(10)
    const text = (node: Host): string => node.text + node.children.map(text).join('')
    for (const cell of cells) {
      const label = walk(cell).find((node) => node.props.class === 'joint-player-role')!
      const icons = walk(label).filter((node) => node.type === 'position-icon')
      expect(icons).toHaveLength(text(label) === uiText('synergyUnknownRole') ? 0 : 1)
      if (icons.length) expect(icons[0].props['aria-hidden']).toBe('true')
      const copy = walk(cell).find((node) => node.props.class === 'joint-player-copy')!
      const labels = copy.children.filter((node) => node.type !== 'text' && node.type !== 'comment')
      expect(labels.map((node) => node.type)).toEqual(['b', 'small'])
      expect(labels[0].props.class).toBe('joint-player-champion')
      expect(labels[1]).toBe(label)
      expect(text(labels[0])).toBeTruthy()
    }
    expect(cells.map(text).join(' ')).toContain('SyntheticChampionLongName_TESTONLY')
    expect(cells.map(text).join(' ')).toContain('Garen')
    expect(
      new Set(
        walk(table)
          .filter((node) => node.type === 'position-icon')
          .map((node) => node.props['data-position'])
      )
    ).toEqual(new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']))
    expect(
      data.synergy.value.map((row: any) => [row.key, row.games, row.wins, row.winRate])
    ).toEqual(before)
  } finally {
    f.app.unmount()
  }
})

test('same synergy row collapses without repositioning list or resetting horizontal scroll', async () => {
  const f = harness(),
    list = { scrollTop: 180, scrollLeft: 120 },
    outer = { scrollTop: 64, scrollLeft: 0 }
  try {
    const row = f.all().find((n) => n.type === 'tr' && n.props.onClick)!,
      button = f.all().find((n) => n.props.class === 'pair-select')!
    row.closest = ((selector: string) =>
      selector.includes('comparison-list') ? list : outer) as any
    const focused = vi.fn()
    button.focus = focused
    const event = { currentTarget: row, target: { closest: () => null } }
    await row.props.onClick(event)
    await nextTick()
    expect(button.props['aria-pressed']).toBe(true)
    const view = f.all().find((n) => n.props.class === 'ma-panel ma-workspace synergy-view')!
    view.getBoundingClientRect = () => {
      list.scrollTop += 64
      list.scrollLeft = 0
      outer.scrollTop += 64
      return { left: 0, right: 500 }
    }
    await row.props.onClick(event)
    await nextTick()
    expect(button.props['aria-pressed']).toBe(false)
    expect(list).toEqual({ scrollTop: 180, scrollLeft: 120 })
    expect(outer.scrollTop).toBe(64)
    expect(focused).toHaveBeenCalledWith({ preventScroll: true })
  } finally {
    f.app.unmount()
  }
})
