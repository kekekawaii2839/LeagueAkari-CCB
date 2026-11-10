import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  aggregateNativeMetric,
  nativeMetricDefinitions,
  nativeMetricKeys
} from '@shared/shards/member-analysis/native-metrics'

import { aggregateConversion, earlyGoldDiff } from './analytics'
import { eventMetricCell, eventSections, eventSideGames } from './event-results'
import { formatMetric, roleMetricMeta } from './metric-defs'

export const teamMetricGroups = [
  '全部指标',
  '基础与资源',
  '前期差值',
  ...eventSections.map((section) => section.title)
]
export type TeamMetricCell = {
  value: string
  sample: string
  tone?: 'positive' | 'negative'
}
export type TeamMetricRow = {
  key: string
  group: string
  label: string
  definition: string
  cells: TeamMetricCell[]
}

// One observation is one match, never one tracked member. All groups share the global sample.
export function teamMetricRows(games: MemberAnalysisGame[]): TeamMetricRow[] {
  const sides = ['总计', '蓝方', '红方'] as const
  const populations = sides.map((side) => eventSideGames(games, side))
  const sample = (valid: number, total: number) =>
    `有效 ${valid}/${total} 场${valid === 0 ? ' · 未采集或不适用' : valid < total ? ' · 部分有效' : ''}`
  const rows: TeamMetricRow[] = [
    {
      key: 'games',
      group: '基础与资源',
      label: '场次',
      definition: '当前全局筛选与最近场数范围内的对局数。',
      cells: populations.map((population) => ({
        value: formatMetric(population.length, 'int'),
        sample: ''
      }))
    },
    {
      key: 'winRate',
      group: '基础与资源',
      label: '胜率',
      definition: '胜场数 ÷ 对局数；描述当前样本，不代表未来胜率。',
      cells: populations.map((population) => {
        const wins = population.filter((game) => game.win).length
        return {
          value: formatMetric(population.length ? wins / population.length : null, 'pct'),
          sample: `${wins} 胜 / ${population.length - wins} 负`
        }
      })
    }
  ]
  for (const key of nativeMetricKeys) {
    if (key === 'damageTakenPerDeath') continue
    const definition = nativeMetricDefinitions[key]
    rows.push({
      key,
      group: '基础与资源',
      label:
        key === 'gameDuration'
          ? `${definition.label}（分钟）`
          : key === 'bloodiness'
            ? `${definition.label}（击杀/分钟）`
            : definition.label,
      definition: `${definition.description} 单位：${definition.unit}。`,
      cells: populations.map((population) => {
        const result = aggregateNativeMetric(population, key)
        return {
          value: result.value === null ? '—' : formatMetric(result.value, definition.fmt),
          sample: sample(result.validGames, population.length)
        }
      })
    })
  }
  const differences = [
    {
      key: 'gold15',
      label: roleMetricMeta.gd15.label,
      unit: '金币',
      read: (game: MemberAnalysisGame) => earlyGoldDiff(game, '15'),
      definition:
        '五个分路的 15 分钟对位经济差之和；仅纳入达到 15 分钟且五路数值齐全的对局，按有效对局平均。'
    },
    {
      key: 'gold20',
      label: '经济差 @ 20',
      unit: '金币',
      read: (game: MemberAnalysisGame) => earlyGoldDiff(game, '20'),
      definition: '20 分钟团队经济差，按达到该时刻且数值已知的对局平均。'
    },
    ...(
      [
        ['dragon15Diff', roleMetricMeta.dragon15.label, '条', 900],
        ['grub15Diff', roleMetricMeta.grub15.label, '只', 900],
        ['objectiveFight15Diff', roleMetricMeta.objectiveFight15.label, '击杀', 900],
        ['tower20Diff', '防御塔差 @ 20', '座', 1200],
        ['upperGold15', '上半区经济差 @ 15', '金币', 900],
        ['botGold15', '下半区经济差 @ 15', '金币', 900]
      ] as const
    ).map(([key, label, unit, duration]) => ({
      key,
      label,
      unit,
      read: (game: MemberAnalysisGame) => (game.duration >= duration ? game[key] : null),
      definition: `${label}${key === 'upperGold15' ? '（上野中三路）' : key === 'botGold15' ? '（下辅两路）' : ''}，己方减敌方，按达到该时刻且数值已知的对局平均；差值不代表因果收益。`
    }))
  ]
  for (const metric of differences)
    rows.push({
      key: metric.key,
      group: '前期差值',
      label: metric.label,
      definition: `${metric.definition} 单位：${metric.unit}。`,
      cells: populations.map((population) => {
        const values = population
          .map(metric.read)
          .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        const value = values.length
          ? values.reduce((sum, value) => sum + value, 0) / values.length
          : null
        return {
          value: value === null ? '—' : `${value > 0 ? '+' : ''}${formatMetric(value)}`,
          tone: value === null || value === 0 ? undefined : value > 0 ? 'positive' : 'negative',
          sample: sample(values.length, population.length)
        }
      })
    })
  const conversion = populations.map((population) => aggregateConversion(population)[0])
  const rawCounts = [
    ['killEpisodes', '击杀窗口', '击杀后的兑现'],
    ['convertedKillEpisodes', '已兑现击杀窗口', '击杀后的兑现'],
    ['killToEpicEpisodes', '转资源击杀窗口', '击杀后的兑现'],
    ['killToTowerEpisodes', '转推塔击杀窗口', '击杀后的兑现'],
    ['deathEpisodes', '死亡窗口', '死亡代价'],
    ['highCostDeathEpisodes', '高代价死亡窗口', '死亡代价'],
    ['cleanObjectives', '干净资源事件', '资源团'],
    ['objectiveFightSamples', '资源团次数', '资源团'],
    ['objectiveFightWins', '资源团获胜次数', '资源团'],
    ['tradedEnemyObjectives', '已交换敌方资源窗口', '跨图交换']
  ] as const
  for (const section of eventSections)
    for (const metric of [...section.metrics, ...section.extra])
      rows.push({
        key: metric.key,
        group: section.title,
        label: metric.label,
        definition: `${metric.help}${metric.unit ? ` 单位：${metric.unit}。` : ''}`,
        cells: populations.map((population, index) => ({
          ...eventMetricCell({ ...metric, unit: undefined }, conversion[index], population)
        }))
      })
  for (const [key, label, group] of rawCounts)
    rows.push({
      key,
      group,
      label,
      definition: `${label}的总次数，仅统计事件数据有效的对局。`,
      cells: populations.map((population, index) =>
        eventMetricCell(
          { key, label, help: '', format: 'int', fields: [key] },
          conversion[index],
          population
        )
      )
    })
  return rows
}
