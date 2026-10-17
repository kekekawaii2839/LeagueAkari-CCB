import { expect, test } from 'vitest'

import { scatterMetricKeys } from './scatter-analysis'
import { scatterAutomaticTickText, scatterAxisTickPolicy } from './scatter-axis-ticks'
import { scatterDifferenceMetrics } from './scatter-reference-lines'
import { scatterDomain } from './visualization'

const signed: ReadonlySet<string> = new Set(scatterDifferenceMetrics)
test('all automatic nonnegative metrics keep original padding but replace meaningless negative ticks with actual zero', () => {
  for (const metric of scatterMetricKeys) {
    const domain = scatterDomain([0, 2])
    const before = { ...domain }
    const result = scatterAxisTickPolicy(metric, domain, [0, 2], 500, 40)
    expect(domain).toEqual(before)
    expect(domain.min).toBe(-0.16)
    if (signed.has(metric)) {
      expect(result.automaticNonnegative).toBe(false)
      expect(result.values[0]).toBeLessThan(0)
    } else {
      expect(result.automaticNonnegative).toBe(true)
      expect(result.gridValues[0]).toBe(-0.16)
      expect(result.gridValues).toContain(0)
      expect(result.values[0]).toBe(0)
      expect(result.values.every((value) => value >= 0)).toBe(true)
      expect(result.values.filter((value) => value === 0)).toHaveLength(1)
    }
  }
})

test('actual negative anomalies and manual views retain their original tick path and negative space', () => {
  const range = { min: -0.16, max: 2.16 }
  expect(scatterAxisTickPolicy('kda', range, [-0.1, 2], 500, 40).values[0]).toBe(-0.16)
  const manual = scatterAxisTickPolicy('kda', range, [0, 2], 500, 40, true)
  expect(manual.automaticNonnegative).toBe(false)
  expect(manual.values).toEqual(
    Array.from({ length: 5 }, (_, i) => range.min + ((range.max - range.min) * i) / 4)
  )
  expect(
    scatterAxisTickPolicy('kda', { min: 0.5, max: 1.5 }, [0, 2], 500, 40, true).values
  ).not.toContain(0)
})

test('zero is inserted only in-domain, raw equality dedupes it, and pixel neighbors yield to zero', () => {
  expect(scatterAxisTickPolicy('kda', { min: -1, max: 1 }, [0], 500, 40).values).toEqual([
    0, 0.5, 1
  ])
  expect(
    scatterAxisTickPolicy('kda', { min: 92, max: 208 }, [100, 200], 500, 40).values
  ).not.toContain(0)
  const close = scatterAxisTickPolicy('kda', { min: -0.999, max: 3.001 }, [0, 2], 100, 20)
  expect(close.values).toEqual([0, 1.001, 2.001, 3.001])
  expect(
    scatterAxisTickPolicy('kda', { min: -1, max: 1 }, [null, NaN], 500, 40).automaticNonnegative
  ).toBe(false)
})

test('tiny real ticks do not collapse to zero, ordinary formatting and exact observations remain unchanged', () => {
  const range = scatterDomain([0, 0.00001])
  const values = scatterAxisTickPolicy('kda', range, [0, 0.00001], 500, 40).values
  const labels = values.map((value) =>
    scatterAutomaticTickText(value, values, range, false, (v) => v.toFixed(2))
  )
  expect(new Set(labels).size).toBe(values.length)
  expect(labels.some((label) => Number(label) > 0)).toBe(true)
  expect(
    scatterAutomaticTickText(1, [0, 0.42, 1, 1.58, 2.16], { min: -0.16, max: 2.16 }, false, (v) =>
      v.toFixed(2)
    )
  ).toBe('1.00')
  const percentLabels = values.map((value) =>
    scatterAutomaticTickText(value, values, range, true, (v) => `${(v * 100).toFixed(1)}%`)
  )
  expect(new Set(percentLabels).size).toBe(values.length)
  expect(percentLabels.every((label) => label.endsWith('%'))).toBe(true)
})
