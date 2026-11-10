/** Synthetic-only Monte Carlo audit. No network, game data or dataset files.
 * Usage: node audit-sampling-noise.mjs <compiled sampling-noise.js>
 * Published baselines and pick rates are fixed by construction. Every replicate
 * independently generates exact binomial wins from KNOWN latent probabilities;
 * this is not a resampling of published/rounded real-world win rates.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fractions = [0.03, 0.1, 0.3, 1]
const fullSamples = [5000, 4300, 6100, 4800, 5600, 3900, 6800, 4500]
const weights = [0.25, 0.19, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05]

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`Nonfinite Monte Carlo ${name}`)
  return value
}

export function createSyntheticProfile(label, spreadPp) {
  if (typeof label !== 'string' || !label || finite(spreadPp, 'spread') < 0)
    throw new Error('Invalid synthetic profile')
  const shape = [-1.8, -1.2, -0.7, -0.2, 0.3, 0.9, 1.4, 2]
  const center = shape.reduce((sum, x, i) => sum + weights[i] * x, 0)
  const variance = shape.reduce((sum, x, i) => sum + weights[i] * (x - center) ** 2, 0)
  const cells = shape.map((x, i) => {
    const deltaPp = ((x - center) / Math.sqrt(variance)) * spreadPp
    const baseline = 0.485 + 0.025 * Math.sin(i * 0.8)
    return {
      target: `Synthetic target ${i + 1}`,
      pickRate: weights[i],
      baseline,
      trueDeltaPp: deltaPp,
      trueWinRate: baseline + deltaPp / 100,
      fullGames: fullSamples[i]
    }
  })
  if (cells.some((c) => c.trueWinRate <= 0 || c.trueWinRate >= 1))
    throw new Error('Synthetic probability outside binomial support')
  return { label, cells }
}

function truthVariance(profile, convention) {
  const sumWeight = profile.cells.reduce((s, c) => s + c.pickRate, 0)
  const a = profile.cells.map((c) => c.pickRate / sumWeight)
  const center = profile.cells.reduce((s, c, i) => s + a[i] * c.trueDeltaPp, 0)
  const numerator = profile.cells.reduce((s, c, i) => s + a[i] * (c.trueDeltaPp - center) ** 2, 0)
  const denominator = convention === 'meta-distribution' ? 1 : 1 - a.reduce((s, x) => s + x * x, 0)
  return numerator / denominator
}

function randomGenerator(seed) {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function binomial(games, probability, random) {
  let wins = 0
  for (let i = 0; i < games; i++) if (random() < probability) wins++
  return wins
}

/** Audit the untruncated signed variance, NOT mean(sqrt(max(0, estimate))).
 * The latter has truncation/Jensen bias and is not an unbiasedness criterion.
 */
export function evaluateMonteCarloMoments({ mean, sampleVariance, repetitions, truth }) {
  finite(mean, 'mean')
  finite(sampleVariance, 'sample variance')
  finite(truth, 'truth')
  if (!Number.isSafeInteger(repetitions) || repetitions < 2 || sampleVariance < 0 || truth < 0)
    throw new Error('Invalid Monte Carlo moments')
  const standardError = Math.sqrt(sampleVariance / repetitions)
  const tolerance = 0.02 + 6 * standardError
  return {
    standardErrorPp2: standardError,
    mean95MonteCarloIntervalPp2: [mean - 1.96 * standardError, mean + 1.96 * standardError],
    acceptanceTolerancePp2: tolerance,
    passed: Math.abs(mean - truth) <= tolerance
  }
}

