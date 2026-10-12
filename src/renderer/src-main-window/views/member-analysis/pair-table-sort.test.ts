import { describe, expect, test } from 'vitest'

import { nextRoleTableSort, sortAnalysisTableRows } from './role-table-sort'

const rows = [
  {
    pair: '成员2 + 成员3',
    games: 10,
    wins: 5,
    losses: 5,
    winRate: 0.50004,
    upperGold15: 0,
    tower20Diff: 2
  },
  {
    pair: '成员10 + 成员1',
    games: 10,
    wins: 7,
    losses: 3,
    winRate: 0.7,
    upperGold15: null,
    tower20Diff: -1
  },
  {
    pair: '成员1 + 成员2',
    games: 3,
    wins: 1,
    losses: 2,
    winRate: 0.50003,
    upperGold15: -150,
    tower20Diff: 0
  }
]
const pairs = (input: { pair: string }[]) => input.map((row) => row.pair)

describe('pair table sorting uses the member-role three-state behavior', () => {
  test('cycles and restores default order without mutating pair aggregates', () => {
    const original = structuredClone(rows)
    const descending = nextRoleTableSort(null, 'games')
    const ascending = nextRoleTableSort(descending, 'games')
    expect(pairs(sortAnalysisTableRows(rows, descending))).toEqual(pairs(rows))
    expect(pairs(sortAnalysisTableRows(rows, ascending))).toEqual([
      rows[2].pair,
      rows[0].pair,
      rows[1].pair
    ])
    expect(sortAnalysisTableRows(rows, nextRoleTableSort(ascending, 'games'))).toEqual(original)
    expect(rows).toEqual(original)
  })

  test('sorts pair names naturally, unrounded win rates and independent win/loss columns', () => {
    expect(
      pairs(sortAnalysisTableRows(rows, { key: 'pair', direction: 'ascending' }, ['pair']))
    ).toEqual([rows[2].pair, rows[0].pair, rows[1].pair])
    expect(pairs(sortAnalysisTableRows(rows, { key: 'winRate', direction: 'descending' }))).toEqual(
      [rows[1].pair, rows[0].pair, rows[2].pair]
    )
    expect(pairs(sortAnalysisTableRows(rows, { key: 'wins', direction: 'descending' }))).toEqual([
      rows[1].pair,
      rows[0].pair,
      rows[2].pair
    ])
    expect(pairs(sortAnalysisTableRows(rows, { key: 'losses', direction: 'descending' }))).toEqual(
      pairs(rows)
    )
  })

  test('sorts signed metrics numerically, preserving missingness in both directions', () => {
    expect(
      sortAnalysisTableRows(rows, { key: 'upperGold15', direction: 'descending' }).map(
        (row) => row.upperGold15
      )
    ).toEqual([0, -150, null])
    expect(
      sortAnalysisTableRows(rows, { key: 'upperGold15', direction: 'ascending' }).map(
        (row) => row.upperGold15
      )
    ).toEqual([-150, 0, null])
    expect(
      sortAnalysisTableRows(rows, { key: 'tower20Diff', direction: 'descending' }).map(
        (row) => row.tower20Diff
      )
    ).toEqual([2, 0, -1])
  })

  test('keeps equal metric values stable, including all-missing and empty tables', () => {
    const missing = [
      { pair: '乙', value: null },
      { pair: '甲', value: null }
    ]
    expect(sortAnalysisTableRows(missing, { key: 'value', direction: 'ascending' })).toEqual(
      missing
    )
    expect(sortAnalysisTableRows([], { key: 'value', direction: 'ascending' })).toEqual([])
  })
})
