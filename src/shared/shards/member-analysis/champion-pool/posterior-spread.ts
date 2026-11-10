import { standardizeBlindabilitySpreads } from './scoring'

export const DEFAULT_TAU_GRID_PP = [
  0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8
] as const
export interface PosteriorSpreadCell {
  target: string
  deltaPp: number
  samplingVariancePp2: number
  pickRate: number
}
export interface PosteriorSpreadProfile {
  champion: string
  cells: readonly PosteriorSpreadCell[]
}
export interface PosteriorSpreadOptions {
  tauGridPp: readonly number[]
  priorStrength: number
  varianceConvention: 'meta-distribution' | 'reliability-weighted-sample'
  draws: number
  seed: number
  axisRoleCount: 4 | 5
  maxIterations?: number
  tolerance?: number
}

/** Conditional working model: independent Gaussian pair-rate errors with FIXED
 * positive variances; a flat row intercept; exchangeable latent interactions.
 * Prior weights are learned within ONE role block, never across the nine roles.
 * This is an independently specified EB estimator, not the author's fitted model.
 */
export function posteriorMomentsAtTau(
  cells: readonly PosteriorSpreadCell[],
  tauPp: number,
  convention: PosteriorSpreadOptions['varianceConvention']
) {
  if (
    !Number.isFinite(tauPp) ||
    tauPp < 0 ||
    tauPp > 100 ||
    !['meta-distribution', 'reliability-weighted-sample'].includes(convention)
  )
    throw new Error('Invalid latent scale/convention')
  validateCells(cells)
  const t = tauPp * tauPp,
    precision = cells.map((c) => 1 / (t + c.samplingVariancePp2))
  const P = precision.reduce((s, x) => s + x, 0),
    mu = cells.reduce((s, c, i) => s + precision[i] * c.deltaPp, 0) / P
  const muVariance = 1 / P
  const logLikelihood =
    -0.5 *
    (cells.reduce(
      (s, c, i) => s + Math.log(t + c.samplingVariancePp2) + precision[i] * (c.deltaPp - mu) ** 2,
      0
    ) +
      Math.log(P))
  const total = cells.reduce((s, c) => s + c.pickRate, 0),
    a = cells.map((c) => c.pickRate / total)
  const k = precision.map((value) => t * value),
    b = k.map((x) => 1 - x)
  const conditionalVariance = cells.map((c, i) => t * c.samplingVariancePp2 * precision[i])
  const means = cells.map((c, i) => k[i] * c.deltaPp + b[i] * mu)
  const center = means.reduce((s, x, i) => s + a[i] * x, 0),
    bCenter = b.reduce((s, x, i) => s + a[i] * x, 0)
  const denominator = convention === 'meta-distribution' ? 1 : 1 - a.reduce((s, x) => s + x * x, 0)
  if (1 - a.reduce((s, x) => s + x * x, 0) < 1e-12)
    throw new Error('Degenerate effective target weights')
  const expectedVariance =
    t === 0
      ? 0
      : (means.reduce((s, x, i) => s + a[i] * (x - center) ** 2, 0) +
          conditionalVariance.reduce((s, x, i) => s + a[i] * (1 - a[i]) * x, 0) +
          muVariance * b.reduce((s, x, i) => s + a[i] * (x - bCenter) ** 2, 0)) /
        denominator
  return {
    tauPp,
    logLikelihood,
    mu,
    muVariance,
    k,
    b,
    conditionalVariance,
    means,
    weights: a,
    denominator,
    expectedVariancePp2: expectedVariance
  }
}

