import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, ssrContextKey } from 'vue'

import VersionTrendView, {
  calculateTrendPlotHeight,
  calculateTrendTableHeight
} from './VersionTrendView.vue'
import { type TrendRequest, type TrendResult, trendMetrics, trendRequestKey } from './domain'

const leagueState = Vue.reactive({
  gameData: { champions: {} as Record<string, { alias: string; name: string }> }
})
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => leagueState
}))
vi.mock('naive-ui', () => ({
  useThemeVars: () => Vue.computed(() => ({ fontFamily: 'system-ui, sans-serif' })),
  ...Object.fromEntries(
    ['NButton', 'NInput', 'NInputNumber', 'NSelect', 'NPagination'].map((kind) => [
      kind,
      (props: any, { slots }: any) => h('control', { ...props, kind }, slots.default?.())
    ])
  )
}))
const descriptor = parse(
  readFileSync(new URL('./VersionTrendView.vue', import.meta.url), 'utf8')
).descriptor
VersionTrendView.render = new Function(
  'Vue',
  ts.transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      isTS: true,
      bindingMetadata: compileScript(descriptor, { id: 'version-trend-view' }).bindings
    }).code,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
  ).outputText
)(Vue)
type HostNode = {
  type: string
  style: { display: string }
  text: string
  props: Record<string, any>
  children: HostNode[]
  parent: HostNode | null
  focus: ReturnType<typeof vi.fn>
  scrollIntoView: ReturnType<typeof vi.fn>
}
const node = (type: string): HostNode => ({
  type,
  style: { display: '' },
  text: '',
  props: {},
  children: [],
  parent: null,
  focus: vi.fn(),
  scrollIntoView: vi.fn()
})

