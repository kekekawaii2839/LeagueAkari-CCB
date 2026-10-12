// sort-imports-ignore
import './test-i18n'
import { expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { aggregateSynergy } from './analytics'
import { sharedHeroStats } from './synergy-analysis'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import SynergyHeroStats from './SynergyHeroStats.vue'
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
const pages = vi.hoisted(() => ({ items: [] as number[] }))
vi.mock('naive-ui', () => ({
  NPagination: (props: any) => {
    pages.items.push(props.itemCount ?? props['item-count'])
    return null
  }
}))
const game = (id: number, a: string | null, b: string | null, win: boolean): MemberAnalysisGame =>
  ({
    gameId: id,
    timestamp: id,
    date: '2026-01-01',
    win,
    side: 'Blue',
    players: [
      { player: 'Member 1', role: 'TOP', champion: a },
      { player: 'Member 2', role: 'MIDDLE', champion: b }
    ]
  }) as MemberAnalysisGame
const render = async (games: MemberAnalysisGame[], scope?: 'shared' | 'role-pair') => {
  pages.items = []
  const stats = sharedHeroStats(aggregateSynergy(games)[0])
  return renderToString(
    createSSRApp({ render: () => h(SynergyHeroStats, { stats, minimum: 5, scope }) })
  )
}

test('role-pair mode explicitly identifies its narrower denominator and preserves unavailable heroes', async () => {
  const games = [game(1, 'Garen', 'Vi', true), game(2, null, 'Vi', false)]
  for (const g of games) g.players[1].role = 'JUNGLE'
  const html = await render(games, 'role-pair')
  expect(html).toContain('分路搭配时英雄')
  expect(html).toContain('有序分路搭配的 2 场')
  expect(html).toContain('不含二人其他分路的共同出场')
  expect(html).toContain('英雄未提供')
  expect(html).toContain('有英雄记录 1/2 场')
  expect(html).toContain('Wilson 95% 区间仅描述历史胜率')
})
test('renders both members and oriented hero combinations with counts, full denominator, roles and intervals', async () => {
  const html = await render([game(1, 'Garen', 'Ahri', true), game(2, 'Garen', 'Lux', false)])
  expect(html).toContain('同队时英雄')
  expect(html).toContain('共同 2 场')
  expect(html).toContain('Garen')
  expect(html).toContain('Ahri')
  expect(html).toContain('Lux')
  expect(html).toContain('上路 2 场')
  expect(html).toContain('50.0%')
  expect(html).toContain('95% 区间')
  expect(html).toContain('样本较少')
  expect(html).toContain('英雄共同组合 · 2 组')
  expect(html).toContain('有英雄记录 2/2 场')
  expect(html).toContain('不代表英雄搭配的因果收益')
})
test('missing heroes remain named unavailable entries; zero win rates are real numeric observations', async () => {
  const html = await render([game(1, null, 'Ahri', false), game(2, 'Garen', 'Ahri', true)])
  expect(html).toContain('英雄未提供')
  expect(html).toContain('有英雄记录 1/2 场')
  expect(html).toContain('完整英雄记录 1/2 场')
  expect(html).toContain('0.0%')
  expect(html).toContain('50.0%')
})
test('long and low-frequency rows are accessible by named pagination, not removed by a sample threshold', async () => {
  const html = await render(
    Array.from({ length: 7 }, (_, i) =>
      game(i + 1, 'Synthetic Hero ' + i, 'Synthetic Partner ' + i, i === 0)
    )
  )
  expect(pages.items).toEqual([7, 7, 7])
  expect(html).toContain('Synthetic Hero 0')
  expect(html).toContain('样本较少')
  expect(html).toContain('有英雄记录 7/7 场')
  expect(html).toContain('英雄共同组合 · 7 组')
})
