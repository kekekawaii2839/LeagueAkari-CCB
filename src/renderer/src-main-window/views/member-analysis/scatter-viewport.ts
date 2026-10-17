export type ScatterRange = { min: number; max: number }
export type ScatterViewport = { x: ScatterRange; y: ScatterRange }

// Group measured values, not their projected pixels: an extreme outlier must
// not turn nearby-but-distinct observations into a permanent overlap group.
export function groupExactScatterValues<T>(
  rows: T[],
  x: (row: T) => number,
  y: (row: T) => number
) {
  const groups: { valueX: number; valueY: number; rows: T[] }[] = []
  const values = new Map<number, Map<number, (typeof groups)[number]>>()
  for (const row of rows) {
    const a = x(row),
      b = y(row)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    let ys = values.get(a)
    if (!ys) values.set(a, (ys = new Map()))
    let group = ys.get(b)
    if (!group) {
      group = { valueX: a, valueY: b, rows: [] }
      ys.set(b, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

export function boundedScatterRange(range: ScatterRange, full: ScatterRange): ScatterRange {
  const span = full.max - full.min
  if (!(span > 0) || !Number.isFinite(span)) return full
  // Precision follows the requested local range, not a distant outlier. A
  // full-domain-relative floor would itself prevent inspecting the cluster.
  const minimum = Math.max(
    Number.MIN_VALUE * 16,
    Number.EPSILON * Math.max(Math.abs(range.min), Math.abs(range.max)) * 8
  )
  const requested = range.max - range.min
  if (!Number.isFinite(range.min) || !Number.isFinite(range.max) || requested <= 0) return full
  const size = Math.min(span, Math.max(minimum, requested))
  const min = Math.max(full.min, Math.min(full.max - size, range.min))
  return { min, max: min + size }
}

export function scaleScatterViewport(
  view: ScatterViewport,
  full: ScatterViewport,
  factor: number
): ScatterViewport {
  const scale = (range: ScatterRange, bounds: ScatterRange) => {
    const center = range.min + (range.max - range.min) / 2
    const half = ((range.max - range.min) * factor) / 2
    if (!(center + half > center - half)) return range
    return boundedScatterRange({ min: center - half, max: center + half }, bounds)
  }
  return { x: scale(view.x, full.x), y: scale(view.y, full.y) }
}

export function panScatterViewport(
  view: ScatterViewport,
  full: ScatterViewport,
  dx: number,
  dy: number
): ScatterViewport {
  const move = (range: ScatterRange, bounds: ScatterRange, amount: number) => {
    const offset = (range.max - range.min) * amount
    return boundedScatterRange({ min: range.min + offset, max: range.max + offset }, bounds)
  }
  return { x: move(view.x, full.x, dx), y: move(view.y, full.y, dy) }
}

export function selectedScatterViewport(
  view: ScatterViewport,
  a: { x: number; y: number },
  b: { x: number; y: number }
): ScatterViewport {
  const x = (value: number) => view.x.min + value * (view.x.max - view.x.min)
  const y = (value: number) => view.y.max - value * (view.y.max - view.y.min)
  return {
    x: { min: x(Math.min(a.x, b.x)), max: x(Math.max(a.x, b.x)) },
    y: { min: y(Math.max(a.y, b.y)), max: y(Math.min(a.y, b.y)) }
  }
}

export function formatScatterViewportTick(value: number, range: ScatterRange, percent: boolean) {
  const step = ((range.max - range.min) / 4) * (percent ? 100 : 1)
  const digits = Math.max(percent ? 1 : 0, Math.ceil(-Math.log10(step)) + 1)
  const scaled = value * (percent ? 100 : 1)
  const text = digits > 12 ? scaled.toExponential(16) : scaled.toFixed(digits)
  return `${Number(text) === 0 ? (digits > 12 ? '0' : (0).toFixed(digits)) : text}${percent ? '%' : ''}`
}
