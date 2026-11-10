import { type InteractionSpreadEstimate, type InteractionSpreadOptions } from './sampling-noise'
import {
  DRAFT_ROLES,
  type DraftRole,
  type InteractionDataScope,
  type InteractionMode
} from './scoring'

export interface ScopedSpreadBlock {
  champion: string
  ownRole: DraftRole
  otherRole: DraftRole
  mode: InteractionMode
  scope: InteractionDataScope
  settings: InteractionSpreadOptions
  estimate: InteractionSpreadEstimate
}

export interface RoleBalancedSpreadAxis {
  status: 'available' | 'noise-dominated' | 'incomplete'
  expectedRoles: number
  usableRoles: number
  noiseDominatedRoles: DraftRole[]
  missingOrPartialRoles: DraftRole[]
  meanObservedVariancePp2: number | null
  meanSamplingVariancePp2: number | null
  meanSignedCorrectedVariancePp2: number | null
  correctedRmsSpreadPp: number | null
}

/** Independently defined estimator: average the SIGNED within-role MoM
 * variances with equal role weights, then take the root only for a positive
 * signed point estimate. This is NOT a statistical-identification guarantee.
 * Not the source site's per-block reverse-z scoring or fitted pair shrinkage.
 * Shared matches across roles do not break linearity of expectation, but DO
 * prevent constructing independent-role confidence intervals from this result.
 */
