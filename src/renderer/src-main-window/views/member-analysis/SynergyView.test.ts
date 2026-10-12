// sort-imports-ignore
import './test-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSSRApp, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { aggregateSynergy } from './analytics'
import SynergyView from './SynergyView.vue'
const data = vi.hoisted(() => ({
  synergy: null as any,
  games: null as any,
  table: null as any,
  selects: [] as any[]
}))
vi.mock('./useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('./MemberAnalysisMetricTable.vue', () => ({
  default: (props: any) => {
    data.table = props
    return null
  }
}))
vi.mock('naive-ui', () => ({
  useThemeVars: () => ({ fontFamily: 'system-ui' }),
  NSelect: (props: any) => {
    data.selects.push(props.options)
    return null
  },
  NButton: () => null,
  NPagination: () => null
}))
const game = (id: number, names: string[], win: boolean): MemberAnalysisGame =>
  ({
    gameId: id,
    timestamp: id * 1000,
    date: '2026-01-01',
    side: 'Blue',
    win,
    players: names.map((player, i) => ({ player, role: i ? 'JUNGLE' : 'TOP', champion: 'Garen' }))
  }) as MemberAnalysisGame
const render = () => renderToString(createSSRApp(SynergyView))
beforeEach(() => {
  setActivePinia(createPinia())
  data.games = ref([
    game(1, ['Member 1', 'Member 2'], true),
    game(2, ['Member 1', 'Member 2'], false),
    game(3, ['Member 1', 'Member 3'], true),
    game(4, ['Member 2', 'Member 3'], false)
  ])
  data.synergy = ref(aggregateSynergy(data.games.value))
  data.table = null
  data.selects = []
})

test('default comparison retains every pair, exact sample, baseline and interval with no automatic selection', async () => {
  const html = await render()
  expect(html).toContain('组合比较 · 3 组')
  expect(html).toContain('2 场')
  expect(html).toContain('1 胜 / 1 负')
  expect(html).toContain('共同胜率 50.0%，个人基线 50.0%，共同胜率 95% 区间')
  expect(html).toContain('0.0')
  expect(html).toContain('aria-pressed="false"')
  expect(html).not.toContain('aria-pressed="true"')
  expect(html).not.toContain('个人基线来自哪里')
  expect(html).toContain('选择左侧成员组合，查看个人基线')
  expect(html).toContain('未选择时不显示结果')
  expect(html).toContain('描述性差异，不代表配合带来的因果收益。')
  expect(html).toContain('计算口径与低样本处理')
  expect(html).toContain('全部组合精确值')
  expect(html).not.toMatch(/<details[^>]*\bopen\b/)
  expect(data.table.rows).toHaveLength(3)
  expect(data.table.columns.map((c: any) => c.key)).toEqual([
    'playerA',
    'playerB',
    'games',
    'winRate',
    'baseline',
    'observedDifference',
    'shrinkageWeight',
    'adjustedDifference'
  ])
})
test('identical participation shows actual coverage instead of a zero ranking', async () => {
  data.games.value = [
    game(1, ['Member 1', 'Member 2'], true),
    game(2, ['Member 2', 'Member 1'], false)
  ]
  data.synergy.value = aggregateSynergy(data.games.value)
  const html = await render()
  expect(html).toContain('成员出场范围相同，无法比较同队差异。')
  expect(html).toContain('与其他成员共同对局')
  expect(html).toContain('50.0%')
  expect(html).toContain('2 场')
  expect(html).not.toContain('aria-pressed')
  expect(data.table).toBeNull()
})
test('empty input retains explicit empty state and omits result controls', async () => {
  data.games.value = []
  data.synergy.value = []
  const html = await render()
  expect(html).toContain('当前范围没有可比较的数据。')
  expect(html).not.toContain('成员组合')
  expect(data.table).toBeNull()
})
test('long identities, low samples, missing role evidence and numerical zero are not discarded', async () => {
  const long = 'Member Synthetic Long Name'
  const rows = aggregateSynergy([
    game(1, [long, 'Member 2'], false),
    game(2, ['Member 2', 'Member 3'], true)
  ])
  data.games.value = [game(1, [long, 'Member 2'], false), game(2, ['Member 2', 'Member 3'], true)]
  data.synergy.value = rows
  const html = await render()
  expect(html).toContain(long)
  expect(html).toContain('样本较少')
  expect(html).toContain('0.0%')
  data.synergy.value = [{ ...rows[0], gamesList: [] }]
  expect(await render()).toContain('分路未提供')
})

test('member selector preserves complete IDs and distinguishes equal names with different tags', async () => {
  // Generate fictional identities rather than recording production IDs in fixtures.
  const name = 'Member Synthetic Long Name'
  const first = `${name}#${1111}`
  const second = `${name}#${2222}`
  const legacy = 'Member 3'
  data.games.value = [game(1, [first, second], true), game(2, [second, legacy], false)]
  data.synergy.value = aggregateSynergy(data.games.value)
  await render()
  const options = data.selects.find((items: any[]) => items?.some((item) => item.value === first))
  expect(options).toHaveLength(3)
  expect(options).toEqual(
    expect.arrayContaining([first, second, legacy].map((value) => ({ label: value, value })))
  )
})
