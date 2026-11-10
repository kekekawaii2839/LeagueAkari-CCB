// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref } from 'vue'
import ChampionTierView from './ChampionTierView.vue'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

const state = vi.hoisted(() => ({ games: null as any }))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ games: state.games })
}))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => ({ settings: { members: [] } })
}))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({
    champions: { name: (id: number) => ['', 'Alpha', 'Beta', 'Gamma', 'Zeta', 'Theta'][id] }
  })
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({
    gameData: {
      champions: {
        1: { id: 1, name: 'Alpha' },
        2: { id: 2, name: 'Beta' },
        3: { id: 3, name: 'Gamma' },
        4: { id: 4, name: 'Zeta' },
        5: { id: 5, name: 'Theta' }
      }
    }
  })
}))
vi.mock('@renderer-shared/shards/extra-assets/store', () => ({
  useExtraAssetsStore: () => ({ heroListMap: {} })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: () => h('icon')
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: () => h('icon')
}))
vi.mock('naive-ui', () => ({
  ...Object.fromEntries(
    ['NEmpty', 'NInput', 'NButton'].map((kind) => [
      kind,
      (props: any, { slots }: any) =>
        h(kind === 'NButton' ? 'button' : 'control', { ...props, kind }, [
          slots.icon?.(),
          slots.default?.()
        ])
    ])
  )
}))
const descriptor = parse(
  readFileSync(new URL('./ChampionTierView.vue', import.meta.url), 'utf8')
).descriptor
ChampionTierView.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'champion-tier-view' }).bindings
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
}
const node = (type: string): Node => ({ type, text: '', props: {}, children: [], parent: null })
function harness(games: MemberAnalysisGame[]) {
  state.games = ref(games)
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
  const root = node('root'),
    app = renderer.createApp(ChampionTierView)
  app.provide(Vue.ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
  const text = (n: Node) =>
    walk(n)
      .map((child) => child.text)
      .join(' ')
  return {
    all: () => walk(root),
    text: () => text(root),
    rows: () =>
      walk(root)
        .filter(
          (n) =>
            n.type === 'tr' &&
            n.parent?.type === 'tbody' &&
            n.parent.parent?.props['aria-label'] === '本地英雄 Tier 榜单'
        )
        .map(text),
    cells: () =>
      walk(root)
        .filter(
          (n) =>
            n.type === 'tr' &&
            n.parent?.type === 'tbody' &&
            n.parent.parent?.props['aria-label'] === '本地英雄 Tier 榜单'
        )
        .map((row) => row.children.map(text)),
    dispose: () => app.unmount()
  }
}
const games = () =>
  Array.from({ length: 8 }, (_, gameId) => ({
    gameId,
    win: gameId < 4,
    bans: gameId < 6 ? { own: [], enemy: [] } : undefined,
    players: [
      { champion: gameId < 6 ? 'Alpha' : 'Gamma', role: 'TOP' },
      { champion: 'Beta', role: 'MIDDLE' }
    ]
  })) as unknown as MemberAnalysisGame[]

test('renders OP first, reverses graded order and excludes rows below five games', async () => {
  const champions = ['Alpha', 'Beta', 'Gamma', 'Zeta', 'Theta']
  const input = champions.flatMap((champion, group) =>
    Array.from({ length: 20 }, (_, i) => ({
      gameId: group * 20 + i,
      win: group === 0 || i < 9,
      bans: { own: [], enemy: [] },
      players: [
        { champion, role: 'TOP' },
        ...(i < 2 && group === 0 ? [{ champion: 'LowSample', role: 'MIDDLE' }] : [])
      ]
    }))
  ) as unknown as MemberAnalysisGame[]
  const f = harness(input)
  try {
    expect(f.cells()[0][0]).toContain('Alpha')
    expect(f.cells()[0][1].trim()).toBe('OP')
    expect(f.rows()).toHaveLength(5)
    expect(f.text()).not.toContain('LowSample')
    const tier = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('本地 Tier：'))!
    tier.props.onClick()
    await nextTick()
    expect(f.cells().at(-1)![1].trim()).toBe('OP')
    const hero = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('查看Alpha（'))!
    hero.props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(f.text()).not.toContain('Tier 0')
    expect(f.text()).not.toContain('实验分级')
  } finally {
    f.dispose()
  }
})

