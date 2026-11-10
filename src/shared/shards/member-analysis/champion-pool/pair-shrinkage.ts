/** Independent first pair-level model, NOT the author's unpublished hierarchy.
 * Gaussian working errors, fixed WR baselines, and a zero-centred role prior.
 * See the normal random-effects setup in the Stan User's Guide (meta-analysis).
 * Shared prior scale is estimated from THIS role matrix, never website scores.
 */
import type { ScopedInteractionBlock } from './scoring'

export interface PairShrinkageObservation {
  key: string
  deltaPp: number
  games: number
  fitWeight?: number // dependence bookkeeping, not additional match counts
}

export const DEFAULT_PAIR_TAU_GRID_PP: readonly number[] = [
  ...Array.from({ length: 201 }, (_, i) => i / 20),
  12,
  16,
  20,
  32,
  50,
  100
]

export function estimateRolePairShrinkage(
  observations: readonly PairShrinkageObservation[],
  tauGridPp: readonly number[] = DEFAULT_PAIR_TAU_GRID_PP
) {
  if (observations.length < 3 || observations.length > 200000)
    throw new Error('At least three observed pairs required')
  const keys = new Set<string>()
  for (const o of observations) {
    if (
      typeof o.key !== 'string' ||
      !o.key ||
      keys.has(o.key) ||
      !Number.isFinite(o.deltaPp) ||
      Math.abs(o.deltaPp) > 100 ||
      !Number.isSafeInteger(o.games) ||
      o.games <= 0 ||
      !Number.isFinite(o.fitWeight ?? 1) ||
      (o.fitWeight ?? 1) <= 0 ||
      (o.fitWeight ?? 1) > 1
    )
      throw new Error('Invalid/duplicate pair observation; missing pairs are not zeros')
    keys.add(o.key)
  }
  if (
    tauGridPp.length < 2 ||
    tauGridPp.length > 5000 ||
    tauGridPp[0] !== 0 ||
    tauGridPp.some(
      (t, i) => !Number.isFinite(t) || t < 0 || t > 100 || (i > 0 && t <= tauGridPp[i - 1])
    )
  )
    throw new Error('Explicit increasing latent-SD grid starting at zero required')
  const rows = [...observations].sort((a, b) => a.key.localeCompare(b.key))
  const noise = rows.map((o) => 2500 / o.games)
  // This is a positive maximum-binomial working variance, not an assertion of
  // exact Gaussian errors or automatically conservative posterior uncertainty.
  const objective = tauGridPp.map((tau) => {
    const t = tau * tau
    return rows.reduce((s, o, i) => {
      const variance = t + noise[i]
      return s + 0.5 * (o.fitWeight ?? 1) * (Math.log(variance) + o.deltaPp ** 2 / variance)
    }, 0)
  })
  let selected = 0
  for (let i = 1; i < objective.length; i++) if (objective[i] < objective[selected]) selected = i
  const tauPp = tauGridPp[selected],
    t = tauPp * tauPp
  return {
    method: 'role-normal-normal-pair-shrinkage-v1' as const,
    assumptions:
      'zero-centred shared role prior; fixed baselines; Gaussian working errors; dependent reports not independent match evidence' as const,
    noiseModel: 'maximum-binomial-variance-2500-over-n' as const,
    uncertainty:
      'conditional model variance only; excludes fitted-prior, baseline and shared-match covariance uncertainty' as const,
    fit: {
      tauPp,
      priorVariancePp2: t,
      gridPp: [...tauGridPp],
      selectedGridIndex: selected,
      negativeLogLikelihood: objective[selected],
      objective,
      atZeroBoundary: selected === 0,
      atUpperGridBoundary: selected === tauGridPp.length - 1,
      observedPairs: rows.length,
      fitWeightSum: rows.reduce((s, o) => s + (o.fitWeight ?? 1), 0)
    },
    cells: rows.map((o, i) => {
      const shrinkWeight = t / (t + noise[i])
      return {
        key: o.key,
        rawDeltaPp: o.deltaPp,
        games: o.games,
        samplingVariancePp2: noise[i],
        shrinkWeight,
        shrunkDeltaPp: shrinkWeight * o.deltaPp,
        modelPosteriorVariancePp2: (t * noise[i]) / (t + noise[i])
      }
    })
  }
}

/** Fill the pair-level matrix, then let the existing source-compatible scorer
 * mix alpha*shrunk+(1-alpha)*raw. Do NOT subtract row MoM noise afterwards.
 */
export function shrinkInteractionBlock(
  block: ScopedInteractionBlock,
  gamesByCell: readonly (readonly (number | null)[])[],
  tauGridPp: readonly number[] = DEFAULT_PAIR_TAU_GRID_PP
) {
  const n = block.champions.length,
    m = block.targets.length
  if (
    new Set(block.champions).size !== n ||
    new Set(block.targets).size !== m ||
    block.rawPp.length !== n ||
    gamesByCell.length !== n ||
    block.rawPp.some((row) => row.length !== m) ||
    gamesByCell.some((row) => row.length !== m)
  )
    throw new Error('Unaligned pair matrix/count dimensions')
  const ownIndex = new Map(block.champions.map((x, i) => [x, i]))
  const targetIndex = new Map(block.targets.map((x, i) => [x, i]))
  const observations: PairShrinkageObservation[] = []
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m; j++) {
      const value = block.rawPp[i][j],
        games = gamesByCell[i][j]
      if (games !== null && (!Number.isSafeInteger(games) || games < 0))
        throw new Error('Invalid pair count')
      if (value === null) continue
      if (block.champions[i] === block.targets[j])
        throw new Error('Impossible duplicate-hero interaction in ranked pair matrix')
      if (games === null || games === 0) throw new Error('Known interaction without a usable count')
      let fitWeight = 1
      if (block.mode === 'matchup' && block.ownRole === block.otherRole) {
        const r = ownIndex.get(block.targets[j]),
          c = targetIndex.get(block.champions[i])
        if (r !== undefined && c !== undefined && block.rawPp[r][c] !== null) fitWeight = 0.5
      }
      observations.push({ key: `${i}:${j}`, deltaPp: value, games, fitWeight })
    }
  const model = estimateRolePairShrinkage(observations, tauGridPp)
  const lookup = new Map(model.cells.map((c) => [c.key, c.shrunkDeltaPp]))
  const shrunkPp = block.rawPp.map((row, i) =>
    row.map((v, j) => (v === null ? null : lookup.get(`${i}:${j}`)!))
  )
  return {
    block: {
      ...block,
      champions: [...block.champions],
      targets: [...block.targets],
      championPickRates: [...block.championPickRates],
      targetPickRates: [...block.targetPickRates],
      rawPp: block.rawPp.map((row) => [...row]),
      shrunkPp
    },
    model
  }
}
