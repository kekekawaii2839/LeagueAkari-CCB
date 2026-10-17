// sort-imports-ignore
import './test-i18n'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import ScatterView from './ScatterView.vue'

const data = vi.hoisted(() => ({
  roles: null as any,
  matches: [] as any[],
  table: null as any,
  minimum: null as any
}))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ roles: data.roles, games: ref([]) })
}))
vi.mock('./scatter-analysis', async (original) => ({
  ...(await original<object>()),
  matchScatterRows: () => data.matches
}))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('./MetricHelp.vue', () => ({ default: () => null }))
vi.mock('./ScatterExactTable.vue', () => ({
  default: (props: any) => {
    data.table = props
    return h(
      'table',
      props.rows.map((row: any) =>
        h(
          'tr',
          props.columns.map((column: any) =>
            h('td', column.render ? column.render(row) : String(row[column.key] ?? '—'))
          )
        )
      )
    )
  }
}))
vi.mock('naive-ui', () => ({
  NSelect: () => null,
  NSwitch: () => null,
  NCheckbox: () => null,
  NInputNumber: (props: any) => {
    data.minimum = props
    return h('input', {
      type: 'number',
      value: props.value,
      min: props.min,
      'aria-label': props['aria-label']
    })
  },
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.())
}))
const row = (player: string, x: number | null, y = 0.5) => ({
  player,
  role: 'MIDDLE',
  games: 2,
  damageConversion: x,
  winRate: y
})
const render = () => renderToString(createSSRApp(ScatterView))
beforeEach(() => {
  setActivePinia(createPinia())
  data.roles = ref([row('成员甲', 0), row('成员乙', 0), row('缺失成员', null)])
  data.matches = []
  data.table = null
  data.minimum = null
})

test('aggregate mode omits the redundant point count while retaining missing and exact values', async () => {
  const html = await render()
  expect(html).not.toContain('个成员分路')
  expect(html).toContain('缺失 1 条')
  expect(html).toContain('全部精确值（3 条）')
  data.roles.value = [row('成员甲', 0), row('成员乙', 1)]
  const complete = await render()
  expect(complete).not.toContain('个成员分路')
  expect(complete).not.toContain('缺失 ')
  expect(complete).toContain('全部精确值（2 条）')
})

test('aggregate win-rate Y draws a noninteractive 50% reference at the measured fraction', async () => {
  const html = await render()
  const reference = html.match(/<g[^>]*data-reference-value="0.5"[^>]*>([\s\S]*?)<\/g>/)?.[1]
  expect(reference).toBeDefined()
  expect(reference).toContain('50%')
  expect(Number(reference?.match(/y1="([^"]+)"/)?.[1])).toBeCloseTo(155)
  expect(html).toContain('水平虚线表示50%胜率参考值')
  expect(data.table.rows[0].y).toBe(0.5)
})

test('50% reference does not expand an aggregate win-rate domain that excludes it', async () => {
  data.roles.value = [row('成员甲', 0, 0.8), row('成员乙', 1, 0.9)]
  const html = await render()
  expect(html).not.toContain('data-reference-value="0.5"')
  expect(data.table.rows.map((record: any) => record.y)).toEqual([0.8, 0.9])
})

test('X-only win rate and per-match binary outcomes never draw the win-rate reference', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.xMetric = 'winRate'
  state.yMetric = 'damageConversion'
  data.roles.value = [row('成员甲', 0.2, 0.4), row('成员乙', 0.8, 0.6)]
  const aggregate = await render()
  expect(aggregate).toContain('data-scatter-point=')
  expect(aggregate).not.toContain('data-reference-value="0.5"')
  state.matchMode = true
  state.xMetric = 'damageConversion'
  state.yMetric = 'winRate'
  data.matches = [
    { ...row('成员甲', 0, 1), gameId: 101 },
    { ...row('成员乙', 1, 0), gameId: 102 }
  ]
  const matches = await render()
  expect(matches).toContain('data-scatter-point=')
  expect(matches).not.toContain('data-reference-value="0.5"')
})

