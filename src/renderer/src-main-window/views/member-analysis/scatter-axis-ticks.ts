import type { ScatterMetric } from './scatter-analysis'
import { scatterDifferenceMetrics } from './scatter-reference-lines'
import { type ScatterRange, formatScatterViewportTick } from './scatter-viewport'
import { finiteOrNull } from './visualization'

const signed: ReadonlySet<ScatterMetric> = new Set(scatterDifferenceMetrics)

// Tick policy only: preserve the original padded data domain and projection.
export function scatterAxisTickPolicy(
  metric: ScatterMetric,
  range: ScatterRange,
  observations: unknown[],
  size: number,
  minimumGap: number,
  manual = false
) {
  const values = Array.from(
    { length: 5 },
    (_, index) => range.min + ((range.max - range.min) * index) / 4
  )
  const finite = observations.map(finiteOrNull).filter((value): value is number => value !== null)
  const automaticNonnegative =
    !manual && !signed.has(metric) && finite.length > 0 && finite.every((value) => value >= 0)
  if (!automaticNonnegative) return { values, gridValues: values, automaticNonnegative }
  const visible = values.filter((value) => value >= 0)
  if (range.min <= 0 && range.max >= 0 && range.max > range.min) {
    // Exact raw-value equality, never an epsilon that could swallow real data.
    const withZero = [...new Set([0, ...visible])].sort((a, b) => a - b)
    return {
      values: withZero.filter(
        (value) => value === 0 || (value / (range.max - range.min)) * size >= minimumGap
      ),
      gridValues: [...new Set([...values, 0])].sort((a, b) => a - b),
      automaticNonnegative
    }
  }
  return { values: visible, gridValues: values, automaticNonnegative }
}

export function scatterAutomaticTickText(
  value: number,
  ticks: number[],
  range: ScatterRange,
  percent: boolean,
  original: (value: number) => string
) {
  const texts = ticks.map(original)
  const needsPrecision =
    new Set(texts).size !== texts.length ||
    ticks.some((tick, index) => tick !== 0 && Number.parseFloat(texts[index]) === 0)
  return needsPrecision ? formatScatterViewportTick(value, range, percent) : original(value)
}
