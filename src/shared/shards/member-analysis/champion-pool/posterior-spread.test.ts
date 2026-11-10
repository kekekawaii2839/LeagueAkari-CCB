import { describe, expect, it } from 'vitest'

import {
  type PosteriorSpreadOptions,
  type PosteriorSpreadProfile,
  estimatePosteriorRoleSpreads,
  posteriorMomentsAtTau
} from './posterior-spread'
import { standardizeBlindabilitySpreads } from './scoring'

const options: PosteriorSpreadOptions = {
  tauGridPp: [0, 0.2, 0.5, 1, 2, 4],
  priorStrength: 1,
  varianceConvention: 'reliability-weighted-sample',
  draws: 256,
  seed: 20261109,
  axisRoleCount: 5
}
const cells = [
  { target: 'A', deltaPp: -1, samplingVariancePp2: 1, pickRate: 0.5 },
  { target: 'B', deltaPp: 1, samplingVariancePp2: 1, pickRate: 0.5 }
]
function cohort(): PosteriorSpreadProfile[] {
  return [0, 0.2, 0.5, 1, 2, 3].map((scale, i) => ({
    champion: `S${i}`,
    cells: cells.map((c) => ({ ...c, deltaPp: c.deltaPp * scale }))
  }))
}

describe('complete-cohort empirical-Bayes role spread estimation', () => {
  it('integrates the common row intercept and conditional theta covariance analytically', () => {
    const r = posteriorMomentsAtTau(cells, 1, 'meta-distribution')
    expect(r.mu).toBe(0)
    expect(r.muVariance).toBe(1)
    expect(r.means).toEqual([-0.5, 0.5])
    expect(r.conditionalVariance).toEqual([0.5, 0.5])
    expect(r.expectedVariancePp2).toBe(0.5)
    expect(r.logLikelihood).toBeCloseTo(-0.5 * (2 * Math.log(2) + 1))
    expect(posteriorMomentsAtTau(cells, 1, 'reliability-weighted-sample').expectedVariancePp2).toBe(
      1
    )
  })
  it('retains the shared-intercept covariance term with unequal measurement variances', () => {
    const c = [
      { ...cells[0], deltaPp: -2 },
      { ...cells[1], deltaPp: 2, samplingVariancePp2: 3 }
    ]
    expect(posteriorMomentsAtTau(c, 1, 'meta-distribution').expectedVariancePp2).toBeCloseTo(7 / 9)
  })
  it('tau=0 is one posterior hypothesis, not a missing observation or proof of perfect stability', () => {
    const r = posteriorMomentsAtTau(cells, 0, 'meta-distribution')
    expect(r.expectedVariancePp2).toBe(0)
    expect(r.means[0]).toBe(r.means[1])
    const result = estimatePosteriorRoleSpreads(cohort(), options)
    expect(result.profiles).toHaveLength(6)
    expect(
      result.profiles.every((r) => Number.isFinite(r.meanZ) && r.rootExpectedVariancePp > 0)
    ).toBe(true)
  })
  it('keeps the full reference for every draw and does not restandardize posterior mean scores', () => {
    const result = estimatePosteriorRoleSpreads(cohort(), options)
    expect(result.referenceSize).toBe(6)
    expect(result.profiles.reduce((s, p) => s + p.meanZ, 0)).toBeCloseTo(0, 12)
    const scores = result.profiles.map((p) => p.meanZ),
      mean = scores.reduce((s, x) => s + x, 0) / scores.length
    const sd = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / (scores.length - 1))
    expect(sd).toBeLessThan(1)
    expect(
      result.profiles.every(
        (p) =>
          p.simultaneousRoleZBounds.lower <= p.zInterval95.lower &&
          p.simultaneousRoleZBounds.upper >= p.zInterval95.upper
      )
    ).toBe(true)
  })
  it('an uninformative exchangeable cohort is not forced into unit-spread rankings', () => {
    const profiles = cohort().map((p) => ({
      ...p,
      cells: p.cells.map((c) => ({ ...c, deltaPp: 0, samplingVariancePp2: 1e6 }))
    }))
    const r = estimatePosteriorRoleSpreads(profiles, { ...options, draws: 1024 })
    expect(r.profiles.every((p) => Math.abs(p.meanZ) < 0.2)).toBe(true)
    expect(r.profiles.every((p) => p.zInterval95.lower < 0 && p.zInterval95.upper > 0)).toBe(true)
    const restandardized = standardizeBlindabilitySpreads(
      r.profiles.map((p) => p.posteriorMeanSdPp)
    ).zScores
    expect(Math.max(...restandardized.map((x) => Math.abs(x!)))).toBeGreaterThan(0.5)
  })
  it('fits a normalized strictly positive role prior and records the penalized EM objective', () => {
    const r = estimatePosteriorRoleSpreads(cohort(), options)
    expect(r.prior.weights.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 12)
    expect(r.prior.weights.every((x) => x > 0)).toBe(true)
    for (let i = 1; i < r.prior.objectiveHistory.length; i++)
      expect(r.prior.objectiveHistory[i]).toBeGreaterThanOrEqual(
        r.prior.objectiveHistory[i - 1] - 1e-8
      )
    expect(r.prior.converged).toBe(true)
  })
  it('is deterministic, permutation invariant and does not mutate caller data', () => {
    const p = cohort(),
      before = structuredClone(p),
      a = estimatePosteriorRoleSpreads(p, options),
      b = estimatePosteriorRoleSpreads(
        [...p].reverse().map((p) => ({ ...p, cells: [...p.cells].reverse() })),
        options
      )
    expect(a).toEqual(b)
    expect(p).toEqual(before)
  })
  it('is invariant to a common within-row shift without modifying spread or scores', () => {
    const p = cohort(),
      a = estimatePosteriorRoleSpreads(p, options),
      b = estimatePosteriorRoleSpreads(
        p.map((p) => ({ ...p, cells: p.cells.map((c) => ({ ...c, deltaPp: c.deltaPp + 2.31 })) })),
        options
      )
    for (let i = 0; i < a.profiles.length; i++) {
      expect(a.profiles[i].meanZ).toBeCloseTo(b.profiles[i].meanZ, 10)
      expect(a.profiles[i].rootExpectedVariancePp).toBeCloseTo(
        b.profiles[i].rootExpectedVariancePp,
        10
      )
    }
  })
  it('does not silently regularize zero/invalid variances or omit incomplete profiles', () => {
    for (const v of [0, -1, NaN, Infinity])
      expect(() =>
        estimatePosteriorRoleSpreads(
          [
            { champion: 'A', cells: [{ ...cells[0], samplingVariancePp2: v }, cells[1]] },
            cohort()[0]
          ],
          options
        )
      ).toThrow()
    expect(() => estimatePosteriorRoleSpreads([cohort()[0], cohort()[0]], options)).toThrow()
    expect(() =>
      estimatePosteriorRoleSpreads(
        [{ champion: 'incomplete', cells: [cells[0]] }, cohort()[0]],
        options
      )
    ).toThrow()
    expect(() =>
      estimatePosteriorRoleSpreads(cohort(), { ...options, tauGridPp: [0, 1, 1] })
    ).toThrow()
  })
  it('reports nonconvergence rather than silently pretending prior fitting finished', () => {
    const r = estimatePosteriorRoleSpreads(cohort(), { ...options, maxIterations: 1 })
    expect(r.prior.converged).toBe(false)
    expect(r.prior.iterations).toBe(1)
  })
})
