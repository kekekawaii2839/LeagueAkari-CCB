/** Axis precision belongs to the whole tick set, not each value's magnitude.
 * Percentages choose their precision after conversion to percentage points. */
export function createComparisonAxisFormatter(ticks: readonly number[], percentage: boolean) {
  const scale = percentage ? 100 : 1
  const values = ticks.filter(Number.isFinite).map((tick) => tick * scale)
  let digits = 0
  while (
    digits < 20 &&
    values.some((value) => {
      const rounded = Number(value.toFixed(digits))
      return Math.abs(value - rounded) > Math.abs(value) * Number.EPSILON * 32
    })
  )
    digits++
  return (value: number) => {
    if (!Number.isFinite(value)) return '—'
    const rounded = Number((value * scale).toFixed(digits))
    // toFixed preserves a negative sign on rounded negative zero. The axis
    // already carries sign through its position; zero must never read '-0'.
    return `${(rounded === 0 ? 0 : rounded).toFixed(digits)}${percentage ? '%' : ''}`
  }
}
