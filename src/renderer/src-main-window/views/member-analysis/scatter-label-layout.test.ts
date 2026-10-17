import { expect, test } from 'vitest'

import { layoutNearbyScatterLabels, scatterLabelWidth } from './scatter-label-layout'

const plot = { left: 82, top: 35, width: 500, height: 300 }
const distance = (
  point: { x: number; y: number },
  label: { left: number; right: number; top: number; bottom: number }
) =>
  Math.hypot(
    Math.max(label.left - point.x, 0, point.x - label.right),
    Math.max(label.top - point.y, 0, point.y - label.bottom)
  )

test('dense labels remain within a bounded distance of their actual point rectangle, with leaders', () => {
  const points = Array.from({ length: 18 }, (_, i) => ({
    x: 260 + (i % 3),
    y: 180 + (i % 2),
    text: `成员${i}测试标签`,
    visible: true
  }))
  const result = layoutNearbyScatterLabels(points, plot)
  expect(result).toHaveLength(points.length)
  result.forEach((label, i) => {
    expect(distance(points[i], label)).toBeGreaterThanOrEqual(11)
    expect(distance(points[i], label)).toBeLessThanOrEqual(32)
    expect(label.leader).not.toBeNull()
    expect(points[i].x).toBe(260 + (i % 3))
  })
})

test('edge and zoom-projected labels stay inside the plot without moving point anchors', () => {
  const points = [
    [82, 35],
    [582, 35],
    [82, 335],
    [582, 335],
    [280, 200]
  ].map(([x, y]) => ({ x, y, text: 'LongLatinPlayer成员#TEST_ONLY', visible: true }))
  const before = JSON.stringify(points)
  for (const [i, label] of layoutNearbyScatterLabels(points, plot).entries()) {
    expect(label.left).toBeGreaterThanOrEqual(plot.left)
    expect(label.right).toBeLessThanOrEqual(plot.left + plot.width)
    expect(label.top).toBeGreaterThanOrEqual(plot.top)
    expect(label.bottom).toBeLessThanOrEqual(plot.top + plot.height)
    expect(distance(points[i], label)).toBeLessThanOrEqual(32)
  }
  expect(JSON.stringify(points)).toBe(before)
})

test('Latin width is estimated separately from CJK; long duplicate tags remain distinguishable', () => {
  expect(scatterLabelWidth('Alice')).toBeLessThan(scatterLabelWidth('成员昵称全名'))
  const points = ['甲', '乙'].map((tag) => ({
    x: 200,
    y: 200,
    text: `非常长的同名成员昵称昵称昵称#${tag}`,
    suffix: `#${tag}`,
    visible: true
  }))
  const labels = layoutNearbyScatterLabels(points, plot)
  expect(labels[0].text).toContain('#甲')
  expect(labels[1].text).toContain('#乙')
  expect(labels[0].text).not.toBe(labels[1].text)
  expect(labels.every((label) => label.right - label.left <= 220)).toBe(true)
})

test('out-of-domain labels do not influence visible placement or create leaders', () => {
  const visible = { x: 200, y: 150, text: '成员甲', visible: true }
  const hidden = { x: 200, y: 150, text: '域外长标签'.repeat(10), visible: false }
  const labels = layoutNearbyScatterLabels([hidden, visible], plot)
  expect(labels[0].text).toBe('')
  expect(labels[0].leader).toBeNull()
  expect(labels[1]).toEqual(layoutNearbyScatterLabels([visible], plot)[0])
})

test('long common-prefix tags preserve their distinguishing endings', () => {
  const labels = layoutNearbyScatterLabels(
    ['A', 'B'].map((end) => ({
      x: 200,
      y: 100,
      text: `同名成员#SAME_PREFIX_012345678901234567890${end}`,
      suffix: `#SAME_PREFIX_012345678901234567890${end}`,
      visible: true
    })),
    plot
  )
  expect(labels[0].text.endsWith('A')).toBe(true)
  expect(labels[1].text.endsWith('B')).toBe(true)
  expect(labels[0].text).not.toBe(labels[1].text)
})

test('short normal plots still have near-rectangle placement at corners and center', () => {
  const small = { left: 82, top: 35, width: 208, height: 80 }
  const points = [
    [82, 35],
    [290, 35],
    [82, 115],
    [290, 115],
    [186, 75]
  ].map(([x, y]) => ({ x, y, text: '超长中文成员身份'.repeat(10), visible: true }))
  layoutNearbyScatterLabels(points, small).forEach((label, i) => {
    expect(distance(points[i], label)).toBeGreaterThanOrEqual(11)
    expect(distance(points[i], label)).toBeLessThanOrEqual(32)
    expect(label.left).toBeGreaterThanOrEqual(82)
    expect(label.right).toBeLessThanOrEqual(290)
  })
})
