/** Method-of-moments cross-interaction spread, conditional on fixed published
 * marginal baselines and pick rates. This is variance deconvolution, NOT pair
 * shrinkage, and does not implement the source site's unpublished estimator.
 */
export interface InteractionSpreadCell {
  target: string
  deltaPp: number | null
  games: number
  reportedWinRate: number | null
  pickRate: number
}

export interface InteractionSpreadOptions {
  pickRateFloor: number
  pickRateWeighted: boolean
  noiseModel: 'binomial-proportion-plugin' | 'maximum-binomial-variance'
  varianceConvention: 'meta-distribution' | 'reliability-weighted-sample'
}

export interface InteractionSpreadEstimate {
  method: 'conditional-independent-cell-mom-v1'
  assumptions: 'fixed-baselines-fixed-pick-rates-independent-pair-errors'
  noiseModel: InteractionSpreadOptions['noiseModel']
  varianceConvention: InteractionSpreadOptions['varianceConvention']
  status: 'available' | 'partial' | 'insufficient' | 'noise-dominated'
  eligibleTargets: number
  observedTargets: number
  noiseEstimableTargets: number
  weightedCoverage: number | null
  effectiveTargets: number | null
  pairAppearances: number // not a general unique-match count
  meanDeltaPp: number | null
  observedVariancePp2: number | null
  observedSdPp: number | null
  samplingVariancePp2: number | null
  signedCorrectedVariancePp2: number | null
  correctedSdPp: number | null // negative variance is unresolved, NOT perfect stability
}

/** For an exact W/n, the plugin estimates the proportion's sampling variance
 * without bias. For a rounded published ratio it is only an approximation.
 * The maximum model is a noise upper bound, not a confidence interval.
 */
export function pairRateSamplingVariancePp2(
  reportedWinRate: number,
  games: number,
  model: InteractionSpreadOptions['noiseModel']
): number | null {
  if (
    !Number.isFinite(reportedWinRate) ||
    reportedWinRate < 0 ||
    reportedWinRate > 1 ||
    !Number.isSafeInteger(games) ||
    games < 0
  )
    throw new Error('Invalid binomial proportion or sample size')
  if (model === 'maximum-binomial-variance') return games > 0 ? 2500 / games : null
  if (model !== 'binomial-proportion-plugin') throw new Error('Unknown sampling noise model')
  return games > 1 ? (10000 * reportedWinRate * (1 - reportedWinRate)) / (games - 1) : null
}

export function estimateInteractionSpread(
  cells: readonly InteractionSpreadCell[],
  options: InteractionSpreadOptions
): InteractionSpreadEstimate {
  if (
    !Number.isFinite(options.pickRateFloor) ||
    options.pickRateFloor < 0 ||
    options.pickRateFloor > 1 ||
    typeof options.pickRateWeighted !== 'boolean' ||
    !['binomial-proportion-plugin', 'maximum-binomial-variance'].includes(options.noiseModel) ||
    !['meta-distribution', 'reliability-weighted-sample'].includes(options.varianceConvention)
  )
    throw new Error('Invalid spread options')
  const ids = new Set<string>()
  for (const cell of cells) {
    if (
      !cell.target.trim() ||
      ids.has(cell.target) ||
      !Number.isSafeInteger(cell.games) ||
      cell.games < 0 ||
      !Number.isFinite(cell.pickRate) ||
      cell.pickRate < 0 ||
      cell.pickRate > 1 ||
      (cell.deltaPp !== null && (!Number.isFinite(cell.deltaPp) || Math.abs(cell.deltaPp) > 100)) ||
      (cell.reportedWinRate !== null &&
        (!Number.isFinite(cell.reportedWinRate) ||
          cell.reportedWinRate < 0 ||
          cell.reportedWinRate > 1))
    )
      throw new Error('Invalid or duplicate interaction target')
    ids.add(cell.target)
  }
  const weight = (cell: InteractionSpreadCell) => (options.pickRateWeighted ? cell.pickRate : 1)
  const eligible = cells.filter((c) => c.pickRate >= options.pickRateFloor && weight(c) > 0)
  const observed = eligible.filter(
    (c) => c.games > 0 && c.deltaPp !== null && c.reportedWinRate !== null
  )
  const totalWeight = eligible.reduce((s, c) => s + weight(c), 0)
  const observedWeight = observed.reduce((s, c) => s + weight(c), 0)
  const result: InteractionSpreadEstimate = {
    method: 'conditional-independent-cell-mom-v1',
    assumptions: 'fixed-baselines-fixed-pick-rates-independent-pair-errors',
    noiseModel: options.noiseModel,
    varianceConvention: options.varianceConvention,
    status: 'insufficient',
    eligibleTargets: eligible.length,
    observedTargets: observed.length,
    noiseEstimableTargets: 0,
    weightedCoverage: totalWeight > 0 ? observedWeight / totalWeight : null,
    effectiveTargets: null,
    pairAppearances: observed.reduce((s, c) => s + c.games, 0),
    meanDeltaPp: null,
    observedVariancePp2: null,
    observedSdPp: null,
    samplingVariancePp2: null,
    signedCorrectedVariancePp2: null,
    correctedSdPp: null
  }
  if (!Number.isSafeInteger(result.pairAppearances))
    throw new Error('Pair appearances exceed safe range')
  if (observedWeight <= 0) return result
  const a = observed.map((c) => weight(c) / observedWeight)
  const sumSquares = a.reduce((s, w) => s + w * w, 0)
  const denominator = options.varianceConvention === 'meta-distribution' ? 1 : 1 - sumSquares
  const center = observed.reduce((s, c, i) => s + a[i] * c.deltaPp!, 0)
  result.meanDeltaPp = center
  result.effectiveTargets = 1 / sumSquares
  if (observed.length < 2 || 1 - sumSquares < 1e-12) return result
  const variance =
    observed.reduce((s, c, i) => s + a[i] * (c.deltaPp! - center) ** 2, 0) / denominator
  result.observedVariancePp2 = variance
  result.observedSdPp = Math.sqrt(variance)
  const sampling = observed.map((c) =>
    pairRateSamplingVariancePp2(c.reportedWinRate!, c.games, options.noiseModel)
  )
  result.noiseEstimableTargets = sampling.filter((v) => v !== null).length
  if (result.noiseEstimableTargets !== observed.length) {
    result.status = 'partial'
    return result
  }
  const noise = sampling.reduce<number>((s, v, i) => s + a[i] * (1 - a[i]) * v!, 0) / denominator
  result.samplingVariancePp2 = noise
  result.signedCorrectedVariancePp2 = variance - noise
  if (variance <= noise) {
    result.status = 'noise-dominated'
    return result
  }
  result.correctedSdPp = Math.sqrt(variance - noise)
  result.status = observed.length === eligible.length ? 'available' : 'partial'
  return result
}
