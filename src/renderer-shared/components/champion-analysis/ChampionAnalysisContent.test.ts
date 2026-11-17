import type { AggregatedChampionAnalysis } from '@shared/data-adapter/analysis/player'
import { renderToString } from '@vue/server-renderer'
import { createInstance } from 'i18next'
import I18nextVue from 'i18next-vue'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { parse } from 'yaml'

import ChampionAnalysisContent from './ChampionAnalysisContent.vue'

const copy = parse(readFileSync('src/shared/i18n/zh-CN/common.yaml', 'utf8'))

vi.mock('@renderer-shared/components/akari-score', () => ({
  AkariScorePopover: defineComponent({
    inheritAttrs: false,
    props: ['score'],
    setup:
      (_, { slots }) =>
      () =>
        slots.default?.()
  })
}))
vi.mock('@renderer-shared/components/jungle-pathing-analysis', () => ({
  JunglePathingContent: () => null
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('@renderer-shared/providers/akari-resource/context', () => ({
  useAkariResourceProvider: () => ({ champions: { name: () => '匿名英雄' } })
}))
vi.mock('./ChampionMasteryContent.vue', () => ({ default: () => null }))
vi.mock('./ChampionPositionChart.vue', () => ({ default: () => null }))
vi.mock('@vicons/material', () => ({
  DonutSmallRound: () => null,
  ForestRound: () => null,
  InsightsRound: () => null,
  ManageSearchFilled: () => null,
  MilitaryTechRound: () => null
}))
vi.mock('naive-ui', () => {
  const Slot = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.())
  })
  return { NButton: Slot, NIcon: Slot, NTabPane: Slot, NTabs: Slot }
})

function fixture(rate: number | null, valid: number): AggregatedChampionAnalysis {
  const all = {
    count: 2,
    wins: 1,
    losses: 1,
    winRate: 0.5,
    winningStreak: 0,
    losingStreak: 0,
    activeSessionWins: 0,
    activeSessionLosses: 0
  }
  return {
    championId: 77,
    summary: {
      avgVisionScore: 999,
      avgVisionScorePerMinute: rate,
      visionScorePerMinuteGames: valid,
      avgVisionScorePercentageOfTeam: 0.2,
      avgKda: 2,
      avgKillParticipation: 0.5,
      kdaCv: 0,
      kills: 1,
      deaths: 1,
      assists: 1,
      avgPings: null,
      avgEnemyMissingPings: null,
      avgSoloKills: null,
      avgChampionDamagePerMinute: 100,
      avgChampionDamagePercentageOfTeam: 0.2,
      avgDamageTakenPercentageOfTeam: 0.2,
      avgDamageGoldEfficiency: 1,
      avgKillDamageEfficiency: 1,
      avgGoldPercentageOfTeam: 0.2,
      avgCsPerMinute: 5,
      avgCsPercentageOfTeam: 0.2,
      avgTowerDamagePercentageOfTeam: 0.2
    },
    winLoss: { all, normal: all, cherry: { ...all, count: 0 } },
    akariScore: { total: 5 },
    positions: null,
    jungle: null
  } as AggregatedChampionAnalysis
}

describe('champion analysis vision rate', () => {
  it.each([
    [0.87654, 1, '0.88'],
    [0, 2, '0.00'],
    [null, 0, '—']
  ] as const)(
    'shows the rate %s without a unit suffix or sample caption',
    async (rate, valid, display) => {
      const i18next = createInstance()
      await i18next.init({
        lng: 'zh-CN',
        resources: { 'zh-CN': { common: copy } },
        interpolation: { escapeValue: false }
      })
      const app = createSSRApp(ChampionAnalysisContent, { analysis: fixture(rate, valid) })
      app.use(I18nextVue, { i18next })
      const html = await renderToString(app)
      expect(html).toContain('场均分均视野')
      const visionStart = html.indexOf('场均分均视野')
      const visionRow = html.slice(visionStart, html.indexOf('</div>', visionStart))
      expect(visionRow).toContain(display)
      expect(html).not.toContain('有效')
      expect(visionRow).not.toContain('/分')
      expect(html).not.toContain('999')
      expect(html).toContain('视野占比')
      expect(html).toContain('20%')
    }
  )
})