const request: TrendRequest = {
  axis: 'patch',
  timeBucket: 'day',
  memberId: 'SYNTHETIC_MEMBER_TEST_ONLY',
  role: 'TOP',
  metric: 'player:wcpm',
  champion: null,
  side: 'all',
  outcome: 'all',
  patchFrom: '',
  patchTo: '',
  dateFrom: '',
  dateTo: '',
  durationMin: null,
  durationMax: null,
  includeMemberIds: [],
  excludeMemberIds: [],
  completeness: 'all'
}
function harness(
  axis: TrendRequest['axis'],
  interval = false,
  status: {
    loading?: boolean
    error?: string
    stale?: boolean
    champion?: string
    role?: TrendRequest['role']
    metric?: string
    points?: TrendResult['points']
    withRetry?: boolean
  } = {}
) {
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

  const selectedRequest = {
    ...request,
    axis,
    champion: status.champion ?? null,
    role: status.role ?? request.role,
    metric: status.metric ?? request.metric
  }
  const result: TrendResult = {
    generation: 1,
    requestKey: status.stale ? 'stale-synthetic-test-only' : trendRequestKey(selectedRequest),
    metric: {
      key: 'player:wcpm',
      scope: 'player',
      teamContext: false,
      label: '合成视野指标',
      unit: '次/分',
      format: 'num'
    },
    axis,
    timeBucket: 'day',
    selectedGames: 3,
    unknownPatchGames: 0,
    unknownTimestampGames: 0,
    unresolvedIdentityGames: 0,
    legacyGames: 0,
    points: [
      {
        bucketKey: axis === 'patch' ? '15.15' : '2026-01-01',
        label: axis === 'patch' ? '15.15' : '2026-01-01',
        patch: '15.15',
        patches: ['15.15'],
        bucketStartMs: Date.UTC(2026, 0, 1),
        bucketEndMs: Date.UTC(2026, 0, 2),
        observedFromMs: Date.UTC(2026, 0, 1),
        observedToMs: Date.UTC(2026, 0, 1),
        value: 0.5,
        games: 2,
        validGames: 2,
        gameIds: [1, 2],
        validGameIds: [1, 2],
        numerator: 30,
        denominator: 60,
        denominatorUnit: 'minutes',
        wins: 1,
        interval: interval ? { low: 0.2, high: 0.8 } : null,
        connectPrevious: false
      },
      {
        bucketKey: axis === 'patch' ? '15.16' : '2026-01-02',
        label: axis === 'patch' ? '15.16' : '2026-01-02',
        patch: '15.16',
        patches: ['15.16'],
        bucketStartMs: Date.UTC(2026, 0, 2),
        bucketEndMs: Date.UTC(2026, 0, 3),
        observedFromMs: Date.UTC(2026, 0, 2),
        observedToMs: Date.UTC(2026, 0, 2),
        value: null,
        games: 1,
        validGames: 0,
        gameIds: [3],
        validGameIds: [],
        numerator: null,
        denominator: null,
        denominatorUnit: 'minutes',
        wins: 0,
        interval: null,
        connectPrevious: false
      }
    ]
  }
  if (status.points) result.points = status.points
  const updates = vi.fn(),
    matches = vi.fn(),
    root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(
        VersionTrendView,
        {
          request: selectedRequest,
          result,
          loading: status.loading ?? false,
          error: status.error ?? null,
          members: [{ label: 'Synthetic member', value: selectedRequest.memberId }],
          roles: [
            { label: '上', value: 'TOP' },
            { label: '野', value: 'JUNGLE' }
          ],
          champions: [
            { label: 'Aatrox', value: 'Aatrox' },
            { label: 'Khazix', value: 'Khazix' },
            { label: 'UnknownSyntheticHero', value: 'UnknownSyntheticHero' }
          ],
          filterSummary: '',
          text: (key: string) => key,
          'onUpdate:request': updates,
          onMatches: matches
        },
        status.withRetry
          ? {
              'error-action': ({ loading }: { loading: boolean }) =>
                h('retry-action', { disabled: loading })
            }
          : undefined
      )
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
  return { all: () => walk(root), result, updates, matches, dispose: () => app.unmount() }
}
test.each(['patch', 'time'] as const)(
  'removes sample navigation while preserving %s point/table selection and counts',
  async (axis) => {
    const f = harness(axis)
    try {
      const table = f.all().find((node) => node.type === 'table')!
      const headers = table.children.find((node) => node.type === 'thead')!.children[0].children
      expect(headers).toHaveLength(4)
      const allText = f
        .all()
        .map((node) => node.text)
        .join(' ')
      expect(allText).not.toContain('allMatches')
      expect(allText).not.toContain('validMatches')
      expect(allText).toContain('2/2')
      expect(allText).toContain('0/1')
      expect(allText).toContain('missing')
      const points = () =>
        f.all().filter((node) => node.type === 'g' && node.props.role === 'button')
      expect(points()).toHaveLength(2)
      points()[0].props.onClick()
      await nextTick()
      expect(points()[0].props['aria-pressed']).toBe(true)
      expect(
        f
          .all()
          .filter((node) => node.props.kind === 'NButton' && node.props['aria-pressed'] === true)
      ).toHaveLength(1)
      const keyHandlers = points()[0].props.onKeydown
      for (const handler of Array.isArray(keyHandlers) ? keyHandlers : [keyHandlers])
        handler({ key: 'Enter', preventDefault: vi.fn() })
      await nextTick()
      expect(points()[0].props['aria-pressed']).toBe(false)
      expect(f.matches).not.toHaveBeenCalled()
      expect(f.updates).not.toHaveBeenCalled()
      expect(f.result.points.map((point) => [point.gameIds, point.validGameIds])).toEqual([
        [
          [1, 2],
          [1, 2]
        ],
        [[3], []]
      ])
    } finally {
      f.dispose()
    }
  }
)

