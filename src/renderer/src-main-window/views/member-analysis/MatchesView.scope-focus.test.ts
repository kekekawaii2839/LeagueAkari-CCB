// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import {
  computed,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  reactive,
  ssrContextKey
} from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MatchesView from './MatchesView.vue'
import MatchListPage from './MatchListPage.vue'

const navigation = vi.hoisted(() => ({ locate: vi.fn(), cancel: vi.fn(), options: null as any }))
vi.mock('./useMemberMatchDetails', () => ({ useMemberMatchDetailsPageOrder: vi.fn() }))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({
    games: computed(() => useMemberAnalysisStore().overview?.games ?? [])
  })
}))
vi.mock('./match-navigation', () => ({
  createMatchNavigation: (options: any) => {
    navigation.options = options
    return navigation
  },
  resolveMatchNavigationTarget: vi.fn()
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
const mounts = vi.hoisted(() => ({ summary: 0, summaryAlive: 0, details: 0, detailsAlive: 0 }))
vi.mock('./MatchNativeDetails.vue', () => ({
  default: defineComponent({
    props: ['gameId'],
    setup(props) {
      const instance = ++mounts.details
      mounts.detailsAlive++
      onBeforeUnmount(() => mounts.detailsAlive--)
      return () => h('aside', { 'data-detail-game': props.gameId, 'data-instance': instance })
    }
  })
}))
// Card data/loading is covered separately; this host exercises scope delivery.
vi.mock('./MemberMatchOverview.vue', () => ({
  default: defineComponent({
    props: ['game', 'expanded'],
    emits: ['toggle'],
    setup(props, { emit }) {
      const instance = ++mounts.summary
      mounts.summaryAlive++
      onBeforeUnmount(() => mounts.summaryAlive--)
      return () =>
        h(
          'button',
          {
            'data-summary-game': props.game.gameId,
            'data-instance': instance,
            'aria-expanded': props.expanded,
            onClick: () => emit('toggle')
          },
          `Synthetic identity ${props.game.gameId}#TESTONLY`
        )
    }
  })
}))
vi.mock('naive-ui', () => ({
  NPagination: (props: any) =>
    h(
      'nav',
      [1, 2, 3].map((page) =>
        h(
          'button',
          { 'data-page': page, onClick: () => props['onUpdate:page'](page) },
          String(page)
        )
      )
    ),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.())
}))

type HostNode = {
  type: string
  ownerDocument: { activeElement: HostNode | null }
  contains: (target: HostNode) => boolean
  closest: (selector: string) => HostNode | null
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  text: string
  isConnected: boolean
  getClientRects: () => object[]
  checkVisibility: () => boolean
  focus: (options: any) => void
  scrollIntoView: (options: any) => void
}
const descriptor = parse(
  readFileSync(new URL('./MatchesView.vue', import.meta.url), 'utf8')
).descriptor
MatchesView.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'scope-focus' }).bindings
  }).code
)(Vue)

const pageDescriptor = parse(
  readFileSync(new URL('./MatchListPage.vue', import.meta.url), 'utf8')
).descriptor
MatchListPage.render = new Function(
  'Vue',
  compile(pageDescriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(pageDescriptor, { id: 'match-page-cache' }).bindings
  }).code
)(Vue)

