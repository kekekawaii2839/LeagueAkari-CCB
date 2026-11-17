// sort-imports-ignore
import '../test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref } from 'vue'
import PatchNotesPanel from './PatchNotesPanel.vue'
import type { PatchNotes } from '@shared/shards/member-analysis/patch-notes'

const io = vi.hoisted(() => ({
  read: vi.fn(),
  itemName: '合成装备' as string | null,
  clientItems: {} as Record<number, { name: string }>,
  clientPerks: {} as Record<number, { name: string }>
}))
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => ({ getPatchNotes: io.read }) }))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({
    champions: { name: (id: number) => (id === 1 ? '合成英雄' : ''), icon: () => null },
    items: {
      display: (id: number) =>
        (id === 1001 || id === 3008 || id === 2520) && io.itemName
          ? { name: io.itemName, iconPath: '/synthetic-item.png' }
          : null
    }
  })
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({
    gameData: {
      champions: { 1: { id: 1, alias: 'SyntheticHero' } },
      items: io.clientItems,
      perks: io.clientPerks
    }
  })
}))
vi.mock('@renderer-shared/shards/extra-assets/store', () => ({
  useExtraAssetsStore: () => ({ heroListMap: {} })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: {
    props: ['championId'],
    setup: (props: { championId: number }) => () =>
      h('champion-icon', { championId: props.championId })
  }
}))
vi.mock('@renderer-shared/components/LcuImage.vue', () => ({
  default: (props: any) => h('item-icon', props)
}))
vi.mock('naive-ui', () =>
  Object.fromEntries(
    ['NButton', 'NInput', 'NSelect', 'NPagination'].map((kind) => [
      kind,
      (props: any, { slots }: any) => h('control', { ...props, kind }, slots.default?.())
    ])
  )
)
const descriptor = parse(
  readFileSync(new URL('./PatchNotesPanel.vue', import.meta.url), 'utf8')
).descriptor
PatchNotesPanel.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'patch-notes-panel' }).bindings
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
const reply = (patch = '16.21'): { ok: true; value: PatchNotes } => ({
  ok: true,
  value: {
    patch,
    publicPatch: '26.21',
    status: 'available',
    stale: false,
    source: 'Riot Games · en-US',
    sourceUrl:
      'https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/',
    publishedAt: '2026-10-20T18:00:00.000Z',
    fetchedAt: 1,
    parserVersion: 2,
    truncated: false,
    sections: [
      {
        category: 'champion',
        title: 'Synthetic Hero',
        section: 'Champions',
        hotfix: false,
        entityKey: 'SyntheticHero',
        changes: ['Damage: 10 ⇒ 12'],
        entries: [
          {
            text: 'Damage: 10 ⇒ 12',
            label: 'Damage',
            before: '10',
            after: '12',
            ability: 'Q - Synthetic'
          }
        ]
      }
    ]
  }
})
function harness(
  initialActive = true,
  initialReply = reply(),
  read?: (request: any) => Promise<any>
) {
  io.read.mockReset().mockImplementation(
    read ??
      (async ({ patch, latest }) => ({
        ...initialReply,
        value: {
          ...initialReply.value,
          patch: latest ? (initialReply.value.availablePatches?.[0] ?? patch) : patch
        }
      }))
  )
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
  const active = ref(initialActive),
    root = node('root')
  const app = renderer.createApp({ render: () => h(PatchNotesPanel, { active: active.value }) })
  app.provide(Vue.ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
  return {
    active,
    expandAll: () =>
      walk(root)
        .find(
          (n) => n.props.kind === 'NButton' && n.children.some((child) => child.text === '展开全部')
        )
        ?.props.onClick(),
    all: () => walk(root),
    text: () =>
      walk(root)
        .map((n) => n.text)
        .join(' '),
    dispose: () => app.unmount()
  }
}

test('base and mid-patch changes for the same champion stay in separate labelled regions', async () => {
  const data = reply()
  const base = { ...data.value.sections[0], title: 'Varus', entityKey: 'Varus' }
  data.value.sections = [{ ...base, hotfix: true, section: 'Mid-Patch Updates' }, base]
  const f = harness(true, data)
  const text = (n: Node): string => [n.text, ...n.children.map(text)].join(' ')
  const groups = () =>
    f.all().filter((n) => n.type === 'section' && n.props['aria-label']?.startsWith('26.21'))
  try {
    await vi.waitFor(() => expect(groups()).toHaveLength(2))
    expect(groups().map((n) => n.props['aria-label'])).toEqual([
      '26.21 · 常规改动',
      '26.21 · 临时热更新'
    ])
    for (const group of groups()) {
      expect(text(group)).toContain('Varus')
      expect(group.children.some((n) => n.type === 'h2')).toBe(true)
    }
    const buttons = f.all().filter((n) => n.props['aria-controls']?.startsWith('patch-detail-'))
    buttons[0].props.onClick()
    await nextTick()
    expect(buttons[0].props['aria-expanded']).toBe(true)
    expect(buttons[1].props['aria-expanded']).toBe(false)
    f.expandAll()
    await nextTick()
    expect(f.all().filter((n) => n.type === 'ul')).toHaveLength(2)
    expect(f.all().some((n) => n.props.kind === 'NInput')).toBe(false)
  } finally {
    f.dispose()
  }
})

test('independent page loads actual structured contents automatically and renders before/after values', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(f.text()).toContain('Synthetic Hero'))
    f.expandAll()
    await nextTick()
    expect(io.read).toHaveBeenCalledWith({ patch: '16.21', latest: true, cacheOnly: true })
    expect(
      f.all().some((n) => n.type === 'span' && n.children.some((child) => child.text === '10'))
    ).toBe(true)
    expect(
      f
        .all()
        .some((n) => n.type === 'span' && n.children.some((child) => child.text.trim() === '12'))
    ).toBe(true)
    expect(f.text()).toContain('↑ 加强')
    expect(f.text()).toContain('Q - Synthetic')
    expect(f.text()).toContain('合成英雄')
    expect(f.all().some((n) => n.type === 'champion-icon' && n.props.championId === 1)).toBe(true)
    const refresh = f
      .all()
      .find((n) => n.props.kind === 'NButton' && typeof n.props.onClick === 'function')!
    refresh.props.onClick()
    await vi.waitFor(() =>
      expect(io.read).toHaveBeenLastCalledWith({ patch: '16.21', latest: true, refresh: true })
    )
  } finally {
    f.dispose()
  }
})

