/** Offline video-method alignment experiment. No fitting or website coordinates.
 * The video does NOT specify negative-MoM handling or role-to-axis aggregation.
 * Those choices are explicitly labelled, never claimed as recovered author code.
 */
export function calculateVideoMomExperiment(data, names, core, options = {}) {
  const settings = {
    ownRole: 'MID',
    ownDisplayFloor: 0.005,
    targetFloor: 0.005,
    noiseModel: 'maximum-binomial-variance',
    varianceConvention: 'meta-distribution',
    ...options
  }
  const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']
  if (!roles.includes(settings.ownRole)) throw new Error('Invalid own role')
  const requestedReference = settings.referenceChampionIds
  if (
    requestedReference !== undefined &&
    (!Array.isArray(requestedReference) ||
      new Set(requestedReference).size !== requestedReference.length ||
      requestedReference.some((x) => typeof x !== 'string'))
  )
    throw new Error('Invalid reference IDs')
  const roster = data.baselines
    .filter(
      (r) =>
        r.role === settings.ownRole &&
        (requestedReference
          ? requestedReference.includes(String(r.championId))
          : r.pickRate >= settings.ownDisplayFloor)
    )
    .sort((a, b) => a.championId - b.championId)
  if (requestedReference && roster.length !== requestedReference.length)
    throw new Error('Incomplete requested reference')
  if (roster.length < 2 || new Set(roster.map((r) => r.championId)).size !== roster.length)
    throw new Error('Invalid fixed candidate cohort')
  const expected = new Set([
    ...roles.map((r) => `matchup:${r}`),
    ...roles.filter((r) => r !== settings.ownRole).map((r) => `synergy:${r}`)
  ])
  const blockKeys = data.blocks.map((b) => `${b.mode}:${b.otherRole}`)
  if (
    blockKeys.length !== 9 ||
    new Set(blockKeys).size !== 9 ||
    blockKeys.some((k) => !expected.has(k)) ||
    data.blocks.some(
      (b) =>
        b.ownRole !== settings.ownRole ||
        JSON.stringify(b.scope) !== JSON.stringify(data.blocks[0].scope)
    )
  )
    throw new Error('Nine same-scope role blocks required')
  const tables = new Map()
  for (const s of data.pairSamples) {
    const k = `${s.selectedChampionId}:${s.mode}:${s.otherRole}`
    if (!tables.has(k)) tables.set(k, new Map())
    if (tables.get(k).has(String(s.championId))) throw new Error('Duplicate pair')
    tables.get(k).set(String(s.championId), s)
  }
  const estimates = roster.map((r) => ({
    champion: String(r.championId),
    name: names[String(r.championId)] ?? String(r.championId),
    pickRate: r.pickRate,
    baselineGames: r.games,
    blocks: []
  }))
  const spreadBlocks = data.blocks.map((b) => {
    if (
      b.targets.length !== b.targetPickRates.length ||
      new Set(b.targets).size !== b.targets.length
    )
      throw new Error('Invalid target roster')
    const spreadsPp = roster.map((r, i) => {
      const table = tables.get(`${r.championId}:${b.mode}:${b.otherRole}`)
      const cells = b.targets.flatMap((target, j) => {
        if (String(target) === String(r.championId)) return [] // ranked mirror/duplicate exclusion
        const s = table?.get(String(target))
        return [
          {
            target: String(target),
            deltaPp: s?.rawDeltaPp ?? null,
            reportedWinRate: s?.reportedWinRate ?? null,
            games: s?.games ?? 0,
            pickRate: b.targetPickRates[j]
          }
        ]
      })
      const estimate = core.estimateInteractionSpread(cells, {
        pickRateFloor: settings.targetFloor,
        pickRateWeighted: true,
        noiseModel: settings.noiseModel,
        varianceConvention: settings.varianceConvention
      })
      if (
        (!settings.allowPartialSourceCells &&
          (!['available', 'noise-dominated'].includes(estimate.status) ||
            estimate.weightedCoverage !== 1)) ||
        !Number.isFinite(estimate.signedCorrectedVariancePp2)
      )
        throw new Error('Incomplete source/noise estimate; no available-role averaging')
      const atBoundary = estimate.signedCorrectedVariancePp2 <= 0
      // Explicit constrained point estimate; NOT a claim of proven zero variation.
      const sdPp = Math.sqrt(Math.max(0, estimate.signedCorrectedVariancePp2))
      estimates[i].blocks.push({ mode: b.mode, otherRole: b.otherRole, estimate, atBoundary, sdPp })
      return sdPp
    })
    return {
      ownRole: settings.ownRole,
      mode: b.mode,
      otherRole: b.otherRole,
      champions: estimates.map((r) => r.champion),
      championPickRates: roster.map((r) => r.pickRate),
      spreadsPp
    }
  })
  const rows = core
    .scoreBlindabilityFromSpreads(settings.ownRole, spreadBlocks, settings.ownDisplayFloor)
    .map((row) => {
      const e = estimates.find((e) => e.champion === row.champion)
      if (row.matchupRoles !== 5 || row.synergyRoles !== 4)
        throw new Error('Lost full-role coverage')
      return {
        ...row,
        name: e.name,
        baselineGames: e.baselineGames,
        complete: true,
        boundaryBlocks: e.blocks.filter((b) => b.atBoundary).map((b) => `${b.mode}:${b.otherRole}`),
        estimates: e.blocks
      }
    })
  // Aggregation-order sensitivity. Not asserted to be the video's hidden rule.
  const aggregateFirst = estimates.map((r) => ({
    champion: r.champion,
    name: r.name,
    ...Object.fromEntries(
      ['matchup', 'synergy'].map((mode) => {
        const blocks = r.blocks.filter((b) => b.mode === mode)
        const v =
          blocks.reduce((s, b) => s + b.estimate.signedCorrectedVariancePp2, 0) / blocks.length
        return [mode, { signedVariancePp2: v, sdPp: Math.sqrt(Math.max(0, v)), atBoundary: v <= 0 }]
      })
    )
  }))
  for (const mode of ['matchup', 'synergy']) {
    const ref = core.standardizeBlindabilitySpreads(aggregateFirst.map((r) => r[mode].sdPp))
    aggregateFirst.forEach((r, i) => {
      r[mode + 'Mean'] = ref.zScores[i]
    })
  }
  return {
    method: 'video-mom-alignment-experiment-v1',
    scope: data.blocks[0].scope,
    ownRole: settings.ownRole,
    settings,
    rows,
    referenceProfiles: estimates,
    aggregateFirst: aggregateFirst.filter((r) => rows.some((x) => x.champion === r.champion)),
    cohort: estimates.map(({ champion, name, pickRate }) => ({ champion, name, pickRate })),
    references: spreadBlocks.map((b) => ({
      ...core.standardizeBlindabilitySpreads(b.spreadsPp),
      mode: b.mode,
      otherRole: b.otherRole,
      champions: b.champions
    })),
    evidence: {
      aligned: [
        'odds-corrected residuals supplied by independently audited adapter',
        'pick-rate-weighted observed variance',
        'binomial rate sampling noise',
        'subtract variances before square root',
        'no Bayesian prior, pair shrink or E[z]'
      ],
      unresolved: [
        'video does not specify nonpositive corrected-variance handling',
        'video does not specify cross-role aggregation order; primary reuses inspected site scorer',
        'video does not specify weighted-variance denominator, reference roster, or exact binomial approximation'
      ],
      explicitConventions: [
        'nonpositive variance bounded to zero only for point plotting, signed values retained; not proven stability',
        'fixed complete candidate cohort; same nine roles for everyone; no finite-only filtering',
        'primary: per-role reverse sample-z then full five/four mean; aggregate-first retained as sensitivity',
        'no confidence intervals, no certainty gate, no final coordinate rescaling'
      ]
    }
  }
}
