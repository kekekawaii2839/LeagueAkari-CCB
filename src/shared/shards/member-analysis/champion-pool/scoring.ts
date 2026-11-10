/** Independent implementation of the publicly inspected Pool Designer blindability steps.
 * It consumes interaction estimates; it does NOT fit the site's unpublished shrinkage model.
 * Units of matrix entries are percentage points, not probability or statistical significance.
 */
export const DRAFT_ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP'] as const
export type DraftRole = (typeof DRAFT_ROLES)[number]
export type InteractionMode = 'matchup' | 'synergy'

export interface InteractionBlock {
  mode: InteractionMode
  ownRole: DraftRole
  otherRole: DraftRole
  champions: string[]
  championPickRates: number[] // own-role display eligibility; NOT the z reference subset
  targets: string[]
  targetPickRates: number[] // role shares, 0..1, from the selected population
  rawPp: (number | null)[][]
  shrunkPp: (number | null)[][]
}

export interface BlindabilitySettings {
  shrinkAlpha: number
  pickRateFloor: number
  pickRateWeighted: boolean
}

export interface InteractionDataScope {
  source: string
  interactionPatch: string
  playRatePatch: string
  region: string
  queueId: number
  population: string
}

export interface ScopedInteractionBlock extends InteractionBlock {
  scope: InteractionDataScope
}

/** Real adapters must retain block provenance. The unscoped scorer is also used
 * by synthetic audits. Interaction and play-rate patch are deliberately separate.
 */
export function scoreScopedBlindability(
  ownRole: DraftRole,
  blocks: ScopedInteractionBlock[],
  settings: BlindabilitySettings,
  pool: readonly string[] = []
) {
  if (!blocks.length) throw new Error('No scoped interaction dataset')
  const scope = { ...blocks[0].scope }
  const scopeKeys = [
    'source',
    'interactionPatch',
    'playRatePatch',
    'region',
    'queueId',
    'population'
  ] as const
  const stringKeys = [
    'source',
    'interactionPatch',
    'playRatePatch',
    'region',
    'population'
  ] as const
  if (
    stringKeys.some((key) => typeof scope[key] !== 'string' || !scope[key].trim()) ||
    !Number.isSafeInteger(scope.queueId) ||
    scope.queueId < 0
  ) {
    throw new Error('Explicit dataset provenance required')
  }
  if (blocks.some((block) => scopeKeys.some((key) => block.scope[key] !== scope[key]))) {
    throw new Error('Cannot mix dataset sources or sampling scopes')
  }
  return { scope: Object.freeze(scope), rows: scoreBlindability(ownRole, blocks, settings, pool) }
}