export function simulateConfiguration(
  estimateInteractionSpread,
  profile,
  fraction,
  { repetitions = 2000, seed = 20261108, convention = 'meta-distribution' } = {}
) {
  if (
    typeof estimateInteractionSpread !== 'function' ||
    !Number.isSafeInteger(repetitions) ||
    repetitions < 100 ||
    !Number.isSafeInteger(seed) ||
    !(fraction > 0 && fraction <= 1) ||
    !['meta-distribution', 'reliability-weighted-sample'].includes(convention)
  )
    throw new Error('Invalid synthetic audit configuration')
  const random = randomGenerator(seed)
  const options = {
    pickRateFloor: 0,
    pickRateWeighted: true,
    noiseModel: 'binomial-proportion-plugin',
    varianceConvention: convention
  }
  let mean = 0,
    m2 = 0,
    observedVarianceSum = 0,
    noiseVarianceSum = 0,
    dominated = 0
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const cells = profile.cells.map((cell) => {
      const games = Math.floor(cell.fullGames * fraction)
      if (games < 2) throw new Error('Synthetic audit requires at least two games per cell')
      const reportedWinRate = binomial(games, cell.trueWinRate, random) / games
      return {
        target: cell.target,
        pickRate: cell.pickRate,
        games,
        reportedWinRate,
        deltaPp: 100 * (reportedWinRate - cell.baseline)
      }
    })
    const estimate = estimateInteractionSpread(cells, options)
    const signed = finite(estimate.signedCorrectedVariancePp2, 'signed corrected variance')
    const observed = finite(estimate.observedVariancePp2, 'observed variance')
    const noise = finite(estimate.samplingVariancePp2, 'noise variance')
    if (observed < 0 || noise < 0 || Math.abs(signed - (observed - noise)) > 1e-8)
      throw new Error('Invalid variance decomposition')
    if (signed <= 0) {
      if (estimate.status !== 'noise-dominated' || estimate.correctedSdPp !== null)
        throw new Error('Nonpositive variance must remain unresolved, not perfect stability')
      dominated++
    } else {
      const correctedSd = finite(estimate.correctedSdPp, 'corrected standard deviation')
      if (estimate.status !== 'available' || Math.abs(correctedSd ** 2 - signed) > 1e-8)
        throw new Error('Invalid available corrected spread')
    }
    observedVarianceSum += observed
    noiseVarianceSum += noise
    const difference = signed - mean
    mean += difference / (repetition + 1)
    m2 += difference * (signed - mean)
  }
  const truth = truthVariance(profile, convention)
  const moments = evaluateMonteCarloMoments({
    mean,
    sampleVariance: m2 / (repetitions - 1),
    repetitions,
    truth
  })
  return {
    profile: profile.label,
    varianceConvention: convention,
    sampleFraction: fraction,
    repetitions,
    pairAppearancesPerReplicate: profile.cells.reduce(
      (s, c) => s + Math.floor(c.fullGames * fraction),
      0
    ),
    knownTrueVariancePp2: truth,
    knownTrueSdPp: Math.sqrt(truth),
    observedRmsSdPp: Math.sqrt(observedVarianceSum / repetitions),
    meanEstimatedNoiseVariancePp2: noiseVarianceSum / repetitions,
    meanSignedCorrectedVariancePp2: mean,
    sqrtMeanSignedCorrectedVariancePp: mean >= 0 ? Math.sqrt(mean) : null,
    noiseDominatedFraction: dominated / repetitions,
    ...moments
  }
}

export function runSamplingNoiseAudit(estimateInteractionSpread, options = {}) {
  const profiles = [
    createSyntheticProfile('Synthetic narrow', 1.1),
    createSyntheticProfile('Synthetic wide', 2.2)
  ]
  const cases = []
  let i = 0
  for (const profile of profiles)
    for (const fraction of fractions)
      cases.push(
        simulateConfiguration(estimateInteractionSpread, profile, fraction, {
          ...options,
          seed: (options.seed ?? 20261108) + i++ * 7919
        })
      )
  cases.push(
    simulateConfiguration(estimateInteractionSpread, profiles[0], 0.1, {
      ...options,
      seed: (options.seed ?? 20261108) + i * 7919,
      convention: 'reliability-weighted-sample'
    })
  )
  cases.push(
    simulateConfiguration(
      estimateInteractionSpread,
      createSyntheticProfile('Synthetic flat', 0),
      0.1,
      {
        ...options,
        seed: (options.seed ?? 20261108) + (i + 1) * 7919
      }
    )
  )
  return {
    source: 'known-latent-probability synthetic binomial experiments; not real-match subsampling',
    method: 'fixed baselines, fixed nonuniform pick rates, independent exact W/n cell proportions',
    seed: options.seed ?? 20261108,
    intervalMeaning:
      '95% approximate Monte Carlo interval for the SIMULATION MEAN; not a champion uncertainty interval',
    acceptance: 'absolute mean signed-variance error <= 0.02 pp^2 + 6 Monte Carlo standard errors',
    cases,
    passed: cases.every((c) => c.passed)
  }
}

async function main() {
  if (process.argv.length !== 3) throw new Error('Expected a compiled sampling-noise module path')
  const module = await import(pathToFileURL(resolve(process.argv[2])).href)
  const report = runSamplingNoiseAudit(module.estimateInteractionSpread)
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (!report.passed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    process.stdout.write(
      JSON.stringify({ passed: false, error: 'sampling-noise-audit-failed' }) + '\n'
    )
    process.exitCode = 1
  })