test('simplifies chart and summaries while retaining interval evidence and advanced filters', async () => {
  const f = harness('patch', true)
  try {
    const text = () =>
      f
        .all()
        .map((node) => node.text)
        .join(' ')
    expect(text()).not.toContain('coverage')
    expect(text()).not.toContain('population')
    expect(text()).not.toContain('uncertainty')
    expect(
      f
        .all()
        .filter((node) => node.props.kind === 'NButton')
        .some((node) => node.text === 'method')
    ).toBe(false)
    // Only four grid lines plus the zero line: no confidence whisker series.
    expect(f.all().filter((node) => node.type === 'line')).toHaveLength(5)
    const intervalCell = f.all().find((node) => node.type === 'td' && node.props.title)
    expect(intervalCell?.props.title).toContain('95%:')
    expect(intervalCell?.props.tabindex).toBe(0)
    expect(intervalCell?.props['aria-label']).toBe(intervalCell?.props.title)
    expect(f.result.points[0].interval).toEqual({ low: 0.2, high: 0.8 })
    const filters = f
      .all()
      .find((node) => node.props.kind === 'NButton' && node.props['aria-expanded'] === false)!
    filters.props.onClick()
    await nextTick()
    expect(f.all().filter((node) => node.props.kind === 'NInputNumber')).toHaveLength(2)
    expect(f.updates).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})

test.each([
  [850, 480, 16, 320],
  [720, 480, 16, 220],
  [420, 480, 16, 80],
  [610, 488, 24, 94],
  [Number.NaN, 480, 16, 240]
])(
  'secondary table budget preserves reachable rows: %s/%s/%s',
  (available, preceding, padding, expected) => {
    expect(calculateTrendTableHeight(available, preceding, padding)).toBe(expected)
  }
)

test.each([
  ['JUNGLE', 'jungle:topGanksPG', 'TOP', 'player:winRate'],
  ['TOP', 'player:laneGankDeathsPG', 'JUNGLE', 'player:winRate'],
  ['JUNGLE', 'player:wcpm', 'TOP', 'player:wcpm']
] as const)(
  'role transition %s/%s to %s retains only applicable metrics',
  async (role, metric, nextRole, expectedMetric) => {
    const f = harness('patch', false, { role, metric })
    try {
      const roleControl = f
        .all()
        .find((node) => node.props.kind === 'NSelect' && node.props.value === role)!
      roleControl.props['onUpdate:value'](nextRole)
      await nextTick()
      expect(f.updates).toHaveBeenCalledTimes(1)
      expect(f.updates).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: nextRole, metric: expectedMetric })
      )
    } finally {
      f.dispose()
    }
  }
)

test.each([
  [1104, 684.85, 48, 280, 280],
  [835.2, 684.85, 48, 280, 280],
  [760, 705.6, 48, 280, 202.4],
  [760, 628, 48, 202.4, 202.4],
  [760, 1000, 48, 280, 180],
  [Number.NaN, 705.6, 48, 280, 280]
])(
  'plot budget repositions marks without clipping short-window axes: %s/%s/%s/%s',
  (available, preceding, padding, current, expected) => {
    expect(calculateTrendPlotHeight(available, preceding, padding, current)).toBeCloseTo(expected)
  }
)

test('short-window plot and table budgets leave the header and first row inside the page', () => {
  const plot = calculateTrendPlotHeight(760, 705.6, 48, 280)
  const preceding = 705.6 + plot - 280
  const table = calculateTrendTableHeight(760, preceding, 48)
  expect(table).toBeCloseTo(80)
  expect(preceding + table + 48).toBeLessThanOrEqual(760)
})

