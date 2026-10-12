import { describe, expect, test } from 'vitest'

import { formatMetric } from './metric-defs'
import {
  finiteOrNull,
  fixedFiveRoster,
  formatSigned,
  groupScatterPoints,
  identicalRosters,
  memberOrder,
  metricTone,
  percentWidth,
  reliabilityLabel,
  scatterDomain,
  scatterPosition,
  scatterWinRateDomain,
  wilsonInterval
} from './visualization'

describe('member analysis visualization semantics', () => {
  test.each([
    [0],
    [1],
    [0, 0],
    [1, 1],
    [0.5],
    [0.5, 0.5],
    [0.001, 0.01],
    [0.99, 0.999],
    [0, 0.5, 1],
    [],
    [null, undefined, NaN, Infinity, -Infinity],
    [-2, -1],
    [2, 3]
  ])('keeps win-rate display domains finite, ordered and within 0–1: %j', (...values) => {
    const domain = scatterWinRateDomain(values)
    expect(Number.isFinite(domain.min)).toBe(true)
    expect(Number.isFinite(domain.max)).toBe(true)
    expect(domain.min).toBeGreaterThanOrEqual(0)
    expect(domain.max).toBeLessThanOrEqual(1)
    expect(domain.min).toBeLessThan(domain.max)
    for (const value of values) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) continue
      expect(scatterPosition(value, domain, 35, 240, true)).toBeGreaterThanOrEqual(35)
      expect(scatterPosition(value, domain, 35, 240, true)).toBeLessThanOrEqual(275)
    }
  })
  test('retains interior automatic padding and leaves raw out-of-range values unrepaired', () => {
    const values = [0.4, 0.6]
    expect(scatterWinRateDomain(values)).toEqual(scatterDomain(values))
    expect(values).toEqual([0.4, 0.6])
    const domain = scatterWinRateDomain([-0.2, 0.5, 1.2])
    expect(domain).toEqual({ min: 0, max: 1 })
    expect(scatterPosition(-0.2, domain, 35, 240, true)).toBeGreaterThan(275)
    expect(scatterPosition(1.2, domain, 35, 240, true)).toBeLessThan(35)
    expect(scatterDomain([0, 1])).toEqual({ min: -0.08, max: 1.08 })
  })
  test('keeps every coincident scatter member without inventing distinct coordinates', () => {
    const points = [
      { x: 10, y: 20, name: 'A' },
      { x: 10, y: 20, name: 'B' },
      { x: 11, y: 20, name: 'C' }
    ]
    const groups = groupScatterPoints(points)
    expect(groups).toHaveLength(2)
    expect(groups[0].rows.map((row) => row.name)).toEqual(['A', 'B'])
    expect(groups[0]).toMatchObject({ x: 10, y: 20 })
    expect(groups.flatMap((group) => group.rows)).toEqual(points)
  })
  test('detects uninformative rosters independently of role or array ordering', () => {
    const game = (names: string[]) => ({ players: names.map((player) => ({ player })) })
    expect(identicalRosters([game(['A', 'B']), game(['B', 'A'])])).toBe(true)
    expect(identicalRosters([game(['A', 'B']), game(['A', 'C'])])).toBe(false)
    expect(identicalRosters([])).toBe(false)
  })
  test('orders configured members first without mutating input', () => {
    const names = ['A#TEST', 'B#TEST', 'C#TEST']
    expect(
      memberOrder(names, [
        { gameName: 'B', tagLine: 'TEST' },
        { gameName: 'A', tagLine: 'TEST' }
      ])
    ).toEqual(['B#TEST', 'A#TEST', 'C#TEST'])
    expect(names).toEqual(['A#TEST', 'B#TEST', 'C#TEST'])
  })
  test('distinguishes unavailable values from real zero and formats signs', () => {
    expect(finiteOrNull(null)).toBeNull()
    expect(formatSigned(null)).toBe('—')
    expect(formatSigned(0)).toBe('0')
    expect(formatMetric(null)).toBe('—')
    expect(formatMetric(0)).toBe('0.00')
    expect(formatMetric(0, 'text')).toBe('0')
    expect(formatSigned(25)).toBe('+25')
    expect(formatSigned(-25)).toBe('−25')
  })
  test('keeps comparison widths bounded and semantic tones explicit', () => {
    expect(percentWidth(0.6)).toBe(60)
    expect(percentWidth(-2500, 2000)).toBe(100)
    expect(metricTone(1)).toBe('positive')
    expect(metricTone(-1)).toBe('negative')
    expect(metricTone(null)).toBe('neutral')
  })
  test('labels low-sample reliability instead of hiding it', () => {
    expect(reliabilityLabel(2, 5)).toBe('样本较少')
    expect(reliabilityLabel(5, 5)).toBe('参考样本')
    expect(reliabilityLabel(10, 5)).toBe('较多样本')
  })
  test('derives a bounded win-rate interval without converting empty samples to zero', () => {
    const interval = wilsonInterval(5, 10)!
    expect(interval.low).toBeGreaterThanOrEqual(0)
    expect(interval.low).toBeLessThan(0.5)
    expect(interval.high).toBeGreaterThan(0.5)
    expect(interval.high).toBeLessThanOrEqual(1)
    expect(wilsonInterval(0, 0)).toBeNull()
  })
  test('expands identical scatter values into a usable finite domain', () => {
    const domain = scatterDomain([7, 7, null])
    expect(domain.min).toBeLessThan(7)
    expect(domain.max).toBeGreaterThan(7)
    expect(scatterPosition(7, domain, 10, 100)).toBeCloseTo(60)
    expect(scatterPosition(7, domain, 10, 100, true)).toBeCloseTo(60)
  })
  test('charts only one configured member per fixed role and never a sixth row', () => {
    const roster = fixedFiveRoster([
      { role: 'UTILITY', id: 5 },
      { role: 'MIDDLE', id: 3 },
      { role: 'TOP', id: 1 },
      { role: 'JUNGLE', id: 2 },
      { role: 'BOTTOM', id: 4 },
      { role: 'TOP', id: 99 }
    ])
    expect(roster.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
  })
})