function validateCells(cells: readonly PosteriorSpreadCell[]) {
  if (cells.length < 2 || cells.length > 1000)
    throw new Error('At least two complete interaction observations are required')
  const ids = new Set<string>()
  for (const c of cells) {
    if (
      typeof c.target !== 'string' ||
      !c.target.trim() ||
      ids.has(c.target) ||
      !Number.isFinite(c.deltaPp) ||
      Math.abs(c.deltaPp) > 100 ||
      !Number.isFinite(c.samplingVariancePp2) ||
      c.samplingVariancePp2 < 1e-8 ||
      c.samplingVariancePp2 > 1e8 ||
      !Number.isFinite(c.pickRate) ||
      c.pickRate <= 0 ||
      c.pickRate > 1
    )
      throw new Error(
        'Invalid/incomplete posterior interaction; zero variance is not silently regularized'
      )
    ids.add(c.target)
  }
}
function logSumExp(values: number[]) {
  const max = Math.max(...values)
  return max + Math.log(values.reduce((s, x) => s + Math.exp(x - max), 0))
}
function responsibilities(logLikelihoods: number[], weights: number[]) {
  const log = logLikelihoods.map((x, j) => x + Math.log(weights[j])),
    normalizer = logSumExp(log)
  return { weights: log.map((x) => Math.exp(x - normalizer)), normalizer }
}
function quantile(values: number[], p: number) {
  const at = (values.length - 1) * p,
    i = Math.floor(at)
  return values[i] + (values[Math.min(i + 1, values.length - 1)] - values[i]) * (at - i)
}
function generator(seed: number, name: string) {
  let state = seed >>> 0
  for (const c of name) {
    state ^= c.charCodeAt(0)
    state = Math.imul(state, 16777619) >>> 0
  }
  if (state === 0) state = 1
  let spare: number | null = null
  const uniform = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) + 0.5) / 4294967296
  }
  return {
    uniform,
    normal: () => {
      if (spare !== null) {
        const z = spare
        spare = null
        return z
      }
      const r = Math.sqrt(-2 * Math.log(uniform())),
        angle = 2 * Math.PI * uniform()
      spare = r * Math.sin(angle)
      return r * Math.cos(angle)
    }
  }
}

