import { expect, test } from 'vitest'

import { formatMetric } from './metric-defs'

test('time formatting carries rounded seconds into minutes', () => {
  expect(formatMetric(59.6, 'time')).toBe('1:00')
  expect(formatMetric(119.6, 'time')).toBe('2:00')
  expect(formatMetric(61, 'time')).toBe('1:01')
  expect(formatMetric(null, 'time')).toBe('—')
})