test.each(['patch', 'time'] as const)(
  'projects %s gaps as non-interactive dashed spans without filling missing values',
  async (axis) => {
    const seed = harness(axis)
    const base = seed.result.points[0]
    seed.dispose()
    const points = [
      [0, 0, false],
      [1, 0.2, true],
      [4, 0.6, false],
      [5, null, false],
      [6, 0.8, false],
      [7, 0, true],
      [11, 0.4, false]
    ].map(([day, value, connect]) => ({
      ...base,
      bucketKey: String(day),
      label: String(day),
      bucketStartMs: Date.UTC(2026, 0, Number(day) + 1),
      value: value as number | null,
      connectPrevious: connect as boolean
    }))
    const f = harness(axis, false, { points })
    try {
      const buttons = () =>
        f.all().filter((node) => node.type === 'g' && node.props.role === 'button')
      const lines = () => f.all().filter((node) => node.type === 'line')
      const dashed = () => lines().filter((node) => node.props['stroke-dasharray'])
      expect(buttons()).toHaveLength(points.length)
      expect(f.all().filter((node) => node.type === 'circle')).toHaveLength(6)
      expect(lines()).toHaveLength(9) // Five grid lines, two real spans, two gaps.
      expect(dashed()).toHaveLength(2)
      const legend = f.all().find((node) => node.type === 'span' && node.text === 'gapLegend')!
      expect(legend).toBeDefined()
      expect(f.all().find((node) => node.type === 'svg')?.props['aria-describedby']).toBe(
        legend.props.id
      )
      for (const [line, from, to] of [
        [dashed()[0], 1, 2],
        [dashed()[1], 5, 6]
      ] as const) {
        const first = buttons()[from].children.find((node) => node.type === 'circle')!
        const last = buttons()[to].children.find((node) => node.type === 'circle')!
        expect([line.props.x1, line.props.y1, line.props.x2, line.props.y2]).toEqual([
          first.props.cx,
          first.props.cy,
          last.props.cx,
          last.props.cy
        ])
        expect(line.parent?.props['aria-hidden']).toBe('true')
        expect(line.parent?.props['pointer-events']).toBe('none')
      }
      expect(
        buttons().every((button) => button.children.every((node) => node.type !== 'line'))
      ).toBe(true)
      buttons()[2].props.onClick()
      await nextTick()
      expect(buttons()[2].props['aria-pressed']).toBe(true)
      expect(dashed()).toHaveLength(2)
      expect(f.result.points.map((point) => point.value)).toEqual([0, 0.2, 0.6, null, 0.8, 0, 0.4])
      expect(f.updates).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  }
)

test('metric menu preserves complete metric names and canonical selection', () => {
  const f = harness('patch')
  try {
    const control = f
      .all()
      .find((node) => node.props.kind === 'NSelect' && node.props.value === request.metric)!
    const longest = trendMetrics
      .filter((metric) =>
        control.props.options.some(
          (option: { value: string; disabled: boolean }) =>
            option.value === metric.key && !option.disabled
        )
      )
      .reduce((longest, metric) => (metric.label.length > longest.label.length ? metric : longest))
    const option = control.props.options.find(
      (option: { value: string }) => option.value === longest.key
    )
    expect(option.label).toBe(longest.label)
    const renderLabel = control.props['render-label']
    expect(renderLabel(option, false).children).toBe(longest.label)
    expect(renderLabel(option, true)).toBe(longest.label)
    control.props['onUpdate:value'](longest.key)
    expect(f.updates).toHaveBeenLastCalledWith(expect.objectContaining({ metric: longest.key }))
  } finally {
    f.dispose()
  }
})

test('preserves real loading, failure and retained-result status without coverage prose', () => {
  const f = harness('patch', false, {
    loading: true,
    error: 'Synthetic calculation failure',
    stale: true
  })
  try {
    const statuses = f
      .all()
      .filter((node) => node.props.role === 'status')
      .map((node) => node.text)
    expect(statuses).toContain('loading')
    expect(statuses).toContain('stale')
    expect(f.all().find((node) => node.props.role === 'alert')?.text).toBe(
      'Synthetic calculation failure'
    )
    expect(f.all().some((node) => node.type === 'table')).toBe(true)
  } finally {
    f.dispose()
  }
})

test('champion labels follow client resources while canonical filtering and selected values stay stable', async () => {
  leagueState.gameData.champions = {
    '266': { alias: 'Aatrox', name: '暗裔剑魔' },
    '121': { alias: 'Khazix', name: '虚空掠夺者' }
  }
  const f = harness('patch', false, { champion: 'Aatrox' })
  try {
    const select = () =>
      f.all().find((node) => node.props.kind === 'NSelect' && node.props.clearable !== undefined)!
    const options = () => select().props.options
    expect(
      options().map((option: { label: string; value: string }) => [option.label, option.value])
    ).toEqual([
      ['暗裔剑魔', 'Aatrox'],
      ['虚空掠夺者', 'Khazix'],
      ['UnknownSyntheticHero', 'UnknownSyntheticHero']
    ])
    expect(select().props.filter('剑魔', options()[0])).toBe(true)
    expect(select().props.filter('aatROX', options()[0])).toBe(true)
    expect(select().props.filter("Kha'Zix", options()[1])).toBe(true)
    expect(select().props.filter('剑魔', options()[1])).toBe(false)
    select().props['onUpdate:value']('Aatrox')
    expect(f.updates).toHaveBeenLastCalledWith(expect.objectContaining({ champion: 'Aatrox' }))
    const updateCount = f.updates.mock.calls.length
    leagueState.gameData.champions = {
      '266': { alias: 'Aatrox', name: 'Aatrox' },
      '121': { alias: 'Khazix', name: 'Kha’Zix' }
    }
    await nextTick()
    expect(options()[0]).toEqual({ label: 'Aatrox', value: 'Aatrox' })
    expect(options()[1]).toEqual({ label: 'Kha’Zix', value: 'Khazix' })
    expect(f.updates).toHaveBeenCalledTimes(updateCount)
    expect(select().props.value).toBe('Aatrox')
    leagueState.gameData.champions = {}
    await nextTick()
    expect(options()[1]).toEqual({ label: 'Khazix', value: 'Khazix' })
    expect(select().props.value).toBe('Aatrox')
  } finally {
    f.dispose()
    leagueState.gameData.champions = {}
  }
})

test.each(['patch', 'time'] as const)(
  'axis and advanced filter remain in the same ordered toolbar for %s',
  async (axis) => {
    const f = harness(axis)
    try {
      const selects = f.all().filter((n) => n.props.kind === 'NSelect')
      const member = selects.find((n) => n.props.value === request.memberId)!
      const axisControl = selects.find((n) => n.props.value === axis)!
      const more = f
        .all()
        .find((n) => n.props.kind === 'NButton' && n.children.some((c) => c.text === 'filters'))!
      expect(axisControl.parent?.parent).toBe(member.parent?.parent)
      expect(more.parent).toBe(member.parent?.parent)
      if (axis === 'time')
        expect(selects.find((n) => n.props.value === 'day')?.parent?.parent).toBe(more.parent)
      more.props.onClick()
      await nextTick()
      expect(f.all().some((n) => n.props.kind === 'NInput')).toBe(true)
      axisControl.props['onUpdate:value'](axis === 'patch' ? 'time' : 'patch')
      expect(f.updates).toHaveBeenLastCalledWith(
        expect.objectContaining({ axis: axis === 'patch' ? 'time' : 'patch' })
      )
    } finally {
      f.dispose()
    }
  }
)

test('long failure copy and scoped retry action share one status row without losing loading/stale semantics', async () => {
  const message =
    'Synthetic TEST_ONLY: ' + 'Unavailable observation details with a long identifier. '.repeat(8)
  const state = Vue.reactive({ error: message, loading: true, stale: true, withRetry: true })
  const f = harness('patch', false, state)
  try {
    const alert = () => f.all().find((n) => n.props.role === 'alert')!
    const action = () => f.all().find((n) => n.type === 'retry-action')!
    expect(alert().text).toBe(message)
    expect(action().parent?.parent).toBe(alert().parent)
    expect(action().props.disabled).toBe(true)
    expect(
      f
        .all()
        .filter((n) => n.props.role === 'status')
        .map((n) => n.text)
    ).toEqual(expect.arrayContaining(['loading', 'stale']))
    state.loading = false
    await nextTick()
    expect(action().props.disabled).toBe(false)
    expect(alert().text).toBe(message)
    state.error = ''
    await nextTick()
    expect(f.all().some((n) => n.type === 'retry-action')).toBe(false)
  } finally {
    f.dispose()
  }
})
