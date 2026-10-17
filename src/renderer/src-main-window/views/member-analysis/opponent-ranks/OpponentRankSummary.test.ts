// sort-imports-ignore
import '../test-i18n'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import GoldEmblem from '@renderer-shared/assets/ranked-icons-large/gold.png'
import BronzeEmblem from '@renderer-shared/assets/ranked-icons-large/bronze.png'
import ChallengerEmblem from '@renderer-shared/assets/ranked-icons-large/challenger.png'
import DiamondEmblem from '@renderer-shared/assets/ranked-icons-large/diamond.png'
import EmeraldEmblem from '@renderer-shared/assets/ranked-icons-large/emerald.png'
import GrandmasterEmblem from '@renderer-shared/assets/ranked-icons-large/grandmaster.png'
import IronEmblem from '@renderer-shared/assets/ranked-icons-large/iron.png'
import MasterEmblem from '@renderer-shared/assets/ranked-icons-large/master.png'
import PlatinumEmblem from '@renderer-shared/assets/ranked-icons-large/platinum.png'
import SilverEmblem from '@renderer-shared/assets/ranked-icons-large/silver.png'
import {
  RANK_TIERS,
  RANK_TIER_NAMES,
  normalizeRankedStats,
  unavailableRank
} from '@shared/shards/member-analysis/opponent-ranks'
import { describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, createSSRApp, h, nextTick, shallowRef, ssrContextKey } from 'vue'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { renderToString } from 'vue/server-renderer'
import OpponentRankSummary from './OpponentRankSummary.vue'
vi.mock('../components/MemberAnalysisSegments.vue', () => ({
  default: {
    props: ['modelValue', 'options', 'ariaLabel', 'ariaControls'],
    emits: ['update:modelValue'],
    setup:
      (props: any, { emit }: any) =>
      () =>
        h('queue-segments', {
          ...props,
          'aria-label': props.ariaLabel,
          'onUpdate:modelValue': (value: string | number) => emit('update:modelValue', value)
        })
  }
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
  test('repeated button activation cancels selection and does not reselect on data refresh', async () => {
    const descriptor = parse(
      readFileSync(new URL('./OpponentRankSummary.vue', import.meta.url), 'utf8')
    ).descriptor
    OpponentRankSummary.render = new Function(
      'Vue',
      compile(descriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        bindingMetadata: compileScript(descriptor, { id: 'opponent-rank-behavior' }).bindings
      }).code
    )(Vue)
    type Node = { props: Record<string, any>; children: Node[]; parent: Node | null }
    const node = (): Node => ({ props: {}, children: [], parent: null })
    const renderer = createRenderer<Node, Node>({
      createElement: node,
      createText: node,
      createComment: node,
      setText() {},
      setElementText() {},
      parentNode: (element) => element.parent,
      nextSibling: (element) =>
        element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null,
      patchProp: (element, key, _previous, value) => {
        element.props[key] = value
      },
      insert(element, parent, anchor) {
        element.parent = parent
        const index = anchor ? parent.children.indexOf(anchor) : -1
        parent.children.splice(index < 0 ? parent.children.length : index, 0, element)
      },
      remove(element) {
        if (element.parent)
          element.parent.children.splice(element.parent.children.indexOf(element), 1)
      }
    })
    const root = node()
    const value = game()
    for (const opponent of value.opponentRanks!.opponents) {
      opponent.snapshot.solo = {
        status: 'ranked',
        rank: { tier: 'DIAMOND', division: 'IV', leaguePoints: 0 }
      }
    }
    const games = shallowRef([value])
    const app = renderer.createApp({ render: () => h(OpponentRankSummary, { games: games.value }) })
    app.provide(ssrContextKey, {})
    const findButton = (element: Node): Node | undefined =>
      element.props['aria-label']?.startsWith('黄金，')
        ? element
        : element.children.map(findButton).find(Boolean)
    app.mount(root)
    const button = findButton(root)!
    expect(button.props['aria-pressed']).toBe(true)
    button.props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(button.props['aria-pressed']).toBe(false)
    games.value = [{ ...value }]
    await nextTick()
    expect(button.props['aria-pressed']).toBe(false)
    button.props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(button.props['aria-pressed']).toBe(true)
    button.props.onClick({ stopPropagation() {} })
    await nextTick()
    expect(button.props['aria-pressed']).toBe(false)
    const findQueue = (element: Node): Node | undefined =>
      element.props['aria-label'] === '对手段位排位队列'
        ? element
        : element.children.map(findQueue).find(Boolean)
    const segment = findQueue(root)!
    expect(segment.props.ariaLabel).toBe('对手段位排位队列')
    expect(segment.props.modelValue).toBe('flex')
    expect(segment.props.options).toEqual([
      { value: 'flex', label: '灵活组排' },
      { value: 'solo', label: '单双排' }
    ])
    expect(segment.props.ariaControls).toBe('opponent-rank-comparison')
    segment.props['onUpdate:modelValue']('solo')
    await nextTick()
    expect(segment.props.modelValue).toBe('solo')
    expect(button.props['aria-pressed']).toBe(false)
    expect(button.props['aria-label']).toContain('对手出场 0 次，分组 0 场')
    games.value = [{ ...value }]
    await nextTick()
    expect(segment.props.modelValue).toBe('solo')
    segment.props['onUpdate:modelValue']('invalid')
    await nextTick()
    expect(segment.props.modelValue).toBe('solo')
    segment.props['onUpdate:modelValue']('flex')
    await nextTick()
    expect(segment.props.modelValue).toBe('flex')
    expect(button.props['aria-pressed']).toBe(false)
    expect(button.props['aria-label']).toContain('对手出场 5 次，分组 1 场')
    app.unmount()
  })
  test('uses native player-header rank emblems for tier rows and the selected rank', async () => {
    const html = await render([game()])
    const emblems = {
      IRON: IronEmblem,
      BRONZE: BronzeEmblem,
      SILVER: SilverEmblem,
      GOLD: GoldEmblem,
      PLATINUM: PlatinumEmblem,
      EMERALD: EmeraldEmblem,
      DIAMOND: DiamondEmblem,
      MASTER: MasterEmblem,
      GRANDMASTER: GrandmasterEmblem,
      CHALLENGER: ChallengerEmblem
    }
    for (const tier of RANK_TIERS) {
      const row = html
        .split('<tr')
        .find((value) => value.includes(`<span>${RANK_TIER_NAMES[tier]}</span>`))
      expect(row).toContain(`src="${emblems[tier]}" alt=""`)
    }
    const selected = html.split('class="rank-selection-heading"')[1]
    expect(selected).toContain(`src="${GoldEmblem}" alt=""`)
    expect(selected).toContain('黄金')
  })
  test('keeps separate units, partial samples and nonzero exception counts without the method block', async () => {
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
    expect(main).not.toContain('查询时段位（非比赛当时）')
    expect(main).not.toContain('统计口径')
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
    expect(main).not.toContain('来源：英雄联盟对局服务')
    expect(main).toContain('Wilson 95% 区间')
    expect(main).toContain('样本少')
    expect(main).not.toContain('历史描述，不代表下一局胜率')
    expect(main).not.toContain('同一人可重复')
    expect(html).not.toContain('<details')
    expect(html).not.toContain('<summary')
    expect(html).not.toContain('分组胜率每场只计一次')
    expect(html).not.toContain('未定级、定级中、缺失或旧快照不参与平均')
  })
  test('keeps unranked and provisional records out of the average, but visible in coverage', async () => {
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
    expect(html).toContain('已定级对手 3/5 条出场记录')
    expect(html).not.toContain('不代表比赛开始时的段位或实际实力')
    expect(html).not.toContain('<details')
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