test('overview renders more than ten objects without pagination and supports per-object and all details', async () => {
  const data = reply()
  data.value.sections = Array.from({ length: 23 }, (_, index) => ({
    ...data.value.sections[0],
    title: `Synthetic ${index}`,
    entityKey: null
  }))
  const f = harness(true, data)
  try {
    await vi.waitFor(() => expect(f.all().filter((n) => n.type === 'article')).toHaveLength(23))
    expect(f.all().some((n) => n.props.kind === 'NPagination')).toBe(false)
    expect(f.all().filter((n) => n.type === 'ul')).toHaveLength(0)
    const detail = () =>
      f
        .all()
        .find((n) => n.props.kind === 'NButton' && n.props['aria-controls'] === 'patch-detail-0')!
    expect(detail().props['aria-expanded']).toBe(false)
    detail().props.onClick()
    await nextTick()
    expect(detail().props['aria-expanded']).toBe(true)
    expect(f.all().filter((n) => n.type === 'ul')).toHaveLength(1)
    f.expandAll()
    await nextTick()
    expect(f.all().filter((n) => n.type === 'ul')).toHaveLength(23)
    f.all()
      .find(
        (n) => n.props.kind === 'NButton' && n.children.some((child) => child.text === '收起全部')
      )!
      .props.onClick()
    await nextTick()
    expect(f.all().filter((n) => n.type === 'ul')).toHaveLength(0)
    expect(f.all().filter((n) => n.type === 'article')).toHaveLength(23)
  } finally {
    f.dispose()
  }
})

test('hidden lazy page does no loading, activation loads, and later replies cannot populate hidden page', async () => {
  const f = harness(false)
  try {
    await nextTick()
    expect(io.read).not.toHaveBeenCalled()
    let finish!: (value: unknown) => void
    io.read.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    f.active.value = true
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(1)
    f.active.value = false
    await nextTick()
    finish(reply())
    await nextTick()
    await nextTick()
    expect(f.text()).not.toContain('Synthetic Hero')
    expect(f.text()).not.toContain('当前搜索或类别没有匹配')
    expect(f.text()).not.toContain('官方摘录中没有可识别')
  } finally {
    f.dispose()
  }
})

