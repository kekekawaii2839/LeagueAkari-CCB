import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import { type ConversionAggregate, type SideLabel, aggregateConversion } from './analytics'
import { formatMetric } from './metric-defs'
import { finiteOrNull, formatSigned } from './visualization'

type EventField = keyof NonNullable<MemberAnalysisGame['eventDecision']>
export type EventMetric = {
  key: keyof ConversionAggregate
  label: string
  help: string
  format?: 'pct' | 'int' | 'num'
  unit?: string
  signed?: boolean
  fields: EventField[]
  counts?: [EventField, EventField]
  windows?: string
  samples?: EventField
}
export const eventSections: { title: string; metrics: EventMetric[]; extra: EventMetric[] }[] = [
  {
    title: '击杀后的兑现',
    metrics: [
      {
        key: 'killConversionRate',
        label: '总兑现率',
        help: '击杀后取得资源或防御塔；分母为击杀窗口。',
        format: 'pct',
        fields: ['convertedKillEpisodes', 'killEpisodes'],
        counts: ['convertedKillEpisodes', 'killEpisodes'],
        windows: '击杀窗口'
      },
      {
        key: 'killToEpicRate',
        label: '转资源率',
        help: '击杀后取得史诗资源；分母为击杀窗口。',
        format: 'pct',
        fields: ['killToEpicEpisodes', 'killEpisodes'],
        counts: ['killToEpicEpisodes', 'killEpisodes'],
        windows: '击杀窗口'
      },
      {
        key: 'killToTowerRate',
        label: '转推塔率',
        help: '击杀后取得防御塔；分母为击杀窗口。',
        format: 'pct',
        fields: ['killToTowerEpisodes', 'killEpisodes'],
        counts: ['killToTowerEpisodes', 'killEpisodes'],
        windows: '击杀窗口'
      },
      {
        key: 'conversionDelaySec',
        label: '平均延迟',
        help: '已记录兑现延迟的平均值，单位为秒。',
        unit: '秒',
        fields: ['conversionDelayTotalSec', 'conversionDelaySamples'],
        samples: 'conversionDelaySamples'
      }
    ],
    extra: []
  },
  {
    title: '死亡代价',
    metrics: [
      {
        key: 'highCostDeathRate',
        label: '高代价死亡率',
        help: '导致明显资源损失的死亡窗口比例。',
        format: 'pct',
        fields: ['highCostDeathEpisodes', 'deathEpisodes'],
        counts: ['highCostDeathEpisodes', 'deathEpisodes'],
        windows: '死亡窗口'
      },
      {
        key: 'deathCostPointsPG',
        label: '场均代价点',
        help: '资源、塔和镀层按原规则加权，按当前范围场数平均。',
        unit: '点',
        fields: ['deathCostPoints']
      },
      {
        key: 'deathCostEpicsPG',
        label: '场均丢资源',
        help: '死亡后丢失的史诗资源，按当前范围场数平均。',
        unit: '个',
        fields: ['deathCostEpics']
      }
    ],
    extra: [
      {
        key: 'deathCostTowersPG',
        label: '场均丢塔',
        help: '死亡后丢失的防御塔，按当前范围场数平均。',
        unit: '座',
        fields: ['deathCostTowers']
      },
      {
        key: 'shutdownBountyLostPG',
        label: '场均终结赏金',
        help: '死亡丢失的终结赏金，按当前范围场数平均。',
        unit: '金币',
        fields: ['shutdownBountyLost']
      }
    ]
  },
  {
    title: '资源团',
    metrics: [
      {
        key: 'cleanObjectiveRate',
        label: '干净资源率',
        help: '无需付出团战代价的资源事件比例。',
        format: 'pct',
        fields: ['cleanObjectives', 'objectivesTaken'],
        counts: ['cleanObjectives', 'objectivesTaken'],
        windows: '资源事件'
      },
      {
        key: 'objectiveFightWinRate',
        label: '资源团胜率',
        help: '资源附近团战的获胜比例，不是对局胜率。',
        format: 'pct',
        fields: ['objectiveFightWins', 'objectiveFightSamples'],
        counts: ['objectiveFightWins', 'objectiveFightSamples'],
        windows: '资源团'
      },
      {
        key: 'objectivesTaken',
        label: '取得资源',
        help: '当前范围取得的史诗资源事件总数。',
        format: 'int',
        unit: '个',
        fields: ['objectivesTaken']
      }
    ],
    extra: []
  },
  {
    title: '跨图交换',
    metrics: [
      {
        key: 'crossMapTradeRate',
        label: '交换率',
        help: '敌方拿资源时取得跨图收益；分母为敌方资源窗口。',
        format: 'pct',
        fields: ['tradedEnemyObjectives', 'enemyObjectives'],
        counts: ['tradedEnemyObjectives', 'enemyObjectives'],
        windows: '敌方资源窗口'
      },
      {
        key: 'tradeDelaySec',
        label: '交换延迟',
        help: '负数表示提前交换，正数表示后续交换。',
        unit: '秒',
        signed: true,
        fields: ['tradeDelayTotalSec', 'tradeDelaySamples'],
        samples: 'tradeDelaySamples'
      },
      {
        key: 'enemyObjectives',
        label: '敌方资源事件',
        help: '当前范围的可交换窗口数量。',
        format: 'int',
        unit: '个',
        fields: ['enemyObjectives']
      }
    ],
    extra: []
  }
]

export const eventSideGames = (games: MemberAnalysisGame[], side: SideLabel) =>
  side === '总计' ? games : games.filter((game) => game.side === (side === '蓝方' ? 'Blue' : 'Red'))

// Presentation guard only: do not change the existing aggregate or treat its zero fallback as an observation.
export function eventMetricCell(
  metric: EventMetric,
  row: ConversionAggregate,
  games: MemberAnalysisGame[]
) {
  const valid = games.filter((game) =>
    metric.fields.every((key) => finiteOrNull(game.eventDecision?.[key]) !== null)
  ).length
  if (valid === 0)
    return {
      value: '—',
      sample: `有效 ${valid}/${games.length} 场 · ${valid ? '部分未采集' : '未采集'}`,
      missing: true
    }
  const value = finiteOrNull(row[metric.key])
  const text =
    value === null
      ? '—'
      : metric.signed
        ? formatSigned(value, 1)
        : formatMetric(value, metric.format ?? 'num')
  const sum = (key: EventField) =>
    games.reduce((n, game) => n + (game.eventDecision?.[key] ?? 0), 0)
  let sample = `有效 ${valid}/${games.length} 场`
  if (metric.counts) {
    const [numerator, denominator] = metric.counts.map(sum)
    sample = denominator ? `${numerator} / ${denominator} 次` : `无${metric.windows}`
  } else if (metric.samples) {
    const count = sum(metric.samples)
    sample = count ? `延迟记录 ${count} 次` : '无延迟记录'
  }
  return {
    value: text === '—' || !metric.unit ? text : `${text} ${metric.unit}`,
    sample: valid < games.length ? `${sample} · 有效 ${valid}/${games.length} 场` : sample,
    missing: false
  }
}

export function eventGameCells(metric: EventMetric, games: MemberAnalysisGame[]) {
  return new Map(
    games.map((game) => [
      game.gameId,
      eventMetricCell(metric, aggregateConversion([game])[0], [game])
    ])
  )
}
