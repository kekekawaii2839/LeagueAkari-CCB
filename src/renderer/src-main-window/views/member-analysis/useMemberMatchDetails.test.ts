import type {
  MemberAnalysisMatchDetails,
  MemberAnalysisMatchOverview,
  MemberAnalysisResult
} from '@shared/shards/member-analysis'
import { describe, expect, test, vi } from 'vitest'
import {
  KeepAlive,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  onBeforeUnmount,
  reactive,
  ref
} from 'vue'

import {
  useMemberMatchDetails,
  useMemberMatchDetailsPageOrder,
  useMemberMatchOverview
} from './useMemberMatchDetails'

type Result = MemberAnalysisResult<MemberAnalysisMatchDetails | null>
const fixture = vi.hoisted(() => ({
  store: { overviewGeneration: 1 } as {
    overviewGeneration: number
    capabilities?: { methods: string[] } | null
  },
  read: vi.fn<(id: number) => Promise<Result>>(),
  readOverview:
    vi.fn<(id: number) => Promise<MemberAnalysisResult<MemberAnalysisMatchOverview | null>>>()
}))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => fixture.store
}))
vi.mock('@main-window/shards/member-analysis', () => ({ MemberAnalysisRenderer: class {} }))
vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => ({ getMatchDetails: fixture.read, getMatchOverview: fixture.readOverview })
}))
type Host = { parent: Host | null; children: Host[]; text: string }
const node = (): Host => ({ parent: null, children: [], text: '' })
const renderer = createRenderer<Host, Host>({
  createElement: node,
  createComment: node,
  createText: (text) => ({ ...node(), text }),
  setText: (n, text) => {
    n.text = text
  },
  setElementText: (n, text) => {
    n.text = text
  },
  patchProp() {},
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = parent
    const i = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(i < 0 ? parent.children.length : i, 0, n)
  },
  remove(n) {
    n.parent?.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = null
  }
})
function deferred() {
  let resolve: (value: Result) => void = () => {}
  const promise = new Promise<Result>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await nextTick()
}
function harness() {
  fixture.store = reactive({ overviewGeneration: 1 })
  const flags = reactive({ summary: true, details: true, show: true })
  const views = new Map<string, ReturnType<typeof useMemberMatchDetails>>()
  const Consumer = defineComponent({
    props: { name: { type: String, required: true }, active: Boolean },
    setup(props) {
      const view = useMemberMatchDetails(
        () => 1,
        () => props.active
      )
      views.set(props.name, view)
      return () => null
    }
  })
  const app = renderer.createApp({
    render: () =>
      flags.show
        ? h('div', [
            h(Consumer, { name: 'summary', active: flags.summary }),
            h(Consumer, { name: 'details', active: flags.details })
          ])
        : null
  })
  app.mount(node())
  return { flags, views, dispose: () => app.unmount() }
}
describe('summary and native details shared lifecycle', () => {
  test('the page order survives reverse child mounting and rapid replacement cancels the previous page', async () => {
    fixture.store = reactive({ overviewGeneration: 1 })
    fixture.read.mockReset().mockResolvedValue({ ok: true, value: null })
    const ids = ref([17, 3, 29])
    const Consumer = defineComponent({
      props: { id: { type: Number, required: true } },
      setup(props) {
        useMemberMatchDetails(
          () => props.id,
          () => true
        )
        return () => null
      }
    })
    const app = renderer.createApp({
      setup() {
        useMemberMatchDetailsPageOrder(
          () => ids.value,
          () => true
        )
        return () =>
          h(
            'div',
            ids.value
              .slice()
              .reverse()
              .map((id) => h(Consumer, { id, key: id }))
          )
      }
    })
    app.mount(node())
    try {
      ids.value = [11, 50, 9]
      await tick()
      await tick()
      expect(fixture.read.mock.calls.map((args) => args[0])).toEqual([11, 50, 9])
    } finally {
      app.unmount()
    }
  })
  test('keeps a ready roster across tab switches without a transient null or another IPC read', async () => {
    const value = { gameId: 1 } as unknown as MemberAnalysisMatchDetails
    fixture.read.mockReset().mockResolvedValue({ ok: true, value })
    const host = harness()
    try {
      await tick()
      const summary = host.views.get('summary')!
      expect(summary.match.value).toBe(value)
      host.flags.summary = false
      await nextTick()
      expect(summary.match.value).toBe(value)
      expect(summary.loading.value).toBe(false)
      host.flags.summary = true
      await nextTick()
      expect(summary.match.value).toBe(value)
      expect(summary.loading.value).toBe(false)
      expect(fixture.read).toHaveBeenCalledTimes(1)
      // A new publication must never display the previous publication's roster.
      host.flags.summary = false
      await nextTick()
      fixture.store.overviewGeneration++
      await nextTick()
      expect(summary.match.value).toBeNull()
    } finally {
      host.dispose()
    }
  })
  test('coalesces IPC and preserves the details subscription when summary deactivates', async () => {
    const pending = deferred()
    fixture.read.mockReset().mockImplementation(() => pending.promise)
    const host = harness()
    try {
      await tick()
      expect(fixture.read).toHaveBeenCalledTimes(1)
      host.flags.summary = false
      await tick()
      pending.resolve({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
      })
      await tick()
      expect(host.views.get('details')!.error.value).toBe(true)
      expect(host.views.get('summary')!.error.value).toBe(false)
      expect(host.views.get('summary')!.loading.value).toBe(false)
    } finally {
      host.dispose()
    }
  })
  test('explicit retry updates both active readers without duplicate IPC', async () => {
    fixture.read.mockReset().mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
    })
    const host = harness()
    try {
      await tick()
      expect(host.views.get('summary')!.error.value).toBe(true)
      fixture.read.mockResolvedValue({ ok: true, value: null })
      host.views.get('details')!.load()
      await tick()
      expect(fixture.read).toHaveBeenCalledTimes(2)
      expect(host.views.get('summary')!.error.value).toBe(false)
      expect(host.views.get('details')!.error.value).toBe(false)
    } finally {
      host.dispose()
    }
  })
  test('publication replacement and unmount suppress previous late failure delivery', async () => {
    const pending = deferred()
    fixture.read
      .mockReset()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue({ ok: true, value: null })
    const host = harness()
    try {
      await tick()
      fixture.store.overviewGeneration = 2
      await tick()
      pending.resolve({
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'Synthetic late failure', retryable: true }
      })
      await tick()
      expect(host.views.get('summary')!.error.value).toBe(false)
      expect(host.views.get('details')!.error.value).toBe(false)
      expect(fixture.read).toHaveBeenCalledTimes(2)
      host.flags.show = false
      await tick()
    } finally {
      host.dispose()
    }
  })
})