test('refresh failure retains structured notes and exposes a retry action', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(f.text()).toContain('Synthetic Hero'))
    f.expandAll()
    await nextTick()
    io.read.mockRejectedValueOnce(new Error('synthetic failure'))
    const refresh = f
      .all()
      .find((n) => n.props.kind === 'NButton' && typeof n.props.onClick === 'function')!
    refresh.props.onClick()
    await vi.waitFor(() => expect(f.text()).toContain('已保留上次公告内容'))
    expect(f.text()).toContain('Synthetic Hero')
    const retry = f
      .all()
      .find((n) => n.props.kind === 'NButton' && n.children.some((child) => child.text === '重试'))!
    expect(retry).toBeDefined()
    io.read.mockResolvedValueOnce(reply())
    retry.props.onClick()
    await vi.waitFor(() => expect(f.text()).not.toContain('已保留上次公告内容'))
    expect(io.read).toHaveBeenLastCalledWith({ patch: '16.21', latest: true, refresh: true })
  } finally {
    f.dispose()
  }
})

test('all targets share a continuous page, numeric item identity resolves, and prose is retained', async () => {
  const data = reply()
  data.value.sections.push({
    ...data.value.sections[0],
    category: 'item',
    title: 'Synthetic Boots',
    entityKey: '1001',
    entries: [
      {
        text: 'A synthetic mechanic changed.',
        label: null,
        before: null,
        after: null,
        ability: null
      }
    ]
  })
  const f = harness(true, data)
  try {
    await vi.waitFor(() => expect(f.text()).toContain('Synthetic Boots'))
    f.expandAll()
    await nextTick()
    expect(f.all().filter((n) => n.type === 'article')).toHaveLength(2)
    expect(f.text()).toContain('合成装备')
    expect(
      f.all().some((n) => n.type === 'item-icon' && n.props.src === '/synthetic-item.png')
    ).toBe(true)
    expect(f.text()).toContain('A synthetic mechanic changed.')
    expect(
      f.all().some((n) => n.props['data-change'] === 'unknown' && n.parent?.type === 'p')
    ).toBe(true)
    const category = f.all().filter((n) => n.props.kind === 'NSelect')[1]
    category.props['onUpdate:value']('item')
    await nextTick()
    expect(f.text()).toContain('Synthetic Boots')
    expect(f.text()).not.toContain('Synthetic Hero')
  } finally {
    f.dispose()
  }
})

test('official images fill unmapped identities and skill rows without guessing names', async () => {
  const data = reply()
  const section = data.value.sections[0]
  section.entityKey = null
  section.imageUrl = 'https://cmsassets.rgpub.io/synthetic.webp'
  section.entries[0].abilityImageUrl =
    'https://ddragon.leagueoflegends.com/cdn/16.1.1/img/spell/SyntheticQ.png'
  section.entries[0].label = 'Cooldown'
  const f = harness(true, data)
  try {
    await vi.waitFor(() => expect(f.text()).toContain('Synthetic Hero'))
    f.expandAll()
    await nextTick()
    expect(f.text()).toContain('↓ 削弱')
    expect(f.text()).toContain('合成英雄')
    const urls = f
      .all()
      .filter((n) => n.type === 'item-icon')
      .map((n) => n.props.src)
    expect(urls).toContain(section.imageUrl)
    expect(urls).toContain(section.entries[0].abilityImageUrl)
  } finally {
    f.dispose()
  }
})

test.each([
  [[null, null], '待核对'],
  [['12', '14'], '↑ 加强'],
  [['8', '6'], '↓ 削弱'],
  [['12', '8'], '↑ 加强 & ↓ 削弱'],
  [['12', null], '↑ 加强 & 待核对'],
  [['8', null], '↓ 削弱 & 待核对'],
  [['12', '8', null], '↑ 加强 & ↓ 削弱 & 待核对']
])('collapsed object labels summarize all entries %j as %s', async (values, expected) => {
  const data = reply()
  const section = data.value.sections[0]
  section.entries = (values as (string | null)[]).map((after) => ({
    text: '',
    ability: null,
    label: 'Damage',
    before: '10',
    after
  }))
  const f = harness(true, data)
  try {
    await vi.waitFor(() => expect(f.text()).toContain('Synthetic Hero'))
    const article = f.all().find((n) => n.type === 'article')!
    const readText = (n: Node): string => [n.text, ...n.children.map(readText)].join(' ')
    expect(readText(article).replace(/\s+/g, ' ')).toContain(expected)
    expect(readText(article)).not.toContain('含')
    expect(f.all().filter((n) => n.type === 'ul')).toHaveLength(0)
  } finally {
    f.dispose()
  }
})

