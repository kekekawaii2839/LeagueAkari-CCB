import { renderToString } from '@vue/server-renderer'
import { describe, expect, it, vi } from 'vitest'
import { createSSRApp } from 'vue'

import MatchCardDetailsTab from './MatchCardDetailsTab.vue'

const captured = vi.hoisted(() => ({ charts: [] as { title: string; chartData: unknown }[] }))

vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer-shared/composables/useNumberFormatter', () => ({
  useNumberFormatter: () => ({ formatNumber: (value: number) => String(value) })
}))
vi.mock('@renderer-shared/components/akari-score', () => ({ AkariScorePopover: {} }))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({ champions: { name: () => 'Synthetic champion' } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: { render: () => null }
}))
vi.mock('../utils/theme', () => ({ getTeamColor: () => 'transparent' }))
vi.mock('../context', async () => {
  const { ref } = await import('vue')
  return {
    useMatchCard: () => ({
      basicInfo: ref({ gameId: 1, gameCreation: 0, gameVersion: 'test', dataSource: 'sgp' }),
      hidePrivacy: ref(true)
    })
  }
})
vi.mock('../utils/details-table/raw-details', async () => {
  const { ref } = await import('vue')
  return {
    useRawDetails: () =>
      ref([
        {
          participantId: 2,
          championId: 2,
          identity: { teamIdentifier: 'TEAM-200' },
          visionScorePerMinute: 1.239
        },
        {
          participantId: 1,
          championId: 1,
          identity: { teamIdentifier: 'TEAM-100' },
          visionScorePerMinute: 0.5820763899
        },
        {
          participantId: 3,
          championId: 3,
          identity: { teamIdentifier: 'TEAM-200' },
          visionScorePerMinute: 0
        }
      ])
  }
})
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const passthrough = defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('div', slots.default?.())
  })
  return {
    NInput: { render: () => null },
    NScrollbar: passthrough,
    NPopover: defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h('div', [slots.trigger?.(), slots.default?.()])
    })
  }
})
vi.mock('../widgets/StatsBarChart.vue', async () => {
  const { defineComponent } = await import('vue')
  return {
    default: defineComponent({
      props: ['title', 'chartData'],
      setup: (props) => {
        captured.charts.push({ title: props.title, chartData: props.chartData })
        return () => null
      }
    })
  }
})

describe('detailed match per-minute vision chart', () => {
  it('keeps the numeric comparison chart and unrounded values while cells show two decimals', async () => {
    captured.charts.length = 0
    const html = await renderToString(createSSRApp(MatchCardDetailsTab))

    expect(
      captured.charts.find((chart) => chart.title === 'matchCard.statKeys.visionScorePerMinute')
        ?.chartData
    ).toEqual([
      { participantId: 1, value: 0.5820763899 },
      { participantId: 2, value: 1.239 },
      { participantId: 3, value: 0 }
    ])
    expect(html).toContain('>0.58</span>')
    expect(html).toContain('>1.24</span>')
    expect(html).toContain('>0.00</span>')
  })
})
