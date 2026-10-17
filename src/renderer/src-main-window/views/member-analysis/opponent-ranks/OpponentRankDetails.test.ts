// sort-imports-ignore
import '../test-i18n'
import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { OpponentRanks } from '@shared/shards/member-analysis/opponent-ranks'
import {
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import OpponentRankDetails from './OpponentRankDetails.vue'
import { snapshotTime } from './format'
import { createPinia } from 'pinia'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import GoldMedal from '@renderer-shared/assets/ranked-icons-large/gold.png'
import DiamondMedal from '@renderer-shared/assets/ranked-icons-large/diamond.png'
import ChallengerMedal from '@renderer-shared/assets/ranked-icons-large/challenger.png'

vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: {
    props: ['position'],
    setup: (props: { position: string }) => () => h('svg', { 'data-position': props.position })
  }
}))

const render = (ranks?: OpponentRanks, embedded = false) => {
  const pinia = createPinia()
  const league = useLeagueClientStore(pinia)
  league.gameData.champions = {
    887: {
      id: 887,
      alias: 'Gwen',
      name: '格温',
      roles: ['fighter'],
      squarePortraitPath: '/synthetic/gwen.png'
    },
    121: {
      id: 121,
      alias: 'Khazix',
      name: '卡兹克',
      roles: ['assassin'],
      squarePortraitPath: '/synthetic/khazix.png'
    }
  }
  return renderToString(
    createSSRApp({ render: () => h(OpponentRankDetails, { ranks, embedded }) }).use(pinia)
  )
}
const ranks = (): OpponentRanks => ({
  version: 1,
  source: 'SGP leagues-ledge (current snapshot)',
  serverId: 'TEST',
  opponents: Array.from({ length: 5 }, (_, i) => ({
    slot: i + 1,
    role: null,
    champion: null,
    snapshot: unavailableRank('network-error', '2026-10-13T12:00:00Z')
  }))
})
describe('opponent rank explanation copy and missingness', () => {
  test.each([false, true])(
    'keeps canonical role text with native position icons and leaves unknown roles icon-free (embedded=%s)',
    async (embedded) => {
      const value = ranks()
      const canonical = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
      value.opponents.forEach((opponent, index) => {
        opponent.role = canonical[index]
      })
      const html = await render(value, embedded)
      for (const [index, label] of ['上路', '打野', '中路', '下路', '辅助'].entries()) {
        expect(html).toContain(`data-position="${canonical[index]}"`)
        expect(html).toContain(label)
      }
      expect(html.match(/data-position=/g)).toHaveLength(5)
      expect(html.match(/aria-hidden="true"/g)).toHaveLength(5)
      value.opponents[0].role = JSON.parse('"SUPPORT"')
      value.opponents[1].role = null
      const unknown = await render(value, embedded)
      expect(unknown.match(/data-position=/g)).toHaveLength(3)
      expect(unknown.match(/分路未知/g)).toHaveLength(2)
      expect(unknown).not.toContain('data-position="SUPPORT"')
      expect(unknown).not.toContain('data-position="ALL"')
    }
  )
  test.each([false, true])(
    'adds native current-rank emblems only for known ranks and retains text/status/time (embedded=%s)',
    async (embedded) => {
      const value = ranks()
      const time = '2026-10-13T12:00:00Z'
      value.opponents[0].snapshot = normalizeRankedStats(
        {
          queues: [
            { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', rank: 'IV', leaguePoints: 0 },
            { queueType: 'RANKED_FLEX_SR', tier: 'DIAMOND', rank: 'II' }
          ]
        },
        time
      )
      value.opponents[1].snapshot = normalizeRankedStats(
        {
          queues: [
            { queueType: 'RANKED_SOLO_5x5', tier: 'UNRANKED' },
            { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV', provisionalGamesRemaining: 3 }
          ]
        },
        time
      )
      value.opponents[2].snapshot = {
        ...normalizeRankedStats(
          { queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'CHALLENGER', leaguePoints: 700 }] },
          time
        ),
        status: 'stale',
        reason: 'network-error'
      }
      const html = await render(value, embedded)
      const rows = html
        .split(/<tbody\b[^>]*>/)[1]
        .split('</tbody>')[0]
        .split('<tr')
        .slice(1)
      expect(html.match(/<img\b/g)).toHaveLength(3)
      expect(rows[0]).toContain(`src="${GoldMedal}"`)
      expect(rows[0]).toContain(`src="${DiamondMedal}"`)
      expect(rows[0]).toContain('黄金 IV · 0 LP')
      expect(rows[0]).toContain('钻石 II · LP 缺失')
      expect(rows[0]).toContain(snapshotTime(time))
      expect(rows[1]).toContain('未定级')
      expect(rows[1]).toContain('定级中')
      expect(rows[1]).not.toContain('<img')
      expect(rows[2]).toContain(`src="${ChallengerMedal}"`)
      expect(rows[2]).toContain('王者 · 700 LP（旧快照）')
      expect(rows[2]).toContain('网络或服务超时失败（已尝试）')
      for (const row of rows.slice(3)) {
        expect(row).toContain('未获取')
        expect(row).not.toContain('<img')
      }
      for (const image of html.match(/<img\b[^>]*>/g) ?? []) {
        expect(image).toContain('alt=""')
        expect(image).toContain('width="24"')
        expect(image).toContain('height="24"')
      }
    }
  )
  test('embedded native tab removes repeated prose but keeps source, temporal uncertainty and actual missing reasons', async () => {
    const value = ranks()
    value.capture = { mode: 'live', observedAt: '2026-10-13T12:00:00Z', phase: 'InProgress' }
    value.opponents[0].capturedDuringGame = true
    value.opponents[0].champion = 'Gwen'
    value.opponents[0].role = 'TOP'
    const longUnknown = 'SyntheticUnknownHero_Long_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
    value.opponents[3].champion = longUnknown
    value.opponents[1].snapshot = normalizeRankedStats(
      { queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV', leaguePoints: 0 }] },
      '2026-10-13T12:00:00Z'
    )
    const html = await render(value, true)
    expect(html).not.toContain('<h4')
    expect(html).not.toContain('各人以实际查询时间为准，不保证开局段位')
    expect(html).not.toContain('查询时快照（与比赛的时间关系未核实）')
    expect(html).toContain('查询时快照')
    expect(html).toContain('与比赛时点关系未核实')
    expect(html).toContain('局内采集标记')
    expect(html).toContain('格温')
    expect(html).toContain(longUnknown)
    expect(html).toContain('上路')
    expect(html).toContain('黄金 IV · 0 LP')
    expect(html).toContain(snapshotTime(value.capture.observedAt))
    expect(html).toContain('未查询成功')
    expect(html).toContain('网络或服务超时失败（已尝试）')
    expect(html).toContain('来源：英雄联盟对局服务')
    expect(html).toContain('TEST')
    expect(html.match(/scope="row"/g)).toHaveLength(5)
  })
  test('embedded unavailable data remains explicit rather than showing empty or fabricated ranks', async () => {
    const html = await render(undefined, true)
    expect(html).toContain('未采集。连接对应区服客户端后刷新；无法回溯历史段位。')
    expect(html).toContain('与比赛时点关系未核实')
    expect(html).not.toContain('<tbody')
  })
  test('resolves numeric and canonical heroes using client labels while preserving unknown fallback', async () => {
    const value = ranks()
    value.opponents.forEach((opponent, index) => {
      opponent.champion = ['887', 'Gwen', 'Kha\u0027Zix', 'SyntheticHero', null][index]
    })
    const html = await render(value)
    expect(html.match(/格温/g)).toHaveLength(2)
    expect(html).toContain('卡兹克')
    expect(html).toContain('SyntheticHero')
    expect(html).toContain('英雄未知')
    expect(html).not.toContain('<small>887</small>')
  })
  test('uses a fixed title and never calls absent data a post-match snapshot', async () => {
    const html = await render()
    expect(html).toMatch(/<h4\b[^>]*>对手查询时段位<\/h4>/)
    expect(html).toContain('未采集。连接对应区服客户端后刷新；无法回溯历史段位。')
    expect(html).not.toContain('事后')
  })
  test('keeps capture time, actual query reasons and the limits of a legacy live flag', async () => {
    const value = ranks()
    value.capture = { mode: 'live', observedAt: '2026-10-13T12:00:00Z', phase: 'InProgress' }
    value.opponents[0].capturedDuringGame = true
    const html = await render(value)
    expect(html).toContain('采集启动：')
    expect(html).toContain('各人以实际查询时间为准，不保证开局段位')
    expect(html).toContain('局内采集标记（具体时点未核实）')
    expect(html).toContain('未查询成功')
    expect(html).toContain('网络或服务超时失败（已尝试）')
    expect(html).not.toContain('本局期间自动获取')
  })
  test('separates missing observation, successful query and attempted-query timestamps without changing legacy default', () => {
    expect(snapshotTime(null, '采集时间未知')).toBe('采集时间未知')
    expect(snapshotTime(null, '未查询成功')).toBe('未查询成功')
    expect(snapshotTime(undefined, '尝试时间未知')).toBe('尝试时间未知')
    expect(snapshotTime(null)).toBe('未查询成功')
    expect(snapshotTime('2026-10-13T12:00:00Z', '采集时间未知')).not.toBe('采集时间未知')
  })
})
