import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decomposeRoleAverage, describeSpreadReference } from './audit-score-concentration.mjs'

test('identical role rankings do not contract their average', () => {
  const r = decomposeRoleAverage([
    [-1, 0, 1],
    [-1, 0, 1]
  ])
  assert.equal(r.finalSd, 1)
  assert.equal(r.meanPairRoleCorrelation, 1)
  assert.equal(r.diagonalVarianceContribution, 0.5)
  assert.equal(r.covarianceContribution, 0.5)
})
test('opposite role rankings cancel with the exact covariance decomposition', () => {
  const r = decomposeRoleAverage([
    [-1, 0, 1],
    [1, 0, -1]
  ])
  assert.equal(r.finalSd, 0)
  assert.equal(r.meanPairRoleCorrelation, -1)
  assert.equal(r.diagonalVarianceContribution, 0.5)
  assert.equal(r.covarianceContribution, -0.5)
})
test('small display z spread can be caused by reference tails without changing displayed values', () => {
  const display = ['A', 'B', 'C']
  const normal = describeSpreadReference(
    [
      { champion: 'A', spreadPp: 1 },
      { champion: 'B', spreadPp: 2 },
      { champion: 'C', spreadPp: 3 }
    ],
    display
  )
  const tail = describeSpreadReference(
    [
      { champion: 'A', spreadPp: 1 },
      { champion: 'B', spreadPp: 2 },
      { champion: 'C', spreadPp: 3 },
      { champion: 'D', spreadPp: 20 }
    ],
    display
  )
  assert.equal(normal.displaySdPp, tail.displaySdPp)
  assert(tail.displayZsd < normal.displayZsd)
  assert(tail.nonDisplayShareOfReferenceSST > 0.5)
})
test('reference-to-z scale identity and zero boundary provenance are preserved', () => {
  const r = describeSpreadReference(
    [
      { champion: 'A', spreadPp: 0 },
      { champion: 'B', spreadPp: 1 },
      { champion: 'C', spreadPp: 2 }
    ],
    ['A', 'B']
  )
  assert.equal(r.zeroSpreadCount, 1)
  assert.equal(r.displayZsd, r.displaySdPp / r.referenceSdPp)
  const flat = decomposeRoleAverage([
    [1, 1, 1],
    [0, 0, 0]
  ])
  assert.equal(flat.finalSd, 0)
  assert.equal(flat.meanPairRoleCorrelation, null)
})
test('common row shifts do not change spread or the decomposition', () => {
  const a = decomposeRoleAverage([
      [-1, 0, 1],
      [2, 0, 3]
    ]),
    b = decomposeRoleAverage([
      [9, 10, 11],
      [-2, -4, -1]
    ])
  assert(Math.abs(a.finalSd - b.finalSd) < 1e-12)
  for (let i = 0; i < a.R; i++)
    for (let j = 0; j < a.R; j++)
      assert(Math.abs(a.covarianceMatrix[i][j] - b.covarianceMatrix[i][j]) < 1e-12)
})
test('missing, nonfinite, duplicate and unmatched cohort inputs fail closed', () => {
  for (const v of [
    [[1, 2], [1]],
    [
      [1, 2],
      [NaN, 1]
    ],
    [
      [1, 2],
      [null, 1]
    ],
    [],
    [[1]]
  ])
    assert.throws(() => decomposeRoleAverage(v))
  assert.throws(() =>
    describeSpreadReference(
      [
        { champion: 'A', spreadPp: 1 },
        { champion: 'A', spreadPp: 2 }
      ],
      ['A', 'B']
    )
  )
  assert.throws(() =>
    describeSpreadReference(
      [
        { champion: 'A', spreadPp: 1 },
        { champion: 'B', spreadPp: 2 }
      ],
      ['A', 'C']
    )
  )
})