test('difference axes draw zero references in both aggregate and per-match modes without changing values', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.xMetric = 'gd15'
  state.yMetric = 'gd10'
  data.roles.value = [
    { ...row('成员甲', 1), gd15: -10, gd10: -5 },
    { ...row('成员乙', 2), gd15: 10, gd10: 5 }
  ]
  const aggregate = await render()
  expect(aggregate).toContain('data-reference-axis="x" data-reference-value="0"')
  expect(aggregate).toContain('data-reference-axis="y" data-reference-value="0"')
  expect(data.table.rows.map((record: any) => [record.x, record.y])).toEqual([
    [-10, -5],
    [10, 5]
  ])
  state.matchMode = true
  data.matches = [
    { ...data.roles.value[0], gameId: 101 },
    { ...data.roles.value[1], gameId: 102 }
  ]
  const matches = await render()
  expect(matches).toContain('data-reference-axis="x" data-reference-value="0"')
  expect(matches).toContain('data-reference-axis="y" data-reference-value="0"')
})

test('zero difference reference coexists with aggregate Y50, never expands an excluded domain', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.xMetric = 'gd15'
  data.roles.value = [
    { ...row('成员甲', 1), gd15: -10 },
    { ...row('成员乙', 2), gd15: 10 }
  ]
  const both = await render()
  expect(both).toContain('data-reference-axis="x" data-reference-value="0"')
  expect(both).toContain('data-reference-value="0.5"')
  data.roles.value = [
    { ...row('成员甲', 1), gd15: 10 },
    { ...row('成员乙', 2), gd15: 20 }
  ]
  const positive = await render()
  expect(positive).not.toContain('data-reference-axis="x"')
  expect(positive).toContain('data-reference-value="0.5"')
})

test('aggregate zoom tools do not appear in per-match mode or change full observations', async () => {
  const aggregate = await render()
  expect(aggregate).toContain('成员汇总视域缩放')
  expect(aggregate).toContain('框选缩放')
  expect(aggregate).toContain('恢复全图')
  expect(data.table.rows).toHaveLength(3)
  useMemberAnalysisStore().scatterViewState.matchMode = true
  data.matches = [{ ...row('成员甲', 0), gameId: 101 }]
  const matches = await render()
  expect(matches).not.toContain('成员汇总视域缩放')
  expect(matches).not.toContain('框选缩放')
  expect(data.table.rows).toHaveLength(1)
})

test('member-role minimum games starts at zero only in aggregate mode, without filtering missing metrics', async () => {
  const aggregate = await render()
  expect(aggregate).toContain('成员分路最小场次')
  expect(data.minimum.value).toBe(0)
  expect(data.minimum.min).toBe(0)
  expect(data.minimum.precision).toBe(0)
  expect(data.minimum.step).toBe(1)
  expect(aggregate).not.toContain('已隐藏')
  expect(data.table.rows).toHaveLength(3)
  expect(data.table.rows[2].x).toBeNull()
  useMemberAnalysisStore().scatterViewState.matchMode = true
  data.matches = [{ ...row('成员甲', 0), gameId: 101 }]
  const matches = await render()
  expect(matches).not.toContain('成员分路最小场次')
  expect(matches).not.toContain('已隐藏')
  expect(data.table.rows).toHaveLength(1)
})

test('aggregate exact-value grouping separates distinct values compressed by a distant outlier', async () => {
  data.roles.value = [row('局部零', 0), row('局部一', 1), row('远端', 1e12), row('真实重叠', 0)]
  const html = await render()
  expect((html.match(/data-scatter-point=/g) ?? []).length).toBe(3)
  expect(html).toContain('2 条记录')
  expect(data.table.rows).toHaveLength(4)
  expect(data.table.rows.map((r: any) => r.x)).toEqual([0, 1, 1e12, 0])
})

