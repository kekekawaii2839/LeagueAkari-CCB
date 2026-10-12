import { expect, test } from 'vitest'

import { fitScatterLine, fitScatterLogistic, regressScatterGroups } from './scatter-analysis'
import { scatterMemberStyle } from './scatter-member-style'

test('configured roster identities never cycle through five colors', () => {
  const styles = Array.from({ length: 20 }, (_, index) => scatterMemberStyle(index))
  expect(new Set(styles.map((s) => s.color)).size).toBe(20)
  expect(scatterMemberStyle(13)).toEqual(styles[13])
  expect(scatterMemberStyle(13).color).not.toBe(scatterMemberStyle(3).color)
  expect(scatterMemberStyle(20).color).not.toBe(scatterMemberStyle(0).color)
})

test('fits positive and negative relationships in original units', () => {
  const fit = fitScatterLine([
    { x: -2, y: -3 },
    { x: 0, y: 1 },
    { x: 3, y: 7 }
  ])!
  expect(fit.slope).toBeCloseTo(2)
  expect(fit.intercept).toBeCloseTo(1)
  expect(fit.r).toBeCloseTo(1)
  expect(fit.rSquared).toBeCloseTo(1)
  expect(
    fitScatterLine([
      { x: 1, y: 3 },
      { x: 2, y: 1 }
    ])!.r
  ).toBeCloseTo(-1)
})

test('handles insufficient and constant samples honestly', () => {
  expect(fitScatterLine([])).toBeNull()
  expect(fitScatterLine([{ x: 0, y: 0 }])).toBeNull()
  expect(
    fitScatterLine([
      { x: 1, y: 2 },
      { x: 1, y: 3 }
    ])
  ).toBeNull()
  expect(
    fitScatterLine([
      { x: 1, y: 0 },
      { x: 2, y: 0 }
    ])
  ).toMatchObject({ slope: 0, intercept: 0, r: null, rSquared: null })
})

test('retains overlapping observations and excludes non-finite values', () => {
  const fit = fitScatterLine([
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 2, y: 1 },
    { x: NaN, y: 9 }
  ])!
  expect(fit.n).toBe(3)
  expect(fit.slope).toBeCloseTo(0.5)
})

const binarySample = [0, 1, 2].flatMap((x) =>
  Array.from({ length: 4 }, (_, i) => ({ x, y: Number(i <= x) }))
)

test('member regressions use only their own observations and retain missing-only members', () => {
  const rows = [
    { player: 'A', x: 0, y: 0 },
    { player: 'A', x: 1, y: 2 },
    { player: 'B', x: 0, y: 4 },
    { player: 'B', x: 1, y: 3 },
    { player: 'C', x: NaN, y: 1 }
  ]
  const separate = regressScatterGroups(rows, true, false)
  expect(separate[0].linear?.slope).toBeCloseTo(2)
  expect(separate[1].linear?.slope).toBeCloseTo(-1)
  expect(separate[2]).toMatchObject({ player: 'C', n: 0, missing: 1, linear: null })
  expect(regressScatterGroups(rows, false, false)[0]).toMatchObject({ n: 4, missing: 1 })
  expect(
    regressScatterGroups(
      rows.filter((p) => p.player !== 'A'),
      true,
      false
    ).map((m) => m.player)
  ).toEqual(['B', 'C'])
})

test('each member gets their own logistic model and failure status', () => {
  const groups = regressScatterGroups(
    [
      ...binarySample.map((p) => ({ ...p, player: 'A' })),
      ...binarySample.map((p) => ({ ...p, y: 1, player: 'B' }))
    ],
    true,
    true
  )
  expect(groups[0].logistic?.status).toBe('available')
  expect(groups[1].logistic?.status).toBe('unavailable')
  expect(groups.every((g) => g.linear === null)).toBe(true)
})

test('fits logistic MLE against analytically known probabilities, not linear R²', () => {
  const fit = fitScatterLogistic(binarySample)
  expect(fit.status).toBe('available')
  if (fit.status !== 'available') throw new Error(fit.reason)
  expect(fit.intercept).toBeCloseTo(-Math.log(3), 7)
  expect(fit.slope).toBeCloseTo(Math.log(3), 7)
  expect(fit.predict(0)).toBeCloseTo(0.25, 7)
  expect(fit.predict(1)).toBeCloseTo(0.5, 7)
  expect(fit.predict(2)).toBeCloseTo(0.75, 7)
  const ll = 2 * (Math.log(0.25) + 3 * Math.log(0.75)) + 4 * Math.log(0.5)
  expect(fit.pseudoRSquared).toBeCloseTo(1 - ll / (12 * Math.log(0.5)), 7)
  expect(fit.n).toBe(12)
  expect(fit.wins).toBe(6)
})

test('logistic fit is invariant to predictor units and supports decreasing probability', () => {
  const fit = fitScatterLogistic(binarySample.map((p) => ({ x: 1e9 + p.x * 1000, y: 1 - p.y })))
  if (fit.status !== 'available') throw new Error(fit.reason)
  expect(fit.predict(1e9)).toBeCloseTo(0.75, 7)
  expect(fit.predict(1e9 + 2000)).toBeCloseTo(0.25, 7)
  expect(fit.predict(-1e30)).toBe(1)
  expect(fit.predict(1e30)).toBe(0)
})

test('logistic rejects absent classes, constant predictors and complete or quasi separation', () => {
  for (const rows of [
    [],
    [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ],
    [0, 1, 2].map((x) => ({ x, y: 1 })),
    [0, 1, 0].map((y) => ({ x: 1, y })),
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 }
    ],
    [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ]
  ]) {
    expect(fitScatterLogistic(rows).status).toBe('unavailable')
  }
})

test('overlapping classes without association yield a constant probability curve', () => {
  const fit = fitScatterLogistic(
    [0, 1, 2].flatMap((x) => [
      { x, y: 0 },
      { x, y: 1 }
    ])
  )
  if (fit.status !== 'available') throw new Error(fit.reason)
  expect(fit.predict(1)).toBeCloseTo(0.5)
  expect(fit.pseudoRSquared).toBeCloseTo(0)
  expect(
    fitScatterLine([
      { x: 1, y: 0.4 },
      { x: 2, y: 0.4 },
      { x: 3, y: 0.4 }
    ])!.r
  ).toBeNull()
})
