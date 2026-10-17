// sort-imports-ignore
import '../test-i18n'
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createPinia } from 'pinia'
import { expect, test, vi } from 'vitest'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ref, ssrContextKey } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION
} from '@shared/shards/member-analysis'
import VersionTrendPanel from './VersionTrendPanel.vue'
import { buildVersionTrend } from './domain'
import { createTrendWorkerHandler } from './worker-protocol'
const io = vi.hoisted(() => ({
  read: vi.fn(),
  workers: [] as any[],
  postHook: undefined as undefined | ((worker: any, message: any) => void)
}))
vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => ({ getPublishedMemberIdentities: io.read })
}))
vi.mock('./VersionTrendView.vue', () => ({
  default: (props: any, { slots }: any) =>
    h('trend', props, props.error ? slots['error-action']?.({ loading: props.loading }) : [])
}))
vi.mock('./version-trend.worker?worker', () => ({
  default: class {
    messages: any[] = []
    onmessage: any
    onerror: any
    terminate = vi.fn()
    constructor() {
      io.workers.push(this)
    }
    postMessage(message: any) {
      this.messages.push(message)
      io.postHook?.(this, message)
    }
  }
}))
vi.mock('naive-ui', () =>
  Object.fromEntries(
    ['NButton', 'NEmpty'].map((kind) => [
      kind,
      (props: any, { slots }: any) =>
        h('control', { ...props, kind }, [slots.default?.(), slots.extra?.()])
    ])
  )
)
const descriptor = parse(
  readFileSync(new URL('./VersionTrendPanel.vue', import.meta.url), 'utf8')
).descriptor
VersionTrendPanel.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'version-trend-panel' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)
type HostNode = {
  type: string
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  focus: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
}
const node = (type: string): HostNode => ({
  type,
  text: '',
  props: {},
  children: [],
  parent: null,
  focus: vi.fn(),
  scrollIntoView: vi.fn()
})

const token = 'A'.repeat(32)
const page = (nextCursor: string | null = null, configurationToken = 'B'.repeat(32)) => ({
  ok: true,
  value: {
    publicationToken: token,
    configurationToken,
    configuredMemberIds: ['member-slot-1'],
    games: [],
    pagination: { nextCursor }
  }
})
function harness(
  options: {
    flag?: boolean
    active?: boolean
    routeKeepAlive?: boolean
    reader?: () => Promise<unknown>
    games?: any[]
  } = {}
) {
  io.read.mockReset()
  io.postHook = undefined
  io.read.mockImplementation(options.reader ?? (async () => page()))
  io.workers.length = 0
  const renderer = createRenderer<HostNode, HostNode>({
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
  store.settings = {
    enabled: true,
    experimentalVersionTrendEnabled: options.flag ?? true,
    members: [{ serverId: 'SYNTHETIC', gameName: 'SyntheticMember', tagLine: 'TEST_ONLY' }],
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false
  }
  store.overview = {
    contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
    dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
    publicationToken: token,
    generatedAt: '2026-10-13T00:00:00Z',
    firstRun: false,
    gameCount: options.games?.length ?? 0,
    playerCount: 0,
    games: options.games ?? [],
    source: 'Synthetic',
    collectionAudit: null,
    pagination: { nextCursor: null }
  }
  const active = ref(options.active ?? true),
    root = node('root')
  const routeVisible = ref(true)
  const app = renderer.createApp({
    render: () =>
      options.routeKeepAlive
        ? h(Vue.KeepAlive, null, {
            default: () =>
              routeVisible.value
                ? h(VersionTrendPanel, { active: active.value })
                : h('different-route')
          })
        : h(VersionTrendPanel, { active: active.value })
  })
  app.use(pinia)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
  return { store, active, routeVisible, all: () => walk(root), dispose: () => app.unmount() }
}
test.each([{ flag: false }, { active: false }])(
  'disabled/hidden trend does no IO or worker: %j',
  async (options) => {
    const f = harness(options)
    try {
      await nextTick()
      expect(io.read).not.toHaveBeenCalled()
      expect(io.workers).toHaveLength(0)
    } finally {
      f.dispose()
    }
  }
)
test('identity pages precede worker and filter changes reuse same publication identities', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    expect(io.read.mock.calls[0][0]).toEqual({
      publicationToken: token,
      memberSlots: [1],
      pageSize: 25,
      cursor: null
    })
    const worker = io.workers[0],
      start = worker.messages[0]
    worker.onmessage({
      data: {
        type: 'done',
        jobId: start.jobId,
        requestKey: JSON.stringify(start.request),
        result: {
          generation: start.generation,
          requestKey: JSON.stringify(start.request),
          points: []
        }
      }
    })
    await nextTick()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    const view = f.all().find((n) => n.type === 'trend')!
    view.props['onUpdate:request']({ ...view.props.request, axis: 'time' })
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    expect(io.read).toHaveBeenCalledTimes(1)
    f.active.value = false
    await nextTick()
    expect(io.workers[1].terminate).toHaveBeenCalledTimes(1)
  } finally {
    f.dispose()
  }
})
test('configuration changes between identity pages reject the result before worker creation', async () => {
  let count = 0
  const f = harness({
    reader: async () => (++count === 1 ? page('C'.repeat(32)) : page(null, 'D'.repeat(32)))
  })
  try {
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    await vi.waitFor(() =>
      expect(f.all().find((n) => n.type === 'trend')?.props.error).toBeTruthy()
    )
    expect(io.workers).toHaveLength(0)
  } finally {
    f.dispose()
  }
})
test('leaving page invalidates pending identity response without subsequent reads', async () => {
  let finish!: (reply: unknown) => void
  const f = harness({
    reader: () =>
      new Promise((resolve) => {
        finish = resolve
      })
  })
  try {
    f.active.value = false
    await nextTick()
    finish(page('C'.repeat(32)))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(io.workers).toHaveLength(0)
  } finally {
    f.dispose()
  }
})