test('all-role rows select the same champion independently and details use its own role', async () => {
  const input = Array.from({ length: 6 }, (_, i) => ({
    gameId: i,
    win: i < 4,
    bans: { own: [1], enemy: [] },
    players: [
      { champion: 'Alpha', role: 'TOP', player: 'Top#SYNTHETIC' },
      ...(i < 5 ? [{ champion: 'Alpha', role: 'MIDDLE', player: 'Mid#SYNTHETIC' }] : [])
    ]
  })) as unknown as MemberAnalysisGame[]
  const f = harness(input)
  const heroes = () =>
    f.all().filter((n) => n.type === 'button' && n.props['aria-label']?.startsWith('查看Alpha（'))
  try {
    expect(f.rows()).toHaveLength(2)
    expect(new Set(heroes().map((n) => n.props['aria-label'])).size).toBe(2)
    expect(
      heroes()
        .map((n) => n.props['aria-label'])
        .join(' ')
    ).toContain('上路')
    expect(
      heroes()
        .map((n) => n.props['aria-label'])
        .join(' ')
    ).toContain('中路')
    expect(f.rows().some((row) => row.includes('上路'))).toBe(true)
    expect(f.rows().some((row) => row.includes('中路'))).toBe(true)
    heroes()
      .find((n) => n.props['aria-label'].includes('上路'))!
      .props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(f.text()).toContain('Top#SYNTHETIC')
    expect(f.text()).not.toContain('Mid#SYNTHETIC')
    expect(f.text()).toContain('当前分路无可比较差异')
    heroes()
      .find((n) => n.props['aria-label'].includes('中路'))!
      .props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(
      heroes()
        .filter((n) => n.props['aria-pressed'])
        .map((n) => n.props['aria-label'])
    ).toEqual([expect.stringContaining('中路')])
    expect(f.text()).toContain('Mid#SYNTHETIC')
    expect(f.text()).not.toContain('Top#SYNTHETIC')
    const banTable = f
      .all()
      .find((n) => n.type === 'table' && n.props['aria-label'] === 'Alpha的禁用统计')!
    const walk = (n: Node): string => n.text + ' ' + n.children.map(walk).join(' ')
    expect(walk(banTable)).not.toContain('有效')
    const banRows = banTable.children
      .find((n) => n.type === 'tbody')!
      .children.filter((n) => n.type === 'tr')
    expect(banRows).toHaveLength(3)
    expect(banRows.map((row) => row.children[0].props['aria-description'])).toEqual([
      '有效 5/5 场',
      '有效 5/5 场',
      '有效 5/5 场'
    ])
  } finally {
    f.dispose()
  }
})

test('does not show the footer methodology disclosure while preserving the tier list', () => {
  const f = harness(games())
  try {
    expect(f.rows().length).toBeGreaterThan(0)
    expect(f.text()).not.toContain('统计口径与本地 Tier 算法')
    expect(f.all().some((n) => n.type === 'details')).toBe(false)
  } finally {
    f.dispose()
  }
})

test('shows single-line rates without scores or sample sublines, preserving coverage and missingness', () => {
  const f = harness(games())
  try {
    expect(f.text()).not.toContain('本地样本分级')
    const alpha = f.rows().find((row) => row.includes('Alpha'))!
    expect(alpha).not.toContain('本地得分')
    expect(alpha).not.toContain('/6 场')
    expect(alpha).not.toContain('/8 场')
    const cells = f.cells().find((row) => row[0].includes('Alpha'))!
    expect(cells.slice(2, 5).map((cell) => cell.trim())).toEqual(['66.7%', '75.0%', '0.0%'])
    expect(cells[5].trim()).toBe('6')
    expect(f.text()).toContain('当前 8 场')
    expect(f.text()).not.toContain('双方禁用有效')
    expect(alpha).toContain('0.0%')
    expect(f.rows().some((row) => row.includes('Gamma'))).toBe(false)
  } finally {
    f.dispose()
  }
})

