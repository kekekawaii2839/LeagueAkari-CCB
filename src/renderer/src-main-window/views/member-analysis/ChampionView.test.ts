// sort-imports-ignore
import './test-i18n'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  createSSRApp,
  createRenderer,
  h,
  nextTick,
  reactive,
  ref,
  ssrContextKey,
  type Slots
} from 'vue'
import * as Vue from 'vue'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { renderToString } from 'vue/server-renderer'
import type { ChampionAggregate } from './analytics'
import ChampionView from './ChampionView.vue'
import type { ChampionPoolSort } from './champion-pools'

type TestStore = {
  settings: { members: { gameName: string; tagLine: string; serverId: string }[] }
  filters: { matchRole: string }
  championViewState: { sort: ChampionPoolSort | null }
  overviewGeneration: number
  memberProfileIcons: Record<string, number | null>
}
const fixture = vi.hoisted(() => ({
  store: null as unknown as TestStore,
  players: [] as string[],
  avatarIcons: [] as (number | null)[]
}))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => fixture.store
}))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({
    games: ref([]),
    champions: ref(
      fixture.players.flatMap((player) =>
        ['Garen', 'Shen', 'Ornn', 'Sion'].map(
          (champion, index) =>
            ({
              player,
              role: 'TOP',
              champion,
              games: 4 - index,
              wins: 1,
              winRate: 1 / (4 - index),
              pickRate: (4 - index) / 10,
              blueGames: 4 - index,
              blueWins: 1,
              redGames: 0,
              redWins: 0,
              performance: {}
            }) as ChampionAggregate
        )
      )
    )
  })
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/shards/extra-assets/store', () => ({
  useExtraAssetsStore: () => ({ heroListMap: {} })
}))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({ champions: { name: String } })
}))
vi.mock('./MemberProfileAvatar.vue', () => ({
  default: {
    props: ['iconId'],
    setup(props: { iconId: number | null }) {
      return () => {
        fixture.avatarIcons.push(props.iconId)
        return h('span', { 'aria-hidden': 'true' })
      }
    }
  }
}))
vi.mock('./ChampionPoolPortrait.vue', () => ({
  default: (props: { row: ChampionAggregate }) =>
    h(
      'button',
      {
        'aria-label': `${props.row.champion}: ${props.row.games} 场`
      },
      props.row.champion
    )
}))
vi.mock('./ChampionPoolPopover.vue', () => ({ default: () => null }))
vi.mock('naive-ui', () => ({
  NIcon: (props: Record<string, unknown>, { slots }: { slots: Slots }) =>
    h('i', props, slots.default?.()),
  NButton: (_: unknown, { slots }: { slots: Slots }) => h('button', slots.default?.()),
  NPopover: (_: unknown, { slots }: { slots: Slots }) => slots.trigger?.()
}))

beforeEach(() => {
  fixture.players = ['SYNTHETIC_TEST_ONLY#TESTONLY']
  fixture.avatarIcons = []
  fixture.store = reactive({
    settings: {
      members: [{ gameName: 'SYNTHETIC_TEST_ONLY', tagLine: 'TESTONLY', serverId: 'TEST' }]
    },
    filters: { matchRole: 'all' },
    championViewState: { sort: null },
    overviewGeneration: 1,
    memberProfileIcons: {}
  })
})

test('pool shows the top three heroes and samples without the redundant title or legend', async () => {
  const html = await renderToString(createSSRApp(ChampionView))
  expect(html).not.toContain('常用英雄（前三）')
  expect(html).not.toContain('外环：选用率')
  expect(html).not.toContain('恢复成员顺序')
  for (const champion of ['Garen', 'Shen', 'Ornn']) expect(html).toContain(champion)
  expect(html).not.toContain('Sion')
  expect(html).toContain('10 场')
  expect(html).toContain('aria-haspopup="dialog"')
})

test('all five role headings retain labels and accessible sort actions beside decorative native SVGs', async () => {
  const html = await renderToString(createSSRApp(ChampionView))
  const heading = html.split('<thead')[1].split('</thead>')[0]
  expect(heading.match(/<svg\b/g)).toHaveLength(5)
  expect(heading.match(/aria-hidden="true"/g)).toHaveLength(10)
  for (const role of ['上路', '打野', '中路', '下路', '辅助']) expect(heading).toContain(role)
  expect(heading.match(/data-sort-role=/g)).toHaveLength(5)
})

test('an active sort exposes the metric direction without a separate restore button', async () => {
  fixture.store.championViewState.sort = { role: 'TOP', metric: 'games', direction: 'descending' }
  const html = await renderToString(createSSRApp(ChampionView))
  expect(html).not.toContain('恢复成员顺序')
  expect(html).toContain('按上路排序 · 场数：多到少')
  expect(html).toContain('aria-sort="descending"')
  expect(html).not.toContain('常用英雄（前三）')
  expect(html).not.toContain('外环：选用率')
})

