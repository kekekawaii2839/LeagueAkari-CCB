/** Keep the comparison plot independent of the advanced header fold.
 * The exact table gives up only its row viewport; if one complete row no longer
 * fits, the local workspace remains scrollable instead of shrinking the plot.
 */
export function scatterLayoutBudget(
  available: number,
  collapsedAvailable: number,
  minimumTable: number,
  heading: number,
  minimumVisual = 180
) {
  const baselineFooter = Math.max(Math.round(collapsedAvailable * 0.32), minimumTable + heading)
  const visual = Math.max(minimumVisual, Math.floor(collapsedAvailable - baselineFooter))
  const table = Math.max(minimumTable, Math.floor(available - visual - heading))
  return { visual, table, fallback: visual + heading + table > available }
}
