import { expect, test } from 'vitest'

import {
  formatMetric,
  jungleMeta,
  roleMetricDetail,
  roleMetricGroups,
  roleMetricMeta,
  roleMetricName
} from './metric-defs'
import { trendMetrics } from './version-trend/domain'

test('four compact role groups preserve all 21 original utility and lane metrics exactly once', () => {
  const groups = [
    roleMetricGroups.utility,
    roleMetricGroups.lane,
    roleMetricGroups.skirmish,
    roleMetricGroups.objectives
  ]
  const keys = groups.flatMap((group) => group.columns.filter((key) => key !== 'games'))
  const expected = [
    'takenShare',
    'damageTakenPM',
    'mitigatedPM',
    'objectiveDamagePM',
    'turretDamagePM',
    'healPM',
    'shieldPM',
    'ccPM',
    'soloKillsPG',
    'fbRate',
    'ftRate',
    'gd10',
    'gd15',
    'csd15',
    'xpd15',
    'damageDiff15',
    'soloDiff15',
    'counter',
    'dragon15',
    'grub15',
    'objectiveFight15'
  ]
  expect(keys.toSorted()).toEqual(expected.toSorted())
  expect(new Set(keys).size).toBe(21)
  expect(groups.map((group) => group.columns.length - 1)).toEqual([6, 4, 5, 6])
  expect(keys.every((key) => roleMetricMeta[key])).toBe(true)
})

test('rate differences use percentage points without altering raw proportions', () => {
  expect(formatMetric(0.05, 'pp')).toBe('5.0')
  expect(formatMetric(-0.034, 'pp')).toBe('-3.4')
  expect(formatMetric(0, 'pp')).toBe('0.0')
  expect(roleMetricDetail('counter', 0.05)).toBe('5.0 百分点')
  expect(formatMetric(null, 'pp')).toBe('—')
  expect(formatMetric(Number.NaN, 'pp')).toBe('—')
})

test('isolated values carry units while missing values remain missing', () => {
  expect(roleMetricName('gpm')).toBe('分均经济')
  expect(roleMetricDetail('gpm', 420)).toBe('420 金币/分钟')
  expect(roleMetricDetail('dpm', 0)).toBe('0.00 伤害/分钟')
  expect(roleMetricDetail('gd15', -210, '−210.0')).toBe('−210.0 金币')
  expect(roleMetricDetail('gd15', null, '—')).toBe('—')
  expect(roleMetricDetail('dpm', undefined)).toBe('—')
  expect(roleMetricDetail('dpm', Number.POSITIVE_INFINITY)).toBe('—')
  expect(roleMetricName('kda')).toBe('KDA')
  expect(roleMetricDetail('kda', 3.25)).toBe('3.25')
  expect(roleMetricDetail('kp', 0.5)).toBe('50.0%')
})

test('canonical names are shared by metric pickers while units remain independent', () => {
  const expected: Record<string, [string, string]> = {
    gd10: ['经济差 @ 10', '金币'],
    gd15: ['经济差 @ 15', '金币'],
    csd15: ['补刀差 @ 15', '个'],
    xpd15: ['经验差 @ 15', '经验'],
    damageTakenPM: ['分均承伤', '伤害/分钟'],
    mitigatedPM: ['分均减伤', '伤害/分钟'],
    healPM: ['分均队友治疗', '生命值/分钟'],
    shieldPM: ['分均队友护盾', '护盾值/分钟'],
    counter: ['OP.GG 线杀率差', '百分点']
  }
  for (const [key, [label, unit]] of Object.entries(expected)) {
    expect(roleMetricMeta[key].label).toBe(label)
    expect(roleMetricName(key)).toBe(label)
    expect(roleMetricMeta[key].unit).toBe(unit)
    const metric = trendMetrics.find((metric) => metric.key === `player:${key}`)!
    expect(metric.label).toBe(label)
    expect(metric.unit).toBe(unit)
    expect(metric.format).toBe(roleMetricMeta[key].fmt)
  }
  // Timing and source qualifiers are meaningful parts of a name, not units.
  expect(roleMetricName('laneGankBefore3')).toBe('被抓死亡次数 · 0–3分钟')
  expect(roleMetricName('objectiveFight15')).toBe('资源团净击杀 @ 15')
  expect(roleMetricMeta.gd15.description).toContain('15 分钟相对同位置对手的经济差')
})

