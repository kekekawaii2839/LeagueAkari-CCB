import { expect, test } from 'vitest'

import {
  boundedScatterRange,
  formatScatterViewportTick,
  groupExactScatterValues,
  panScatterViewport,
  scaleScatterViewport,
  selectedScatterViewport
} from './scatter-viewport'
import { scatterPosition } from './visualization'

test('raw grouping keeps distinct crowded observations and true overlaps without changing their identity', () => {
  const rows = [
    { id: 'a', x: 0, y: 0.5 },
    { id: 'b', x: 1, y: 0.5 },
    { id: 'c', x: 1e12, y: 0.5 },
    { id: 'd', x: 0, y: 0.5 }
  ]
  expect(
    Math.abs(
      scatterPosition(1, { min: 0, max: 1e12 }, 0, 248) -
        scatterPosition(0, { min: 0, max: 1e12 }, 0, 248)
    )
  ).toBeLessThan(1e-6)
  const groups = groupExactScatterValues(
    rows,
    (r) => r.x,
    (r) => r.y
  )
  expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['a', 'd'], ['b'], ['c']])
  expect(scatterPosition(groups[1].valueX, { min: 0, max: 2 }, 0, 248)).toBe(124)
  expect(groups[0].rows[0]).toBe(rows[0])
  expect(rows).toHaveLength(4)
})

test('nonfinite values never become groups at a valid zero', () => {
  const rows = [
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
    { x: 0, y: 0 },
    { x: -0, y: 0 }
  ]
  expect(
    groupExactScatterValues(
      rows,
      (r) => r.x,
      (r) => r.y
    ).map((g) => g.rows.length)
  ).toEqual([2])
})

test('reversed rectangle preserves Y direction and creates only a viewport', () => {
  expect(
    selectedScatterViewport(
      { x: { min: -10, max: 30 }, y: { min: 0, max: 1 } },
      { x: 0.75, y: 0.8 },
      { x: 0.25, y: 0.2 }
    )
  ).toEqual({ x: { min: 0, max: 20 }, y: { min: 0.19999999999999996, max: 0.8 } })
})

test('zoom and pan remain bounded and zooming out restores full probability bounds', () => {
  const full = { x: { min: -10, max: 10 }, y: { min: 0, max: 1 } }
  const view = scaleScatterViewport(full, full, 0.5)
  expect(view).toEqual({ x: { min: -5, max: 5 }, y: { min: 0.25, max: 0.75 } })
  expect(panScatterViewport(view, full, 50, -50)).toEqual({
    x: { min: 0, max: 10 },
    y: { min: 0, max: 0.5 }
  })
  expect(scaleScatterViewport(view, full, 2)).toEqual(full)
  expect(boundedScatterRange({ min: NaN, max: 1 }, full.y)).toEqual(full.y)
  const tiny = boundedScatterRange({ min: 0.5, max: 0.5 + 1e-15 }, full.y)
  expect(tiny.max).toBeGreaterThan(tiny.min)
  expect(boundedScatterRange({ min: 0, max: 2 }, { min: 0, max: 1e12 })).toEqual({ min: 0, max: 2 })
})

test.each([
  { min: 0.5, max: 0.500001 },
  { min: 0, max: 1e-15 },
  { min: 1e12, max: 1e12 + 1000 }
])('local ticks remain distinguishable at %j', (range) => {
  for (const percent of [false, true]) {
    const labels = Array.from({ length: 5 }, (_, i) =>
      formatScatterViewportTick(range.min + ((range.max - range.min) * i) / 4, range, percent)
    )
    expect(new Set(labels).size).toBe(5)
    expect(labels.every((s) => s.endsWith('%') === percent)).toBe(true)
  }
})
