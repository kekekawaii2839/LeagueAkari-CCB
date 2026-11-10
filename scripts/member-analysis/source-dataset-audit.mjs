/** Offline reference decoder for caller-supplied public artifacts, not a product API.
 * Consuming the source's precomputed matrices tests the SCORER, not independent
 * reconstruction of the unavailable upstream match/denoising model.
 */
export function decodeSourceBlocks(bytes, index, metadata, ownRole, bracket) {
  const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']
  if (!(bytes instanceof Uint8Array) || !roles.includes(ownRole))
    throw new Error('Invalid reference input')
  const populations = metadata.by_patch?.[bracket]
  if (!populations) throw new Error('Unknown bracket')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  function half(offset) {
    const bits = view.getUint16(offset, true),
      sign = bits & 0x8000 ? -1 : 1,
      exponent = (bits >>> 10) & 31,
      mantissa = bits & 1023
    if (exponent === 31) {
      if (!mantissa) throw new Error('Infinite interaction')
      return null
    }
    return (
      sign * (exponent === 0 ? mantissa * 2 ** -24 : (1 + mantissa / 1024) * 2 ** (exponent - 15))
    )
  }
  const rates = new Map()
  for (const role of roles) {
    const roster = index.champions[role]
    if (!Array.isArray(roster) || new Set(roster).size !== roster.length)
      throw new Error('Invalid source roster')
    const byName = new Map()
    for (const r of populations[role] ?? []) {
      if (
        byName.has(r.champion) ||
        !Number.isFinite(r.pick_rate) ||
        r.pick_rate < 0 ||
        r.pick_rate > 1
      )
        throw new Error('Invalid source population rate')
      byName.set(r.champion, r.pick_rate)
    }
    // Source engine treats an absent metadata entry as PR=0; retain provenance.
    // This convention is reference-only, not an imputation of real observations.
    for (const name of roster) if (!byName.has(name)) byName.set(name, 0)
    rates.set(role, byName)
  }
  const blocks = []
  for (const mode of ['matchup', 'synergy'])
    for (const otherRole of roles) {
      if (mode === 'synergy' && otherRole === ownRole) continue
      const b = index[mode]?.[ownRole]?.[otherRole]
      if (
        !b ||
        !Number.isSafeInteger(b.offset) ||
        b.offset < 0 ||
        b.offset % 2 ||
        !Number.isSafeInteger(b.rows_n) ||
        !Number.isSafeInteger(b.cols_n) ||
        b.rows_n !== b.rows?.length ||
        b.cols_n !== b.cols?.length ||
        new Set(b.rows).size !== b.rows.length ||
        new Set(b.cols).size !== b.cols.length ||
        b.rows.some((x) => !index.champions[ownRole].includes(x)) ||
        b.cols.some((x) => !index.champions[otherRole].includes(x))
      )
        throw new Error('Invalid source block axes')
      const n = b.rows_n * b.cols_n
      if (b.offset + 4 * n + 4 * b.rows_n > bytes.length) throw new Error('Truncated source block')
      const matrix = (start) =>
        Array.from({ length: b.rows_n }, (_, i) =>
          Array.from({ length: b.cols_n }, (_, j) => half(start + 2 * (i * b.cols_n + j)))
        )
      blocks.push({
        ownRole,
        otherRole,
        mode,
        champions: [...b.rows],
        targets: [...b.cols],
        championPickRates: b.rows.map((x) => rates.get(ownRole).get(x)),
        targetPickRates: b.cols.map((x) => rates.get(otherRole).get(x)),
        shrunkPp: matrix(b.offset),
        rawPp: matrix(b.offset + 2 * n),
        scope: {
          source: 'author-precomputed-reference-matrices-not-independent-upstream',
          interactionPatch: '16.1-16.4 plus separately updated Locke',
          playRatePatch: '16.16',
          region: 'source-unspecified',
          queueId: 420,
          population: bracket
        }
      })
    }
  return blocks
}

export function compareSourceScores(ours, referenceRows) {
  const lookup = new Map(referenceRows.map((r) => [r.champion, r]))
  if (
    lookup.size !== referenceRows.length ||
    ours.length !== referenceRows.length ||
    new Set(ours.map((r) => r.champion)).size !== ours.length
  )
    throw new Error('Reference candidate mismatch')
  const fields = {
    matchupMean: 'matchup_mean',
    synergyMean: 'synergy_mean',
    aggregate: 'aggregate',
    laneMatchup: 'lane_matchup',
    outOfLaneMatchup: 'out_of_lane_matchup',
    laneSynergy: 'lane_synergy',
    outOfLaneSynergy: 'out_of_lane_synergy'
  }
  let maximumError = 0,
    compared = 0
  for (const row of ours) {
    const source = lookup.get(row.champion)
    if (!source) throw new Error('Missing reference champion')
    for (const [local, remote] of Object.entries(fields)) {
      const a = row[local] ?? null,
        b = source[remote] ?? null
      if (a === null || b === null) {
        if (a !== b) throw new Error('Missingness mismatch')
        continue
      }
      if (!Number.isFinite(a) || !Number.isFinite(b)) throw new Error('Nonfinite reference score')
      maximumError = Math.max(maximumError, Math.abs(a - b))
      compared++
    }
  }
  return {
    rows: ours.length,
    compared,
    maximumError,
    samePrecomputedInput: true,
    independentUpstreamVerified: false
  }
}

/** Empty-pool source request: metadata controls display, NOT the z reference.
 * Missing metadata names still occur in matrix rows and must not be removed
 * before scoring. This distinction is absent from complete synthetic fixtures.
 */
export function scoreSourceDataset(bytes, index, metadata, ownRole, bracket, settings, score) {
  const blocks = decodeSourceBlocks(bytes, index, metadata, ownRole, bracket)
  const known = new Set(metadata.by_patch[bracket][ownRole].map((r) => r.champion))
  return {
    blocks,
    rows: score(ownRole, blocks, settings).filter((r) => known.has(r.champion)),
    referenceRoster: [...index.champions[ownRole]],
    missingMetadataCandidates: index.champions[ownRole].filter((x) => !known.has(x))
  }
}
