/** Synthetic-only end-to-end bias audit; no network or real dataset IO.
 * CLI: node this-file.mjs <compiled sampling-noise.js> <compiled scoring.js>
 * An unbiased signed variance does NOT imply an unbiased square-root,
 * positive-only reference selection, z score or available-role average.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']
const weights = [0.25, 0.19, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05]
const shape = [-1.8, -1.2, -0.7, -0.2, 0.3, 0.9, 1.4, 2]
const options = {
  pickRateFloor: 0,
  pickRateWeighted: true,
  noiseModel: 'binomial-proportion-plugin',
  varianceConvention: 'meta-distribution'
}

function finite(x, label) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Nonfinite ${label}`)
  return x
}
function average(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}
function weightedVariance(xs) {
  const mean = xs.reduce((s, x, i) => s + weights[i] * x, 0)
  return xs.reduce((s, x, i) => s + weights[i] * (x - mean) ** 2, 0)
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
function binomial(n, p, random) {
  let wins = 0
  for (let i = 0; i < n; i++) if (random() < p) wins++
  return wins
}

export function exactNonlinearCounterexample() {
  const signed = [0, 2],
    truthVariance = 1
  const retained = signed.filter((v) => v > 0)
  return {
    truthVariance,
    meanSignedVariance: average(signed),
    truthSd: 1,
    positiveOnlyRetention: retained.length / signed.length,
    meanSdConditionalOnRetention: average(retained.map(Math.sqrt)),
    meanClippedSd: average(signed.map((v) => Math.sqrt(Math.max(0, v)))),
    conclusion: 'unbiased signed variance does not survive sqrt/drop or sqrt/clip'
  }
}

function spreadBlock(spreadsPp, mode = 'matchup', otherRole = 'TOP') {
  return {
    ownRole: 'MID',
    otherRole,
    mode,
    champions: spreadsPp.map((_, i) => `Synthetic ${i}`),
    championPickRates: spreadsPp.map(() => 1 / spreadsPp.length),
    spreadsPp
  }
}
function checkedScores(score, blocks) {
  const rows = score('MID', blocks, 0)
  if (!Array.isArray(rows)) throw new Error('Invalid scoring response')
  const seen = new Set()
  for (const r of rows) {
    if (typeof r.champion !== 'string' || seen.has(r.champion))
      throw new Error('Invalid score identity')
    seen.add(r.champion)
    for (const k of ['matchupMean', 'synergyMean']) if (r[k] !== null) finite(r[k], k)
    for (const k of ['matchupRoles', 'synergyRoles'])
      if (!Number.isSafeInteger(r[k]) || r[k] < 0) throw new Error('Invalid role count')
  }
  return rows
}

export function exactAvailableRoleCounterexample(score) {
  const truth = [spreadBlock([1, 3, 2, 4]), spreadBlock([4, 2, 3, 1], 'matchup', 'JUNGLE')]
  const dropped = [truth[0], { ...truth[1], spreadsPp: [null, 2, 3, 1] }]
  const trueScores = checkedScores(score, truth),
    selectedScores = checkedScores(score, dropped)
  if (trueScores.length !== 4 || selectedScores.length !== 4)
    throw new Error('Missing counterexample scores')
  const a = trueScores.find((r) => r.champion === 'Synthetic 0'),
    b = selectedScores.find((r) => r.champion === 'Synthetic 0')
  if (!a || !b || Math.abs(a.matchupMean) > 1e-10 || !(b.matchupMean > 0.5) || b.matchupRoles !== 1)
    throw new Error('Available-role counterexample failed')
  return {
    trueEqualTwoRoleScores: trueScores.map((r) => ({
      hero: r.champion,
      score: r.matchupMean,
      roles: r.matchupRoles
    })),
    oneUnavailableRoleScores: selectedScores.map((r) => ({
      hero: r.champion,
      score: r.matchupMean,
      roles: r.matchupRoles
    })),
    conclusion:
      'one missing poor role can make a previously average hero look above-reference; other references also move'
  }
}

/** Exact two-outcome shared-baseline errors, not a delta-method approximation.
 * For b=.5 the opponent odds expectation g(a,b)=a, so a common estimated-own
 * baseline error shifts EVERY cell equally and contributes zero spread.
 */