test('match chart shows only distinct match count while retaining missing notices and exact rows', async () => {
  useMemberAnalysisStore().scatterViewState.matchMode = true
  data.matches = [
    { ...row('成员甲', 0), gameId: 101 },
    { ...row('成员乙', 1), gameId: 102 },
    { ...row('缺失成员', null), gameId: 103 }
  ]
  const html = await render()
  expect(html.replace(/<[^>]*>/g, '')).toContain('2 场')
  expect(html).not.toContain('条有效记录 /')
  expect(html).toContain('缺失 1 条')
  expect(html).toContain('全部精确值（3 条）')
})

test('exact values are permanently visible with original columns and missing values', async () => {
  const html = await render()
  expect(html).toContain('aria-label="全部精确值"')
  expect(html).not.toMatch(/<summary\b/)
  expect(html).toContain('全部精确值（3 条）')
  expect(html).toContain('缺失成员')
  expect(data.table.rows).toHaveLength(3)
  expect(data.table.columns.map((c: any) => c.key)).toEqual(['player', 'role', 'games', 'x', 'y'])
  expect(data.table.columns[0].render(data.table.rows[2])).toBe('缺失成员')
  expect(data.table.rows[0].x).toBe(0)
  expect(data.table.rows[2].x).toBeNull()
})

test('member identities are plain text, without selection buttons or detail navigation', async () => {
  const html = await render()
  for (const record of data.table.rows)
    expect(data.table.columns[0].render(record)).toBe(record.player)
  expect(html.match(/<table\b[\s\S]*?<\/table>/)?.[0]).not.toContain('<button')
  expect(html).not.toContain('选中位置的成员')
  expect(html).not.toContain('已选')
  expect(html).toContain('选择高亮对应精确值行')
})

test('match table retains date, champion, result and distinct identities at the same coordinate', async () => {
  useMemberAnalysisStore().scatterViewState.matchMode = true
  data.matches = [101, 102].map((gameId) => ({
    ...row('成员甲', 0),
    gameId,
    date: '2026-01-01',
    champion: '合成英雄',
    result: '胜'
  }))
  const html = await render()
  expect(html).toContain('全部精确值（2 条）')
  expect(data.table.columns.map((c: any) => c.key)).toEqual([
    'player',
    'role',
    'gameId',
    'date',
    'champion',
    'result',
    'x',
    'y'
  ])
  expect(data.table.rows.map((r: any) => r.gameId)).toEqual([101, 102])
  expect(data.table['row-key'](data.table.rows[0])).not.toBe(
    data.table['row-key'](data.table.rows[1])
  )
  expect(data.table.columns[0].render(data.table.rows[1])).toBe('成员甲')
})

test('zero observations retain a permanent exact table and explicit empty state', async () => {
  data.roles.value = []
  const html = await render()
  expect(html).toContain('全部精确值（0 条）')
  expect(html).not.toMatch(/<summary\b/)
  expect(html).toContain('当前范围没有可比较的数据。')
  expect(data.table.rows).toHaveLength(0)
  expect(html).not.toContain('aria-pressed="true"')
})

const yAxisLabels = (html: string) =>
  [
    ...html.matchAll(/<text(?=[^>]*class="[^"\n]*\baxis-tick-y\b[^"\n]*")[^>]*>(.*?)<\/text>/gs)
  ].map((match) => match[1].replace(/<title\b[^>]*>.*?<\/title>/gs, '').trim())

test.each([[0], [1], [0, 0], [1, 1], [0.5], [0.001, 0.01], [0.99, 0.999], [0, 0.5, 1]])(
  'aggregate win-rate Y ticks and endpoint marks stay in the probability display range: %j',
  async (...values) => {
    data.roles.value = values.map((y, index) => row(`合成成员${index}`, index, y))
    const html = await render()
    const labels = yAxisLabels(html)
    expect(labels).toHaveLength(5)
    for (const label of labels) {
      expect(label).toMatch(/%$/)
      expect(parseFloat(label)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(label)).toBeLessThanOrEqual(100)
    }
    for (const match of html.matchAll(/<circle[^>]* cy="([^"]+)"/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(35)
      expect(Number(match[1])).toBeLessThanOrEqual(275)
    }
    expect(data.table.rows.map((r: any) => r.y)).toEqual(values)
  }
)