export function aggregateNoiseCorrectedAxes(
  ownRole: DraftRole,
  blocks: readonly ScopedSpreadBlock[]
) {
  if (!DRAFT_ROLES.includes(ownRole) || !blocks.length)
    throw new Error('A valid role and scoped blocks are required')
  const scope = { ...blocks[0].scope }
  const champion = blocks[0].champion
  if (typeof champion !== 'string' || !champion.trim())
    throw new Error('Explicit champion is required')
  const settings = { ...blocks[0].settings }
  const scopeKeys = [
    'source',
    'interactionPatch',
    'playRatePatch',
    'region',
    'queueId',
    'population'
  ] as const
  const settingKeys = [
    'pickRateFloor',
    'pickRateWeighted',
    'noiseModel',
    'varianceConvention'
  ] as const
  if (
    scopeKeys.some((k) =>
      k === 'queueId'
        ? !Number.isSafeInteger(scope[k]) || scope[k] < 0
        : typeof scope[k] !== 'string' || !scope[k].trim()
    )
  )
    throw new Error('Explicit scope is required')
  if (
    !Number.isFinite(settings.pickRateFloor) ||
    settings.pickRateFloor < 0 ||
    settings.pickRateFloor > 1 ||
    typeof settings.pickRateWeighted !== 'boolean' ||
    !['binomial-proportion-plugin', 'maximum-binomial-variance'].includes(settings.noiseModel) ||
    !['meta-distribution', 'reliability-weighted-sample'].includes(settings.varianceConvention)
  )
    throw new Error('Invalid spread settings')
  const byMode = {
    matchup: new Map<DraftRole, InteractionSpreadEstimate>(),
    synergy: new Map<DraftRole, InteractionSpreadEstimate>()
  }
  for (const block of blocks) {
    if (block.champion !== champion) throw new Error('Cannot mix champions')
    if (
      block.ownRole !== ownRole ||
      !DRAFT_ROLES.includes(block.otherRole) ||
      !['matchup', 'synergy'].includes(block.mode) ||
      (block.mode === 'synergy' && block.otherRole === ownRole)
    )
      throw new Error('Invalid interaction position')
    if (
      scopeKeys.some((k) => scope[k] !== block.scope[k]) ||
      settingKeys.some((k) => settings[k] !== block.settings[k])
    )
      throw new Error('Cannot mix spread scopes or settings')
    const e = block.estimate
    if (
      e.method !== 'conditional-independent-cell-mom-v1' ||
      e.assumptions !== 'fixed-baselines-fixed-pick-rates-independent-pair-errors' ||
      e.noiseModel !== settings.noiseModel ||
      e.varianceConvention !== settings.varianceConvention
    )
      throw new Error('Inconsistent spread estimator')
    if (byMode[block.mode].has(block.otherRole)) throw new Error('Duplicate interaction position')
    for (const v of [e.observedVariancePp2, e.samplingVariancePp2, e.signedCorrectedVariancePp2])
      if (v !== null && !Number.isFinite(v)) throw new Error('Nonfinite spread variance')
    if (
      (e.observedVariancePp2 !== null && e.observedVariancePp2 < 0) ||
      (e.samplingVariancePp2 !== null && e.samplingVariancePp2 < 0)
    )
      throw new Error('Negative observed or sampling variance')
    if (
      e.signedCorrectedVariancePp2 !== null &&
      (e.observedVariancePp2 === null ||
        e.samplingVariancePp2 === null ||
        Math.abs(e.signedCorrectedVariancePp2 - (e.observedVariancePp2 - e.samplingVariancePp2)) >
          1e-8)
    )
      throw new Error('Inconsistent variance decomposition')
    if (
      e.status === 'available' &&
      (e.signedCorrectedVariancePp2 === null || e.signedCorrectedVariancePp2 <= 0)
    )
      throw new Error('Inconsistent available spread')
    if (
      e.status === 'noise-dominated' &&
      (e.signedCorrectedVariancePp2 === null || e.signedCorrectedVariancePp2 > 0)
    )
      throw new Error('Inconsistent unresolved spread')
    byMode[block.mode].set(block.otherRole, e)
  }
  function axis(mode: InteractionMode): RoleBalancedSpreadAxis {
    const expected = DRAFT_ROLES.filter((r) => mode === 'matchup' || r !== ownRole)
    const result: RoleBalancedSpreadAxis = {
      status: 'incomplete',
      expectedRoles: expected.length,
      usableRoles: 0,
      noiseDominatedRoles: [],
      missingOrPartialRoles: [],
      meanObservedVariancePp2: null,
      meanSamplingVariancePp2: null,
      meanSignedCorrectedVariancePp2: null,
      correctedRmsSpreadPp: null
    }
    const usable: InteractionSpreadEstimate[] = []
    for (const role of expected) {
      const e = byMode[mode].get(role)
      if (
        !e ||
        !['available', 'noise-dominated'].includes(e.status) ||
        e.weightedCoverage !== 1 ||
        e.signedCorrectedVariancePp2 === null ||
        e.observedVariancePp2 === null ||
        e.samplingVariancePp2 === null
      ) {
        result.missingOrPartialRoles.push(role)
        continue
      }
      usable.push(e)
      if (e.status === 'noise-dominated') result.noiseDominatedRoles.push(role)
    }
    result.usableRoles = usable.length
    if (usable.length !== expected.length) return result // never average only the surviving roles
    result.meanObservedVariancePp2 =
      usable.reduce((s, e) => s + e.observedVariancePp2!, 0) / expected.length
    result.meanSamplingVariancePp2 =
      usable.reduce((s, e) => s + e.samplingVariancePp2!, 0) / expected.length
    result.meanSignedCorrectedVariancePp2 =
      usable.reduce((s, e) => s + e.signedCorrectedVariancePp2!, 0) / expected.length
    if (result.meanSignedCorrectedVariancePp2 <= 0) {
      result.status = 'noise-dominated'
      return result
    }
    result.status = 'available'
    result.correctedRmsSpreadPp = Math.sqrt(result.meanSignedCorrectedVariancePp2)
    return result
  }
  return {
    method: 'conditional-role-balanced-rms-mom-v1' as const,
    champion,
    ownRole,
    scope: Object.freeze(scope),
    settings: Object.freeze(settings),
    matchup: axis('matchup'),
    synergy: axis('synergy')
  }
}
