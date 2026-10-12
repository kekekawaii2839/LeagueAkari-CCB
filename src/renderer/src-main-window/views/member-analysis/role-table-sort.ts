export type RoleTableSort = { key: string; direction: 'descending' | 'ascending' } | null

export function nextRoleTableSort(current: RoleTableSort, key: string): RoleTableSort {
  if (current?.key !== key) return { key, direction: 'descending' }
  return current.direction === 'descending' ? { key, direction: 'ascending' } : null
}

const memberCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

// Input order is the configured member order. Ties keep it; missing/non-finite
// metrics stay last in both directions, never masquerading as zero.
export function sortAnalysisTableRows<T extends object>(
  rows: readonly T[],
  sort: RoleTableSort,
  textKeys: readonly string[] = ['player']
): T[] {
  const result = [...rows]
  if (!sort) return result
  const sign = sort.direction === 'descending' ? -1 : 1
  return result.sort((a, b) => {
    const left: unknown = Reflect.get(a, sort.key)
    const right: unknown = Reflect.get(b, sort.key)
    if (textKeys.includes(sort.key)) {
      const leftValid = typeof left === 'string' && left.length > 0
      const rightValid = typeof right === 'string' && right.length > 0
      if (!leftValid || !rightValid) return Number(rightValid) - Number(leftValid)
      return sign * memberCollator.compare(left, right)
    }
    const leftValid = typeof left === 'number' && Number.isFinite(left)
    const rightValid = typeof right === 'number' && Number.isFinite(right)
    if (!leftValid || !rightValid) return Number(rightValid) - Number(leftValid)
    return sign * (left - right)
  })
}

export const sortRoleTableRows = sortAnalysisTableRows