test.each([[0], [1], [0, 0], [1, 1], [0, 1]])(
  'match win outcomes retain full probability ticks and unchanged exact 0/1 values: %j',
  async (...values) => {
    useMemberAnalysisStore().scatterViewState.matchMode = true
    data.matches = values.map((y, index) => ({
      ...row(`合成成员${index}`, index, y),
      gameId: index
    }))
    const html = await render()
    expect(yAxisLabels(html)).toEqual(['0%', '25%', '50%', '75%', '100%'])
    expect(data.table.rows.map((r: any) => r.y)).toEqual(values)
  }
)

test('only win-rate Y is bounded; changing metric restores ordinary negative/wide domains', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  data.roles.value = [
    { ...row('合成甲', -10, 0), gd15: -10 },
    { ...row('合成乙', 20, 1), gd15: 20 }
  ]
  expect(yAxisLabels(await render())).toEqual(['0.0%', '25.0%', '50.0%', '75.0%', '100.0%'])
  state.xMetric = 'winRate'
  state.yMetric = 'gd15'
  const labels = yAxisLabels(await render())
  expect(parseFloat(labels[0])).toBeLessThan(-10)
  expect(parseFloat(labels[4])).toBeGreaterThan(20)
  expect(labels.every((label) => !label.includes('%'))).toBe(true)
})

test('missing/nonfinite win rates remain omitted, never endpoint zeros', async () => {
  data.roles.value = [null, undefined, NaN, Infinity, -Infinity].map((y, index) => ({
    ...row(`缺失合成${index}`, index),
    winRate: y
  }))
  const html = await render()
  expect(yAxisLabels(html)).toEqual([])
  expect(html).toContain('当前范围没有可比较的数据。')
  expect(data.table.rows).toHaveLength(5)
  expect(data.table.rows.map((r: any) => r.y)).toEqual([null, undefined, NaN, Infinity, -Infinity])
})

test.each([[0], [1], [0, 1], [0.5, 0.6]])(
  'aggregate win-rate X remains bounded without changing observations: %j',
  async (...values) => {
    const state = useMemberAnalysisStore().scatterViewState
    state.xMetric = 'winRate'
    state.yMetric = 'gd15'
    data.roles.value = values.map((winRate, index) => ({
      ...row(`合成${index}`, 1, winRate),
      gd15: index
    }))
    const html = await render()
    const ticks = [...html.matchAll(/<text[^>]* y="300"[^>]*>(.*?)<\/text>/gs)].map((match) =>
      match[1].replace(/<title\b[^>]*>.*?<\/title>/gs, '').trim()
    )
    expect(ticks).toHaveLength(5)
    for (const tick of ticks) {
      expect(parseFloat(tick)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(tick)).toBeLessThanOrEqual(100)
    }
    expect(data.table.rows.map((r: any) => r.x)).toEqual(values)
  }
)

test('match heroes resolve client aliases and numeric IDs while unknown identities stay intact', async () => {
  useMemberAnalysisStore().scatterViewState.matchMode = true
  useLeagueClientStore().gameData.champions = {
    103: { id: 103, alias: 'Ahri', name: '九尾妖狐' } as any
  }
  data.matches = ['Ahri', '103', '未识别合成英雄'].map((champion, index) => ({
    ...row(`合成${index}`, index),
    champion,
    gameId: index + 100
  }))
  const html = await render()
  expect(html).toContain('九尾妖狐')
  expect(html).not.toContain('>Ahri<')
  expect(html).toContain('未识别合成英雄')
  // Resolution is presentation-only: canonical row identities remain unchanged.
  expect(data.table.rows.map((r: any) => r.champion)).toEqual(['Ahri', '103', '未识别合成英雄'])
})

