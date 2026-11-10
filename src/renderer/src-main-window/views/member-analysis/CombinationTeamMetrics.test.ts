// sort-imports-ignore
import './test-i18n'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test, vi } from 'vitest'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import CombinationTeamMetrics from './CombinationTeamMetrics.vue'
import { aggregateCombinationNativeMetrics } from './combination-native-metrics'
vi.mock('./MetricHelp.vue', () => ({ default: (props: any) => h('span', props.label) }))
const game = (
  id: number,
  duration: number,
  kills: number | null,
  dragons: number | null
): MemberAnalysisGame => ({
  gameId: id,
  timestamp: Date.UTC(2026, 0, id),
  date: `2026-01-${String(id).padStart(2, '0')}`,
  patch: '16.1',
  side: 'Blue',
  win: true,
  roster: 'Synthetic team metric fixture',
  metricSemantics: 'current-v5',
  dragon15Diff: null,
  grub15Diff: null,
  objectiveFight15Diff: null,
  counterMean: null,
  upperGold15: null,
  botGold15: null,
  gold20Diff: null,
  tower20Diff: null,
  jungle: null,
  laneGankDeaths: null,
  eventDecision: null,
  duration,
  players: [],
  teamMetrics: {
    totalKills: kills,
    dragons,
    barons: null,
    dragonSouls: null,
    elderDragons: null,
    firstDragonTime: 300,
    firstTowerTime: null
  }
})
test('combination team panel keeps individual metrics out and shows source-aware effective samples', async () => {
  const games = [game(1, 1800, 30, 0), game(2, 2400, 50, null)]
  const html = await renderToString(createSSRApp(CombinationTeamMetrics, { games }))
  expect(html).toContain('组合对局指标')
  expect(html).toContain('血腥程度')
  expect(html).toContain('击杀/分钟')
  expect(html).toContain('1.14')
  expect(html).toContain('有效 1/2 场')
  expect(html).toContain('0.00')
  expect(html).toContain('分:秒')
  expect(html).not.toContain('每死承伤')
})
test('an absent team enrichment is not an observed zero; known duration remains usable', () => {
  const games = [{ ...game(1, 1800, null, null), teamMetrics: undefined }]
  const result = aggregateCombinationNativeMetrics(games)
  expect(result.values.gameDuration).toBe(30)
  expect(result.values.teamDragonsPG).toBeNull()
  expect(result.samples.teamDragonsPG).toBe(0)
})