test.each<[string, string | null, string]>([
  ['Gluttonous Greaves', '客户端合成鞋名', '暴食胫甲'],
  ['Gluttonous Greaves', null, '暴食胫甲'],
  ['Bastion Breaker', '客户端合成装备名', '破垒者'],
  ['Bastion Breaker', null, '破垒者'],
  ['Bastionbreaker', null, '破垒者']
])(
  'CMS-only %s resolves to client name (%s) or verified fallback %s',
  async (title, itemName, fallback) => {
    const data = reply()
    data.value.sections = [
      {
        ...data.value.sections[0],
        category: 'item',
        title,
        entityKey: null,
        imageUrl: 'https://cmsassets.rgpub.io/synthetic-greaves.png'
      }
    ]
    io.itemName = itemName
    const f = harness(true, data)
    try {
      const expectedName = itemName ?? fallback
      await vi.waitFor(() => expect(f.text()).toContain(expectedName))
      const heading = f.all().find((n) => n.type === 'h3')!
      const readText = (n: Node): string => [n.text, ...n.children.map(readText)].join(' ')
      expect(readText(heading)).toContain(expectedName)
      expect(f.text()).toContain(title)
    } finally {
      f.dispose()
      io.itemName = '合成装备'
    }
  }
)

test('localized greaves name remains available without a tooltip or icon', async () => {
  const data = reply()
  data.value.sections = [
    { ...data.value.sections[0], category: 'item', title: 'Gluttonous Greaves', entityKey: null }
  ]
  io.itemName = null
  io.clientItems[3008] = { name: '客户端合成鞋名' }
  const f = harness(true, data)
  try {
    await vi.waitFor(() => expect(f.text()).toContain('客户端合成鞋名'))
    expect(f.text()).toContain('Gluttonous Greaves')
  } finally {
    f.dispose()
    io.itemName = '合成装备'
    delete io.clientItems[3008]
  }
})

test('compact notes retain source and changes without helper copy; version options use public names only', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(f.text()).toContain('Synthetic Hero'))
    expect(f.text()).toContain('来源')
    expect(f.text()).not.toContain('个对象 / 分组')
    expect(f.text()).not.toContain('单项按明确属性')
    expect(f.text()).not.toContain('摘录范围与版本说明')
    const select = () => f.all().find((n) => n.props.kind === 'NSelect')!
    expect(select().props.options[0]).toEqual({ label: '26.21', value: '16.21' })
    expect(select().props.options).toContainEqual({ label: '25.24', value: '15.24' })
    expect(select().props.options.some((o: any) => o.value === '16.22')).toBe(false)
    io.read.mockResolvedValueOnce({
      ...reply(),
      value: { ...reply('16.22').value, availablePatches: ['16.22', '16.21'] }
    })
    f.all()
      .find(
        (n) => n.props.kind === 'NButton' && n.children.some((child) => child.text === '刷新公告')
      )!
      .props.onClick()
    await vi.waitFor(() =>
      expect(select().props.options[0]).toEqual({ label: '26.22', value: '16.22' })
    )
    await vi.waitFor(() =>
      expect(io.read).toHaveBeenLastCalledWith({ patch: '16.21', latest: true, refresh: true })
    )
    expect(select().props.value).toBe('16.22')
    expect(select().props.options.some((o: any) => o.value === '16.23')).toBe(false)
  } finally {
    f.dispose()
  }
})