test('same game name with different tags retains distinct complete point evidence', async () => {
  data.roles.value = [row('匿名很长的同名成员名称#甲', 0), row('匿名很长的同名成员名称#乙', 1)]
  const html = await render()
  expect(html).toMatch(/<title[^>]*>匿名很长的同名成员名称#甲 · 中路/)
  expect(html).toMatch(/<title[^>]*>匿名很长的同名成员名称#乙 · 中路/)
  expect(html).toContain('aria-label="1 条记录，匿名很长的同名成员名称#甲')
  expect(html).toContain('aria-label="1 条记录，匿名很长的同名成员名称#乙')
})

test('single aggregate points use native SVG role glyphs while overlapping records retain their count', async () => {
  useMemberAnalysisStore().scatterViewState.roleFilter = 'ALL'
  data.roles.value = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((role, index) => ({
    ...row(`匿名成员${index}`, index < 2 ? 0 : index),
    role
  }))
  const html = await render()
  // Each native glyph is constrained by an explicit SVG viewport, not CSS-only sizing.
  expect(html.match(/<svg[^>]*width="14" height="14" viewBox="0 0 24 24"/g)).toHaveLength(3)
  expect(html).toContain('aria-label="2 条记录，匿名成员0')
  expect(html).toMatch(/<text[^>]*text-anchor="middle"[^>]*>2<\/text>/)
  expect(html).toContain('匿名成员4')
  expect(data.table.rows).toHaveLength(5)
})

test('match table heading and fit tables omit the removed explanation while retaining sample coverage', async () => {
  useMemberAnalysisStore().scatterViewState.matchMode = true
  data.matches = Array.from({ length: 12 }, (_, i) => ({ ...row('匿名成员', i, i % 2), gameId: i }))
  const html = await render()
  const heading = html.match(/<header[^>]*>(.*?)<\/header>/s)![1]
  expect(heading).toContain('全部精确值')
  expect(heading).not.toContain('不代表因果关系')
  expect(html).toContain('拟合结果')
  expect(html).not.toContain('不代表因果关系')
  expect(html).toContain('有效 12 条 / 缺失 0 条')
})

test('aggregate nearby labels retain point evidence and exact rows; match has no permanent leaders', async () => {
  data.roles.value = [
    row('近邻甲#TEST_ONLY_A', 0),
    row('近邻乙#TEST_ONLY_B', 0.001),
    row('边缘成员#TEST_ONLY_C', 1000)
  ]
  const aggregate = await render()
  expect(aggregate.match(/class="point-label-leader"/g)).toHaveLength(3)
  expect(aggregate).toContain('近邻甲#TEST_ONLY_A · 中路')
  expect(data.table.rows).toHaveLength(3)
  expect(data.table.rows.map((record: any) => record.x)).toEqual([0, 0.001, 1000])
  useMemberAnalysisStore().scatterViewState.matchMode = true
  data.matches = [{ ...row('每场成员#TEST_ONLY', 1), gameId: 101 }]
  const match = await render()
  expect(match).not.toContain('class="point-label-leader"')
  expect(match).toContain('每场成员#TEST_ONLY · 中路')
  expect(data.table.rows).toHaveLength(1)
})

test('nonnegative automatic axes preserve padded space while only labeling nonnegative ticks in either mode', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.yMetric = 'kda'
  data.roles.value = [
    { ...row('零值成员', 0), kda: 0 },
    { ...row('正值成员', 2), kda: 3 }
  ]
  for (const perMatch of [false, true]) {
    state.matchMode = perMatch
    data.matches = data.roles.value.map((record: any, index: number) => ({
      ...record,
      gameId: index + 100
    }))
    const html = await render()
    expect(yAxisLabels(html).every((label) => parseFloat(label) >= 0)).toBe(true)
    const xTicks = [...html.matchAll(/<text[^>]* y="300"[^>]*>(.*?)<\/text>/gs)].map((match) =>
      match[1].replace(/<title\b[^>]*>.*?<\/title>/gs, '').trim()
    )
    expect(xTicks).toHaveLength(5)
    const zeroPoint = html.match(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="(?:8|10)"/)
    expect(zeroPoint).not.toBeNull()
    expect(Number(zeroPoint![1])).toBeGreaterThan(82)
    expect(Number(zeroPoint![2])).toBeLessThan(275)
    expect(xTicks.every((label) => parseFloat(label) >= 0)).toBe(true)
    expect(parseFloat(xTicks[4])).toBeGreaterThan(100)
    expect(data.table.rows.map((record: any) => [record.x, record.y])).toEqual([
      [0, 0],
      [2, 3]
    ])
  }
})

test('negative anomalies in semantically nonnegative metrics remain visible rather than coerced', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.yMetric = 'kda'
  data.roles.value = [
    { ...row('异常负值', -0.1), kda: -1 },
    { ...row('正常值', 1), kda: 3 }
  ]
  const html = await render()
  expect(yAxisLabels(html).some((label) => parseFloat(label) < 0)).toBe(true)
  expect(data.table.rows.map((record: any) => [record.x, record.y])).toEqual([
    [-0.1, -1],
    [1, 3]
  ])
})

