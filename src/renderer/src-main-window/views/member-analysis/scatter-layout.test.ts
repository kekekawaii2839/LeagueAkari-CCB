import { describe, expect, test } from 'vitest'

import { scatterLayoutBudget } from './scatter-layout'

describe('scatter header-fold height budget', () => {
  test('advanced expansion consumes table rows before changing the plot', () => {
    const closed = scatterLayoutBudget(800, 800, 106, 32)
    const open = scatterLayoutBudget(700, 800, 106, 32)
    expect(open.visual).toBe(closed.visual)
    expect(open.table).toBe(closed.table - 100)
    expect(open.fallback).toBe(false)
  })
  test('constrained windows preserve plot and one readable table row in local fallback', () => {
    const closed = scatterLayoutBudget(397, 397, 106, 32)
    const open = scatterLayoutBudget(271, 397, 106, 32)
    expect(open.visual).toBe(closed.visual)
    expect(open.table).toBe(106)
    expect(open.fallback).toBe(true)
  })
  test('intermediate animation frames never resize the plot', () => {
    const frames = Array.from({ length: 21 }, (_, index) =>
      scatterLayoutBudget(800 - index * 5, 800, 106, 32)
    )
    expect(new Set(frames.map((frame) => frame.visual)).size).toBe(1)
    expect(frames.every((frame, i) => !i || frame.table <= frames[i - 1].table)).toBe(true)
  })
  test('a new viewport may legitimately choose a different baseline', () => {
    expect(scatterLayoutBudget(500, 500, 106, 32).visual).toBeLessThan(
      scatterLayoutBudget(800, 800, 106, 32).visual
    )
  })
})
