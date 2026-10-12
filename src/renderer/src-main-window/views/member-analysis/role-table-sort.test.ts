import { describe, expect, test } from 'vitest'

import { nextRoleTableSort, sortRoleTableRows } from './role-table-sort'

const rows = [
  { player: '成员2', games: 4, winRate: 0.50004, gd15: 0 },
  { player: '成员10', games: 1, winRate: 0.50003, gd15: null },
  { player: '成员1', games: 4, winRate: 0.7, gd15: -200 },
  { player: '成员3', games: 20, winRate: 0.7, gd15: 600 }
]
const names = (values: { player: string }[]) => values.map((row) => row.player)

describe('role detail table sorting', () => {
  test('cycles descending, ascending, then default; switching columns starts descending', () => {
    const descending = nextRoleTableSort(null, 'games')
    expect(descending).toEqual({ key: 'games', direction: 'descending' })
    const ascending = nextRoleTableSort(descending, 'games')
    expect(ascending).toEqual({ key: 'games', direction: 'ascending' })
    expect(nextRoleTableSort(ascending, 'games')).toBeNull()
    expect(nextRoleTableSort(ascending, 'winRate')).toEqual({
      key: 'winRate',
      direction: 'descending'
    })
  })

  test('sorts samples numerically, preserves tied member order and restores default without mutation', () => {
    const original = JSON.stringify(rows)
    expect(names(sortRoleTableRows(rows, { key: 'games', direction: 'descending' }))).toEqual([
      rows[3].player,
      rows[0].player,
      rows[2].player,
      rows[1].player
    ])
    expect(names(sortRoleTableRows(rows, { key: 'games', direction: 'ascending' }))).toEqual([
      rows[1].player,
      rows[0].player,
      rows[2].player,
      rows[3].player
    ])
    expect(sortRoleTableRows(rows, null)).toEqual(rows)
    expect(JSON.stringify(rows)).toBe(original)
  })

  test('uses unrounded rates and keeps equal rates in configured order', () => {
    expect(names(sortRoleTableRows(rows, { key: 'winRate', direction: 'descending' }))).toEqual([
      rows[2].player,
      rows[3].player,
      rows[0].player,
      rows[1].player
    ])
  })

  test.each(['descending', 'ascending'] as const)(
    'keeps null, undefined and non-finite values last in %s order',
    (direction) => {
      const input = [
        ...rows,
        { player: '缺失', gd15: undefined },
        { player: '无穷', gd15: Infinity },
        { player: '非法', gd15: NaN }
      ]
      const sorted = sortRoleTableRows(input, { key: 'gd15', direction })
      expect(sorted.slice(0, 3).map((row) => row.gd15)).toEqual(
        direction === 'descending' ? [600, 0, -200] : [-200, 0, 600]
      )
      expect(names(sorted.slice(3))).toEqual([rows[1].player, '缺失', '无穷', '非法'])
    }
  )

  test('supports natural member-name ordering in both directions', () => {
    expect(names(sortRoleTableRows(rows, { key: 'player', direction: 'ascending' }))).toEqual([
      rows[2].player,
      rows[0].player,
      rows[3].player,
      rows[1].player
    ])
    expect(names(sortRoleTableRows(rows, { key: 'player', direction: 'descending' }))).toEqual([
      rows[1].player,
      rows[3].player,
      rows[0].player,
      rows[2].player
    ])
  })

  test('handles empty, singleton and all-missing samples', () => {
    const sort = { key: 'gd15', direction: 'ascending' } as const
    expect(sortRoleTableRows([], sort)).toEqual([])
    expect(sortRoleTableRows([rows[1]], sort)).toEqual([rows[1]])
    const missing = [
      { player: '乙', gd15: null },
      { player: '甲', gd15: null }
    ]
    expect(sortRoleTableRows(missing, sort)).toEqual(missing)
  })
})