export function estimatePosteriorRoleSpreads(
  input: readonly PosteriorSpreadProfile[],
  options: PosteriorSpreadOptions
) {
  const grid = [...options.tauGridPp],
    lambda = options.priorStrength,
    maxIterations = options.maxIterations ?? 500,
    tolerance = options.tolerance ?? 1e-8
  if (
    input.length < 2 ||
    input.length > 200 ||
    grid.length < 2 ||
    grid.length > 256 ||
    grid[0] !== 0 ||
    grid.some((x, i) => !Number.isFinite(x) || x < 0 || x > 100 || (i > 0 && x <= grid[i - 1])) ||
    !Number.isFinite(lambda) ||
    lambda <= 0 ||
    !Number.isSafeInteger(options.draws) ||
    options.draws < 64 ||
    options.draws > 16384 ||
    !Number.isSafeInteger(options.seed) ||
    ![4, 5].includes(options.axisRoleCount) ||
    !['meta-distribution', 'reliability-weighted-sample'].includes(options.varianceConvention) ||
    !Number.isSafeInteger(maxIterations) ||
    maxIterations < 1 ||
    maxIterations > 10000 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  )
    throw new Error('Invalid posterior role configuration')
  const ids = new Set<string>()
  const profiles = input
    .map((p) => {
      if (typeof p.champion !== 'string' || !p.champion.trim() || ids.has(p.champion))
        throw new Error('Invalid/duplicate posterior champion')
      ids.add(p.champion)
      validateCells(p.cells)
      return {
        champion: p.champion,
        cells: [...p.cells].sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0))
      }
    })
    .sort((a, b) => (a.champion < b.champion ? -1 : a.champion > b.champion ? 1 : 0))
  const states = profiles.map((p) =>
    grid.map((t) => posteriorMomentsAtTau(p.cells, t, options.varianceConvention))
  )
  const logs = states.map((row) => row.map((x) => x.logLikelihood))
  let weights = grid.map(() => 1 / grid.length),
    objective = -Infinity,
    converged = false,
    iterations = 0
  const history: number[] = []
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const rows = logs.map((log) => responsibilities(log, weights)),
      next = grid.map(
        (_, j) =>
          (rows.reduce((s, r) => s + r.weights[j], 0) + lambda / grid.length) /
          (profiles.length + lambda)
      )
    const nextObjective =
      logs.reduce((s, row) => s + responsibilities(row, next).normalizer, 0) +
      (lambda / grid.length) * next.reduce((s, x) => s + Math.log(x), 0)
    if (!Number.isFinite(nextObjective) || nextObjective < objective - 1e-7)
      throw new Error('Invalid penalized EM objective')
    history.push(nextObjective)
    weights = next
    iterations = iteration + 1
    if (
      Number.isFinite(objective) &&
      nextObjective - objective <= tolerance * (1 + Math.abs(objective))
    ) {
      converged = true
      objective = nextObjective
      break
    }
    objective = nextObjective
  }
  const posteriors = logs.map((row) => responsibilities(row, weights).weights)
  const streams = profiles.map((p) => generator(options.seed, p.champion))
  const sampledSd = profiles.map(() => [] as number[]),
    sampledZ = profiles.map(() => [] as number[])
  let degenerate = 0
  for (let draw = 0; draw < options.draws; draw++) {
    const spreads = profiles.map((p, h) => {
      const rng = streams[h],
        u = rng.uniform()
      let index = 0,
        cumulative = posteriors[h][0]
      while (index < grid.length - 1 && u > cumulative) cumulative += posteriors[h][++index]
      const state = states[h][index]
      if (state.tauPp === 0) {
        sampledSd[h].push(0)
        return 0
      }
      const mu = state.mu + Math.sqrt(state.muVariance) * rng.normal()
      const theta = p.cells.map(
        (c, i) =>
          state.k[i] * c.deltaPp +
          state.b[i] * mu +
          Math.sqrt(state.conditionalVariance[i]) * rng.normal()
      )
      const center = theta.reduce((s, x, i) => s + state.weights[i] * x, 0)
      const variance =
        theta.reduce((s, x, i) => s + state.weights[i] * (x - center) ** 2, 0) / state.denominator
      const sd = Math.sqrt(variance)
      sampledSd[h].push(sd)
      return sd
    })
    const reference = standardizeBlindabilitySpreads(spreads)
    if (reference.fallbackDenominatorUsed) degenerate++
    reference.zScores.forEach((z, h) => {
      if (z === null || !Number.isFinite(z)) throw new Error('Incomplete posterior draw reference')
      sampledZ[h].push(z)
    })
  }
  const rootExpectedVariances = states.map((row, h) =>
    Math.sqrt(row.reduce((s, state, j) => s + posteriors[h][j] * state.expectedVariancePp2, 0))
  )
  const pluginReference = standardizeBlindabilitySpreads(rootExpectedVariances)
  const tail = 0.05 / (2 * options.axisRoleCount)
  return {
    method: 'role-empirical-bayes-spread-v1' as const,
    scoreDefinition:
      'posterior mean of per-draw fixed-cohort reverse sample-z; NOT z of posterior mean SD' as const,
    assumptions:
      'fixed baselines/pick rates/noise variances; Gaussian working likelihood; fitted-prior conditional hero independence' as const,
    uncertainty:
      'Monte Carlo approximate fitted-prior conditional model ranges; excludes prior-fit, baseline and real-match covariance uncertainty' as const,
    draws: options.draws,
    seed: options.seed,
    varianceConvention: options.varianceConvention,
    referenceSize: profiles.length,
    degenerateReferenceDrawFraction: degenerate / options.draws,
    prior: {
      gridPp: grid,
      weights,
      priorStrength: lambda,
      converged,
      iterations,
      penalizedObjective: objective,
      objectiveHistory: history,
      upperGridWeight: weights[weights.length - 1]
    },
    profiles: profiles.map((p, h) => {
      const zs = sampledZ[h],
        ss = sampledSd[h],
        meanZ = zs.reduce((s, x) => s + x, 0) / zs.length,
        meanSd = ss.reduce((s, x) => s + x, 0) / ss.length
      zs.sort((a, b) => a - b)
      ss.sort((a, b) => a - b)
      return {
        champion: p.champion,
        meanZ,
        posteriorMeanSdPp: meanSd,
        rootExpectedVariancePp: rootExpectedVariances[h],
        rootExpectedVariancePluginZ: pluginReference.zScores[h]!,
        sdInterval95: { lower: quantile(ss, 0.025), upper: quantile(ss, 0.975) },
        zInterval95: { lower: quantile(zs, 0.025), upper: quantile(zs, 0.975) },
        simultaneousRoleZBounds: {
          tailProbability: tail,
          lower: quantile(zs, tail),
          upper: quantile(zs, 1 - tail)
        },
        posteriorZeroTauProbability: posteriors[h][0],
        posteriorUpperGridProbability: posteriors[h][grid.length - 1],
        posteriorPriorKl: posteriors[h].reduce(
          (s, x, j) => s + (x > 0 ? x * Math.log(x / weights[j]) : 0),
          0
        )
      }
    })
  }
}