test.each(['failed', 'cancelled'])(
  'new terminal %s refresh invalidates identity cache once without clearing the overview',
  async (status) => {
    let reads = 0
    const f = harness({ reader: async () => page(null, (++reads === 1 ? 'B' : 'D').repeat(32)) })
    try {
      await vi.waitFor(() => expect(io.workers).toHaveLength(1))
      const oldOverview = f.store.overview
      const first = io.workers[0]
      f.store.job = { jobId: 'SYNTHETIC_TERMINAL_TEST_ONLY', status, progress: 1 } as any
      await vi.waitFor(() => expect(io.workers).toHaveLength(2))
      expect(io.read).toHaveBeenCalledTimes(2)
      expect(first.terminate).toHaveBeenCalledTimes(1)
      expect(f.store.overview).toBe(oldOverview)
      const view = f.all().find((n) => n.type === 'trend')!
      view.props['onUpdate:request']({ ...view.props.request, axis: 'time' })
      await vi.waitFor(() => expect(io.workers).toHaveLength(3))
      expect(io.read).toHaveBeenCalledTimes(2)
      // Further progress/duplicate terminal delivery for the same job is not a poll.
      f.store.job = { ...f.store.job!, progress: 0.5 }
      await nextTick()
      expect(io.read).toHaveBeenCalledTimes(2)
    } finally {
      f.dispose()
    }
  }
)

function complete(worker: any) {
  const start = worker.messages[0]
  const value = {
    generation: start.generation,
    requestKey: JSON.stringify(start.request),
    points: [],
    selectedGames: 7
  }
  worker.onmessage({
    data: { type: 'done', jobId: start.jobId, requestKey: value.requestKey, result: value }
  })
  return value
}

test('reopening the same completed scope/request returns exact result without IO, worker or chunks', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    const original = complete(io.workers[0])
    await nextTick()
    f.active.value = false
    await nextTick()
    const start = performance.now()
    f.active.value = true
    await nextTick()
    expect(io.workers).toHaveLength(1)
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(f.all().find((n) => n.type === 'trend')?.props.result).toEqual(original)
    process.stdout.write(
      JSON.stringify({
        syntheticWarmOpen: {
          identityCalls: io.read.mock.calls.length,
          workerStarts: io.workers.length,
          waitMs: performance.now() - start
        }
      }) + '\n'
    )
  } finally {
    f.dispose()
  }
})

test('filter changes during pending identity pagination share one load and only newest request computes', async () => {
  let resolve!: (value: unknown) => void
  const f = harness({
    reader: () =>
      new Promise((finish) => {
        resolve = finish
      })
  })
  try {
    await nextTick()
    const view = f.all().find((n) => n.type === 'trend')!
    view.props['onUpdate:request']({ ...view.props.request, axis: 'time' })
    await nextTick()
    view.props['onUpdate:request']({ ...view.props.request, side: 'Red' })
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(1)
    resolve(page())
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    expect(io.workers[0].messages[0].request).toMatchObject({ axis: 'time', side: 'Red' })
  } finally {
    f.dispose()
  }
})