test('role and jungle registrations use one metadata entry for the same canonical key', () => {
  for (const key of [
    'games',
    'winRate',
    'dragon15',
    'grub15',
    'objectiveFight15',
    'gd10',
    'gd15',
    'xpd15',
    'cspm',
    'gpm',
    'objectiveDamagePM'
  ]) {
    expect(jungleMeta[key]).toBe(roleMetricMeta[key])
    const player = trendMetrics.find((metric) => metric.key === `player:${key}`)!
    const jungle = trendMetrics.find((metric) => metric.key === `jungle:${key}`)!
    expect(jungle.label).toBe(player.label)
    expect(jungle.format).toBe(player.format)
    if (roleMetricMeta[key].unit) expect(jungle.unit).toBe(player.unit)
  }
  expect(jungleMeta.topGanksPG.label).toBe('场均上路抓人')
  expect(jungleMeta.topGanksPG.unit).toBe('次/场')
  expect(trendMetrics.find((metric) => metric.key === 'jungle:topGanksPG')?.label).toBe(
    '场均上路抓人'
  )
  expect(roleMetricDetail('damageTakenPM', 0)).toBe('0.00 伤害/分钟')
  expect(roleMetricDetail('mitigatedPM', null)).toBe('—')
})

test('lane-gank metrics remain self-explanatory outside the compact grouped table', () => {
  const windows = [
    ['laneGankBefore3', '0–3', '0:00（含）至 3:00（不含）'],
    ['laneGankMinute3', '3–4', '3:00（含）至 4:00（不含）'],
    ['laneGankMinute4', '4–5', '4:00（含）至 5:00（不含）'],
    ['laneGankMinute5To10', '5–10', '5:00（含）至 10:00（不含）'],
    ['laneGankMinute10To14', '10–14', '10:00（含）至 14:00（不含）']
  ]
  for (const [key, window, boundary] of windows) {
    const meta = roleMetricMeta[key]
    expect(meta.label).toBe(`被抓死亡次数 · ${window}分钟`)
    expect(meta.shortLabel).toBe(`${window}分钟`)
    expect(meta.windowLabel).toBe(window)
    expect(meta.description).toContain(boundary)
    expect(meta.description).toContain('敌方打野参与击杀或助攻')
    const trend = trendMetrics.find((metric) => metric.key === `player:${key}`)!
    expect(trend.label).toBe(meta.label)
    expect(trend.format).toBe('int')
  }
  const totals = {
    laneGankEligibleGames: ['被抓统计有效场次', '有效场次', 'int'],
    laneGankDeaths: ['被抓死亡次数', '被抓死亡', 'int'],
    laneGankDeathsPG: ['场均被抓死亡次数', '场均被抓', 'num'],
    laneGankAffectedGames: ['被抓死亡对局数', '涉及场次', 'int'],
    laneGankAffectedRate: ['被抓死亡对局率', '涉及率', 'pct']
  }
  for (const [key, [label, shortLabel, format]] of Object.entries(totals)) {
    expect(roleMetricMeta[key]).toMatchObject({ label, shortLabel, fmt: format })
    expect(roleMetricName(key)).toBe(label)
    expect(trendMetrics.find((metric) => metric.key === `player:${key}`)).toMatchObject({
      label,
      format
    })
  }
  expect(roleMetricMeta.laneGankDeaths.description).toContain('14:00 前')
  expect(roleMetricMeta.laneGankAffectedRate.description).toContain('÷ 被抓统计有效场次')
})