export function sharedBaselineCounterexamples() {
  const commonErrorPp = weights.map(() => 5)
  const independentNoise = (x) =>
    x.reduce((s, v, i) => s + weights[i] * (1 - weights[i]) * v * v, 0)
  const g = (a, b) => (a * (1 - b)) / (a * (1 - b) + (1 - a) * b)
  const opponentBaselines = [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
  const plus = opponentBaselines.map((b) => 100 * (g(0.55, b) - g(0.5, b)))
  const minus = opponentBaselines.map((b) => 100 * (g(0.45, b) - g(0.5, b)))
  const halfDifference = plus.map((x, i) => (x - minus[i]) / 2)
  const meanErrors = plus.map((x, i) => (x + minus[i]) / 2)
  return {
    model:
      'own marginal baseline has equally likely .45/.55 errors around .50; no pair-rate sampling error',
    commonShift: {
      trueAcrossCellSamplingVariancePp2: weightedVariance(commonErrorPp),
      incorrectlyIndependentDiagonalNoisePp2: independentNoise(commonErrorPp),
      trueSdPp: 0,
      wrongSignedVarianceAfterDiagonalSubtractionPp2: -independentNoise(commonErrorPp)
    },
    varyingOpponentBaselines: {
      exactCenteredAcrossCellNoiseVariancePp2: weightedVariance(halfDifference),
      diagonalOnlyNoiseVariancePp2: independentNoise(halfDifference),
      baselineNonlinearityMeanBiasSpreadPp: Math.sqrt(weightedVariance(meanErrors))
    },
    notEvidenceOfCurrentImplementationError:
      'current core subtracts pair-rate noise only; examples demonstrate why future baseline uncertainty cannot be inserted as independent diagonal noise',
    implication:
      'baseline covariance cannot be handled by simply adding its marginal variances as independent cell noise; conditional-fixed-baseline output is not unconditional uncertainty'
  }
}

export function createCohort() {
  const center = shape.reduce((s, x, i) => s + weights[i] * x, 0),
    unitSd = Math.sqrt(weightedVariance(shape))
  const normalized = shape.map((x) => (x - center) / unitSd)
  const blocks = []
  for (const mode of ['matchup', 'synergy'])
    for (const otherRole of roles) {
      if (mode === 'synergy' && otherRole === 'MID') continue
      const roleIndex = blocks.length
      const heroes = Array.from({ length: 20 }, (_, h) => {
        const group = Math.floor(h / 5),
          wide = group >= 2,
          lowN = group % 2 === 0
        const trueSd =
          (wide ? 1.7 : 0.35) + 0.12 * (h % 5) + 0.08 * Math.sin(h * 0.7 + roleIndex * 0.8)
        const cells = normalized.map((x, i) => {
          const baseline = 0.48 + 0.035 * Math.cos(i * 0.65 + roleIndex * 0.2 + h * 0.05)
          return {
            target: `Target ${i}`,
            pickRate: weights[i],
            trueDeltaPp: x * trueSd,
            baseline,
            trueWinRate: baseline + (x * trueSd) / 100,
            nFactor: 0.75 + 0.07 * i
          }
        })
        return {
          champion: `Synthetic ${h}`,
          group: `${wide ? 'wide' : 'narrow'}-${lowN ? 'lowN' : 'highN'}`,
          lowN,
          trueSd,
          cells
        }
      })
      blocks.push({ ownRole: 'MID', otherRole, mode, heroes })
    }
  return blocks
}

function summarizeScores(rows, truth, stats, logSamples) {
  const lookup = new Map(rows.map((r) => [r.champion, r]))
  for (const r of truth) {
    const p = lookup.get(r.champion)
    stats.rows++
    if (p?.matchupRoles === 5 && p?.synergyRoles === 4) stats.completeRows++
    for (const k of ['matchupMean', 'synergyMean']) {
      stats.candidateAxes++
      if (!p || p[k] === null) continue
      const y = finite(p[k], 'axis score'),
        x = finite(r[k], 'truth axis score')
      stats.retainedAxes++
      stats.squaredError += (y - x) ** 2
      stats.sumX += x
      stats.sumY += y
      stats.sumXX += x * x
      stats.sumYY += y * y
      stats.sumXY += x * y
      const logN = logSamples.get(r.champion)
      stats.sumN += logN
      stats.sumNN += logN * logN
      stats.sumNY += logN * y
      stats.minN = Math.min(stats.minN, logN)
      stats.maxN = Math.max(stats.maxN, logN)
    }
  }
  for (const field of ['matchupMean', 'synergyMean'])
    for (let i = 0; i < truth.length; i++)
      for (let j = i + 1; j < truth.length; j++) {
        stats.candidatePairs++
        const a = lookup.get(truth[i].champion)?.[field],
          b = lookup.get(truth[j].champion)?.[field]
        if (a === undefined || b === undefined || a === null || b === null) continue
        stats.retainedPairs++
        const product = (truth[i][field] - truth[j][field]) * (a - b)
        stats.correctPairs += product > 0 ? 1 : product === 0 ? 0.5 : 0
      }
}
function scoreStats() {
  return {
    rows: 0,
    completeRows: 0,
    candidateAxes: 0,
    retainedAxes: 0,
    squaredError: 0,
    sumX: 0,
    sumY: 0,
    sumXX: 0,
    sumYY: 0,
    sumXY: 0,
    sumN: 0,
    sumNN: 0,
    sumNY: 0,
    minN: Infinity,
    maxN: -Infinity,
    candidatePairs: 0,
    retainedPairs: 0,
    correctPairs: 0
  }
}
function finishScores(s) {
  const n = s.retainedAxes,
    den = Math.sqrt((n * s.sumXX - s.sumX ** 2) * (n * s.sumYY - s.sumY ** 2))
  const sampleDen = Math.sqrt(
    Math.max(0, n * s.sumNN - s.sumN ** 2) * Math.max(0, n * s.sumYY - s.sumY ** 2)
  )
  return {
    retainedAxisFraction: s.retainedAxes / s.candidateAxes,
    completeNineRoleRowFraction: s.completeRows / s.rows,
    rmseOnRetainedAxes: n ? Math.sqrt(s.squaredError / n) : null,
    scoreVsLogSampleCountCorrelation:
      s.maxN - s.minN > 1e-12 && sampleDen > 0 ? (n * s.sumNY - s.sumN * s.sumY) / sampleDen : null,
    pooledPearsonOnRetainedAxes: den > 0 ? (n * s.sumXY - s.sumX * s.sumY) / den : null,
    retainedPairFraction: s.retainedPairs / s.candidatePairs,
    correctlyOrderedFractionAmongRetainedPairs: s.retainedPairs
      ? s.correctPairs / s.retainedPairs
      : null,
    correctlyOrderedPairsOverAllCandidatePairs: s.correctPairs / s.candidatePairs
  }
}

export function simulateFinitePipeline(
  estimate,
  score,
  { repetitions = 200, seed = 20261109, heterogeneous = true } = {}
) {
  if (
    typeof estimate !== 'function' ||
    typeof score !== 'function' ||
    !Number.isSafeInteger(repetitions) ||
    repetitions < 2 ||
    !Number.isSafeInteger(seed)
  )
    throw new Error('Invalid audit configuration')
  const cohort = createCohort(),
    random = randomGenerator(seed)
  const truthBlocks = cohort.map((b) =>
    spreadBlock(
      b.heroes.map((h) => h.trueSd),
      b.mode,
      b.otherRole
    )
  )
  const truth = checkedScores(score, truthBlocks)
  if (truth.length !== 20 || truth.some((r) => r.matchupRoles !== 5 || r.synergyRoles !== 4))
    throw new Error('Incomplete known truth scores')
  const rawStats = scoreStats(),
    momStats = scoreStats(),
    rawOnMomRetainedStats = scoreStats(),
    truthStats = scoreStats(),
    groups = new Map()
  const logSamples = new Map(
    cohort[0].heroes.map((h) => [h.champion, Math.log(heterogeneous && h.lowN ? 100 : 4000)])
  )
  summarizeScores(truth, truth, truthStats, logSamples)
  let finiteRefs = 0,
    blockCount = 0,
    nonemptyBlockCount = 0,
    fallbackReferences = 0,
    selectedTruthShift = 0,
    estimatedReferenceShift = 0,
    signedMean = 0,
    signedM2 = 0
  for (let rep = 0; rep < repetitions; rep++) {
    const rawBlocks = [],
      momBlocks = []
    let signedError = 0
    for (const b of cohort) {
      const raw = [],
        corrected = [],
        selectedTruth = []
      for (const h of b.heroes) {
        const cells = h.cells.map((c) => {
          const games = Math.floor((heterogeneous && h.lowN ? 100 : 4000) * c.nFactor)
          const reportedWinRate = binomial(games, c.trueWinRate, random) / games
          return {
            target: c.target,
            pickRate: c.pickRate,
            games,
            reportedWinRate,
            deltaPp: 100 * (reportedWinRate - c.baseline)
          }
        })
        const result = estimate(cells, options)
        const signed = finite(result.signedCorrectedVariancePp2, 'signed variance')
        const obs = finite(result.observedVariancePp2, 'observed variance'),
          noise = finite(result.samplingVariancePp2, 'noise variance')
        if (obs < 0 || noise < 0 || Math.abs(obs - noise - signed) > 1e-8)
          throw new Error('Invalid variance decomposition')
        if (signed <= 0 && result.correctedSdPp !== null)
          throw new Error('Nonpositive variance was clipped into an SD')
        if (
          signed > 0 &&
          Math.abs(finite(result.correctedSdPp, 'corrected SD') ** 2 - signed) > 1e-8
        )
          throw new Error('Invalid SD transformation')
        const sd = signed > 0 ? result.correctedSdPp : null
        raw.push(Math.sqrt(obs))
        corrected.push(sd)
        const group = groups.get(h.group) ?? { candidateCells: 0, retainedCells: 0 }
        group.candidateCells++
        if (sd !== null) {
          group.retainedCells++
          selectedTruth.push(h.trueSd)
        }
        groups.set(h.group, group)
        signedError += signed - h.trueSd ** 2
      }
      const fullTruthMean = average(b.heroes.map((h) => h.trueSd)),
        finiteSpreads = corrected.filter((v) => v !== null)
      finiteRefs += finiteSpreads.length
      blockCount++
      if (finiteSpreads.length < 2) fallbackReferences++
      if (finiteSpreads.length) {
        nonemptyBlockCount++
        selectedTruthShift += average(selectedTruth) - fullTruthMean
        estimatedReferenceShift += average(finiteSpreads) - fullTruthMean
      }
      rawBlocks.push(spreadBlock(raw, b.mode, b.otherRole))
      momBlocks.push(spreadBlock(corrected, b.mode, b.otherRole))
    }
    const rawRows = checkedScores(score, rawBlocks),
      momRows = checkedScores(score, momBlocks)
    summarizeScores(rawRows, truth, rawStats, logSamples)
    summarizeScores(momRows, truth, momStats, logSamples)
    const momLookup = new Map(momRows.map((r) => [r.champion, r]))
    const rawRestricted = rawRows.map((r) => {
      const m = momLookup.get(r.champion)
      return {
        ...r,
        matchupMean: m && m.matchupMean !== null ? r.matchupMean : null,
        synergyMean: m && m.synergyMean !== null ? r.synergyMean : null
      }
    })
    summarizeScores(rawRestricted, truth, rawOnMomRetainedStats, logSamples)
    const error = signedError / (20 * 9),
      diff = error - signedMean
    signedMean += diff / (rep + 1)
    signedM2 += diff * (error - signedMean)
  }
  const mcSE = Math.sqrt(signedM2 / (repetitions - 1) / repetitions)
  return {
    scenario: heterogeneous
      ? 'same-true-spreads-unequal-cell-samples'
      : 'same-true-spreads-equal-cell-samples',
    repetitions,
    seed,
    sampling: 'exact synthetic binomial counts, independent targets/roles, fixed baselines and PR',
    sampleSizes: heterogeneous
      ? '~75-124 vs ~3000-4960 per target'
      : '~3000-4960 per target for every hero',
    signedVarianceCheck: {
      meanErrorPp2: signedMean,
      standardErrorOfMonteCarloMeanPp2: mcSE,
      approximate95MonteCarloMeanErrorIntervalPp2: [
        signedMean - 1.96 * mcSE,
        signedMean + 1.96 * mcSE
      ],
      interpretation: 'simulation-mean error, not a champion confidence interval'
    },
    referenceSelection: {
      candidateHeroes: 20,
      meanFiniteHeroesPerBlock: finiteRefs / blockCount,
      emptyReferenceBlocks: blockCount - nonemptyBlockCount,
      lessThanTwoFiniteReferenceBlocks: fallbackReferences,
      meanTrueSdShiftOfSelectedReferencePp: nonemptyBlockCount
        ? selectedTruthShift / nonemptyBlockCount
        : null,
      meanEstimatedSdShiftOfFiniteReferencePp: nonemptyBlockCount
        ? estimatedReferenceShift / nonemptyBlockCount
        : null,
      groupCoverage: [...groups].map(([group, s]) => ({
        group,
        retainedBlockFraction: s.retainedCells / s.candidateCells
      }))
    },
    knownTruth: {
      candidateHeroes: 20,
      completeRoles: 9,
      axes: 'reverse sample-z per block, available-role mean',
      scoreVsLogSampleCountCorrelation: finishScores(truthStats).scoreVsLogSampleCountCorrelation
    },
    rawBlockZ: finishScores(rawStats),
    momFiniteOnlyBlockZ: finishScores(momStats),
    pairedComparisonSameRetainedAxes: {
      rawRmse: finishScores(rawOnMomRetainedStats).rmseOnRetainedAxes,
      momRmse: finishScores(momStats).rmseOnRetainedAxes,
      rawPearson: finishScores(rawOnMomRetainedStats).pooledPearsonOnRetainedAxes,
      momPearson: finishScores(momStats).pooledPearsonOnRetainedAxes,
      rawPairOrderAgreement:
        finishScores(rawOnMomRetainedStats).correctlyOrderedFractionAmongRetainedPairs,
      momPairOrderAgreement: finishScores(momStats).correctlyOrderedFractionAmongRetainedPairs,
      retainedAxisFraction: finishScores(momStats).retainedAxisFraction,
      interpretation:
        'identical retained hero-axis membership; raw scores are not restandardized on that subset'
    },
    warning:
      'retained-only quality must be read alongside candidate coverage; dropping unknown axes is not full-cohort accuracy'
  }
}

export function auditFiniteReferenceBias(estimate, score, config = {}) {
  const nonlinear = exactNonlinearCounterexample(),
    availableRole = exactAvailableRoleCounterexample(score),
    baseline = sharedBaselineCounterexamples()
  if (
    nonlinear.meanSignedVariance !== 1 ||
    !(nonlinear.meanSdConditionalOnRetention > 1) ||
    baseline.commonShift.trueAcrossCellSamplingVariancePp2 > 1e-20
  )
    throw new Error('Exact audit invariant failed')
  return {
    source: 'synthetic-only controlled bias audit; no real heroes or games',
    conclusion:
      'single-block signed variance unbiasedness does not validate sqrt/nonrandom-drop/reference-z/available-role aggregation',
    exactNonlinearCounterexample: nonlinear,
    exactAvailableRoleCounterexample: availableRole,
    sharedBaselineErrors: baseline,
    simulations: [
      simulateFinitePipeline(estimate, score, { ...config, heterogeneous: false }),
      simulateFinitePipeline(estimate, score, { ...config, heterogeneous: true })
    ]
  }
}

async function main() {
  if (process.argv.length !== 4) throw new Error('Expected compiled noise and scorer module paths')
  const noise = await import(pathToFileURL(resolve(process.argv[2])).href),
    scoring = await import(pathToFileURL(resolve(process.argv[3])).href)
  process.stdout.write(
    JSON.stringify(
      auditFiniteReferenceBias(
        noise.estimateInteractionSpread,
        scoring.scoreBlindabilityFromSpreads
      ),
      null,
      2
    ) + '\n'
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    process.stdout.write(JSON.stringify({ error: 'finite-reference-bias-audit-failed' }) + '\n')
    process.exitCode = 1
  })