test('same-name members retain distinct complete tags and their controlled profile icons', async () => {
  const name = 'SYNTHETIC_TEST_ONLY_LONG_MEMBER_NAME'
  fixture.players = [name + '#SYNTHETIC_TAG_A', name + '#SYNTHETIC_TAG_B']
  fixture.store.settings.members = ['SYNTHETIC_TAG_A', 'SYNTHETIC_TAG_B'].map((tagLine) => ({
    gameName: name,
    tagLine,
    serverId: 'TEST'
  }))
  fixture.store.memberProfileIcons = { [fixture.players[0]]: 0, [fixture.players[1]]: 29 }
  const html = await renderToString(createSSRApp(ChampionView))
  expect((html.match(/<th scope="row"/g) ?? []).length).toBe(2)
  expect(html).toMatch(new RegExp('<strong[^>]*>' + name + '</strong>'))
  expect(html).toMatch(/<small[^>]*>#SYNTHETIC_TAG_A<\/small>/)
  expect(html).toMatch(/<small[^>]*>#SYNTHETIC_TAG_B<\/small>/)
  expect(fixture.avatarIcons).toEqual([0, 29])
})

test('missing tags keep a neutral second line and unavailable icons use the shared fallback', async () => {
  fixture.players = ['SYNTHETIC_TEST_ONLY_WITHOUT_TAG']
  const html = await renderToString(createSSRApp(ChampionView))
  expect(html).toMatch(/<strong[^>]*>SYNTHETIC_TEST_ONLY_WITHOUT_TAG<\/strong>/)
  expect(html).toMatch(/<small[^>]*>—<\/small>/)
  expect(fixture.avatarIcons).toEqual([null])
})

// Mount the real template so sort-state tests exercise its actual native button handlers.
const descriptor = parse(
  readFileSync(new URL('./ChampionView.vue', import.meta.url), 'utf8')
).descriptor
ChampionView.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'champion-sort-behavior' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)

type HostNode = {
  type: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  style: Record<string, string>
  closest: () => null
  addEventListener: () => void
  removeEventListener: () => void
}
const hostNode = (type: string): HostNode => ({
  type,
  props: {},
  children: [],
  parent: null,
  style: {},
  closest: () => null,
  addEventListener() {},
  removeEventListener() {}
})
function mountChampionView() {
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: hostNode,
    createComment: hostNode,
    createText: hostNode,
    setText() {},
    setElementText(n, text) {
      n.props.text = text
    },
    parentNode: (n) => n.parent,
    nextSibling: () => null,
    patchProp(n, key, _old, value) {
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
  const root = hostNode('root'),
    app = renderer.createApp(ChampionView)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = (): HostNode[] => {
    const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  const trigger = (role: string) => all().find((n) => n.props['data-sort-role'] === role)!
  const click = async (role: string) => {
    await trigger(role).props.onClick()
    await nextTick()
  }
  return { app, all, trigger, click }
}

test('each role button cycles the existing four sorts and returns to the configured default order', async () => {
  const f = mountChampionView()
  try {
    for (const expected of [
      { role: 'TOP', metric: 'games', direction: 'descending' },
      { role: 'TOP', metric: 'games', direction: 'ascending' },
      { role: 'TOP', metric: 'heroes', direction: 'descending' },
      { role: 'TOP', metric: 'heroes', direction: 'ascending' },
      null
    ]) {
      await f.click('TOP')
      expect(fixture.store.championViewState.sort).toEqual(expected)
      const heading = f.trigger('TOP').parent!
      expect(heading.props['aria-sort']).toBe(expected?.direction ?? 'none')
      expect(f.trigger('TOP').props.type).toBe('button')
      expect(f.trigger('TOP').props['aria-label']).toContain(
        expected?.metric === 'heroes' ? '英雄数量' : expected ? '场数' : '按上路排序'
      )
    }
    expect(fixture.store.championViewState.sort).toBeNull()
  } finally {
    f.app.unmount()
  }
})

test('switching columns starts its first sort, retained state survives remount, and excluded columns reset safely', async () => {
  let f = mountChampionView()
  try {
    await f.click('TOP')
    await f.click('TOP')
    await f.click('JUNGLE')
    expect(fixture.store.championViewState.sort).toEqual({
      role: 'JUNGLE',
      metric: 'games',
      direction: 'descending'
    })
    expect(f.trigger('TOP').parent!.props['aria-sort']).toBe('none')
    f.app.unmount()
    f = mountChampionView()
    await nextTick()
    expect(fixture.store.championViewState.sort?.role).toBe('JUNGLE')
    fixture.store.filters.matchRole = 'TOP'
    await nextTick()
    expect(fixture.store.championViewState.sort).toBeNull()
    expect(f.trigger('JUNGLE').props.disabled).toBe(true)
    await f.click('JUNGLE')
    expect(fixture.store.championViewState.sort).toBeNull()
    await f.click('TOP')
    expect(fixture.store.championViewState.sort).toEqual({
      role: 'TOP',
      metric: 'games',
      direction: 'descending'
    })
  } finally {
    f.app.unmount()
  }
})
