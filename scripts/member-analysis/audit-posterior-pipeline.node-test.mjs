import assert from 'node:assert/strict'
import test from 'node:test'

import { auditUninformativeCohort, simulatePosteriorScenario } from './audit-posterior-pipeline.mjs'

function referenceEstimate(cells, options) {
  const W = cells.reduce((s, c) => s + c.pickRate, 0),
    a = cells.map((c) => c.pickRate / W),
    mean = cells.reduce((s, c, i) => s + a[i] * c.deltaPp, 0),
    D =
      options.varianceConvention === 'meta-distribution' ? 1 : 1 - a.reduce((s, x) => s + x * x, 0)
  const variance = cells.reduce((s, c, i) => s + a[i] * (c.deltaPp - mean) ** 2, 0) / D
  const noise =
    cells.reduce(
      (s, c, i) =>
        s +
        (a[i] * (1 - a[i]) * 10000 * c.reportedWinRate * (1 - c.reportedWinRate)) / (c.games - 1),
      0
    ) / D
  return {
    observedSdPp: Math.sqrt(variance),
    correctedSdPp: variance > noise ? Math.sqrt(variance - noise) : null
  }
}
function referenceScore(_role, blocks) {
  const rows = new Map()
  for (const b of blocks) {
    const xs = b.spreadsPp.filter((x) => x !== null),
      mean = xs.reduce((s, x) => s + x, 0) / xs.length,
      sd =
        xs.length > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1)) : 0
    b.champions.forEach((champion, i) => {
      const r = rows.get(champion) ?? { champion, matchup: [], synergy: [] },
        x = b.spreadsPp[i]
      if (x !== null) r[b.mode].push(-(x - mean) / (sd < 1e-9 ? 1 : sd))
      rows.set(champion, r)
    })
  }
  const avg = (x) => (x.length ? x.reduce((s, y) => s + y, 0) / x.length : null)
  return [...rows.values()]
    .filter((r) => r.matchup.length + r.synergy.length)
    .map((r) => ({
      champion: r.champion,
      matchupMean: avg(r.matchup),
      synergyMean: avg(r.synergy),
      matchupRoles: r.matchup.length,
      synergyRoles: r.synergy.length
    }))
}
function mockPosterior(profiles) {
  return {
    profiles: profiles.map((p) => ({
      champion: p.champion,
      meanZ: 0,
      posteriorMeanSdPp: 1,
      rootExpectedVariancePp: 1.1,
      rootExpectedVariancePluginZ: 0,
      posteriorZeroTauProbability: 0.1,
      posteriorPriorKl: 0,
      sdInterval95: { lower: 0, upper: 4 },
      zInterval95: { lower: -3, upper: 3 },
      simultaneousRoleZBounds: { lower: -4, upper: 4 }
    })),
    prior: { converged: true, iterations: 5, upperGridWeight: 0.01 },
    degenerateReferenceDrawFraction: 0
  }
}

test('audit covers the whole twenty-hero cohort and all nine roles without reward for low-N perfect ranking', () => {
  const r = simulatePosteriorScenario(mockPosterior, referenceEstimate, referenceScore, {
    repetitions: 2,
    draws: 64
  })
  assert.equal(r.candidateHeroes, 20)
  assert.equal(r.roles, 9)
  assert.equal(r.pipelines.posteriorMeanZ.retainedAxisFraction, 1)
  assert.equal(r.pipelines.posteriorMeanZ.completeNineRoleRowFraction, 1)
  assert.ok(r.pipelines.posteriorMeanZ.rmseOnRetainedAxes > 0)
  assert.equal(r.pipelines.posteriorMeanZ.pairOrderAgreementOnRetained, 0.5)
  assert.equal(r.pipelines.posteriorMeanZ.conditionalModelAxisRangeCoverage, 1)
  assert.equal(r.priorDiagnostics.unconvergedRoleFraction, 0)
})

