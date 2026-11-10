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

/** Count the selected member-role population before dropping missing metric
 * pairs. A match observation remains one point; the threshold never means
 * `row.games >= minimum` (each row would always have just one game).
 */
export function filterMatchByMinimumGames<
  T extends { player: string; role: string; gameId: number | null }
>(rows: T[], minimum: number) {
  const threshold = normalizeSummaryMinimumGames(minimum)
  const groups = new Map<string, Set<number | null>>()
  const key = (row: T) => JSON.stringify([row.player, row.role])
  for (const row of rows) {
    const id = key(row)
    const games = groups.get(id) ?? new Set<number | null>()
    games.add(row.gameId)
    groups.set(id, games)
  }
  const excluded = new Set(
    [...groups].filter(([, games]) => games.size < threshold).map(([id]) => id)
  )
  const visible = threshold === 0 ? rows : rows.filter((row) => !excluded.has(key(row)))
  return { visible, hidden: excluded.size, hiddenObservations: rows.length - visible.length }
}
