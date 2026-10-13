// sort-imports-ignore
import './test-i18n'
import { readFileSync } from 'node:fs'
import { parse, compileScript } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { computed, createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MatchesView from './MatchesView.vue'

const navigation = vi.hoisted(() => ({ locate: vi.fn(), cancel: vi.fn() }))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({
    games: computed(() => useMemberAnalysisStore().overview?.games ?? [])
  })
}))
vi.mock('./match-navigation', () => ({
  createMatchNavigation: () => navigation,
  resolveMatchNavigationTarget: vi.fn()
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('naive-ui', () => ({
  NPagination: () => null,
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.())
}))

type HostNode = {
  type: string
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

function harness(
  options: {
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
      games: [1, 2].map((gameId) => ({
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
  let visible = options.visible ?? true
  const node = (type: string): HostNode => ({
    type,
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
describe('multi-match scope delivers focus to its own banner once', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })
  test('scrolls and focuses the rendered connected banner, without expanding an arbitrary match', async () => {
    const host = harness()
    try {
      expect(host.request()).toBe(true)
      await settled()
      expect(host.effects.map((e) => e.kind)).toEqual(['scroll', 'focus'])
      const banner = host.effects[0].node
      expect(banner.props.role).toBe('status')
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