test('two-page KeepAlive releases inactive leases, keeps settled identity, suppresses late reads and evicts the third page', async () => {
  fixture.store = reactive({ overviewGeneration: 800 })
  const late = deferred()
  fixture.read.mockReset().mockImplementation(async (id) =>
    id === 802
      ? late.promise
      : {
          ok: true,
          value: fullFixture(id)
        }
  )
  const current = ref(801)
  const views = new Map<number, ReturnType<typeof useMemberMatchDetails>>()
  const destroyed: number[] = []
  const Consumer = defineComponent({
    props: { id: { type: Number, required: true } },
    setup(props) {
      views.set(
        props.id,
        useMemberMatchDetails(
          () => props.id,
          () => true
        )
      )
      onBeforeUnmount(() => destroyed.push(props.id))
      return () => h('div')
    }
  })
  const app = renderer.createApp({
    render: () =>
      h(
        KeepAlive,
        { max: 2 },
        {
          default: () => h(Consumer, { key: current.value, id: current.value })
        }
      )
  })
  app.mount(node())
  try {
    await tick()
    const first = views.get(801)!.match.value
    current.value = 802
    await tick()
    expect(views.get(802)!.loading.value).toBe(true)
    current.value = 801
    await tick()
    expect(views.get(801)!.match.value).toBe(first)
    expect(views.get(802)!.loading.value).toBe(false)
    late.resolve({ ok: true, value: { gameId: 802 } as unknown as MemberAnalysisMatchDetails })
    await tick()
    expect(views.get(802)!.match.value).toBeNull()
    expect(fixture.read.mock.calls.map((args) => args[0])).toEqual([801, 802])
    current.value = 803
    await tick()
    expect(destroyed).toEqual([802])
    expect(views.get(803)!.match.value?.summary.gameId).toBe(803)
    fixture.store.overviewGeneration++
    await tick()
    expect(views.get(801)!.match.value).toBeNull()
  } finally {
    app.unmount()
  }
})