export interface BlindabilityScore {
  champion: string
  matchupMean: number | null
  synergyMean: number | null
  aggregate: number | null
  laneMatchup: number | null
  outOfLaneMatchup: number | null
  laneSynergy: number | null
  outOfLaneSynergy: number | null
  matchupRoles: number
  synergyRoles: number
  blocks: { mode: InteractionMode; otherRole: DraftRole; sdPp: number | null; z: number | null }[]
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function sampleSd(values: number[], weights?: number[]): number | null {
  if (values.length < 2) return null
  const w = weights ?? values.map(() => 1)
  const total = w.reduce((sum, value) => sum + value, 0)
  if (total <= 0) return null
  const center = values.reduce((sum, value, i) => sum + value * w[i], 0) / total
  const denominator = total - w.reduce((sum, value) => sum + value * value, 0) / total
  if (denominator <= 0) return null
  return Math.sqrt(
    values.reduce((sum, value, i) => sum + w[i] * (value - center) ** 2, 0) / denominator
  )
}

function validateBlock(block: InteractionBlock) {
  const n = block.targets.length
  if (
    block.championPickRates.length !== block.champions.length ||
    block.championPickRates.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
  ) {
    throw new Error('Invalid own-position population shares')
  }
  if (
    new Set(block.champions).size !== block.champions.length ||
    new Set(block.targets).size !== n
  ) {
    throw new Error('Duplicate champion-role slot')
  }
  if (
    block.targetPickRates.length !== n ||
    block.targetPickRates.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
  ) {
    throw new Error('Invalid target population shares')
  }
  for (const matrix of [block.rawPp, block.shrunkPp]) {
    if (
      matrix.length !== block.champions.length ||
      matrix.some(
        (row) =>
          row.length !== n ||
          row.some((x) => x !== null && (!Number.isFinite(x) || Math.abs(x) > 100))
      )
    ) {
      throw new Error('Invalid interaction matrix')
    }
  }
}

export function scoreBlindability(
  ownRole: DraftRole,
  blocks: InteractionBlock[],
  settings: BlindabilitySettings,
  pool: readonly string[] = []
): BlindabilityScore[] {
  if (
    ![settings.shrinkAlpha, settings.pickRateFloor].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 1
    )
  ) {
    throw new RangeError('Alpha and pick-rate floor must be in 0..1')
  }
  const seen = new Set<string>()
  const prepared: PrecomputedSpreadBlock[] = []
  for (const block of blocks) {
    validateBlock(block)
    if (block.ownRole !== ownRole || (block.mode === 'synergy' && block.otherRole === ownRole)) {
      throw new Error('Block belongs to a different position or impossible same-role synergy')
    }
    const key = `${block.mode}:${block.otherRole}`
    if (seen.has(key)) throw new Error('Duplicate interaction block')
    seen.add(key)
    const indices = block.targets.flatMap((_, i) =>
      block.targetPickRates[i] >= settings.pickRateFloor ? [i] : []
    )
    const weighted =
      settings.pickRateWeighted && indices.reduce((s, i) => s + block.targetPickRates[i], 0) > 0
    const spreads = block.champions.map((_, row) => {
      if (indices.length < 3) return null
      const values: number[] = []
      const weights: number[] = []
      for (const col of indices) {
        const raw = block.rawPp[row][col]
        const shrunk = block.shrunkPp[row][col]
        // At alpha endpoints the unused matrix must not invalidate a known cell.
        const delta =
          settings.shrinkAlpha === 0
            ? raw
            : settings.shrinkAlpha === 1
              ? shrunk
              : raw === null || shrunk === null
                ? null
                : settings.shrinkAlpha * shrunk + (1 - settings.shrinkAlpha) * raw
        if (delta === null) continue
        values.push(delta)
        weights.push(weighted ? block.targetPickRates[col] : 1)
      }
      return sampleSd(values, weights)
    })
    prepared.push({
      ownRole: block.ownRole,
      otherRole: block.otherRole,
      mode: block.mode,
      champions: block.champions,
      championPickRates: block.championPickRates,
      spreadsPp: spreads
    })
  }
  return scoreBlindabilityFromSpreads(ownRole, prepared, settings.pickRateFloor, pool)
}

export interface PrecomputedSpreadBlock {
  ownRole: DraftRole
  otherRole: DraftRole
  mode: InteractionMode
  champions: string[]
  championPickRates: number[]
  spreadsPp: (number | null)[]
}

/** The same source-compatible normalization used after measuring interaction SD.
 * Null means unavailable, never a zero-spread substitute. The reference is the
 * finite subset of the supplied role roster, not a universal safe-pick threshold.
 */
export function standardizeBlindabilitySpreads(spreads: readonly (number | null)[]) {
  if (spreads.some((v) => v !== null && (!Number.isFinite(v) || v < 0 || v > 200)))
    throw new Error('Invalid spread in percentage points')
  const finite = spreads.filter((v): v is number => v !== null)
  const center = mean(finite),
    spread = sampleSd(finite)
  const fallback = spread === null || spread < 1e-9
  const denominator = fallback ? 1 : spread
  return {
    candidateCount: spreads.length,
    finiteCount: finite.length,
    meanSdPp: center,
    sampleSdOfSdPp: spread,
    denominator,
    fallbackDenominatorUsed: fallback,
    zScores: spreads.map((v) =>
      v === null || center === null ? null : -(v - center) / denominator
    )
  }
}

/** Restores the inspected source's scoring structure: reverse-z each role block,
 * then average the AVAILABLE role z scores. Partial rows are deliberately retained
 * as in the source; callers must expose coverage rather than call them full axes.
 */
