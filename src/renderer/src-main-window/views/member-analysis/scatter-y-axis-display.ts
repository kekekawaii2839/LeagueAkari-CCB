import type { ScatterMetric } from './scatter-analysis'

// Conservative advances for the existing 13px tick / 14px title system font.
// This is a budget estimate, not a measurement of native SVG glyph bounds.
export function scatterAxisTextWidth(text: string, fontSize = 13) {
  const width = Array.from(text).reduce(
    (sum, character) =>
      sum +
      (/[^\u0000-\u00ff]/u.test(character)
        ? 13
        : /[0-9]/.test(character)
          ? 7.2
          : character === '.'
            ? 3.6
            : /[-−+]/.test(character)
              ? 5.5
              : character === ' '
                ? 3.5
                : character === '%'
                  ? 10
                  : 7.2),
    0
  )
  return (width * fontSize) / 13
}

type YAxisDisplay =
  | {
      status: 'original'
      reason: 'probability' | 'ordinary' | 'numeric-limit' | 'precision-budget' | 'title-space'
    }
  | {
      status: 'compact'
      exponent: number
      divisor: number
      title: string
      labels: ReadonlyMap<number, string>
    }

// A common, explicitly annotated engineering multiplier changes display only.
// Narrow spans around a large offset may be impossible within this budget;
// retain the existing labels rather than inventing an offset or duplicate ticks.
export function compactScatterYAxis(options: {
  metric: ScatterMetric
  binary: boolean
  values: number[]
  original: (value: number) => string
  percent: boolean
  unit?: string
  title: string
  height: number
}): YAxisDisplay {
  const { values, original, percent } = options
  if (options.metric === 'winRate' || options.binary)
    return { status: 'original', reason: 'probability' }
  if (!values.length || !values.every(Number.isFinite) || new Set(values).size !== values.length)
    return { status: 'original', reason: 'numeric-limit' }
  const originalWidth = Math.max(...values.map((value) => scatterAxisTextWidth(original(value))))
  if (originalWidth <= 36) return { status: 'original', reason: 'ordinary' }
  const displayed = values.map((value) => (percent ? value * 100 : value))
  if (!displayed.every(Number.isFinite)) return { status: 'original', reason: 'numeric-limit' }
  const maximum = Math.max(...displayed.map(Math.abs))
  if (!(maximum > 0)) return { status: 'original', reason: 'ordinary' }
  const exponent = Math.floor(Math.log10(maximum) / 3) * 3
  // Keep ordinary sizes (including ordinary percentage rates) unchanged.
  if (!exponent) return { status: 'original', reason: 'ordinary' }
  const divisor = 10 ** exponent
  if (!(divisor > 0) || !Number.isFinite(divisor))
    return { status: 'original', reason: 'numeric-limit' }
  const scaled = displayed.map((value) => value / divisor)
  if (!scaled.every(Number.isFinite)) return { status: 'original', reason: 'numeric-limit' }
  const unit = percent ? '%' : options.unit
  const title = `${options.title} · ×10^${exponent}${unit ? ` ${unit}` : ''}`
  if (scatterAxisTextWidth(title, 14) > options.height - 12)
    return { status: 'original', reason: 'title-space' }
  const magnitude = Math.max(...scaled.map(Math.abs))
  const minimumDigits = Math.max(0, 2 - Math.floor(Math.log10(magnitude)))
  for (let digits = minimumDigits; digits <= 12; digits++) {
    const labels = scaled.map((value) => (value === 0 ? 0 : value).toFixed(digits))
    if (labels.some((text, index) => scaled[index] !== 0 && Number(text) === 0)) continue
    if (new Set(labels).size !== values.length) continue
    const width = Math.max(...labels.map((text) => scatterAxisTextWidth(text)))
    if (width > 36 || width >= originalWidth) continue
    return {
      status: 'compact',
      exponent,
      divisor,
      title,
      labels: new Map(values.map((value, index) => [value, labels[index]]))
    }
  }
  return { status: 'original', reason: 'precision-budget' }
}
