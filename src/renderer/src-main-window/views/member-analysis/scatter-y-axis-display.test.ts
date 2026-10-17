import { expect, test } from 'vitest'

import { compactScatterYAxis, scatterAxisTextWidth } from './scatter-y-axis-display'

type Options = Parameters<typeof compactScatterYAxis>[0]
const options = (overrides: Partial<Options> = {}): Options => ({
  metric: 'gd15',
  binary: false,
  values: [-1330567, -982567, -634567, -286567, 61433],
  original: (value) => value.toFixed(0),
  percent: false,
  unit: '金币',
  title: '经济差 @ 15',
  height: 256,
  ...overrides
})

test('one explicit engineering multiplier shortens all signed Y labels and leaves source values unchanged', () => {
  const input = options()
  const before = [...input.values]
  const display = compactScatterYAxis(input)
  expect(display.status).toBe('compact')
  if (display.status !== 'compact') throw new Error(display.reason)
  expect(display.exponent).toBe(6)
  expect(display.divisor).toBe(1e6)
  expect(display.title).toBe('经济差 @ 15 · ×10^6 金币')
  expect([...display.labels.values()]).toEqual(['-1.33', '-0.98', '-0.63', '-0.29', '0.06'])
  expect([...display.labels.values()].every((text) => scatterAxisTextWidth(text) <= 36)).toBe(true)
  expect(new Set(display.labels.values()).size).toBe(input.values.length)
  expect(input.values).toEqual(before)
})

test('ordinary numeric sizes and probability/binary metrics keep their existing display', () => {
  expect(compactScatterYAxis(options({ values: [0, 1, 2, 3, 4] }))).toEqual({
    status: 'original',
    reason: 'ordinary'
  })
  for (const metric of ['winRate', 'fbRate', 'ftRate'] as const) {
    expect(compactScatterYAxis(options({ metric, binary: metric !== 'winRate' }))).toEqual({
      status: 'original',
      reason: 'probability'
    })
  }
  expect(
    compactScatterYAxis(
      options({
        metric: 'damageConversion',
        percent: true,
        values: [0, 0.42, 1, 1.58, 2.16],
        original: (v) => `${(v * 100).toFixed(1)}%`
      })
    )
  ).toEqual({ status: 'original', reason: 'ordinary' })
})

test('percentage axes scale displayed percentage numbers exactly once and declare percent only in the shared title', () => {
  const display = compactScatterYAxis(
    options({
      metric: 'damageConversion',
      percent: true,
      values: [0, 1e5, 2e5, 3e5, 4e5],
      original: (value) => `${value * 100}%`,
      title: '伤害转化率',
      unit: undefined
    })
  )
  expect(display.status).toBe('compact')
  if (display.status !== 'compact') throw new Error(display.reason)
  expect(display.exponent).toBe(6)
  expect(display.title).toBe('伤害转化率 · ×10^6 %')
  expect(display.labels.get(1e5)).toBe('10.0')
  expect([...display.labels.values()].every((text) => !text.includes('%'))).toBe(true)
})

test('tiny finite values can use a negative common exponent without turning nonzero ticks into zero', () => {
  const values = [0, 0.000000042, 0.0000001, 0.000000158, 0.000000216]
  const display = compactScatterYAxis(
    options({
      metric: 'damageConversion',
      percent: true,
      values,
      original: (value) => `${(value * 100).toFixed(7)}%`,
      title: '伤害转化率',
      unit: undefined
    })
  )
  expect(display.status).toBe('compact')
  if (display.status !== 'compact') throw new Error(display.reason)
  expect(display.exponent).toBe(-6)
  expect(display.labels.get(values[4])).toBe('21.6')
  expect([...display.labels.values()].filter((text) => Number(text) === 0)).toHaveLength(1)
  expect(new Set(display.labels.values()).size).toBe(values.length)
})

test('large-offset narrow spans do not silently duplicate ticks or invent an offset', () => {
  const values = Array.from({ length: 5 }, (_, index) => 1e12 + index)
  expect(compactScatterYAxis(options({ values }))).toEqual({
    status: 'original',
    reason: 'precision-budget'
  })
})

test('numeric overflow, divisor underflow and already duplicated raw ticks keep the original display', () => {
  expect(
    compactScatterYAxis(
      options({ percent: true, values: [Number.MAX_VALUE, Number.MAX_VALUE / 2] })
    )
  ).toEqual({ status: 'original', reason: 'numeric-limit' })
  expect(
    compactScatterYAxis(
      options({
        values: [Number.MIN_VALUE, Number.MIN_VALUE * 2],
        original: (v) => v.toExponential(16)
      })
    )
  ).toEqual({ status: 'original', reason: 'numeric-limit' })
  expect(compactScatterYAxis(options({ values: [1e12, 1e12] }))).toEqual({
    status: 'original',
    reason: 'numeric-limit'
  })
})

test('a short plot does not force a multiplier title into insufficient vertical space', () => {
  expect(compactScatterYAxis(options({ height: 80 }))).toEqual({
    status: 'original',
    reason: 'title-space'
  })
})