function harness(
  options: {
    count?: number
    active?: boolean
    visible?: boolean
    store?: ReturnType<typeof useMemberAnalysisStore>
  } = {}
) {
  const store = options.store ?? useMemberAnalysisStore()
  if (!options.store) {
    store.loading = false
    store.settings = { enabled: true, members: [] } as any
    store.overview = {
      firstRun: false,
      gameCount: 2,
      games: Array.from({ length: options.count ?? 2 }, (_, i) => i + 1).map((gameId) => ({
        gameId,
        date: '2026-01-01',
        timestamp: gameId,
        patch: '26.1',
        win: true,
        side: 'Blue',
        duration: 1800,
        players: [{ role: 'MIDDLE', player: 'Synthetic#TEST_ONLY', champion: 'Synthetic' }]
      }))
    } as any
  }
  const props = reactive({ active: options.active ?? true }),
    effects: { kind: string; node: HostNode; options: any }[] = []
  const document = { activeElement: null as HostNode | null }
  let visible = options.visible ?? true
  const node = (type: string): HostNode => ({
    type,
    ownerDocument: document,
    contains(target) {
      for (let n: HostNode | null = target; n; n = n.parent) if (n === this) return true
      return false
    },
    closest() {
      for (let n: HostNode | null = this; n; n = n.parent)
        if (n.props['data-match-id'] !== undefined) return n
      return null
    },
    props: {},
    children: [],
    parent: null,
    text: '',
    get isConnected() {
      return this.parent !== null
    },
    getClientRects() {
      return this.isConnected && visible ? [{}] : []
    },
    checkVisibility: () => visible,
    focus(options) {
      document.activeElement = this
      effects.push({ kind: 'focus', node: this, options })
    },
    scrollIntoView(options) {
      effects.push({ kind: 'scroll', node: this, options })
    }
  })
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: node,
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
      n.props[key] = value
    },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = parent
      const i = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(i < 0 ? parent.children.length : i, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = null
    }
  })
  const root = node('root'),
    app = renderer.createApp({ render: () => h(MatchesView, props) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = () => {
    const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  return {
    store,
    document,
    props,
    effects,
    all,
    visible(value: boolean) {
      visible = value
    },
    request() {
      return store.navigateToMatches([1, 2], 'Synthetic exact subset', store.overviewGeneration)
    },
    dispose() {
      app.unmount()
    }
  }
}
async function settled() {
  await nextTick()
  await nextTick()
}
describe('multi-match scope delivers focus to the retained toolbar once', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  test('scrolls and focuses the retained connected toolbar, without expanding an arbitrary match', async () => {
    const host = harness()
    try {
      expect(host.request()).toBe(true)
      await settled()
      expect(host.effects.map((e) => e.kind)).toEqual(['scroll', 'focus'])
      const banner = host.effects[0].node
      expect(banner.props.role).toBe('group')
      expect(banner.props.tabindex).toBe('-1')
      expect(host.effects[0].options).toEqual({ block: 'nearest', behavior: 'instant' })
      expect(host.effects[1].node === banner).toBe(true)
      expect(host.effects[1].options).toEqual({ preventScroll: true })
      expect(
        host.all().filter((n) => n.type === 'button' && n.props['aria-expanded'] === true)
      ).toHaveLength(0)
      host.props.active = false
      await settled()
      host.props.active = true
      await settled()
      expect(host.effects).toHaveLength(2)
    } finally {
      host.dispose()
    }
  })
  test.each(['clear', 'expire', 'inactive', 'single', 'unmount'] as const)(
    'does not focus a scope cancelled before its post-render delivery: %s',
    async (change) => {
      const host = harness()
      host.request()
      if (change === 'clear') host.store.clearMatchListScope()
      else if (change === 'expire') host.store.overview = { ...host.store.overview! }
      else if (change === 'inactive') host.props.active = false
      else if (change === 'single') host.store.navigateToMatch(1, 'Synthetic single')
      else host.dispose()
      try {
        await settled()
        expect(host.effects).toHaveLength(0)
        if (change === 'single') expect(navigation.locate).toHaveBeenCalledTimes(1)
        if (change === 'inactive') {
          host.props.active = true
          await settled()
          expect(host.effects).toHaveLength(0)
        }
      } finally {
        if (change !== 'unmount') host.dispose()
      }
    }
  )
  test('invisible delivery is consumed, and old scope remount/tab return cannot take focus', async () => {
    const host = harness({ visible: false })
    host.request()
    await settled()
    expect(host.effects).toHaveLength(0)
    host.visible(true)
    host.props.active = false
    await settled()
    host.props.active = true
    await settled()
    expect(host.effects).toHaveLength(0)
    const store = host.store
    host.dispose()
    const remount = harness({ store })
    try {
      await settled()
      expect(remount.effects).toHaveLength(0)
      expect(remount.request()).toBe(true)
      await settled()
      expect(remount.effects.map((e) => e.kind)).toEqual(['scroll', 'focus'])
    } finally {
      remount.dispose()
    }
  })
  test('only the latest active sequence is delivered when requests replace each other in one tick', async () => {
    const host = harness()
    try {
      host.request()
      host.request()
      await settled()
      expect(host.effects.map((e) => e.kind)).toEqual(['scroll', 'focus'])
      expect(host.store.matchListScope?.sequence).toBe(2)
    } finally {
      host.dispose()
    }
  })
  test.each(['clear', 'single', 'replace'] as const)(
    'rechecks cancellation after the post-render watcher starts awaiting its render tick: %s',
    async (change) => {
      const host = harness()
      try {
        host.request()
        await nextTick()
        if (change === 'clear') host.store.clearMatchListScope()
        else if (change === 'single') host.store.navigateToMatch(1, 'Synthetic single')
        else host.request()
        await settled()
        expect(host.effects.map((effect) => effect.kind)).toEqual(
          change === 'replace' ? ['scroll', 'focus'] : []
        )
      } finally {
        host.dispose()
      }
    }
  )
})

describe('two visited match pages only', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    Object.assign(mounts, { summary: 0, summaryAlive: 0, details: 0, detailsAlive: 0 })
  })
  test('retains exact identities on a cached return, bounds three-page LRU and shrinks a short last page', async () => {
    const host = harness({ count: 51 })
    const summaries = () => host.all().filter((n) => n.props['data-summary-game'] !== undefined)
    const page = async (value: number) => {
      host
        .all()
        .find((n) => n.props['data-page'] === value)!
        .props.onClick()
      await settled()
    }
    try {
      const first = summaries()[0]
      expect(mounts.summary).toBe(25) // no preloading
      first.focus({ preventScroll: true })
      host.effects.length = 0
      await page(2)
      expect(host.effects).toHaveLength(1)
      expect(host.document.activeElement?.props.role).toBe('region')
      expect(summaries()[0].props['data-summary-game']).toBe(26)
      expect(mounts.summaryAlive).toBe(50)
      await page(1)
      expect(summaries()[0]).toBe(first)
      expect(summaries()[0].text).toContain('Synthetic identity 1#TESTONLY')
      expect(mounts.summary).toBe(50)
      await page(3)
      expect(summaries()).toHaveLength(1)
      expect(summaries()[0].props['data-summary-game']).toBe(51)
      expect(mounts.summaryAlive).toBe(26) // page2 evicted, page1 + short page3
      await page(2)
      expect(summaries()).toHaveLength(25)
      expect(mounts.summary).toBe(76) // evicted page2 recreated, not silently unbounded
      expect(mounts.summaryAlive).toBe(26)
    } finally {
      host.dispose()
      expect(mounts.summaryAlive).toBe(0)
    }
  })
  test('native details unmount on deactivation and restore expansion for the exact game; keyboard pagination keeps focus', async () => {
    const host = harness({ count: 50 })
    const summary = () => host.all().find((n) => n.props['data-summary-game'] !== undefined)!
    const details = () => host.all().filter((n) => n.props['data-detail-game'] !== undefined)
    const page = async (value: number) => {
      const control = host.all().find((n) => n.props['data-page'] === value)!
      control.focus({ preventScroll: true })
      host.effects.length = 0
      control.props.onClick()
      await settled()
      expect(host.document.activeElement).toBe(control)
      expect(host.effects).toHaveLength(0)
    }
    try {
      summary().props.onClick()
      await settled()
      const firstDetails = details()[0]
      expect(firstDetails.props['data-detail-game']).toBe(1)
      await page(2)
      expect(mounts.detailsAlive).toBe(0)
      summary().props.onClick()
      await settled()
      expect(details()[0].props['data-detail-game']).toBe(26)
      await page(1)
      expect(mounts.detailsAlive).toBe(1)
      expect(details()[0].props['data-detail-game']).toBe(1)
      expect(details()[0]).not.toBe(firstDetails)
      expect(summary().props['aria-expanded']).toBe(true)
      host.props.active = false
      await settled()
      expect(mounts.detailsAlive).toBe(0)
      host.props.active = true
      await settled()
      expect(details()[0].props['data-detail-game']).toBe(1)
      expect(mounts.detailsAlive).toBe(1)
    } finally {
      host.dispose()
      expect(mounts.detailsAlive).toBe(0)
    }
  })
  test.each(['publication', 'filter', 'scope'] as const)(
    'discards both cached pages on %s and preserves precise navigation after rapid changes',
    async (kind) => {
      const host = harness({ count: 51 })
      const page = async (value: number) => {
        host
          .all()
          .find((n) => n.props['data-page'] === value)!
          .props.onClick()
        await settled()
      }
      try {
        await page(2)
        expect(mounts.summaryAlive).toBe(50)
        if (kind === 'publication') host.store.overview = { ...host.store.overview! }
        else if (kind === 'filter') host.store.filters.query = 'Synthetic'
        else
          host.store.navigateToMatches(
            [1, 26, 51],
            'Synthetic exact',
            host.store.overviewGeneration
          )
        await settled()
        expect(mounts.summaryAlive).toBe(kind === 'scope' ? 3 : 25)
        if (kind !== 'scope') {
          navigation.options.expand(host.store.overview!.games[50])
          await settled()
          expect(host.all().find((n) => n.props['data-detail-game'] === 51)).toBeDefined()
          host
            .all()
            .find((n) => n.props['data-page'] === 1)!
            .props.onClick()
          host
            .all()
            .find((n) => n.props['data-page'] === 2)!
            .props.onClick()
          await settled()
          expect(host.all().find((n) => n.props['data-summary-game'] === 26)).toBeDefined()
          expect(mounts.summaryAlive).toBeLessThanOrEqual(50)
        }
      } finally {
        host.dispose()
        expect(mounts.summaryAlive).toBe(0)
      }
    }
  )
})