test('identical weak information is an exchangeability control, not a fabricated real downsample', () => {
  const r = auditUninformativeCohort(mockPosterior, { repetitions: 2, draws: 64 })
  assert.equal(r.controls.length, 2)
  assert.equal(r.controls[0].theoreticalMeanZ, 0)
  assert.equal(r.controls[0].rmsOfRepeatedMeanZ, 0)
  assert.equal(r.controls[1].fractionRoleZIntervalsContainingZero, 1)
  assert.match(r.controls[0].meaning, /not downsampled real games/)
})

test('audit rejects loss of candidates instead of silently selecting an easier reference subset', () => {
  const dropped = (p) => {
    const r = mockPosterior(p)
    r.profiles.pop()
    return r
  }
  assert.throws(
    () => auditUninformativeCohort(dropped, { repetitions: 2, draws: 64 }),
    /dropped fixed cohort/
  )
})

test('audit rejects nonfinite posterior means and malformed bounds', () => {
  const bad = (p) => {
    const r = mockPosterior(p)
    r.profiles[0].meanZ = NaN
    return r
  }
  assert.throws(() => auditUninformativeCohort(bad, { repetitions: 2, draws: 64 }), /Nonfinite/)
  const bounds = (p) => {
    const r = mockPosterior(p)
    r.profiles[0].zInterval95 = { lower: 2, upper: 1 }
    return r
  }
  assert.throws(
    () => auditUninformativeCohort(bounds, { repetitions: 2, draws: 64 }),
    /Invalid posterior bounds/
  )
})

test('nonconverged prior fits remain visible rather than being called successful', () => {
  const notConverged = (p) => {
    const r = mockPosterior(p)
    r.prior.converged = false
    return r
  }
  const r = auditUninformativeCohort(notConverged, { repetitions: 2, draws: 64 })
  assert.equal(r.controls[0].unconvergedFitFraction, 1)
})

test('constant sample sizes do not invent sample-count correlation', () => {
  const r = simulatePosteriorScenario(mockPosterior, referenceEstimate, referenceScore, {
    repetitions: 2,
    draws: 64,
    heterogeneous: false
  })
  assert.equal(r.pipelines.raw.scoreVsLogSampleCountCorrelation, null)
  assert.equal(r.pipelines.posteriorMeanZ.scoreVsLogSampleCountCorrelation, null)
})

test('known-noise control uses true synthetic binomial variance without silently changing data or seed', () => {
  const measured = []
  const capture = (profiles) => {
    measured.push(profiles[0].cells.map((c) => c.samplingVariancePp2))
    return mockPosterior(profiles)
  }
  simulatePosteriorScenario(capture, referenceEstimate, referenceScore, {
    repetitions: 2,
    draws: 64
  })
  const maximum = measured[0]
  measured.length = 0
  const control = simulatePosteriorScenario(capture, referenceEstimate, referenceScore, {
    repetitions: 2,
    draws: 64,
    workingNoise: 'known-binomial'
  })
  const known = measured[0]
  assert.ok(known.every((v, i) => v > 0 && v <= maximum[i]))
  assert.ok(known.some((v, i) => v < maximum[i]))
  assert.match(control.EBWorkingNoise, /oracle noise-sensitivity control/)
})

test('invalid bounded simulation options fail closed', () => {
  assert.throws(
    () =>
      simulatePosteriorScenario(mockPosterior, referenceEstimate, referenceScore, {
        repetitions: 1
      }),
    /Invalid/
  )
  assert.throws(
    () => simulatePosteriorScenario(mockPosterior, referenceEstimate, referenceScore, { draws: 1 }),
    /Invalid/
  )
  assert.throws(
    () =>
      simulatePosteriorScenario(mockPosterior, referenceEstimate, referenceScore, { seed: NaN }),
    /Invalid/
  )
  assert.throws(
    () =>
      simulatePosteriorScenario(mockPosterior, referenceEstimate, referenceScore, {
        workingNoise: 'unknown'
      }),
    /Invalid/
  )
})
