import { expect, test } from 'vitest'

import { filterSummaryByMinimumGames, normalizeSummaryMinimumGames } from './scatter-summary-filter'

test('the default retains the complete aggregate population and original references', () => {
  const rows = [
    { player: 'a', role: 'TOP', games: 1, x: null },
    { player: 'a', role: 'MIDDLE', games: 20, x: 3 }
  ]
  const result = filterSummaryByMinimumGames(rows, 0)
  expect(result.visible).toBe(rows)
  expect(result.hidden).toBe(0)
})

test('filters member-role actual games, independently of missing X/Y and other roles for the member', () => {
  const rows = [
    { player: 'a', role: 'TOP', games: 1, x: 3, y: 0.5 },
    { player: 'a', role: 'MIDDLE', games: 20, x: null, y: null },
    { player: 'b', role: 'TOP', games: 10, x: 2, y: 0.8 }
  ]
  const before = JSON.stringify(rows)
  const result = filterSummaryByMinimumGames(rows, 10)
  expect(result.visible).toEqual([rows[1], rows[2]])
  expect(result.visible[0]).toBe(rows[1])
  expect(result.hidden).toBe(1)
  expect(JSON.stringify(rows)).toBe(before)
  expect(filterSummaryByMinimumGames(rows, 21)).toEqual({ visible: [], hidden: 3 })
  expect(filterSummaryByMinimumGames(rows, 0).visible).toBe(rows)
})

test.each([
  [null, 0],
  [NaN, 0],
  [Infinity, 0],
  [-3, 0],
  [3.8, 3],
  [0, 0],
  [Number.MAX_VALUE, Number.MAX_SAFE_INTEGER]
])('normalizes input %s to a nonnegative integer %s', (value, expected) => {
  expect(normalizeSummaryMinimumGames(value)).toBe(expected)
})

test('unknown sample counts are not manufactured into a valid count', () => {
  const row = { games: NaN, x: 5 }
  expect(filterSummaryByMinimumGames([row], 0).visible).toEqual([row])
  expect(filterSummaryByMinimumGames([row], 1)).toEqual({ visible: [], hidden: 1 })
  expect(Number.isNaN(row.games)).toBe(true)
})
