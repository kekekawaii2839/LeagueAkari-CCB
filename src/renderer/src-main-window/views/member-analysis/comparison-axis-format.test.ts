import { expect, test } from 'vitest'

import { createComparisonAxisFormatter } from './comparison-axis-format'

test.each([
  [[600, 300, 0, -300, -600], false, ['600', '300', '0', '-300', '-600']],
  [[1, 0.5, 0, -0.5, -1], false, ['1.0', '0.5', '0.0', '-0.5', '-1.0']],
  [[1, 0.75, 0.5, 0.25, 0], false, ['1.00', '0.75', '0.50', '0.25', '0.00']],
  [[1, 0.75, 0.5, 0.25, 0], true, ['100%', '75%', '50%', '25%', '0%']],
  [[0.1, 0.075, 0.05, 0.025, 0], true, ['10.0%', '7.5%', '5.0%', '2.5%', '0.0%']],
  [[0.30000000000000004, 0.2, 0.1, 0], false, ['0.3', '0.2', '0.1', '0.0']],
  [[0.003, 0.0015, 0], false, ['0.0030', '0.0015', '0.0000']]
] as const)(
  'formats one coherent tick set without altering its values',
  (ticks, percentage, labels) => {
    const before = [...ticks]
    const format = createComparisonAxisFormatter(ticks, percentage)
    expect(ticks.map(format)).toEqual(labels)
    expect(ticks).toEqual(before)
  }
)

test('normalizes negative zero at the shared precision without manufacturing missing ticks', () => {
  expect(createComparisonAxisFormatter([1, 0, -1], false)(-0)).toBe('0')
  expect(createComparisonAxisFormatter([1, 0.5, 0], false)(-0)).toBe('0.0')
  expect(createComparisonAxisFormatter([1, 0], true)(-0)).toBe('0%')
  expect(createComparisonAxisFormatter([1, 0], false)(Number.NaN)).toBe('—')
})