test('role and header sorting affect the table while preserving the shared sample', async () => {
  const f = harness(games())
  try {
    const top = f.all().find((n) => n.type === 'button' && n.props['aria-label'] === '上路')!
    top.props.onClick()
    await nextTick()
    expect(f.rows()).toHaveLength(1)
    expect(f.rows().some((row) => row.includes('Beta'))).toBe(false)
    expect(f.text()).toContain('当前 8 场')
    expect(top.props['aria-pressed']).toBe(true)
    f.all()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '全部分路')!
      .props.onClick()
    await nextTick()
    expect(top.props['aria-pressed']).toBe(false)
    const sortControl = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('场次：'))!
    sortControl.props.onClick()
    await nextTick()
    expect(f.rows()[0]).toContain('Beta')
    expect(sortControl.parent?.props['aria-sort']).toBe('descending')
    sortControl.props.onClick()
    await nextTick()
    expect(f.rows()[0]).toContain('Alpha')
    expect(sortControl.parent?.props['aria-sort']).toBe('ascending')
    sortControl.props.onClick()
    await nextTick()
    expect(sortControl.parent?.props['aria-sort']).toBe('none')
    expect(state.games.value).toHaveLength(8)
  } finally {
    f.dispose()
  }
})

test('header sorting keeps ungraded rows last in both directions and exposes one active column', async () => {
  const f = harness(games())
  try {
    const tier = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('本地 Tier：'))!
    expect(tier.parent?.props['aria-sort']).toBe('ascending')
    expect(f.rows().some((row) => row.includes('Gamma'))).toBe(false)
    tier.props.onClick()
    await nextTick()
    expect(tier.parent?.props['aria-sort']).toBe('descending')
    expect(f.rows().some((row) => row.includes('Gamma'))).toBe(false)
    const bans = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('禁用率：'))!
    bans.props.onClick()
    await nextTick()
    const descending = f.rows()
    bans.props.onClick()
    await nextTick()
    // All observed ban rates are zero: direction must not reverse tied rows.
    expect(f.rows()).toEqual(descending)
    expect(tier.parent?.props['aria-sort']).toBe('none')
    expect(bans.parent?.props['aria-sort']).toBe('ascending')
  } finally {
    f.dispose()
  }
})

test('missing bans are explicit and never presented as a zero rate or a scored tier', () => {
  const f = harness(
    games()
      .slice(0, 6)
      .map((game) => ({ ...game, bans: undefined }))
  )
  try {
    for (const row of f.rows()) {
      expect(row).toContain('未分级')
      expect(row).toContain('禁用记录不可用')
      expect(row).not.toContain('本地得分')
    }
    expect(f.text()).toContain('当前 6 场')
    expect(f.text()).not.toContain('双方禁用有效')
  } finally {
    f.dispose()
  }
})

test('ban header sorting preserves real zeroes, positive rates and multiple missing identities', async () => {
  const f = harness(
    games().map((game) => ({
      ...game,
      bans: { own: [1], enemy: [] },
      players: [
        ...game.players,
        { champion: 'Delta', role: 'UTILITY' },
        { champion: 'Epsilon', role: 'JUNGLE' }
      ] as MemberAnalysisGame['players']
    }))
  )
  try {
    const button = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('禁用率：'))!
    button.props.onClick()
    await nextTick()
    expect(f.rows()[0]).toContain('Alpha')
    const missing = f.rows().slice(-2)
    expect(missing.some((row) => row.includes('Delta'))).toBe(true)
    expect(missing.some((row) => row.includes('Epsilon'))).toBe(true)
    button.props.onClick()
    await nextTick()
    expect(f.rows()[0]).toContain('0.0%')
    expect(f.rows()[0]).not.toContain('Alpha')
    expect(f.rows().at(-3)).toContain('Alpha')
    expect(f.rows().slice(-2)).toEqual(missing)
  } finally {
    f.dispose()
  }
})