test('initial published catalog selects latest; manual historical selection survives refresh', async () => {
  const data = reply()
  data.value.availablePatches = ['16.22', '16.21']
  const f = harness(true, data)
  try {
    const select = () => f.all().find((n) => n.props.kind === 'NSelect')!
    await vi.waitFor(() =>
      expect(io.read).toHaveBeenLastCalledWith({ patch: '16.22', latest: true, refresh: true })
    )
    expect(select().props.value).toBe('16.22')
    select().props['onUpdate:value']('16.20')
    await vi.waitFor(() => expect(io.read).toHaveBeenLastCalledWith({ patch: '16.20' }))
    f.all()
      .find(
        (n) => n.props.kind === 'NButton' && n.children.some((child) => child.text === '刷新公告')
      )!
      .props.onClick()
    await vi.waitFor(() =>
      expect(io.read).toHaveBeenLastCalledWith({ patch: '16.20', refresh: true })
    )
    expect(select().props.value).toBe('16.20')
  } finally {
    f.dispose()
  }
})

test.each([false, true])(
  'all 26.16 item and rune headings use Chinese names and search (%s client resources)',
  async (clientAvailable) => {
    const reviewed = [
      ["Berserker's Greaves", 3006, '狂战士胫甲'],
      ['Black Cleaver', 3071, '黑色切割者'],
      ['Eclipse', 6692, '星蚀'],
      ["Runaan's Hurricane", 3085, '卢安娜的飓风'],
      ["Sterak's Gage", 3053, '斯特拉克的挑战护手'],
      ['Sundered Sky', 6610, '焚天'],
      ['Sunfire Cape', 3068, '日炎圣盾'],
      ['Chainlaced Crushers', 3173, '带链碾碎者'],
      ["Spellslinger's Shoes", 3175, '灵能使之靴'],
      ['Tiamat', 3077, '提亚马特'],
      ['Fleet Footwork', 8021, '迅捷步法'],
      ['Hail of Blades', 9923, '丛刃']
    ] as const
    const data = reply('16.16')
    data.value.sections = reviewed.map(([title, id]) => ({
      ...data.value.sections[0],
      title,
      entityKey: null,
      category: id === 8021 || id === 9923 ? 'system' : 'item'
    }))
    io.itemName = null
    if (clientAvailable)
      for (const [, id, zh] of reviewed)
        (id === 8021 || id === 9923 ? io.clientPerks : io.clientItems)[id] = { name: zh }
    const f = harness(true, data)
    const readText = (n: Node): string => [n.text, ...n.children.map(readText)].join(' ')
    try {
      await vi.waitFor(() => expect(f.all().filter((n) => n.type === 'h3')).toHaveLength(12))
      expect(
        f
          .all()
          .filter((n) => n.type === 'h3')
          .map((n) => readText(n).trim())
      ).toEqual(reviewed.map(([, , zh]) => zh))
      for (const [title] of reviewed) {
        expect(f.text()).toContain(title)
      }
    } finally {
      f.dispose()
      io.itemName = '合成装备'
      for (const [, id] of reviewed) {
        delete io.clientItems[id]
        delete io.clientPerks[id]
      }
    }
  }
)

test.each([false, true])(
  'ten-patch remaining item/rune names and compound identities localize (%s client resources)',
  async (clientAvailable) => {
    const reviewed: {
      title: string
      category: 'item' | 'system'
      ids: number[]
      names: string[]
    }[] = [
      { title: "Doran's Helm", category: 'item', ids: [1120], names: ['多兰之盔'] },
      { title: 'Imperial Mandate', category: 'item', ids: [4005], names: ['帝国指令'] },
      { title: 'Immortal Path', category: 'item', ids: [3168], names: ['不朽之路'] },
      { title: 'Protoplasm Harness', category: 'item', ids: [2525], names: ['原生质护带'] },
      { title: 'Hextech Rocketbelt', category: 'item', ids: [3152], names: ['海克斯科技火箭腰带'] },
      { title: 'Terminus', category: 'item', ids: [3302], names: ['界弓'] },
      { title: 'Yun Tal Wildarrows', category: 'item', ids: [3032], names: ['育恩塔尔荒野箭'] },
      { title: 'Jack of All Trades', category: 'system', ids: [8316], names: ['多面手'] },
      { title: 'Stormrazor', category: 'item', ids: [3095], names: ['岚切'] },
      { title: "Guinsoo's Rageblade", category: 'item', ids: [3124], names: ['鬼索的狂暴之刃'] },
      {
        title: 'World Atlas and Runic Compass',
        category: 'item',
        ids: [3865, 3866],
        names: ['云游图鉴', '符文罗盘']
      },
      { title: 'Experimental Hexplate', category: 'item', ids: [3073], names: ['海克斯注力刚壁'] },
      { title: 'Dawncore', category: 'item', ids: [6621], names: ['黎明核心'] },
      { title: 'Hubris', category: 'item', ids: [6697], names: ['狂妄'] }
    ]
    const data = reply()
    data.value.sections = reviewed.map(({ title, category }) => ({
      ...data.value.sections[0],
      title,
      category,
      entityKey: null
    }))
    io.itemName = null
    if (clientAvailable)
      for (const section of reviewed)
        for (const [index, id] of section.ids.entries())
          (section.category === 'item' ? io.clientItems : io.clientPerks)[id] = {
            name: section.names[index]
          }
    const f = harness(true, data)
    const readText = (n: Node): string => [n.text, ...n.children.map(readText)].join(' ').trim()
    try {
      await vi.waitFor(() =>
        expect(f.all().filter((n) => n.type === 'h3')).toHaveLength(reviewed.length)
      )
      expect(
        f
          .all()
          .filter((n) => n.type === 'h3')
          .map(readText)
      ).toEqual(reviewed.map((section) => section.names.join(' / ')))
      for (const section of reviewed) {
        expect(f.text()).toContain(section.title)
      }
    } finally {
      f.dispose()
      io.itemName = '合成装备'
      for (const section of reviewed)
        for (const id of section.ids) {
          delete io.clientItems[id]
          delete io.clientPerks[id]
        }
    }
  }
)