test('reopening an interrupted cold load resumes completed identity pages without publishing partial results', async () => {
  let finish!: (reply: unknown) => void
  let reads = 0
  const cursor = 'C'.repeat(32)
  const f = harness({
    reader: () =>
      ++reads === 1
        ? Promise.resolve(page(cursor))
        : new Promise((resolve) => {
            finish = resolve
          })
  })
  try {
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    const stalePage = finish
    f.active.value = false
    await nextTick()
    stalePage(page())
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(io.workers).toHaveLength(0)
    expect(f.all().find((n) => n.type === 'trend')?.props.result).toBeNull()
    f.active.value = true
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(3))
    expect(io.read.mock.calls.map((call) => call[0].cursor)).toEqual([null, cursor, cursor])
    finish(page())
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    complete(io.workers[0])
    await nextTick()
    f.active.value = false
    await nextTick()
    f.active.value = true
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(3)
    expect(io.workers).toHaveLength(1)
  } finally {
    f.dispose()
  }
})

test('activation and active-prop update do not restart the same prepared-input worker', async () => {
  const f = harness({ routeKeepAlive: true })
  try {
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    complete(io.workers[0])
    await nextTick()
    const view = f.all().find((n) => n.type === 'trend')!
    f.routeVisible.value = false
    f.active.value = false
    await nextTick()
    view.props['onUpdate:request']({ ...view.props.request, axis: 'time' })
    await nextTick()
    f.routeVisible.value = true
    f.active.value = true
    await nextTick()
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    expect(io.workers[1].terminate).not.toHaveBeenCalled()
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(io.workers[1].messages[0].request.axis).toBe('time')
  } finally {
    f.dispose()
  }
})

test('a changed publication discards interrupted page progress while hidden and restarts at the first cursor', async () => {
  let finish!: (reply: unknown) => void
  let reads = 0
  let currentToken = token
  const cursor = 'C'.repeat(32)
  const f = harness({
    reader: () => {
      reads++
      if (reads === 2) return new Promise((resolve) => (finish = resolve))
      const reply = page(reads === 1 ? cursor : null)
      reply.value.publicationToken = currentToken
      return Promise.resolve(reply)
    }
  })
  try {
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    f.active.value = false
    await nextTick()
    currentToken = 'E'.repeat(32)
    f.store.overview = { ...f.store.overview!, publicationToken: currentToken }
    finish(page())
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(io.read).toHaveBeenCalledTimes(2)
    expect(io.workers).toHaveLength(0)
    f.active.value = true
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    expect(io.read.mock.calls.map((call) => call[0].cursor)).toEqual([null, cursor, null])
    expect(io.read.mock.calls[2][0].publicationToken).toBe(currentToken)
  } finally {
    f.dispose()
  }
})

test('publication/configuration/terminal identity changes never reuse a completed result', async () => {
  let currentToken = token
  const f = harness({
    reader: async () => ({ ...page(), value: { ...page().value, publicationToken: currentToken } })
  })
  try {
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    complete(io.workers[0])
    await nextTick()
    currentToken = 'E'.repeat(32)
    f.store.overview = { ...f.store.overview!, publicationToken: currentToken }
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    complete(io.workers[1])
    await nextTick()
    f.store.settings!.members = [
      { ...f.store.settings!.members[0], gameName: 'Different_TEST_ONLY' }
    ]
    await vi.waitFor(() => expect(io.workers).toHaveLength(3))
    complete(io.workers[2])
    await nextTick()
    f.store.job = { jobId: 'FAILED_CACHE_TEST_ONLY', status: 'failed', progress: 1 } as any
    await vi.waitFor(() => expect(io.workers).toHaveLength(4))
    expect(io.read).toHaveBeenCalledTimes(4)
  } finally {
    f.dispose()
  }
})