test('tiny automatic nonnegative ticks remain distinguishable from real zero', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.yMetric = 'kda'
  data.roles.value = [
    { ...row('零', 0), kda: 0 },
    { ...row('微小非零', 0.00001), kda: 0.00001 }
  ]
  const html = await render()
  const ticks = yAxisLabels(html)
  expect(new Set(ticks).size).toBe(ticks.length)
  expect(ticks.some((text) => parseFloat(text) > 0)).toBe(true)
  expect(data.table.rows.map((record: any) => record.y)).toEqual([0, 0.00001])
})

test('X endpoint labels anchor inward while exact values, tick coordinates and tiny precision remain intact', async () => {
  const state = useMemberAnalysisStore().scatterViewState
  state.yMetric = 'kda'
  data.roles.value = [
    { ...row('零端点', 0), kda: 0 },
    { ...row('小值端点', 0.0000002), kda: 3 }
  ]
  const html = await render()
  const ticks = [
    ...html.matchAll(/<text(?=[^>]*class="[^"\n]*\baxis-tick-x\b[^"\n]*")([^>]*)>(.*?)<\/text>/gs)
  ]
  expect(ticks).toHaveLength(5)
  expect(ticks[0][1]).toContain('text-anchor="start"')
  expect(ticks.at(-1)![1]).toContain('text-anchor="end"')
  expect(ticks.slice(1, -1).every((tick) => tick[1].includes('text-anchor="middle"'))).toBe(true)
  expect(ticks.at(-1)![2]).toContain('0.0000216%')
  const width = Number(html.match(/<rect x="82" y="35" width="([^"]+)"/)![1])
  expect(Number(ticks.at(-1)![1].match(/x="([^"]+)"/)![1])).toBe(82 + width)
  expect(data.table.rows.map((record: any) => record.x)).toEqual([0, 0.0000002])
})

test('a representable long signed Y axis declares one multiplier while native tick titles and exact rows retain original values', async () => {
  useMemberAnalysisStore().scatterViewState.yMetric = 'gd15'
  const values = [-1234567, -934567, -634567, -334567, -34567]
  data.roles.value = values.map((gd15, index) => ({ ...row(`长值成员${index}`, index / 2), gd15 }))
  const html = await render()
  expect(html).toContain('经济差 @ 15 · ×10^6 金币')
  expect(yAxisLabels(html)).toEqual(['-1.33', '-0.98', '-0.63', '-0.29', '0.06'])
  expect(html).toMatch(/<title[^>]*>-1330567 金币<\/title>/)
  expect(html).toContain('经济差 @ 15 -1234567')
  expect(data.table.rows.map((record: any) => record.y)).toEqual(values)
  expect(html).toContain('class="axis-tick axis-tick-x"')
})
