// sort-imports-ignore
import './test-i18n'
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: vi.fn() }) }))
import { describe, expect, test, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { MemberAnalysisGameSchema } from '@shared/shards/member-analysis'
import { normalizeRankedStats } from '@shared/shards/member-analysis/opponent-ranks'
import type { MemberMatchOverviewInput } from './member-match-overview'
import MemberMatchOverview from './MemberMatchOverview.vue'

const fixture = vi.hoisted(() => {
  const state: { match: MemberMatchOverviewInput | null; loading: boolean; error: boolean } = {
    match: null,
    loading: false,
    error: false
  }
  return { ...state, streamerMode: false }
})
vi.mock('@renderer-shared/shards/app-common/store', () => ({
  useAppCommonStore: () => ({ settings: fixture })
}))
vi.mock('@vicons/material', () => ({
  ArrowBackIosFilled: (props: Record<string, unknown>) => h('svg', props)
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: defineComponent({
    props: { position: String },
    setup: (props) => () => h('role-icon', { 'data-position': props.position })
  })
}))
vi.mock('./useMemberMatchDetails', () => ({
  useMemberMatchOverview: () => ({
    match: computed(() => fixture.match),
    loading: computed(() => fixture.loading),
    error: computed(() => fixture.error),
    load: vi.fn()
  })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: defineComponent({
    props: { championId: Number },
    setup: (props) => () => h('img', { 'data-champion': props.championId })
  })
}))
vi.mock('@renderer-shared/theme/naive-ui', () => ({
  getNaiveUiThemeOverrides: () => ({ Button: {} })
}))
vi.mock('naive-ui', () => ({
  useThemeVars: () =>
    computed(() => ({
      textColor2: 'currentColor',
      buttonColor2Hover: 'transparent',
      buttonColor2Pressed: 'transparent',
      primaryColor: 'currentColor',
      opacityDisabled: '0.5',
      cubicBezierEaseInOut: 'ease'
    })),
  NIcon: (_: unknown, { slots }: { slots: Record<string, Function> }) => slots.default?.(),
  NTooltip: (_: unknown, { slots }: { slots: Record<string, Function> }) => [
    slots.trigger?.(),
    slots.default?.()
  ],
  NButton: (props: Record<string, unknown>, { slots }: { slots: Record<string, Function> }) =>
    h('button', props, [slots.default?.(), slots.icon?.()])
}))
function raw(): MemberMatchOverviewInput {
  return {
    summary: {
      data: {
        json: {
          gameId: 1,
          participants: Array.from({ length: 10 }, (_, i) => ({
            participantId: i + 1,
            puuid: `synthetic-overview-${i}`,
            championId: i + 1,
            teamId: i < 5 ? 100 : 200,
            riotIdGameName: `Synthetic ${i}`,
            summonerName: `Synthetic ${i}`,
            riotIdTagline: 'TEST_ONLY',
            teamPosition: i === 9 ? '' : ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5]
          }))
        }
      }
    }
  }
}
const game = MemberAnalysisGameSchema.parse({
  gameId: 1,
  timestamp: 1,
  date: '2026-10-13',
  patch: '26.1',
  side: 'Blue',
  win: true,
  duration: 1800,
  roster: 'Synthetic',
  dragon15Diff: null,
  grub15Diff: null,
  objectiveFight15Diff: null,
  counterMean: null,
  upperGold15: null,
  botGold15: null,
  gold20Diff: null,
  tower20Diff: null,
  jungle: null,
  eventDecision: null,
  players: []
})
const render = (side = game.side) =>
  renderToString(
    createSSRApp({
      render: () =>
        h(MemberMatchOverview, {
          game: { ...game, side },
          active: true,
          expanded: false,
          timeLabel: '2026-10-13 12:00',
          expandLabel: '展开 Synthetic 对局详情'
        })
    })
  )
const visibleRanks = (html: string) =>
  [...html.matchAll(/<span\b[^>]*class="ten-player-meta"[^>]*>([\s\S]*?)<\/span>/g)]
    .map((match) => match[1])
    .join(' ')