export function scoreBlindabilityFromSpreads(
  ownRole: DraftRole,
  blocks: readonly PrecomputedSpreadBlock[],
  displayPickRateFloor: number,
  pool: readonly string[] = []
): BlindabilityScore[] {
  if (
    !DRAFT_ROLES.includes(ownRole) ||
    !Number.isFinite(displayPickRateFloor) ||
    displayPickRateFloor < 0 ||
    displayPickRateFloor > 1
  )
    throw new Error('Invalid role or display floor')
  const seen = new Set<string>()
  const results = new Map<string, BlindabilityScore>()
  const ownPickRates = new Map<string, number>()
  for (const block of blocks) {
    if (
      block.ownRole !== ownRole ||
      !DRAFT_ROLES.includes(block.otherRole) ||
      !['matchup', 'synergy'].includes(block.mode) ||
      (block.mode === 'synergy' && block.otherRole === ownRole)
    )
      throw new Error('Invalid spread block role')
    const key = `${block.mode}:${block.otherRole}`
    if (seen.has(key)) throw new Error('Duplicate interaction block')
    seen.add(key)
    if (
      block.champions.length !== block.championPickRates.length ||
      block.champions.length !== block.spreadsPp.length ||
      new Set(block.champions).size !== block.champions.length ||
      block.championPickRates.some((p) => !Number.isFinite(p) || p < 0 || p > 1)
    )
      throw new Error('Invalid spread block roster')
    const spreads = block.spreadsPp
    const reference = standardizeBlindabilitySpreads(spreads)
    block.champions.forEach((champion, i) => {
      const previousRate = ownPickRates.get(champion)
      if (previousRate !== undefined && previousRate !== block.championPickRates[i])
        throw new Error('Inconsistent own-position pick rates across blocks')
      ownPickRates.set(champion, block.championPickRates[i])
      const score = results.get(champion) ?? {
        champion,
        matchupMean: null,
        synergyMean: null,
        aggregate: null,
        laneMatchup: null,
        outOfLaneMatchup: null,
        laneSynergy: null,
        outOfLaneSynergy: null,
        matchupRoles: 0,
        synergyRoles: 0,
        blocks: []
      }
      score.blocks.push({
        mode: block.mode,
        otherRole: block.otherRole,
        sdPp: spreads[i],
        z: reference.zScores[i]
      })
      results.set(champion, score)
    })
  }
  const laneRoles: DraftRole[] = ownRole === 'ADC' || ownRole === 'SUP' ? ['ADC', 'SUP'] : [ownRole]
  for (const row of results.values()) {
    const valid = row.blocks.filter((b): b is typeof b & { z: number } => b.z !== null)
    const matchup = valid.filter((b) => b.mode === 'matchup')
    const synergy = valid.filter((b) => b.mode === 'synergy')
    row.matchupRoles = matchup.length
    row.synergyRoles = synergy.length
    row.matchupMean = mean(matchup.map((b) => b.z))
    row.synergyMean = mean(synergy.map((b) => b.z))
    row.aggregate = mean(valid.map((b) => b.z))
    row.laneMatchup = mean(matchup.filter((b) => laneRoles.includes(b.otherRole)).map((b) => b.z))
    row.outOfLaneMatchup = mean(
      matchup.filter((b) => !laneRoles.includes(b.otherRole)).map((b) => b.z)
    )
    row.laneSynergy =
      ownRole === 'ADC' || ownRole === 'SUP'
        ? mean(synergy.filter((b) => laneRoles.includes(b.otherRole)).map((b) => b.z))
        : null
    row.outOfLaneSynergy = mean(
      synergy.filter((b) => !laneRoles.includes(b.otherRole)).map((b) => b.z)
    )
  }
  return (
    [...results.values()]
      // The source omits wholly unscorable rows, even when retained in a pool.
      // Partial one-axis scores remain useful in the table, but not a full 2-D plot.
      .filter((row) => row.aggregate !== null)
      .filter(
        (row) =>
          ownPickRates.get(row.champion)! >= displayPickRateFloor || pool.includes(row.champion)
      )
      .sort(
        (a, b) =>
          (b.aggregate ?? -Infinity) - (a.aggregate ?? -Infinity) ||
          a.champion.localeCompare(b.champion)
      )
  )
}
