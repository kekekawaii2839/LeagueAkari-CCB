/** Offline orchestration; caller supplies scoped data/core and userData writer.
 * Current-patch PR is used here, unlike the historical fixed-PR comparison maps.
 */
export function buildRolePairMap(data, names, universe, ownRole, core) {
  const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']
  if (!roles.includes(ownRole) || data.blocks.length !== 9)
    throw new Error('Invalid role/block set')
  const scope = data.blocks[0].scope
  if (scope.population !== 'all' || scope.interactionPatch !== scope.playRatePatch)
    throw new Error('Charts require matched All Ranks interaction/PR scope')
  const expected = new Set([
    ...roles.map((r) => `matchup:${r}`),
    ...roles.filter((r) => r !== ownRole).map((r) => `synergy:${r}`)
  ])
  if (
    new Set(data.blocks.map((b) => `${b.mode}:${b.otherRole}`)).size !== 9 ||
    data.blocks.some(
      (b) =>
        b.ownRole !== ownRole ||
        !expected.has(`${b.mode}:${b.otherRole}`) ||
        JSON.stringify(b.scope) !== JSON.stringify(scope)
    )
  )
    throw new Error('Mixed/missing role blocks')
  const baselines = new Map()
  for (const b of data.baselines) {
    if (
      b.scope.tier !== 'all' ||
      b.scope.patch !== scope.interactionPatch ||
      b.scope.region !== scope.region ||
      b.scope.queueId !== scope.queueId
    )
      throw new Error('Mixed baseline population')
    const key = `${b.role}:${b.championId}`
    if (baselines.has(key)) throw new Error('Duplicate baseline')
    baselines.set(key, b)
  }
  for (const role of roles) {
    if (
      !Array.isArray(universe[role]) ||
      universe[role].length < 3 ||
      new Set(universe[role].map(String)).size !== universe[role].length
    )
      throw new Error('Invalid reference universe')
    if (universe[role].some((id) => !baselines.has(`${role}:${id}`)))
      throw new Error('Unknown universe hero')
    const required = data.baselines.filter((b) => b.role === role && b.pickRate >= 0.005)
    if (required.some((b) => !universe[role].map(String).includes(String(b.championId))))
      throw new Error('Display-eligible hero omitted')
  }
  const fitted = [],
    blocks = [],
    coverage = []
  for (const original of data.blocks) {
    const rows = universe[ownRole].map(String),
      cols = universe[original.otherRole].map(String)
    const ri = new Map(original.champions.map((id, i) => [id, i])),
      ci = new Map(original.targets.map((id, i) => [id, i]))
    if (rows.some((id) => !ri.has(id)) || cols.some((id) => !ci.has(id)))
      throw new Error('Unmapped matrix axis')
    const table = new Map()
    for (const s of data.pairSamples.filter(
      (s) => s.mode === original.mode && s.otherRole === original.otherRole
    )) {
      const key = `${s.selectedChampionId}:${s.championId}`
      if (table.has(key)) throw new Error('Duplicate pair count')
      table.set(key, s)
    }
    const rawPp = rows.map((id) => cols.map((target) => original.rawPp[ri.get(id)][ci.get(target)]))
    const games = rows.map((id, i) =>
      cols.map((target, j) => {
        const s = table.get(`${id}:${target}`)
        if (rawPp[i][j] !== null && (!s || s.state !== 'available' || s.rawDeltaPp !== rawPp[i][j]))
          throw new Error('Pair/count mismatch')
        return s?.games ?? null
      })
    )
    const block = {
      ...original,
      champions: rows,
      targets: cols,
      rawPp,
      shrunkPp: rawPp.map((r) => r.map(() => null)),
      championPickRates: rows.map((id) => baselines.get(`${ownRole}:${id}`).pickRate),
      targetPickRates: cols.map((id) => baselines.get(`${original.otherRole}:${id}`).pickRate)
    }
    for (let i = 0; i < rows.length; i++) {
      const eligible = cols
        .map((id, j) => ({ id, j }))
        .filter(({ id, j }) => id !== rows[i] && block.targetPickRates[j] >= 0.005)
      const known = eligible.filter(({ j }) => rawPp[i][j] !== null)
      const row = {
        champion: rows[i],
        mode: block.mode,
        otherRole: block.otherRole,
        eligible: eligible.length,
        known: known.length
      }
      coverage.push(row)
      if (block.championPickRates[i] >= 0.005 && known.length !== eligible.length)
        throw new Error('Incomplete display interaction coverage')
    }
    const result = core.shrinkInteractionBlock(block, games)
    if (result.model.fit.atUpperGridBoundary) throw new Error('Prior fit reached upper grid')
    blocks.push(result.block)
    fitted.push({ mode: block.mode, otherRole: block.otherRole, model: result.model })
  }
  const settings = { shrinkAlpha: 0.8, pickRateFloor: 0.005, pickRateWeighted: true }
  const rows = core
    .scoreScopedBlindability(ownRole, blocks, settings)
    .rows.map((r) => {
      if (r.matchupRoles !== 5 || r.synergyRoles !== 4)
        throw new Error('Incomplete plotted role estimate')
      return {
        ...r,
        name: names[r.champion],
        baselineGames: baselines.get(`${ownRole}:${r.champion}`).games
      }
    })
    .sort((a, b) => +a.champion - +b.champion)
  const expectedCount = data.baselines.filter(
    (b) => b.role === ownRole && b.pickRate >= 0.005
  ).length
  if (rows.length !== expectedCount) throw new Error('Display count mismatch')
  return {
    plot: {
      method: 'five-role-pair-shrinkage-v1',
      ownRole,
      scope,
      settings,
      referenceSize: universe[ownRole].length,
      rows,
      models: fitted.map((f) => ({
        mode: f.mode,
        otherRole: f.otherRole,
        method: f.model.method,
        fit: f.model.fit
      })),
      limits: [
        'Independent zero-centred normal-normal role prior, not the author hierarchy.',
        'Gaussian maximum-binomial working noise; fixed baselines; no calibrated score CI.',
        'Current-patch All Ranks PR; historical role universes expanded to include every current PR>=0.5% hero.'
      ]
    },
    evidence: { blocks, fitted, coverage }
  }
}