test('exact result cache is bounded to eight requests and evicts oldest, not current identities', async () => {
  const f = harness()
  try {
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    complete(io.workers[0])
    await nextTick()
    const initial = { ...f.all().find((n) => n.type === 'trend')!.props.request }
    for (let index = 1; index <= 8; index++) {
      const view = f.all().find((n) => n.type === 'trend')!
      view.props['onUpdate:request']({ ...initial, durationMin: index })
      await vi.waitFor(() => expect(io.workers).toHaveLength(index + 1))
      complete(io.workers[index])
      await nextTick()
    }
    const view = f.all().find((n) => n.type === 'trend')!
    view.props['onUpdate:request'](initial)
    await vi.waitFor(() => expect(io.workers).toHaveLength(10))
    expect(io.read).toHaveBeenCalledTimes(1)
    const old = io.workers[8]
    old.onmessage({
      data: {
        type: 'done',
        jobId: old.messages[0].jobId,
        requestKey: JSON.stringify(old.messages[0].request),
        result: { generation: old.messages[0].generation, points: ['STALE'] }
      }
    })
    await nextTick()
    expect(f.all().find((n) => n.type === 'trend')?.props.result?.points).not.toEqual(['STALE'])
  } finally {
    f.dispose()
  }
})

test('real KeepAlive route leaves cancel pending IO and returns resume, then warm return uses completed result', async () => {
  let resolve!: (reply: unknown) => void
  let reads = 0
  const f = harness({
    routeKeepAlive: true,
    reader: () =>
      ++reads === 1
        ? new Promise((finish) => {
            resolve = finish
          })
        : Promise.resolve(page())
  })
  try {
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(1)
    f.routeVisible.value = false
    await nextTick()
    resolve(page('C'.repeat(32)))
    await new Promise((finish) => setTimeout(finish, 5))
    expect(io.read).toHaveBeenCalledTimes(1)
    expect(io.workers).toHaveLength(0)
    f.routeVisible.value = true
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    const result = complete(io.workers[0])
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(2)
    f.routeVisible.value = false
    await nextTick()
    f.routeVisible.value = true
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(2)
    expect(io.workers).toHaveLength(1)
    expect(f.all().find((n) => n.type === 'trend')?.props.result).toEqual(result)
  } finally {
    f.dispose()
  }
})

test('deactivated KeepAlive route does not perform reads for a new publication until reactivated', async () => {
  let currentToken = token
  const f = harness({
    routeKeepAlive: true,
    reader: async () => ({ ...page(), value: { ...page().value, publicationToken: currentToken } })
  })
  try {
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    complete(io.workers[0])
    await nextTick()
    f.routeVisible.value = false
    await nextTick()
    currentToken = 'F'.repeat(32)
    f.store.overview = { ...f.store.overview!, publicationToken: currentToken }
    await nextTick()
    expect(io.read).toHaveBeenCalledTimes(1)
    f.routeVisible.value = true
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    expect(io.read).toHaveBeenCalledTimes(2)
  } finally {
    f.dispose()
  }
})

test('failure retry stays owned by the panel and starts only the same existing identity read', async () => {
  let count = 0,
    finish!: (reply: unknown) => void
  const f = harness({
    reader: async () => {
      if (++count === 1) throw Error('Synthetic read failure')
      return new Promise((resolve) => {
        finish = resolve
      })
    }
  })
  try {
    await vi.waitFor(() =>
      expect(f.all().find((n) => n.type === 'trend')?.props.error).toBeTruthy()
    )
    const retry = f.all().find((n) => n.props.kind === 'NButton')!
    expect(retry.props.disabled).toBe(false)
    expect(retry.props.loading).toBe(false)
    retry.props.onClick()
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    expect(f.all().find((n) => n.type === 'trend')?.props.loading).toBe(true)
    expect(f.all().some((n) => n.props.kind === 'NButton')).toBe(false)
    expect(io.workers).toHaveLength(0)
    finish(page())
    await vi.waitFor(() => expect(io.workers).toHaveLength(1))
    expect(io.read).toHaveBeenCalledTimes(2)
  } finally {
    f.dispose()
  }
})

