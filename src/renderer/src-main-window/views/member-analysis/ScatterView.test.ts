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
