import { expect, test } from 'vitest'

import { scatterMetricKeys } from './scatter-analysis'
import {
  scatterDifferenceMetrics,
  scatterZeroLabels,
  scatterZeroReferenceAxes
} from './scatter-reference-lines'

test('only the nine approved actual difference IDs use zero as parity, independently on each axis', () => {
  const approved = [
    'gd10',
    'gd15',
    'csd15',
    'xpd15',
    'damageDiff15',
    'soloDiff15',
    'dragon15',
    'grub15',
    'objectiveFight15'
  ]
  expect([...scatterDifferenceMetrics].sort()).toEqual([...approved].sort())
  const view = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 } }
  for (const metric of scatterMetricKeys) {
    const expected = approved.includes(metric)
    expect(scatterZeroReferenceAxes(metric, 'winRate', view)).toEqual({ x: expected, y: false })
    expect(scatterZeroReferenceAxes('damageConversion', metric, view)).toEqual({
      x: false,
      y: expected
    })
  }
})

test('viewport zero boundaries are included without changing or expanding either domain', () => {
  const view = { x: { min: 0, max: 20 }, y: { min: -20, max: 0 } }
  const before = JSON.stringify(view)
  expect(scatterZeroReferenceAxes('gd15', 'csd15', view)).toEqual({ x: true, y: true })
  expect(JSON.stringify(view)).toBe(before)
  expect(
    scatterZeroReferenceAxes('gd15', 'csd15', { x: { min: 1, max: 20 }, y: { min: -20, max: -1 } })
  ).toEqual({ x: false, y: false })
  expect(
    scatterZeroReferenceAxes('gd15', 'csd15', { x: { min: NaN, max: 1 }, y: { min: 1, max: -1 } })
  ).toEqual({ x: false, y: false })
})

const plot = { left: 82, top: 35, width: 300, height: 200 }
test('labels stay at separate plot endpoints rather than duplicating zero at the crossing', () => {
  const labels = scatterZeroLabels(232, 135, null, plot)
  expect(labels).toEqual([
    { axis: 'y', x: 378, y: 130, anchor: 'end' },
    { axis: 'x', x: 236, y: 230, anchor: 'start' }
  ])
})

test('lower-right shared endpoint keeps one zero, and existing 50% takes priority there', () => {
  expect(scatterZeroLabels(382, 235, null, plot)).toEqual([
    { axis: 'y', x: 378, y: 230, anchor: 'end' }
  ])
  expect(scatterZeroLabels(382, null, 235, plot)).toEqual([])
  const edge = scatterZeroLabels(82, 35, null, plot)
  expect(edge).toHaveLength(2)
  expect(
    edge.every((label) => label.x >= 82 && label.x <= 382 && label.y >= 47 && label.y <= 230)
  ).toBe(true)
  expect(scatterZeroLabels(null, null, null, plot)).toEqual([])
})