describe('native ten-player match summary', () => {
  test('only canonical real roles receive decorative native icons and unknown keeps its honest label', async () => {
    fixture.match = raw()
    const html = await render()
    const icons = [...html.matchAll(/<role-icon[^>]*data-position="([^"]+)"[^>]*>/g)]
    expect(icons.map((match) => match[1])).toEqual([
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM',
      'UTILITY',
      'TOP',
      'JUNGLE',
      'MIDDLE',
      'BOTTOM'
    ])
    expect(icons.every((match) => match[0].includes('aria-hidden="true"'))).toBe(true)
    expect(html).toContain('分路未知')
    expect(html.match(/data-champion=/g)).toHaveLength(10)
    expect(html).not.toContain('data-position="ALL"')
  })

  test.each(['Blue', 'Red'] as const)(
    'emphasizes only the real own five IDs on %s without reordering sides',
    async (side) => {
      fixture.match = raw()
      const html = await render(side)
      const own = [
        ...html.matchAll(/<span[^>]*class="ten-name"[^>]*><strong[^>]*>([^<]+)<\/strong>/g)
      ].map((m) => m[1])
      expect(own).toEqual(
        Array.from({ length: 5 }, (_, i) => `Synthetic ${i + (side === 'Blue' ? 0 : 5)}`)
      )
      expect(html.indexOf('aria-label="蓝方"')).toBeLessThan(html.indexOf('aria-label="红方"'))
    }
  )
  test('masks all identities including accessibility labels and rank explanations in streamer mode', async () => {
    const value = raw()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II', leaguePoints: 0 }] },
      '2026-10-13T12:05:00Z'
    )
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: [{ participantId: 1, snapshot, timing: 'unknown', observedAt: null }]
    }
    fixture.match = value
    fixture.streamerMode = true
    try {
      const html = await render()
      expect(html).toContain('●●●●●●')
      for (let i = 0; i < 10; i++) expect(html).not.toContain(`Synthetic ${i}`)
      expect(html).not.toContain('TEST_ONLY')
      expect(html).toContain('黄金 II · 0 LP')
      expect(html.match(/data-champion=/g)?.length).toBe(10)
    } finally {
      fixture.streamerMode = false
    }
  })
  test('shows ten equal identities, unknown roles and explicit missing rank data', async () => {
    fixture.match = raw()
    const html = await render()
    expect(html.match(/data-champion=/g)?.length).toBe(10)
    expect(html).toContain('Synthetic 9#TEST_ONLY')
    expect(html).toContain('分路未知')
    expect(html).toContain('未采集')
    expect(html).not.toContain('段位：灵活组排')
    expect(html).not.toContain('段位来源、查询时态与缺失说明')
    expect(html).toContain('2026-10-13 12:00')
    expect(html).toContain('版本 26.1')
    expect(html).toContain('#1')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('aria-controls="match-detail-1"')
    expect(html).toContain('role="group" aria-label="蓝方"')
    expect(html).toContain('role="group" aria-label="红方"')
    expect(html.indexOf('aria-label="蓝方"')).toBeLessThan(html.indexOf('aria-label="红方"'))
    expect(html.match(/>胜利<\/strong>/g)?.length).toBe(1)
    expect(html).not.toContain('>我方<')
    expect(html).not.toContain('>对手<')
  })
  test('keeps the participant flex rank in the compact keyboard trigger without eagerly building detail text', async () => {
    const value = raw()
    const snapshot = normalizeRankedStats(
      {
        queues: [
          { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II', leaguePoints: 9 },
          { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II', leaguePoints: 15 }
        ]
      },
      '2026-10-13T12:05:00Z'
    )
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        snapshot: i === 5 ? snapshot : null,
        timing: i === 5 ? 'during-game' : 'unknown',
        observedAt: i === 5 ? '2026-10-13T12:01:00Z' : null
      }))
    }
    fixture.match = value
    const html = await render()
    expect(html).toContain('黄金 II · 15 LP')
    expect(visibleRanks(html)).toContain('黄金 II · 15 LP')
    expect(visibleRanks(html)).not.toContain('白银 II')
    expect(html).not.toContain('local-game-player-rank-snapshot')
    expect(html).not.toContain('快照不保证开局或历史段位')
    expect(html).toContain('tabindex="0"')
    expect(html).not.toContain('黄金 II · 本局')
  })
  test.each([42, 0, null])(
    'shows exact participant flex LP %s without inventing a missing value',
    async (leaguePoints) => {
      const value = raw()
      const snapshot = normalizeRankedStats(
        {
          queues: [
            { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II', leaguePoints: 9 },
            {
              queueType: 'RANKED_FLEX_SR',
              tier: 'GOLD',
              rank: 'I',
              ...(leaguePoints === null ? {} : { leaguePoints })
            }
          ]
        },
        '2026-10-13T12:05:00Z'
      )
      value.participantRanks = {
        version: 1,
        source: 'local-game-player-rank-snapshot',
        // Reverse snapshot order to prove the compact value belongs to participant 6,
        // not the participant-array/display-column position.
        participants: Array.from({ length: 10 }, (_, i) => ({
          participantId: 10 - i,
          snapshot: 10 - i === 6 ? snapshot : null,
          timing: 'unknown',
          observedAt: null
        }))
      }
      fixture.match = value
      const html = await render()
      const metadata = [
        ...html.matchAll(/<span\b[^>]*class="ten-player-meta"[^>]*>([\s\S]*?)<\/span>/g)
      ].map((match) => match[1])
      expect(metadata[5]).toContain(
        leaguePoints === null ? '黄金 I' : `黄金 I · ${leaguePoints} LP`
      )
      expect(metadata.filter((text) => text.includes('黄金 I'))).toHaveLength(1)
      expect(visibleRanks(html)).not.toContain('9 LP')
      if (leaguePoints === null) expect(metadata[5]).not.toContain('LP')
    }
  )
  test('does not substitute a known solo rank when flex is missing', async () => {
    const value = raw()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'DIAMOND', rank: 'I' }] },
      '2026-10-13T12:05:00Z'
    )
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        snapshot: i === 0 ? snapshot : null,
        timing: 'unknown',
        observedAt: null
      }))
    }
    fixture.match = value
    const html = await render()
    expect(visibleRanks(html)).toContain('未获取')
    expect(visibleRanks(html)).not.toContain('钻石 I')
    expect(html).not.toContain('单双排：钻石 I')
  })
  test.each([
    ['provisional', '定级中'],
    ['unranked', '无段位'],
    ['missing', '未获取'],
    ['no-snapshot', '未获取']
  ] as const)(
    'distinguishes compact flex %s without inventing rank or borrowing solo LP',
    async (status, expected) => {
      const value = raw()
      const snapshot = normalizeRankedStats(
        { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'I', leaguePoints: 42 }] },
        '2026-10-13T12:05:00Z'
      )
      const flexStatus = status === 'no-snapshot' ? 'missing' : status
      snapshot.flex = { status: flexStatus, rank: null }
      value.participantRanks = {
        version: 1,
        source: 'local-game-player-rank-snapshot',
        participants: Array.from({ length: 10 }, (_, i) => ({
          participantId: i + 1,
          snapshot: i === 0 && status !== 'no-snapshot' ? snapshot : null,
          timing: 'unknown',
          observedAt: null
        }))
      }
      fixture.match = value
      const html = await render()
      const metadata = [
        ...html.matchAll(/<span\b[^>]*class="ten-player-meta"[^>]*>([\s\S]*?)<\/span>/g)
      ].map((match) => match[1])
      expect(metadata[0]).toContain(`上路 · ${expected}`)
      expect(metadata[0]).not.toContain('—')
      expect(metadata[0]).not.toContain('LP')
      expect(visibleRanks(html)).not.toContain('黄金 I')
      expect(html).not.toContain('单双排：黄金 I · 42 LP')
    }
  )
  test('does not change unknown timing into post-match, or hide stale provenance', async () => {
    const value = raw()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II' }] },
      '2026-10-13T12:05:00Z'
    )
    const stale = { ...snapshot, status: 'stale' as const, reason: 'network-error' as const }
    value.participantRanks = {
      version: 1,
      source: 'local-game-player-rank-snapshot',
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        snapshot: i === 0 ? stale : null,
        timing: 'unknown',
        observedAt: null
      }))
    }
    fixture.match = value
    const html = await render()
    expect(html).toContain('时间未知')
    expect(html).toContain('旧快照')
    expect(html).toContain('网络或服务超时失败')
  })
  test('keeps loading, unavailable raw cache and failed reads distinct', async () => {
    fixture.match = null
    fixture.loading = true
    expect(await render()).toContain('正在读取本地十人摘要')
    fixture.loading = false
    expect(await render()).toContain('本局十人摘要不可用')
    fixture.error = true
    expect(await render()).toContain('本地十人摘要读取失败')
    fixture.error = false
  })
  test('distinguishes collected but unusable ranks from no capture', async () => {
    fixture.match = raw()
    const snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'UNRANKED' }] },
      '2026-10-13T12:05:00Z'
    )
    game.opponentRanks = {
      version: 1,
      source: 'SGP leagues-ledge (current snapshot)',
      serverId: 'TEST',
      opponents: Array.from({ length: 5 }, (_, i) => ({
        slot: i + 1,
        role: null,
        champion: null,
        snapshot
      }))
    }
    try {
      const html = await render()
      expect(html).not.toContain('对手查询时平均段位')
      expect(html).not.toContain('可用 0/5')
      expect(html).not.toContain('对手slot')
      expect(html).not.toContain('未按slot')
    } finally {
      delete game.opponentRanks
    }
  })
})