function streamGames(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    gameId: count - index,
    timestamp: 1700000000000 + index * 60000,
    date: '2026-01-01',
    patch: '15.15',
    side: 'Blue',
    win: index % 2 === 0,
    duration: 1800,
    roster: 'Synthetic',
    metricSemantics: 'current-v5',
    jungle: null,
    players: [
      {
        player: 'Synthetic',
        role: 'TOP',
        champion: 'SyntheticChampion',
        minutes: 30,
        kills: [1e16, 1, -1e16][index % 3],
        deaths: 0,
        assists: 1
      }
    ]
  }))
}
function streamPage(ids: number[], cursor: string | null = null): any {
  const reply = page(cursor)
  reply.value.games = ids.map((gameId) => ({
    gameId,
    status: 'available',
    members: [{ memberId: 'member-slot-1', player: 'Synthetic' }]
  })) as any
  return reply
}
function pendingPages() {
  const replies: ((value: any) => void)[] = []
  return { replies, reader: () => new Promise((resolve) => replies.push(resolve)) }
}
function replay(worker: any) {
  const replies: any[] = []
  const handle = createTrendWorkerHandler((reply) => replies.push(reply))
  for (const message of worker.messages) handle(message)
  return replies
}

test('cold pages feed original-order games before final identity response, never publish partial results', async () => {
  const pending = pendingPages(),
    games = streamGames(52)
  const f = harness({ reader: pending.reader, games })
  try {
    expect(io.workers).toHaveLength(0)
    pending.replies[0](
      streamPage(
        Array.from({ length: 25 }, (_, i) => i + 1),
        'C'.repeat(32)
      )
    )
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    const worker = io.workers[0]
    await vi.waitFor(() =>
      expect(
        worker.messages.filter((m: any) => m.type === 'chunk').flatMap((m: any) => m.games)
      ).toEqual(games)
    )
    expect(worker.messages.some((m: any) => m.type === 'finish')).toBe(false)
    expect(replay(worker)).toEqual([])
    expect(f.all().find((n) => n.type === 'trend')!.props.result).toBeNull()
    const second = streamPage(
      Array.from({ length: 25 }, (_, i) => i + 26),
      'D'.repeat(32)
    )
    second.value.games[0] = { gameId: 26, status: 'raw-missing', members: [] } as any
    pending.replies[1](second)
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(3))
    const last = streamPage([51, 52, 999])
    last.value.games[0] = { gameId: 51, status: 'ambiguous-game', members: [] } as any
    last.value.games[1] = { gameId: 52, status: 'identity-unavailable', members: [] } as any
    pending.replies[2](last)
    await vi.waitFor(() => expect(worker.messages.at(-1).type).toBe('finish'))
    const start = worker.messages[0]
    const identities = [
      ...Array.from({ length: 25 }, (_, i) => i + 1),
      ...Array.from({ length: 24 }, (_, i) => i + 27)
    ].map((gameId) => ({ gameId, members: [{ memberId: 'member-slot-1', player: 'Synthetic' }] }))
    expect(replay(worker)).toEqual([
      {
        type: 'done',
        jobId: start.jobId,
        requestKey: JSON.stringify(start.request),
        result: buildVersionTrend(
          {
            generation: start.generation,
            identitiesGeneration: start.generation,
            configuredMemberIds: ['member-slot-1'],
            games: games as any,
            identities
          },
          start.request
        )
      }
    ])
    for (const message of worker.messages.filter((m: any) => m.type === 'chunk')) {
      expect(message.games.length).toBeLessThanOrEqual(25)
      expect(message.identities.length).toBeLessThanOrEqual(25)
    }
  } finally {
    f.dispose()
  }
})

test('duplicate early identities discard the stream and preserve prepared Map last-wins behavior', async () => {
  const pending = pendingPages(),
    f = harness({ reader: pending.reader, games: streamGames(1) })
  try {
    pending.replies[0](streamPage([1], 'C'.repeat(32)))
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    const abandoned = io.workers[0],
      last = streamPage([1])
    last.value.games[0].members[0].player = 'Renamed Synthetic'
    pending.replies[1](last)
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    const final = io.workers[1]
    await vi.waitFor(() => expect(final.messages.at(-1).type).toBe('finish'))
    expect(abandoned.terminate).toHaveBeenCalledTimes(1)
    expect(abandoned.messages.some((m: any) => m.type === 'finish')).toBe(false)
    expect(
      final.messages.filter((m: any) => m.type === 'chunk').flatMap((m: any) => m.identities)
    ).toEqual([
      { gameId: 1, members: [{ memberId: 'member-slot-1', player: 'Renamed Synthetic' }] }
    ])
  } finally {
    f.dispose()
  }
})