function overviewHarness(methods: string[] | null, withDetails = false) {
  fixture.store = reactive({ overviewGeneration: 901, capabilities: methods ? { methods } : null })
  const id = ref(1),
    expanded = ref(withDetails)
  let summary!: ReturnType<typeof useMemberMatchOverview>
  let full: ReturnType<typeof useMemberMatchDetails> | undefined
  const Summary = defineComponent({
    setup() {
      summary = useMemberMatchOverview(
        () => id.value,
        () => true
      )
      return () => null
    }
  })
  const Full = defineComponent({
    setup() {
      full = useMemberMatchDetails(
        () => id.value,
        () => true
      )
      return () => null
    }
  })
  const app = renderer.createApp({
    render: () => h('div', [h(Summary), expanded.value ? h(Full) : null])
  })
  app.mount(node())
  return { id, expanded, summary, full: () => full, dispose: () => app.unmount() }
}
const fullFixture = (id: number) =>
  ({
    serverId: 'SYNTHETIC',
    summary: {
      source: 'sgp',
      gameId: id,
      data: { json: { gameId: id, participants: [], teams: [] } }
    },
    details: {
      source: 'sgp',
      gameId: id,
      data: { json: { gameId: id, frames: [{ timestamp: 0 }] } }
    }
  }) as unknown as MemberAnalysisMatchDetails
const overviewFixture = (id: number): MemberAnalysisMatchOverview => {
  const { serverId, summary } = fullFixture(id)
  return { serverId, summary }
}

test('new Main collapsed summary only calls overview, then explicit native expansion loads/coalesces full details', async () => {
  fixture.read.mockReset().mockResolvedValue({ ok: true, value: fullFixture(1) })
  fixture.readOverview.mockReset().mockResolvedValue({ ok: true, value: overviewFixture(1) })
  const host = overviewHarness(['getMatchOverview', 'getMatchDetails'])
  try {
    await tick()
    expect(fixture.readOverview).toHaveBeenCalledTimes(1)
    expect(fixture.read).not.toHaveBeenCalled()
    expect(host.summary.match.value).not.toHaveProperty('details')
    host.expanded.value = true
    await tick()
    expect(fixture.read).toHaveBeenCalledTimes(1)
    expect(host.full()!.match.value?.details).not.toBeNull()
    expect(host.summary.match.value).not.toHaveProperty('details')
  } finally {
    host.dispose()
  }
})
test('only explicitly old Main capability uses shared full tier, while unknown capabilities wait', async () => {
  fixture.read.mockReset().mockResolvedValue({ ok: true, value: fullFixture(1) })
  fixture.readOverview.mockReset().mockResolvedValue({ ok: true, value: overviewFixture(1) })
  const old = overviewHarness(['getMatchDetails'], true)
  try {
    await tick()
    expect(fixture.read).toHaveBeenCalledTimes(1)
    expect(fixture.readOverview).not.toHaveBeenCalled()
    expect(old.summary.match.value).not.toHaveProperty('details')
  } finally {
    old.dispose()
  }
  fixture.read.mockClear()
  fixture.readOverview.mockClear()
  const pending = overviewHarness(null)
  try {
    await tick()
    expect(fixture.read).not.toHaveBeenCalled()
    expect(fixture.readOverview).not.toHaveBeenCalled()
    fixture.store.capabilities = { methods: ['getMatchOverview', 'getMatchDetails'] }
    await tick()
    expect(fixture.readOverview).toHaveBeenCalledTimes(1)
    expect(fixture.read).not.toHaveBeenCalled()
  } finally {
    pending.dispose()
  }
})
test.each(['error', 'unavailable'] as const)(
  'new overview %s and retry do not silently request full data',
  async (status) => {
    fixture.read.mockReset().mockResolvedValue({ ok: true, value: fullFixture(1) })
    fixture.readOverview
      .mockReset()
      .mockResolvedValue(
        status === 'error'
          ? { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true } }
          : { ok: true, value: null }
      )
    const host = overviewHarness(['getMatchOverview', 'getMatchDetails'])
    try {
      await tick()
      expect(host.summary.match.value).toBeNull()
      host.summary.load()
      await tick()
      expect(fixture.readOverview).toHaveBeenCalledTimes(2)
      expect(fixture.read).not.toHaveBeenCalled()
    } finally {
      host.dispose()
    }
  }
)
test('overview identity and publication changes cancel queued reads and reject old late results', async () => {
  const old = deferred()
  fixture.read.mockReset()
  fixture.readOverview
    .mockReset()
    .mockImplementationOnce(() => old.promise)
    .mockImplementation(async (id) => ({ ok: true, value: overviewFixture(id) }))
  const host = overviewHarness(['getMatchOverview', 'getMatchDetails'])
  try {
    await tick()
    host.id.value = 2
    host.id.value = 3
    await tick()
    expect(host.summary.match.value?.summary.gameId).toBe(3)
    fixture.store.overviewGeneration++
    await tick()
    old.resolve({ ok: true, value: fullFixture(1) })
    await tick()
    expect(host.summary.match.value?.summary.gameId).toBe(3)
    expect(fixture.readOverview.mock.calls.map((args) => args[0])).toEqual([1, 3, 3])
    expect(fixture.read).not.toHaveBeenCalled()
  } finally {
    host.dispose()
  }
})
