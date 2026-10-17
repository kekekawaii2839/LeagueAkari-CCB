export function normalizeSummaryMinimumGames(value: number | null): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)))
    : 0
}

// `games` is the aggregate's complete member-role population, not the number
// of nonmissing X/Y measurements. Keep records and their original values intact.
export function filterSummaryByMinimumGames<T extends { games: number }>(
  rows: T[],
  minimum: number
) {
  const threshold = normalizeSummaryMinimumGames(minimum)
  const visible =
    threshold === 0
      ? rows
      : rows.filter((row) => Number.isFinite(row.games) && row.games >= threshold)
  return { visible, hidden: rows.length - visible.length }
}
