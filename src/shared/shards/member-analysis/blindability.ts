/**
 * Independent experimental reconstruction of the variance-based idea in:
 * https://machineloling.com/2024/12/17/blindability/
 * NOT a numerical replica of the current Pool Designer's WASM/z-score model.
 * No source-site code, data, fitted constants or weights are bundled here.
 */
export interface BlindabilityScope {
  source: string
  patch: string // internal major.minor, e.g. 16.21; do not infer from UI season names
  region: string
  queue: string
  rank: string
  role: string
}

export interface BlindabilityCell {
  key: string // unique champion-role opponent/partner slot
  deltaPp: number | null // observed win rate minus expected win rate, percentage points
  samplingVariancePp2: number | null // variance of the delta estimator, NOT count variance
  games: number
  pickRate: number // 0..1 within a role; never pair frequency
}

export interface BlindabilityProfile {
  scope: BlindabilityScope
  champion: string
  matchup: BlindabilityCell[]
  synergy: BlindabilityCell[]
}

export interface BlindabilityOptions {
  pickRateFloor: number
  pickRateWeighted: boolean
}

/** Caller-provided expected slot list is essential: top-N counter APIs are not full matrices. */
export interface BlindabilityUniverse {
  matchup: readonly string[]
  synergy: readonly string[]
}

export interface BlindabilityAxis {
  status: 'available' | 'partial' | 'insufficient'
  eligibleSlots: number
  observedSlots: number
  weightedCoverage: number | null
  effectiveSlots: number | null
  meanDeltaPp: number | null
  observedSdPp: number | null
  correctedSdPp: number | null // lower = less interaction-dependent, NOT higher win probability
  noiseFloor: boolean
}

/** Odds combination is a baseline assumption, not a causal adjustment. Rates are 0..1.
 * A correct odds calculation does NOT calibrate player-rank-conditioned pair WRs:
 * A-in-bracket vs B and B-in-bracket vs A can refer to different match subsets.
 * Comparable/neutral sampling must be established upstream; the residual is not
 * automatically an antisymmetric champion-only matchup effect.
 */
export function expectedPairWinRate(a: number, b: number, mode: 'matchup' | 'synergy') {
  if (![a, b].every((p) => Number.isFinite(p) && p > 0 && p < 1)) {
    throw new RangeError('Baseline rates must be strictly between zero and one')
  }
  const oddsA = a / (1 - a)
  const oddsB = b / (1 - b)
  const odds = mode === 'synergy' ? oddsA * oddsB : oddsA / oddsB
  return odds / (1 + odds)
}

/**
 * Conditional binomial rate variance with a plug-in unbiased estimate, in pp².
 * This is only the pair-rate component. Baseline uncertainty/covariance must be
 * handled upstream; do not pass this alone as full delta variance when material.
 */
export function binomialRateVariancePp2(wins: number, games: number): number | null {
  if (
    !Number.isSafeInteger(games) ||
    games < 0 ||
    !Number.isSafeInteger(wins) ||
    wins < 0 ||
    wins > games
  ) {
    throw new RangeError('Invalid win/game counts')
  }
  if (games < 2) return null
  const p = wins / games
  return (10000 * p * (1 - p)) / (games - 1)
}

function axis(
  cells: BlindabilityCell[],
  universe: readonly string[],
  options: BlindabilityOptions
): BlindabilityAxis {
  if (new Set(universe).size !== universe.length) throw new Error('Duplicate universe slot')
  const keys = new Set<string>()
  for (const cell of cells) {
    if (keys.has(cell.key)) throw new Error('Duplicate matrix slot')
    keys.add(cell.key)
    if (!universe.includes(cell.key)) throw new Error('Matrix slot outside declared universe')
    if (
      !Number.isSafeInteger(cell.games) ||
      cell.games < 0 ||
      !Number.isFinite(cell.pickRate) ||
      cell.pickRate < 0 ||
      cell.pickRate > 1 ||
      (cell.deltaPp !== null && (!Number.isFinite(cell.deltaPp) || Math.abs(cell.deltaPp) > 100)) ||
      (cell.samplingVariancePp2 !== null &&
        (!Number.isFinite(cell.samplingVariancePp2) || cell.samplingVariancePp2 < 0))
    ) {
      throw new RangeError('Invalid matrix observation')
    }
  }
  // A missing row has unknown pick rate: it cannot be silently filtered out.
  const missingRows = universe.filter((key) => !keys.has(key)).length
  const eligible = cells.filter((cell) => cell.pickRate >= options.pickRateFloor)
  const weight = (cell: BlindabilityCell) => (options.pickRateWeighted ? cell.pickRate : 1)
  const observed = eligible.filter(
    (cell) => cell.games > 0 && cell.deltaPp !== null && weight(cell) > 0
  )
  const totalWeight = eligible.reduce((sum, cell) => sum + weight(cell), 0)
  const observedWeight = observed.reduce((sum, cell) => sum + weight(cell), 0)
  const result: BlindabilityAxis = {
    status: 'insufficient',
    eligibleSlots: eligible.length + missingRows,
    observedSlots: observed.length,
    weightedCoverage: missingRows || totalWeight === 0 ? null : observedWeight / totalWeight,
    effectiveSlots: null,
    meanDeltaPp: null,
    observedSdPp: null,
    correctedSdPp: null,
    noiseFloor: false
  }
  if (observedWeight === 0) return result
  const weights = observed.map((cell) => weight(cell) / observedWeight)
  const sumSquares = weights.reduce((sum, w) => sum + w * w, 0)
  const mean = observed.reduce((sum, cell, i) => sum + weights[i] * cell.deltaPp!, 0)
  result.meanDeltaPp = mean
  result.effectiveSlots = 1 / sumSquares
  if (observed.length < 2 || 1 - sumSquares < 1e-12) return result
  const variance =
    observed.reduce((sum, cell, i) => sum + weights[i] * (cell.deltaPp! - mean) ** 2, 0) /
    (1 - sumSquares)
  result.observedSdPp = Math.sqrt(variance)
  result.status =
    missingRows || observed.length !== eligible.filter((cell) => weight(cell) > 0).length
      ? 'partial'
      : 'available'
  if (observed.some((cell) => cell.samplingVariancePp2 === null)) {
    result.status = 'partial'
    return result
  }
  // Method of moments, assuming independent cell errors. Shared matches and
  // estimated common baselines violate this: upstream bootstrap is required
  // for confidence intervals. No confidence interval is claimed by this core.
  const noise =
    observed.reduce(
      (sum, cell, i) => sum + weights[i] * (1 - weights[i]) * cell.samplingVariancePp2!,
      0
    ) /
    (1 - sumSquares)
  result.noiseFloor = variance <= noise
  result.correctedSdPp = Math.sqrt(Math.max(0, variance - noise))
  return result
}

export function calculateBlindability(
  profile: BlindabilityProfile,
  universe: BlindabilityUniverse,
  options: BlindabilityOptions
) {
  if (
    !Number.isFinite(options.pickRateFloor) ||
    options.pickRateFloor < 0 ||
    options.pickRateFloor > 1
  ) {
    throw new RangeError('Pick-rate floor must be between zero and one')
  }
  if (
    !Object.values(profile.scope).every((value) => value.trim()) ||
    !/^\d+\.\d+$/.test(profile.scope.patch)
  ) {
    throw new Error('Explicit source and population scope required')
  }
  return {
    method: 'experimental-independent-mom-v1' as const,
    scope: { ...profile.scope },
    champion: profile.champion,
    matchup: axis(profile.matchup, universe.matchup, options),
    synergy: axis(profile.synergy, universe.synergy, options)
  }
}
