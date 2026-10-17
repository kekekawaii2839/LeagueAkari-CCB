import type { ScatterMetric } from './scatter-analysis'
import type { ScatterRange, ScatterViewport } from './scatter-viewport'

// Explicit Scatter policy derived from metric-defs descriptions and the native
// difference source mappings, not a pre-existing registry flag or label match.
// `counter` is not a selectable Scatter metric and is deliberately absent.
export const scatterDifferenceMetrics = [
  'gd10',
  'gd15',
  'csd15',
  'xpd15',
  'damageDiff15',
  'soloDiff15',
  'dragon15',
  'grub15',
  'objectiveFight15'
] as const satisfies readonly ScatterMetric[]
const differences: ReadonlySet<ScatterMetric> = new Set(scatterDifferenceMetrics)
const containsZero = (range: ScatterRange) =>
  Number.isFinite(range.min) &&
  Number.isFinite(range.max) &&
  range.min < range.max &&
  range.min <= 0 &&
  range.max >= 0

export function scatterZeroReferenceAxes(
  xMetric: ScatterMetric,
  yMetric: ScatterMetric,
  view: ScatterViewport
) {
  return {
    x: differences.has(xMetric) && containsZero(view.x),
    y: differences.has(yMetric) && containsZero(view.y)
  }
}

// Keep labels inside the plot, at the line endpoints rather than the crossing.
// At the lower-right corner retain only the horizontal label (0 or existing
// 50%), instead of stacking a second zero over that same endpoint.
export function scatterZeroLabels(
  x: number | null,
  y: number | null,
  y50: number | null,
  plot: { left: number; top: number; width: number; height: number }
) {
  const right = plot.left + plot.width,
    bottom = plot.top + plot.height
  const textY = (line: number) => Math.max(plot.top + 12, Math.min(bottom - 5, line - 5))
  const labels: { axis: 'x' | 'y'; x: number; y: number; anchor: 'start' | 'end' }[] = []
  if (y !== null) labels.push({ axis: 'y', x: right - 4, y: textY(y), anchor: 'end' })
  if (x !== null) {
    const labelX = Math.max(plot.left + 4, Math.min(right - 4, x + 4))
    const horizontal = y ?? y50
    const collides =
      horizontal !== null &&
      Math.abs(labelX - (right - 4)) < 28 &&
      Math.abs(bottom - 5 - textY(horizontal)) < 18
    if (!collides)
      labels.push({ axis: 'x', x: labelX, y: bottom - 5, anchor: x > right - 20 ? 'end' : 'start' })
  }
  return labels
}