test('same-token configured IDs changing discard early output and use complete prepared configuration', async () => {
  const pending = pendingPages(),
    f = harness({ reader: pending.reader, games: streamGames(2) })
  try {
    pending.replies[0](streamPage([1], 'C'.repeat(32)))
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    const first = io.workers[0],
      last = streamPage([2])
    last.value.configuredMemberIds = ['member-slot-2']
    pending.replies[1](last)
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    await vi.waitFor(() => expect(io.workers[1].messages.at(-1).type).toBe('finish'))
    expect(first.terminate).toHaveBeenCalledTimes(1)
    expect(io.workers[1].messages[0].configuredMemberIds).toEqual(['member-slot-2'])
  } finally {
    f.dispose()
  }
})

test.each(['hidden', 'filter', 'publication', 'generation'])(
  'early %s invalidation cannot finish or post into a newer worker',
  async (change) => {
    const pending = pendingPages(),
      f = harness({ reader: pending.reader, games: streamGames(30) })
    try {
      pending.replies[0](streamPage([1], 'C'.repeat(32)))
      await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
      const old = io.workers[0]
      if (change === 'hidden') f.active.value = false
      else if (change === 'filter') {
        const view = f.all().find((n) => n.type === 'trend')!
        view.props['onUpdate:request']({ ...view.props.request, axis: 'time' })
      } else if (change === 'publication') f.store.overview!.publicationToken = 'Z'.repeat(32)
      else f.store.overviewGeneration++
      await nextTick()
      const count = old.messages.length
      pending.replies[1](streamPage([2]))
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(old.terminate).toHaveBeenCalledTimes(1)
      expect(old.messages).toHaveLength(count)
      expect(old.messages.some((m: any) => m.type === 'finish')).toBe(false)
      if (change === 'filter') {
        await vi.waitFor(() => expect(io.workers).toHaveLength(2))
        await vi.waitFor(() => expect(io.workers[1].messages.at(-1).type).toBe('finish'))
        expect(io.read).toHaveBeenCalledTimes(2)
        expect(io.workers[1].messages[0].request.axis).toBe('time')
      }
    } finally {
      f.dispose()
    }
  }
)

test('later page failure discards the early job; explicit retry starts fresh and completes', async () => {
  const pending = pendingPages(),
    f = harness({ reader: pending.reader, games: streamGames(2) })
  try {
    pending.replies[0](streamPage([1], 'C'.repeat(32)))
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(2))
    const first = io.workers[0]
    pending.replies[1]({ ok: false })
    await vi.waitFor(() =>
      expect(f.all().find((n) => n.type === 'trend')?.props.error).toBeTruthy()
    )
    expect(first.terminate).toHaveBeenCalledTimes(1)
    expect(first.messages.some((m: any) => m.type === 'finish')).toBe(false)
    f.all()
      .find((n) => n.type === 'control' && n.props.kind === 'NButton')!
      .props.onClick()
    await vi.waitFor(() => expect(io.read).toHaveBeenCalledTimes(3))
    pending.replies[2](streamPage([1, 2]))
    await vi.waitFor(() => expect(io.workers).toHaveLength(2))
    await vi.waitFor(() => expect(io.workers[1].messages.at(-1).type).toBe('finish'))
  } finally {
    f.dispose()
  }
})

