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
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: (props: { position: string }) => h('position-icon', { position: props.position })
}))
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

test('role-pair mode removes explanatory scope and denominator copy while preserving counts and unavailable heroes', async () => {
  const games = [game(1, 'Garen', 'Vi', true), game(2, null, 'Vi', false)]
  for (const g of games) g.players[1].role = 'JUNGLE'
  const html = await render(games, 'role-pair')
  expect(html).toContain('分路搭配时英雄')
  expect(html).not.toContain('仅统计所选有序分路搭配')
  expect(html).not.toContain('不含二人其他分路的共同出场')
  expect(html).not.toContain('占比以所选有序分路搭配')
  expect(html).toContain('英雄未提供')
  expect(html).toContain('有英雄记录 1/2 场')
  expect(html).toContain('95% 区间')
})
test('renders both members and oriented hero combinations with counts, full denominator, roles and intervals', async () => {
  const html = await render([game(1, 'Garen', 'Ahri', true), game(2, 'Garen', 'Lux', false)])
  expect(html).toContain('同队时英雄')
  expect(html).not.toContain('仅统计所选二人的共同')
  expect(html).not.toContain('占比以所选组合的全部共同对局')
  expect(html).toContain('Garen')
  expect(html).toContain('Ahri')
  expect(html).toContain('Lux')
  expect(html).toContain('上路 2 场')
  expect(html).toContain('50.0%')
  expect(html).toContain('95% 区间')
  expect(html).toContain('样本较少')
  expect(html).toContain('英雄共同组合 · 2 组')
  expect(html).toContain('有英雄记录 2/2 场')
  expect(html).not.toContain('不代表英雄搭配的因果收益')
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

test('member evidence headings retain complete identities including distinct tags', async () => {
  const names = [
    `${'SyntheticLongIdentity'.repeat(8)}#ONE`,
    `${'SyntheticLongIdentity'.repeat(8)}#TWO`
  ]
  const sample = game(1, 'Garen', 'Ahri', true)
  sample.players.forEach((player, index) => (player.player = names[index]))
  const html = await render([sample])
  const headings = [...html.matchAll(/<h4\b[^>]*>([^<]*)<\/h4>/g)].map((match) => match[1])
  expect(headings).toEqual(expect.arrayContaining(names))
})

test('role fragments preserve all canonical counts, pair-side orientation and unknown text without invented icons', async () => {
  const base = sharedHeroStats(aggregateSynergy([game(1, 'Garen', 'Ahri', true)])[0])
  const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', null, 'UNKNOWN']
  base.members[0].rows[0].roles = roles.map((role, index) => ({ role, games: index + 1 }))
  base.members[1].rows[0].roles = [{ role: 'UTILITY', games: 9 }]
  base.pairs[0].rolePairs = [
    { roleA: 'TOP', roleB: 'JUNGLE', games: 2 },
    { roleA: 'TOP', roleB: 'UTILITY', games: 3 },
    { roleA: null, roleB: 'JUNGLE', games: 4 }
  ]
  for (const scope of ['shared', 'role-pair'] as const) {
    const html = await renderToString(
      createSSRApp(SynergyHeroStats, { stats: base, minimum: 5, scope })
    )
    const icons = [...html.matchAll(/<position-icon position="([^"]+)"/g)].map((match) => match[1])
    expect(icons).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY',
      'UTILITY',
      'TOP',
      'JUNGLE',
      'UTILITY'
    ])
    for (const label of [
      '上路 1 场',
      '打野 2 场',
      '中路 3 场',
      '下路 4 场',
      '辅助 5 场',
      '上路 5 场',
      '打野 6 场',
      '辅助 3 场'
    ])
      expect(html).toContain(label)
    expect(html).toContain('分路未提供 6 场')
    expect(html).toContain('分路未提供 7 场')
    expect(html).toContain('分路未提供 4 场')
  }
})
