/** Bounded synthetic-only whole-pipeline audit. No network or real dataset IO.
 * node this-file.mjs <compiled posterior-spread.js> <compiled sampling-noise.js> <compiled scoring.js>
 * Refit every role's EB prior in every replicate; never compare only one hero or
 * use original-site coordinates/real champion names as a fitting target.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createCohort } from './audit-finite-reference-bias.mjs'

const grid = [
  0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8
]
const noiseOptions = {
  pickRateFloor: 0,
  pickRateWeighted: true,
  noiseModel: 'binomial-proportion-plugin',
  varianceConvention: 'reliability-weighted-sample'
}
function finite(x, label) {
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Nonfinite ${label}`)
  return x
}
function avg(xs) {
  return xs.reduce((s, x) => s + x, 0) / xs.length
}
function rng(seed) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}
function binomial(n, p, random) {
  let w = 0
  for (let i = 0; i < n; i++) if (random() < p) w++
  return w
}
function sd(xs) {
  const mean = avg(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1))
}
function spreadBlock(b, spreads) {
  return {
    ownRole: 'MID',
    mode: b.mode,
    otherRole: b.otherRole,
    champions: b.heroes.map((h) => h.champion),
    championPickRates: b.heroes.map(() => 1 / b.heroes.length),
    spreadsPp: spreads
  }
}
function scoreRows(score, blocks) {
  const rows = score('MID', blocks, 0),
    seen = new Set()
  if (!Array.isArray(rows)) throw new Error('Invalid scorer result')
  for (const r of rows) {
    if (seen.has(r.champion)) throw new Error('Duplicate score')
    seen.add(r.champion)
    for (const key of ['matchupMean', 'synergyMean']) if (r[key] !== null) finite(r[key], 'score')
  }
  return rows
}
function checkBounds(x) {
  if (!x || finite(x.lower, 'lower bound') > finite(x.upper, 'upper bound'))
    throw new Error('Invalid posterior bounds')
  return x
}
function checkedPosterior(fit, profiles, options) {
  const result = fit(profiles, options)
  if (!result || !Array.isArray(result.profiles) || result.profiles.length !== profiles.length)
    throw new Error('Posterior dropped fixed cohort')
  const expected = new Set(profiles.map((p) => p.champion)),
    seen = new Set()
  for (const p of result.profiles) {
    if (!expected.has(p.champion) || seen.has(p.champion))
      throw new Error('Invalid posterior identity')
    seen.add(p.champion)
    for (const k of [
      'meanZ',
      'posteriorMeanSdPp',
      'rootExpectedVariancePp',
      'rootExpectedVariancePluginZ',
      'posteriorZeroTauProbability',
      'posteriorPriorKl'
    ])
      finite(p[k], k)
    if (
      p.posteriorMeanSdPp < 0 ||
      p.rootExpectedVariancePp < 0 ||
      p.posteriorZeroTauProbability < 0 ||
      p.posteriorZeroTauProbability > 1 ||
      p.posteriorPriorKl < -1e-9
    )
      throw new Error('Invalid posterior moment')
    checkBounds(p.sdInterval95)
    checkBounds(p.zInterval95)
    checkBounds(p.simultaneousRoleZBounds)
  }
  if (
    !result.prior ||
    typeof result.prior.converged !== 'boolean' ||
    !Number.isSafeInteger(result.prior.iterations)
  )
    throw new Error('Invalid prior diagnostics')
  finite(result.degenerateReferenceDrawFraction, 'degenerate reference fraction')
  return result
}
function roleOptions({ draws, seed, mode }) {
  return {
    tauGridPp: grid,
    priorStrength: 1,
    varianceConvention: 'reliability-weighted-sample',
    draws,
    seed,
    axisRoleCount: mode === 'synergy' ? 4 : 5,
    maxIterations: 1000,
    tolerance: 1e-8
  }
}
function posteriorAxes(roleResults, field = 'meanZ') {
  const rows = new Map()
  for (const b of roleResults)
    for (const p of b.result.profiles) {
      const row = rows.get(p.champion) ?? {
        champion: p.champion,
        matchup: [],
        synergy: [],
        matchupLower: [],
        matchupUpper: [],
        synergyLower: [],
        synergyUpper: []
      }
      row[b.mode].push(p[field])
      row[`${b.mode}Lower`].push(p.simultaneousRoleZBounds.lower)
      row[`${b.mode}Upper`].push(p.simultaneousRoleZBounds.upper)
      rows.set(p.champion, row)
    }
  return [...rows.values()].map((r) => {
    if (r.matchup.length !== 5 || r.synergy.length !== 4)
      throw new Error('Incomplete posterior role set')
    return {
      champion: r.champion,
      matchupMean: avg(r.matchup),
      synergyMean: avg(r.synergy),
      matchupRoles: 5,
      synergyRoles: 4,
      matchupBounds:
        field === 'meanZ' ? { lower: avg(r.matchupLower), upper: avg(r.matchupUpper) } : undefined,
      synergyBounds:
        field === 'meanZ' ? { lower: avg(r.synergyLower), upper: avg(r.synergyUpper) } : undefined
    }
  })
}
function statistics() {
  return {
    axes: 0,
    retained: 0,
    square: 0,
    sx: 0,
    sy: 0,
    sxx: 0,
    syy: 0,
    sxy: 0,
    sn: 0,
    snn: 0,
    sny: 0,
    minN: Infinity,
    maxN: -Infinity,
    pairs: 0,
    retainedPairs: 0,
    correctPairs: 0,
    rows: 0,
    complete: 0,
    covered: 0,
    rangeCount: 0,
    rangeWidth: 0
  }
}
function accumulate(stats, prediction, truth, logN) {
  const lookup = new Map(prediction.map((r) => [r.champion, r]))
  for (const t of truth) {
    const p = lookup.get(t.champion)
    stats.rows++
    if (p?.matchupRoles === 5 && p?.synergyRoles === 4) stats.complete++
    for (const field of ['matchupMean', 'synergyMean']) {
      stats.axes++
      if (!p || p[field] === null) continue
      const x = finite(t[field], 'true axis'),
        y = finite(p[field], 'predicted axis'),
        n = logN.get(t.champion)
      stats.retained++
      stats.square += (y - x) ** 2
      stats.sx += x
      stats.sy += y
      stats.sxx += x * x
      stats.syy += y * y
      stats.sxy += x * y
      stats.sn += n
      stats.snn += n * n
      stats.sny += n * y
      stats.minN = Math.min(stats.minN, n)
      stats.maxN = Math.max(stats.maxN, n)
      const bounds = p[field === 'matchupMean' ? 'matchupBounds' : 'synergyBounds']
      if (bounds) {
        stats.rangeCount++
        stats.covered += x >= bounds.lower && x <= bounds.upper ? 1 : 0
        stats.rangeWidth += bounds.upper - bounds.lower
      }
    }
  }
  for (const f of ['matchupMean', 'synergyMean'])
    for (let i = 0; i < truth.length; i++)
      for (let j = i + 1; j < truth.length; j++) {
        stats.pairs++
        const a = lookup.get(truth[i].champion)?.[f],
          b = lookup.get(truth[j].champion)?.[f]
        if (a === undefined || b === undefined || a === null || b === null) continue
        stats.retainedPairs++
        const product = (truth[i][f] - truth[j][f]) * (a - b)
        stats.correctPairs += product > 0 ? 1 : product === 0 ? 0.5 : 0
      }
}
function finish(s) {
  const n = s.retained,
    den = Math.sqrt(Math.max(0, n * s.sxx - s.sx * s.sx) * Math.max(0, n * s.syy - s.sy * s.sy)),
    nd = Math.sqrt(Math.max(0, n * s.snn - s.sn * s.sn) * Math.max(0, n * s.syy - s.sy * s.sy))
  return {
    retainedAxisFraction: s.retained / s.axes,
    completeNineRoleRowFraction: s.complete / s.rows,
    rmseOnRetainedAxes: n ? Math.sqrt(s.square / n) : null,
    pearsonOnRetainedAxes: den > 1e-12 ? (n * s.sxy - s.sx * s.sy) / den : null,
    scoreVsLogSampleCountCorrelation:
      s.maxN - s.minN > 1e-12 && nd > 0 ? (n * s.sny - s.sn * s.sy) / nd : null,
    retainedPairFraction: s.retainedPairs / s.pairs,
    pairOrderAgreementOnRetained: s.retainedPairs ? s.correctPairs / s.retainedPairs : null,
    correctlyOrderedPairsOverAllCandidatePairs: s.correctPairs / s.pairs,
    conditionalModelAxisRangeCoverage: s.rangeCount ? s.covered / s.rangeCount : null,
    meanConditionalModelAxisRangeWidth: s.rangeCount ? s.rangeWidth / s.rangeCount : null
  }
}

export function simulatePosteriorScenario(
  fit,
  estimate,
  score,
  {
    repetitions = 50,
    draws = 256,
    seed = 20261109,
    heterogeneous = true,
    workingNoise = 'maximum-binomial'
  } = {}
) {
  if (
    typeof fit !== 'function' ||
    typeof estimate !== 'function' ||
    typeof score !== 'function' ||
    !Number.isSafeInteger(repetitions) ||
    repetitions < 2 ||
    !Number.isSafeInteger(draws) ||
    draws < 64 ||
    !Number.isSafeInteger(seed) ||
    !['maximum-binomial', 'known-binomial'].includes(workingNoise)
  )
    throw new Error('Invalid pipeline audit options')
  const cohort = createCohort(),
    random = rng(seed),
    sumSquares = cohort[0].heroes[0].cells.reduce((s, c) => s + c.pickRate * c.pickRate, 0)
  const truthBlocks = cohort.map((b) =>
      spreadBlock(
        b,
        b.heroes.map((h) => h.trueSd / Math.sqrt(1 - sumSquares))
      )
    ),
    truth = scoreRows(score, truthBlocks)
  if (truth.length !== 20 || truth.some((r) => r.matchupRoles !== 5 || r.synergyRoles !== 4))
    throw new Error('Incomplete known true cohort')
  const logN = new Map(
    cohort[0].heroes.map((h) => [h.champion, Math.log(heterogeneous && h.lowN ? 100 : 4000)])
  )
  const stats = {
    raw: statistics(),
    momFinite: statistics(),
    posteriorMeanZ: statistics(),
    pluginRootExpectedVarianceZ: statistics()
  }
  const truthStats = statistics()
  accumulate(truthStats, truth, truth, logN)
  let blocks = 0,
    unconverged = 0,
    maxIterations = 0,
    topWeight = 0,
    kl = 0,
    profileCount = 0,
    roleCoverage = 0,
    roleRangeWidth = 0,
    sdCoverage = 0,
    degenerate = 0
  for (let rep = 0; rep < repetitions; rep++) {
    const rawBlocks = [],
      momBlocks = [],
      posteriorResults = []
    for (let r = 0; r < cohort.length; r++) {
      const b = cohort[r],
        profiles = [],
        raw = [],
        mom = []
      for (const h of b.heroes) {
        const noisy = h.cells.map((c) => {
          const games = Math.floor((heterogeneous && h.lowN ? 100 : 4000) * c.nFactor),
            p = binomial(games, c.trueWinRate, random) / games
          return {
            target: c.target,
            pickRate: c.pickRate,
            games,
            reportedWinRate: p,
            knownSamplingVariancePp2: (10000 * c.trueWinRate * (1 - c.trueWinRate)) / games,
            deltaPp: 100 * (p - c.baseline)
          }
        })
        const m = estimate(noisy, noiseOptions)
        finite(m.observedSdPp, 'raw spread')
        if (m.correctedSdPp !== null) finite(m.correctedSdPp, 'MoM spread')
        raw.push(m.observedSdPp)
        mom.push(m.correctedSdPp)
        profiles.push({
          champion: h.champion,
          cells: noisy.map((c) => ({
            target: c.target,
            deltaPp: c.deltaPp,
            pickRate: c.pickRate,
            samplingVariancePp2:
              workingNoise === 'known-binomial' ? c.knownSamplingVariancePp2 : 2500 / c.games
          }))
        })
      }
      const result = checkedPosterior(
        fit,
        profiles,
        roleOptions({ draws, seed: seed + rep * 7919 + r * 101, mode: b.mode })
      )
      posteriorResults.push({ mode: b.mode, result })
      rawBlocks.push(spreadBlock(b, raw))
      momBlocks.push(spreadBlock(b, mom))
      blocks++
      unconverged += result.prior.converged ? 0 : 1
      maxIterations = Math.max(maxIterations, result.prior.iterations)
      topWeight += finite(result.prior.upperGridWeight, 'upper grid weight')
      degenerate += result.degenerateReferenceDrawFraction
      const trueBlock = scoreRows(score, [truthBlocks[r]]),
        trueLookup = new Map(
          trueBlock.map((x) => [
            x.champion,
            x[b.mode === 'matchup' ? 'matchupMean' : 'synergyMean']
          ])
        )
      const trueSds = new Map(
        b.heroes.map((h) => [h.champion, h.trueSd / Math.sqrt(1 - sumSquares)])
      )
      for (const p of result.profiles) {
        profileCount++
        kl += p.posteriorPriorKl
        const z = trueLookup.get(p.champion),
          s = trueSds.get(p.champion)
        roleCoverage += z >= p.zInterval95.lower && z <= p.zInterval95.upper ? 1 : 0
        roleRangeWidth += p.zInterval95.upper - p.zInterval95.lower
        sdCoverage += s >= p.sdInterval95.lower && s <= p.sdInterval95.upper ? 1 : 0
      }
    }
    accumulate(stats.raw, scoreRows(score, rawBlocks), truth, logN)
    accumulate(stats.momFinite, scoreRows(score, momBlocks), truth, logN)
    accumulate(stats.posteriorMeanZ, posteriorAxes(posteriorResults), truth, logN)
    accumulate(
      stats.pluginRootExpectedVarianceZ,
      posteriorAxes(posteriorResults, 'rootExpectedVariancePluginZ'),
      truth,
      logN
    )
  }
  return {
    scenario: heterogeneous ? 'unequal-N-independent-of-latent-variance' : 'equal-N',
    repetitions,
    drawsPerRole: draws,
    seed,
    candidateHeroes: 20,
    roles: 9,
    generatedData:
      'known fixed finite latent interaction vectors; exact binomial outcomes; fixed baselines and PR; shapes deliberately not exactly normal-random-effects',
    EBWorkingNoise:
      workingNoise === 'known-binomial'
        ? 'known true 10000*p*(1-p)/n; oracle noise-sensitivity control available only in synthetic data'
        : '2500/n strictly positive binomial noise bound; not an epsilon and not claimed exact measurement variance',
    truthScoreSampleCountCorrelation: finish(truthStats).scoreVsLogSampleCountCorrelation,
    pipelines: Object.fromEntries(Object.entries(stats).map(([name, s]) => [name, finish(s)])),
    priorDiagnostics: {
      unconvergedRoleFraction: unconverged / blocks,
      maxIterationsSeen: maxIterations,
      meanUpperGridWeight: topWeight / blocks
    },
    conditionalModelDiagnostics: {
      roleZInterval95Coverage: roleCoverage / profileCount,
      roleSdInterval95Coverage: sdCoverage / profileCount,
      meanRoleZIntervalWidth: roleRangeWidth / profileCount,
      meanPosteriorPriorKl: kl / profileCount,
      meanDegenerateReferenceDrawFraction: degenerate / blocks
    },
    interpretation:
      'frequentist coverage here is empirical under this synthetic shape/binomial experiment; intervals remain fitted-prior conditional model approximations, not general real-match guarantees'
  }
}

export function auditUninformativeCohort(
  fit,
  { repetitions = 50, draws = 256, seed = 20261109 } = {}
) {
  if (typeof fit !== 'function' || !Number.isSafeInteger(repetitions) || repetitions < 2)
    throw new Error('Invalid weak-information audit')
  const template = createCohort()[0].heroes[0].cells
  const controls = []
  for (const identical of [true, false]) {
    const profiles = Array.from({ length: 20 }, (_, h) => ({
      champion: `Synthetic ${h}`,
      cells: template.map((c, i) => ({
        target: c.target,
        pickRate: c.pickRate,
        deltaPp: (identical ? 1 : 0.3 + h * 0.1) * [-1, -0.7, -0.3, 0, 0.2, 0.5, 0.8, 1.2][i],
        samplingVariancePp2: 2500
      }))
    }))
    const cumulative = profiles.map(() => 0)
    let rms = 0,
      pluginSd = 0,
      width = 0,
      coverZero = 0,
      kl = 0,
      unconverged = 0
    for (let rep = 0; rep < repetitions; rep++) {
      const result = checkedPosterior(
          fit,
          profiles,
          roleOptions({ draws, seed: seed + rep * 7919, mode: 'matchup' })
        ),
        lookup = new Map(result.profiles.map((p) => [p.champion, p]))
      if (!result.prior.converged) unconverged++
      const z = profiles.map((p, h) => {
        const x = lookup.get(p.champion)
        cumulative[h] += x.meanZ
        width += x.zInterval95.upper - x.zInterval95.lower
        coverZero += x.zInterval95.lower <= 0 && x.zInterval95.upper >= 0 ? 1 : 0
        kl += x.posteriorPriorKl
        return x.meanZ
      })
      rms += Math.sqrt(avg(z.map((x) => x * x)))
      pluginSd += sd(result.profiles.map((p) => p.rootExpectedVariancePluginZ))
    }
    const integrated = cumulative.map((x) => x / repetitions)
    controls.push({
      control: identical
        ? 'identical-evidence-exchangeability'
        : 'near-flat-likelihood-small-differences',
      meaning:
        'constructed weak-information likelihood diagnostic, not downsampled real games or an accuracy contest',
      theoreticalMeanZ: identical ? 0 : null,
      meanAcrossHeroSdOfPluginZ: pluginSd / repetitions,
      meanAcrossHeroRmsOfMeanZ: rms / repetitions,
      rmsOfRepeatedMeanZ: Math.sqrt(avg(integrated.map((x) => x * x))),
      maxAbsoluteRepeatedMeanZ: Math.max(...integrated.map(Math.abs)),
      fractionRoleZIntervalsContainingZero: coverZero / (repetitions * 20),
      meanZIntervalWidth: width / (repetitions * 20),
      meanPosteriorPriorKl: kl / (repetitions * 20),
      unconvergedFitFraction: unconverged / repetitions
    })
  }
  return {
    repetitions,
    drawsPerRole: draws,
    controls,
    warning:
      'small mean-z expresses weak evidence; no requirement for perfect low-N ranking, no restandardization of these posterior means'
  }
}

export function auditPosteriorPipeline(fit, estimate, score, config = {}) {
  return {
    source:
      'synthetic-only bounded full-pipeline audit; no original-site targets or real hero data',
    comparisonCaution:
      'raw, EB mean-z and plugin use the full fixed cohort; MoM RMSE/correlation are conditional on retained axes, so coverage and all-candidate pair ordering must accompany them',
    scoreDefinition:
      'expected per-draw full-cohort reverse sample-z, then fixed five/four role mean; not z of expected SD',
    intervalCaution:
      '256 draws give coarse Bonferroni tail quantiles; model ranges are Monte Carlo approximations and omit fitted-prior/baseline/real-match covariance uncertainty',
    scenarios: [
      simulatePosteriorScenario(fit, estimate, score, { ...config, heterogeneous: false }),
      simulatePosteriorScenario(fit, estimate, score, { ...config, heterogeneous: true }),
      simulatePosteriorScenario(fit, estimate, score, {
        ...config,
        heterogeneous: true,
        workingNoise: 'known-binomial'
      })
    ],
    weakInformation: auditUninformativeCohort(fit, config)
  }
}
async function main() {
  if (process.argv.length !== 5)
    throw new Error('Expected compiled posterior, noise and scoring modules')
  const p = await import(pathToFileURL(resolve(process.argv[2])).href),
    n = await import(pathToFileURL(resolve(process.argv[3])).href),
    s = await import(pathToFileURL(resolve(process.argv[4])).href)
  process.stdout.write(
    JSON.stringify(
      auditPosteriorPipeline(
        p.estimatePosteriorRoleSpreads,
        n.estimateInteractionSpread,
        s.scoreBlindabilityFromSpreads
      ),
      null,
      2
    ) + '\n'
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(() => {
    process.stdout.write(JSON.stringify({ error: 'posterior-pipeline-audit-failed' }) + '\n')
    process.exitCode = 1
  })
