// sort-imports-ignore
import '../test-i18n'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import OpponentRankSummary from './OpponentRankSummary.vue'
vi.mock('naive-ui', () => ({
  NRadioGroup: () => null,
  NRadioButton: () => null
}))
function game(): MemberAnalysisGame {
  return {
    win: true,
    duration: 1800,
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
            queues: [{ queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'IV' }]
          },
          '2026-10-12T12:00:00.000Z'
        )
      }))
    }
  } as MemberAnalysisGame
}
async function render(games: MemberAnalysisGame[]) {
  return (
    await renderToString(createSSRApp({ render: () => h(OpponentRankSummary, { games }) }))
  ).replace(/ data-v-[\da-f]+/g, '')
}
describe('opponent rank comparison and coverage', () => {
  test('keeps separate units, partial samples, time and nonzero exception counts visible', async () => {
    const value = game()
    value.opponentRanks!.opponents[0].snapshot = unavailableRank(
      'network-error',
      '2026-10-12T13:00:00.000Z'
    )
    value.opponentRanks!.opponents[1].snapshot = unavailableRank(
      'network-paused',
      '2026-10-12T13:00:00.000Z'
    )
    value.opponentRanks!.opponents[2].snapshot.status = 'stale'
    const html = await render([
      value,
      { ...game(), opponentRanks: undefined },
      { ...game(), duration: 899 }
    ])
    const main = html.split('<details')[0]
    expect(main).toContain('查询时段位（非比赛当时）')
    expect(main).toContain('已定级对手 2/10 条出场记录')
    expect(main).toContain('<dt>胜率纳入</dt><dd>1 / 2 场</dd>')
    expect(main).toContain('<dt>不足五名可用对手</dt><dd>1 场</dd>')
    for (const [label, count] of [
      ['缺失/失败', 1],
      ['暂未查询', 1],
      ['旧快照', 1],
      ['未采集', 5]
    ])
      expect(main).toContain(`<dt>${label}</dt><dd>${count} 次</dd>`)
    expect(main).not.toContain('查询时间（本地）')
    expect(html.split('<details')[1]).toContain('查询时间（本地）')
    expect(main).not.toContain('来源：英雄联盟对局服务')
    expect(html.split('<details')[1]).toContain('来源：英雄联盟对局服务')
    expect(main).toContain('Wilson 95% 区间')
    expect(main).toContain('样本少')
    expect(main).not.toContain('历史描述，不代表下一局胜率')
    expect(main).not.toContain('同一人可重复')
    expect(html).not.toMatch(/<details[^>]*\bopen(?:\s|=|>)/)
    expect(html).toContain('分组胜率每场只计一次')
    expect(html).toContain('未定级、定级中、缺失或旧快照不参与平均')
  })
  test('keeps unranked and provisional records out of the average, but visible in coverage and definitions', async () => {
    const value = game()
    value.opponentRanks!.opponents[0].snapshot.flex = {
      status: 'unranked',
      rank: null
    }
    value.opponentRanks!.opponents[1].snapshot.flex = {
      status: 'provisional',
      rank: null
    }
    const html = await render([value])
    expect(html.split('<details')[0]).toContain('<dt>未定级</dt><dd>1 次</dd>')
    expect(html.split('<details')[0]).toContain('<dt>定级中</dt><dd>1 次</dd>')
    expect(html.split('<details')[1]).toContain('<dt>已定级</dt><dd>3</dd>')
    expect(html).toContain('不代表比赛开始时的段位或实际实力')
  })
  test('failed-query recovery is visible without a fabricated zero win rate', async () => {
    const value = game()
    for (const o of value.opponentRanks!.opponents)
      o.snapshot = unavailableRank('network-error', '2026-10-12T13:00:00.000Z')
    const main = (await render([value])).split('<details')[0]
    expect(main).toContain('已定级对手 0/5 条出场记录')
    expect(main).toContain('<dt>胜率纳入</dt><dd>0 / 1 场</dd>')
    expect(main).toContain('尚无成功段位快照')
    expect(main).toContain('请连接对应区服客户端')
    expect(main).not.toContain('查询时间（本地）')
    expect(main).not.toContain('历史胜率 0.0%')
  })
  test('empty denominators remain missing and have filter recovery, not connection recovery', async () => {
    const html = await render([])
    expect(html).toContain('已定级对手 0/0 条出场记录')
    expect(html).toContain('<dt>胜率纳入</dt><dd>0 / 0 场</dd>')
    expect(html).toContain('当前筛选范围内没有符合条件的对局，请调整顶部筛选。')
    expect(html).not.toContain('请连接对应区服客户端')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('0.0%')
  })
  test('zero wins remain an observed rate; selection includes exact interval and both denominators', async () => {
    const value = { ...game(), win: false }
    const html = await render([value])
    expect(html).toContain('历史胜率 0.0%')
    expect(html).toContain('0.0%–79.3%')
    expect(html).toContain('<dt>胜 / 负</dt><dd>0 / 1 场</dd>')
    expect(html).toContain('<dt>已定级出场占比</dt><dd>100.0%</dd>')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('对手出场 5 次，分组 1 场、胜 0 场')
  })
})