test('search respects composition, supports clearing, and never changes the shared sample', async () => {
  const f = harness(games())
  try {
    const input = () => f.all().find((n) => n.props.kind === 'NInput')!
    input().props.onCompositionstart()
    input().props['onUpdate:value']('Beta')
    await nextTick()
    expect(f.rows()).toHaveLength(2)
    input().props.onCompositionend({ target: { value: 'Beta' } })
    await nextTick()
    expect(f.rows()).toHaveLength(1)
    expect(f.rows()[0]).toContain('Beta')
    expect(f.text()).toContain('当前 8 场')
    input().props['onUpdate:value']('not-a-champion')
    await nextTick()
    expect(f.rows()).toHaveLength(0)
    const empty = f.all().find((n) => n.props.kind === 'NEmpty')!
    expect(empty.props.description).toContain('没有匹配的英雄')
    input().props['onUpdate:value']('')
    await nextTick()
    expect(f.rows()).toHaveLength(2)
    expect(state.games.value).toHaveLength(8)
  } finally {
    f.dispose()
  }
})

test('champion selection shows per-member records, toggles off, and clears stale details after filtering', async () => {
  const input = games().map((game) => ({
    ...game,
    players: game.players.map((player) => ({
      ...player,
      player: player.role === 'TOP' ? 'Member A#TESTONLY' : 'Member B#TESTONLY'
    }))
  }))
  const f = harness(input)
  const hero = () =>
    f.all().find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('查看Alpha（'))!
  const clickHero = () => hero().props.onClick({ stopPropagation() {} })
  try {
    expect(f.text()).toContain('点击英雄行')
    clickHero()
    await nextTick()
    expect(hero().props['aria-expanded']).toBe(true)
    expect(f.text()).toContain('Member A#TESTONLY')
    expect(f.text()).toContain('4 胜 2 负')
    expect(f.text()).toContain('禁用统计')
    expect(f.text()).not.toContain('仅列出当前')
    expect(f.text()).not.toContain('禁用按')
    expect(f.text()).not.toContain('谁禁用过')
    expect(f.text()).not.toContain('禁用者未采集')
    expect(f.text()).not.toContain('Member B#TESTONLY')
    clickHero()
    await nextTick()
    expect(hero().props['aria-expanded']).toBe(false)
    expect(f.text()).not.toContain('Member A#TESTONLY')
    clickHero()
    await nextTick()
    const close = f.all().find((n) => n.type === 'button' && n.props['aria-label'] === '关闭详情')!
    close.props.onClick()
    await nextTick()
    expect(f.text()).not.toContain('Member A#TESTONLY')
    clickHero()
    await nextTick()
    state.games.value = input.slice(0, 1)
    await nextTick()
    expect(f.rows()).toHaveLength(0)
    expect(f.text()).not.toContain('1 胜 0 负')
    expect(f.text()).not.toContain('4 胜 2 负')
    const search = f.all().find((n) => n.props.kind === 'NInput')!
    search.props['onUpdate:value']('Beta')
    await nextTick()
    expect(f.text()).toContain('所选英雄已不在当前范围')
    expect(f.text()).not.toContain('Member A#TESTONLY')
  } finally {
    f.dispose()
  }
})

test('five-game cutoff applies per role, preserves the scope and clears a newly ineligible selection', async () => {
  const input = Array.from({ length: 9 }, (_, i) => ({
    gameId: i,
    win: i < 3,
    bans: { own: [], enemy: [] },
    players: [{ champion: 'Alpha', role: i < 5 ? 'TOP' : 'MIDDLE' }]
  })) as unknown as MemberAnalysisGame[]
  const f = harness(input)
  try {
    expect(f.rows()).toHaveLength(1)
    expect(f.cells()[0][5].trim()).toBe('5')
    expect(f.text()).toContain('当前 9 场')
    const hero = f
      .all()
      .find((n) => n.type === 'button' && n.props['aria-label']?.startsWith('查看Alpha（'))!
    hero.props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(hero.props['aria-expanded']).toBe(true)
    state.games.value = input.slice(1)
    await nextTick()
    expect(f.rows()).toHaveLength(0)
    expect(f.text()).toContain('所选英雄已不在当前范围')
    expect(state.games.value).toHaveLength(8)
  } finally {
    f.dispose()
  }
})
