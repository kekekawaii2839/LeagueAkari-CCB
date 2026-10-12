// sort-imports-ignore
import './test-i18n'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSSRApp, h, nextTick, ref, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import ScatterView from './ScatterView.vue'

const data = vi.hoisted(() => ({ roles: null as any, matches: [] as any[], table: null as any }))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ roles: data.roles, games: ref([]) })
}))
vi.mock('./scatter-analysis', async (original) => ({
  ...(await original<object>()),
  matchScatterRows: () => data.matches
}))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('./MemberAnalysisMetricTable.vue', () => ({
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
const tableButton = (index: number): VNode => data.table.columns[0].render(data.table.rows[index])
const select = async (index: number) => {
  tableButton(index).props!.onClick({ currentTarget: null })
  await nextTick()
}
beforeEach(() => {
  setActivePinia(createPinia())
  data.roles = ref([row('成员甲', 0), row('成员乙', 0), row('缺失成员', null)])
  data.matches = []
  data.table = null
})

test('default disclosure is collapsed and retains exact rows, original columns and missing values', async () => {
  const html = await render()
  expect(html).toMatch(/<details[^>]*>/)
  expect(html).not.toMatch(/<details[^>]*\bopen\b/)
  expect(html).toContain('查看全部精确值（3 条）')
  expect(html).toContain('缺失成员')
  expect(data.table.rows).toHaveLength(3)
  expect(data.table.columns.map((c: any) => c.key)).toEqual(['player', 'role', 'games', 'x', 'y'])
  expect(data.table.columns[0].render(data.table.rows[2])).toBe('缺失成员')
  expect(data.table.rows[0].x).toBe(0)
  expect(data.table.rows[2].x).toBeNull()
})

test('table keyboard control links every overlapping member and cancels without changing filters', async () => {
  await render()
  expect(tableButton(0).props!['aria-pressed']).toBe(false)
  await select(0)
  expect(tableButton(0).props!['aria-pressed']).toBe(true)
  expect(tableButton(1).props!['aria-pressed']).toBe(true)
  expect(tableButton(1).props!['aria-label']).toContain('取消选择')
  await select(1)
  expect(tableButton(0).props!['aria-pressed']).toBe(false)
  expect(tableButton(1).props!['aria-pressed']).toBe(false)
  expect(useMemberAnalysisStore().scatterViewState.roleFilter).toBe('MIDDLE')
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
  expect(html).toContain('查看全部精确值（2 条）')
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
  expect(tableButton(1).props!['aria-label']).toContain('对局 102')
  await select(1)
  expect(tableButton(0).props!['aria-pressed']).toBe(true)
  expect(tableButton(1).props!['aria-pressed']).toBe(true)
})

test('zero observations retain a keyboard disclosure and an explicit empty state', async () => {
  data.roles.value = []
  const html = await render()
  expect(html).toContain('查看全部精确值（0 条）')
  expect(html).toMatch(/<summary\b[^>]*>/)
  expect(html).toContain('当前范围没有可比较的数据。')
  expect(data.table.rows).toHaveLength(0)
  expect(html).not.toContain('aria-pressed="true"')
})

const yAxisLabels = (html: string) =>
  [...html.matchAll(/<text x="74"[^>]*>(.*?)<\/text>/gs)].map((match) => match[1].trim())

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
