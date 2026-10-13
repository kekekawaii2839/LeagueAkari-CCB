// sort-imports-ignore
import './test-i18n'

import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'

import MatchesView from './MatchesView.vue'

const fixture = vi.hoisted(() => ({
  games: [] as MemberAnalysisGame[],
  store: { loading: false, viewState: 'ready', matchNavigation: null as any },
  navigationOptions: null as any,
  locate: vi.fn(),
  cancel: vi.fn()
}))
vi.mock('./useMemberAnalysisData', () => ({
  useMemberAnalysisData: () => ({ games: ref(fixture.games) })
}))
vi.mock('@main-window/shards/member-analysis/store', () => ({
  useMemberAnalysisStore: () => fixture.store
}))
vi.mock('./match-navigation', () => ({
  createMatchNavigation: (options: any) => {
    fixture.navigationOptions = options
    return { locate: fixture.locate, cancel: fixture.cancel }
  },
  resolveMatchNavigationTarget: vi.fn()
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('./MatchNativeDetails.vue', () => ({ default: () => null }))
vi.mock('naive-ui', () => ({
  NPagination: () => null,
  NButton: (_: unknown, { slots }: { slots: Record<string, Function> }) =>
    h('button', slots.default?.())
}))

function game(): MemberAnalysisGame {
  return {
    gameId: 1,
    win: true,
    side: 'Blue',
    timestamp: 1,
    date: '2026-10-12',
    duration: 1800,
    patch: '26.1',
    players: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((role, i) => ({
      role,
      player: `Member ${i + 1}#TEST`,
      champion: 'Garen'
    })),
    opponentRanks: {
      version: 1,
      source: 'SGP leagues-ledge (current snapshot)',
      serverId: 'TEST',
      opponents: Array.from({ length: 5 }, (_, i) => ({
        slot: i + 1,
        role: null,
        champion: null,
        snapshot: normalizeRankedStats(
          {
            queues: [
              { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II' },
              { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV' }
            ]
          },
          '2026-10-12T12:00:00Z'
        )
      }))
    }
  } as MemberAnalysisGame
}
async function render(value: MemberAnalysisGame, active = false) {
  fixture.games = [value]
  return renderToString(createSSRApp({ render: () => h(MatchesView, { active }) }))
}

describe('compact per-match opponent ranks', () => {
  test('renders a bounded page without truncating the full sample or exact scope', async () => {
    fixture.games = Array.from({ length: 500 }, (_, i) => ({ ...game(), gameId: i + 1 }))
    const store = fixture.store as any
    store.overviewGeneration = 2
    try {
      let html = await renderToString(createSSRApp({ render: () => h(MatchesView) }))
      expect(html.match(/<article\b/g)).toHaveLength(25)
      expect(html).toContain('共 500 场')
      store.matchListScope = {
        sequence: 1,
        publishedGeneration: 2,
        status: 'active',
        source: 'Synthetic support',
        gameIds: [1, 26, 500]
      }
      html = await renderToString(createSSRApp({ render: () => h(MatchesView) }))
      expect(html.match(/<article\b/g)).toHaveLength(3)
      expect(html).toContain('data-match-id="500"')
      expect(html).toContain('Synthetic support')
      store.overviewGeneration = 3
      html = await renderToString(createSSRApp({ render: () => h(MatchesView) }))
      expect(html).not.toContain('<article')
      expect(html).toContain('分析版本已变化')
    } finally {
      delete store.matchListScope
      delete store.overviewGeneration
    }
  })
  test.each(['ready', 'error', 'empty', 'feature-disabled'])(
    'navigation during a reload uses the readable state: %s',
    async (state) => {
      const request = { sequence: 1, gameId: 1, source: 'Synthetic evidence' }
      fixture.store.loading = true
      fixture.store.viewState = state
      fixture.store.matchNavigation = request
      fixture.locate.mockClear()
      try {
        await render(game(), true)
        expect(fixture.locate).toHaveBeenCalledTimes(state === 'ready' ? 1 : 0)
        expect(fixture.navigationOptions.current(request)).toBe(state === 'ready')
        fixture.store.matchNavigation = { ...request, sequence: 2 }
        expect(fixture.navigationOptions.current(request)).toBe(false)
      } finally {
        fixture.store.loading = false
        fixture.store.viewState = 'ready'
        fixture.store.matchNavigation = null
      }
    }
  )
  test('retains both queue averages but no longer mixes a population summary into matches', async () => {
    const html = await render(game())
    expect(html).toContain('对手查询时平均段位')
    expect(html).toContain('白银 II')
    expect(html).toContain('黄金 IV')
    expect(html.match(/可用 5\/5/g)).toHaveLength(2)
    expect(html).not.toContain('对手段位汇总与统计口径')
    expect(html).not.toContain('分组胜率纳入')
    expect(html).toContain('展开')
  })
  test('keeps per-queue usable sample counts explicit for partial snapshots', async () => {
    const value = game()
    value.opponentRanks!.opponents[0].snapshot = unavailableRank(
      'network-error',
      '2026-10-12T13:00:00Z'
    )
    value.opponentRanks!.opponents[1].snapshot.flex = { status: 'unranked', rank: null }
    const html = await render(value)
    expect(html).toContain('可用 4/5')
    expect(html).toContain('可用 3/5')
  })
  test('does not substitute a rank for uncollected data', async () => {
    const value = game()
    delete value.opponentRanks
    const html = await render(value)
    expect(html).toContain('未采集')
    expect(html.match(/可用 0\/5/g)).toHaveLength(2)
    expect(html).not.toContain('黄金 IV')
  })
})