test('verified item identity never falls back to an outdated or mode-specific portrait', async () => {
  const data = reply()
  data.value.sections = [
    {
      ...data.value.sections[0],
      category: 'item',
      title: 'Stormrazor',
      entityKey: '3095',
      imageUrl: 'https://ddragon.leagueoflegends.com/cdn/16.16.1/img/item/3095.png'
    }
  ]
  const old = io.clientItems
  io.clientItems = {
    3095: { name: '已弃用的装备' },
    3097: { name: '客户端岚切', iconPath: '/current-sr-stormrazor.png' }
  } as typeof io.clientItems
  const f = harness(true, data)
  try {
    await vi.waitFor(() => expect(f.text()).toContain('客户端岚切'))
    const urls = f
      .all()
      .filter((n) => n.type === 'item-icon')
      .map((n) => n.props.src)
    expect(urls).toContain('/current-sr-stormrazor.png')
    expect(urls).not.toContain(data.value.sections[0].imageUrl)
  } finally {
    f.dispose()
    io.clientItems = old
  }
})

test('latest cached content is visible while automatic official refresh is pending, without a baseline flash', async () => {
  const cached = reply('16.22')
  cached.value.publicPatch = '26.22'
  cached.value.availablePatches = ['16.22', '16.21']
  let finish!: (value: unknown) => void
  const f = harness(true, cached, async (request) =>
    request.cacheOnly
      ? cached
      : new Promise((resolve) => {
          finish = resolve
        })
  )
  try {
    const select = () => f.all().find((n) => n.props.kind === 'NSelect')!
    expect(select().props.value).toBeNull()
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    expect(select().props.value).toBe('16.22')
    expect(f.text()).toContain('Synthetic Hero')
    expect(f.text()).not.toContain('官方 26.')
    expect(io.read.mock.calls[0][0]).toMatchObject({ latest: true, cacheOnly: true })
    expect(io.read.mock.calls[1][0]).toMatchObject({ patch: '16.22', latest: true, refresh: true })
    const fresh = {
      ...cached,
      value: {
        ...cached.value,
        patch: '16.23',
        publicPatch: '26.23',
        availablePatches: ['16.23', '16.22']
      }
    }
    finish(fresh)
    await vi.waitFor(() => expect(select().props.value).toBe('16.23'))
    expect(f.text()).toContain('Synthetic Hero')
    expect(f.all().some((n) => n.props.kind === 'NInput')).toBe(false)
  } finally {
    f.dispose()
  }
})

test('re-entering checks official updates again while keeping the displayed cache', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    f.active.value = false
    await nextTick()
    const calls = io.read.mock.calls.length
    f.active.value = true
    await nextTick()
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(calls + 1))
    expect(io.read).toHaveBeenLastCalledWith({ patch: '16.21', latest: true, refresh: true })
    expect(f.text()).toContain('Synthetic Hero')
  } finally {
    f.dispose()
  }
})
