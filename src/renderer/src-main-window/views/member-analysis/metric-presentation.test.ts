import { expect, test } from 'vitest'

import { formatMetric, roleMetricDetail, roleMetricName } from './metric-defs'

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