async function budgetUpdates() {
  await nextTick()
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
function budgetInput(count: number, active = true) {
  const games = streamGames(count)
  let offset = 0
  const f = harness({
    active,
    games,
    reader: async () => {
      const ids = games.slice(offset, offset + 25).map((g) => g.gameId)
      offset += 25
      return streamPage(ids, offset < count ? `budget-cursor-${offset}` : null)
    }
  })
  return { f, games }
}
async function preparedBudgetInput(count: number) {
  const { f, games } = budgetInput(count)
  await vi.waitFor(() => expect(io.workers[0]?.messages.at(-1)?.type).toBe('finish'))
  const reply = replay(io.workers[0])[0]
  io.workers[0].onmessage({ data: reply })
  await nextTick()
  return { f, games }
}
function requestRole(f: ReturnType<typeof harness>, role: string) {
  const view = f.all().find((n) => n.type === 'trend')!
  view.props['onUpdate:request']({ ...view.props.request, role })
}
test('prepared upload batches at most eight bounded chunks and finishes the last block without another timer', async () => {
  const { f, games } = await preparedBudgetInput(225)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(performance, 'now').mockReturnValue(0)
  try {
    requestRole(f, 'JUNGLE')
    await budgetUpdates()
    const worker = io.workers[1]
    expect(worker.messages.filter((m: any) => m.type === 'chunk')).toHaveLength(8)
    expect(worker.messages.some((m: any) => m.type === 'finish')).toBe(false)
    expect(vi.getTimerCount()).toBe(1)
    await vi.runAllTimersAsync()
    expect(worker.messages.at(-1).type).toBe('finish')
    expect(vi.getTimerCount()).toBe(0)
    const chunks = worker.messages.filter((m: any) => m.type === 'chunk')
    expect(chunks.every((m: any) => m.games.length <= 25 && m.identities.length <= 25)).toBe(true)
    expect(chunks.flatMap((m: any) => m.games)).toEqual(games)
    expect(io.read).toHaveBeenCalledTimes(9)
    const start = worker.messages[0],
      expected = buildVersionTrend(
        {
          generation: start.generation,
          identitiesGeneration: start.generation,
          configuredMemberIds: ['member-slot-1'],
          games: games as any,
          identities: games.map((game) => ({
            gameId: game.gameId,
            members: [{ memberId: 'member-slot-1', player: 'Synthetic' }]
          }))
        },
        start.request
      )
    expect(replay(worker)[0].result).toEqual(expected)
  } finally {
    f.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
test('early upload also caps fast bursts while preserving full input and delaying finish until identities complete', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const { f, games } = budgetInput(225)
  try {
    await budgetUpdates()
    const worker = io.workers[0]
    expect(worker.messages.filter((m: any) => m.type === 'chunk' && m.games.length)).toHaveLength(8)
    expect(worker.messages.some((m: any) => m.type === 'finish')).toBe(false)
    expect(io.read).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(io.read).toHaveBeenCalledTimes(9)
    expect(worker.messages.at(-1).type).toBe('finish')
    expect(
      worker.messages.filter((m: any) => m.type === 'chunk').flatMap((m: any) => m.games)
    ).toEqual(games)
    const start = worker.messages[0]
    expect(replay(worker)[0].result).toEqual(
      buildVersionTrend(
        {
          generation: start.generation,
          identitiesGeneration: start.generation,
          configuredMemberIds: ['member-slot-1'],
          games: games as any,
          identities: games.map((game) => ({
            gameId: game.gameId,
            members: [{ memberId: 'member-slot-1', player: 'Synthetic' }]
          }))
        },
        start.request
      )
    )
  } finally {
    f.dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  }
})
test.each([2, 7])(
  'elapsed work budget yields after a %sms chunk and resets after resuming',
  async (cost) => {
    const { f } = await preparedBudgetInput(125)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    io.postHook = (_worker, message) => {
      if (message.type === 'chunk') now += cost
    }
    try {
      requestRole(f, 'JUNGLE')
      await budgetUpdates()
      const worker = io.workers[1]
      expect(worker.messages.filter((m: any) => m.type === 'chunk')).toHaveLength(
        cost === 2 ? 2 : 1
      )
      expect(worker.messages.some((m: any) => m.type === 'finish')).toBe(false)
      await vi.runOnlyPendingTimersAsync()
      expect(worker.messages.filter((m: any) => m.type === 'chunk')).toHaveLength(
        cost === 2 ? 4 : 2
      )
      await vi.runAllTimersAsync()
      expect(worker.messages.at(-1).type).toBe('finish')
    } finally {
      f.dispose()
      io.postHook = undefined
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  }
)
test.each(['hidden', 'role'])(
  'budget yield %s invalidation never sends another old chunk or stale finish',
  async (change) => {
    const { f } = await preparedBudgetInput(225)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(performance, 'now').mockReturnValue(0)
    try {
      requestRole(f, 'JUNGLE')
      await budgetUpdates()
      const abandoned = io.workers[1],
        count = abandoned.messages.length
      if (change === 'hidden') f.active.value = false
      else requestRole(f, 'MIDDLE')
      await budgetUpdates()
      await vi.runAllTimersAsync()
      expect(abandoned.terminate).toHaveBeenCalledTimes(1)
      expect(abandoned.messages).toHaveLength(count)
      expect(abandoned.messages.some((m: any) => m.type === 'finish')).toBe(false)
      if (change === 'role') {
        const latest = io.workers[2]
        expect(latest.messages[0].request.role).toBe('MIDDLE')
        expect(latest.messages.at(-1).type).toBe('finish')
      }
      expect(io.read).toHaveBeenCalledTimes(9)
    } finally {
      f.dispose()
      vi.restoreAllMocks()
      vi.useRealTimers()
    }
  }
)
