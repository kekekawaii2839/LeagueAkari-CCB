// sort-imports-ignore
import './test-i18n'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test, vi } from 'vitest'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import TeamMetricsView from './TeamMetricsView.vue'
import { teamMetricGroups, teamMetricRows } from './team-metrics'

vi.mock('naive-ui', () => ({
  NSelect: () => h('div'),
  NSwitch: () => h('button'),
  NEmpty: () => h('p', '当前筛选范围内没有团队数据')
}))

const state = vi.hoisted(() => ({ side: 'all', width: 0 }))
vi.mock('@vueuse/core', () => ({
  useElementSize: () => ({ width: { value: state.width } })
}))
const games = ref<MemberAnalysisGame[]>([])
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => ({ analysisSide: state.side })
}))
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => ({ games }) }))
vi.mock('./MetricHelp.vue', () => ({
  default: (props: { label: string }) => h('span', props.label)
}))

test.each([0, 1359, 1360, 1900])(
  'team table preserves ordered metrics and samples at %ipx',
  async (width) => {
    state.width = width
    games.value = [
      {
        side: 'Blue',
        win: true,
        duration: 1800,
        players: [],
        eventDecision: null,
        teamMetrics: {
          totalKills: 0,
          dragons: 0,
          barons: null,
          dragonSouls: null,
          elderDragons: null,
          firstDragonTime: null,
          firstTowerTime: null
        }
      } as unknown as MemberAnalysisGame
    ]
    state.side = 'all'
    const html = await renderToString(createSSRApp(TeamMetricsView))
    expect(html).toMatch(/<th scope="col"[^>]*>指标<\/th>/)
    for (const name of ['总计', '蓝方', '红方'])
      expect(html).toMatch(new RegExp(`scope="col"[^>]*>${name}</th>`))
    const tables = [...html.matchAll(/<table[\s>][\s\S]*?<\/table>/g)].map((match) => match[0])
    expect(tables).toHaveLength(width >= 1360 ? 2 : 1)
    for (const table of tables) {
      for (const name of ['指标', '总计', '蓝方', '红方'])
        expect(table).toMatch(new RegExp(`scope="col"[^>]*>${name}</th>`))
    }
    const labels = [...html.matchAll(/<th scope="row"[^>]*><span[^>]*>([^<]*)<\/span><\/th>/g)].map(
      (match) => match[1]
    )
    const orderedRows = teamMetricGroups.flatMap((group) =>
      teamMetricRows(games.value).filter((row) => row.group === group)
    )
    expect(labels).toEqual(orderedRows.map((row) => row.label))
    const cells = [...html.matchAll(/<td[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/td>/g)]
    const expected = orderedRows.flatMap((row) => row.cells)
    expect(cells).toHaveLength(expected.length)
    cells.forEach((cell, index) => {
      expect(cell[2].split('<')[0].trim()).toBe(expected[index].value)
      expect(cell[1]).toBe(
        [expected[index].value, expected[index].sample].filter(Boolean).join('；')
      )
    })
    expect(cells.some((cell) => cell[1].includes('有效'))).toBe(true)
    const groupHeadings = [...html.matchAll(/scope="colgroup"[^>]*>([^<]*)<\/th>/g)].map(
      (match) => match[1]
    )
    expect(groupHeadings).toEqual(teamMetricGroups.slice(1))
  }
)

test('wide side-filtered tables keep only the selected side and empty state has no tables', async () => {
  games.value = [
    {
      side: 'Blue',
      win: true,
      duration: 1800,
      players: [],
      eventDecision: null
    } as unknown as MemberAnalysisGame
  ]
  state.width = 1900
  state.side = 'Blue'
  const html = await renderToString(createSSRApp(TeamMetricsView))
  expect([...html.matchAll(/scope="col"[^>]*>蓝方<\/th>/g)]).toHaveLength(2)
  expect(html).not.toMatch(/scope="col"[^>]*>(总计|红方)<\/th>/)
  expect([...html.matchAll(/<td /g)]).toHaveLength(teamMetricRows(games.value).length)
  games.value = []
  const empty = await renderToString(createSSRApp(TeamMetricsView))
  expect(empty).toContain('当前筛选范围内没有团队数据')
  expect(empty).not.toContain('<table')
})

test('sample coverage does not add visible labels beneath table values', async () => {
  state.width = 1280
  state.side = 'all'
  games.value = [
    {
      side: 'Blue',
      win: true,
      duration: 1800,
      players: [],
      eventDecision: null,
      teamMetrics: { dragons: 0 }
    },
    { side: 'Blue', win: false, duration: 1800, players: [], eventDecision: null }
  ] as unknown as MemberAnalysisGame[]
  const html = await renderToString(createSSRApp(TeamMetricsView))
  expect(html).not.toMatch(/<small[^>]*>有效 1\/2 场<\/small>/)
  expect(html).not.toMatch(/<small[^>]*>有效 2\/2 场<\/small>/)
  expect(html).not.toMatch(/<small[^>]*>有效 0\/2 场<\/small>/)
})
