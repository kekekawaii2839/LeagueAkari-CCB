// sort-imports-ignore
import './test-i18n'
import { expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { ChampionAggregate } from './analytics'
import ChampionPoolPopover from './ChampionPoolPopover.vue'

vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('./MetricHelp.vue', () => ({
  default: (props: { label: string; definition: string }) =>
    h('button', { 'aria-description': props.definition }, props.label)
}))
vi.mock('naive-ui', () => ({
  NButton: {
    setup:
      (_: unknown, { attrs, slots }: any) =>
      () =>
        h('button', attrs, slots.default?.())
  },
  NIcon: () => null
}))

const row: ChampionAggregate = {
  player: 'Member 1',
  role: 'TOP',
  champion: 'Garen',
  games: 3,
  wins: 1,
  winRate: 1 / 3,
  pickRate: 1,
  blueGames: 2,
  blueWins: 0,
  redGames: 1,
  redWins: 1,
  performance: {
    kda: 3.25,
    dpm: 0,
    gpm: 10000000,
    kp: null,
    damageConversion: 0,
    gd15: -1200.5
  } as ChampionAggregate['performance']
}
const render = (initialChampion: string | null) =>
  renderToString(
    createSSRApp(ChampionPoolPopover, {
      pool: {
        key: 'synthetic-top',
        player: row.player,
        role: row.role,
        games: row.games,
        heroCount: 1,
        unidentifiedGames: 0,
        rows: [row]
      },
      roleLabel: '上路',
      championId: () => 86,
      championName: () => '合成英雄长名称',
      initialChampion
    })
  )

test('selected hero retains all names, exact values, units, missingness, sides and definitions', async () => {
  const html = await render('Garen')
  expect((html.match(/<dt[\s>]/g) ?? []).length).toBe(6)
  expect((html.match(/<dd[\s>]/g) ?? []).length).toBe(6)
  for (const text of [
    'KDA',
    '3.25',
    '分均英雄伤害',
    '0.00',
    '伤害/分钟',
    '分均经济',
    '10000000',
    '金币/分钟',
    '参团率',
    '—',
    '伤害转化率',
    '0.0%',
    '15 分钟经济差',
    '−1200.5',
    '金币',
    '蓝方 0.0% · 2 场',
    '红方 100.0% · 1 场',
    '95% 胜率区间',
    'Gold Per Minute',
    '收起英雄指标',
    '合成英雄长名称'
  ])
    expect(html).toContain(text)
  expect(html).toMatch(/aria-expanded="true"/)
  expect(html).toMatch(/aria-controls="[^"]+"/)
})

test('unselected hero remains a named expandable control without fabricated metric values', async () => {
  const html = await render(null)
  expect(html).toContain('合成英雄长名称')
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-pressed="false"')
  expect(html).not.toContain('<dl')
  expect(html).not.toContain('收起英雄指标')
  expect(html).toContain('英雄池指标说明')
})
