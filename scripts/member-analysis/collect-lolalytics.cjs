'use strict'
// Local research collector. No top-level IO. All persistence goes through caller callbacks.
// Caller MUST place write/read storage under isolated Electron userData, never the checkout.
const LANES = ['top', 'jungle', 'middle', 'bottom', 'support']
const ROLE = { top: 'TOP', jungle: 'JUNGLE', middle: 'MID', bottom: 'ADC', support: 'SUP' }
// Precision is observed quantization, not proof of a provider rounding contract.
const precisionPp = (rate) => (Math.abs(rate * 100 - Math.round(rate * 100)) < 1e-7 ? 0.01 : null)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function parseQwik(html, kind) {
  const match = html.match(/<script[^>]+type="qwik\/json"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('Expected public Qwik snapshot')
  const objs = JSON.parse(match[1]).objs
  const unref = (ref) =>
    typeof ref === 'string' && /^[0-9a-z]+$/.test(ref) ? objs[parseInt(ref, 36)] : ref
  const expandValue = (value, depth) => {
    if (depth < 0) throw new Error('Unexpected snapshot depth')
    return Array.isArray(value)
      ? value.map((v) => expandValue(unref(v), depth - 1))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([k, v]) => [k, expandValue(unref(v), depth - 1)])
          )
        : value
  }
  const navRaw = objs.find(
    (o) =>
      o && typeof o === 'object' && !Array.isArray(o) && o.champion && o.patch && o.page && o.api
  )
  const raw = objs.find(
    (o) =>
      o &&
      typeof o === 'object' &&
      (kind === 'tierlist'
        ? o.fields && o.cid && o.queue && o.avgWr
        : o.header && o.enemy && o.enemy_h)
  )
  if (!navRaw || !raw) throw new Error('Snapshot nav/data schema changed')
  const slugRaw = objs.find(
    (o) =>
      o && typeof o === 'object' && !Array.isArray(o) && o['412'] && unref(o['412']) === 'thresh'
  )
  return {
    nav: expandValue(navRaw, 8),
    data: expandValue(raw, 14),
    slugs: slugRaw ? expandValue(slugRaw, 2) : null,
    fetchedAt: new Date().toISOString()
  }
}
function checkNav(snapshot, scope, lane, champion) {
  const n = snapshot.nav
  if (
    n.patch !== scope.patch ||
    n.tier !== scope.tier ||
    n.region !== scope.region ||
    n.mode !== 'ranked' ||
    n.lane !== lane ||
    n.status !== 200
  )
    throw new Error('Lolalytics did not echo the requested scope')
  if (champion && n.champion !== champion) throw new Error('Lolalytics returned another champion')
  if (snapshot.data.queue !== undefined && snapshot.data.queue !== 420)
    throw new Error('Unexpected queue')
  if (
    snapshot.data.header &&
    (snapshot.data.header.patch !== scope.patch ||
      snapshot.data.header.lane !== lane ||
      snapshot.data.header.queue !== 420)
  )
    throw new Error('Build header scope mismatch')
}
function parsePairs(header, rows) {
  if (!Array.isArray(header) || !Array.isArray(rows))
    throw new Error('Missing matchup field definitions/table')
  const id = header.indexOf('id'),
    wr = header.indexOf('wr'),
    n = header.indexOf('n')
  if (id < 0 || wr < 0 || n < 0) throw new Error('Pair schema changed')
  const seen = new Set()
  return rows.map((row) => {
    const championId = row[id],
      games = row[n],
      rate = row[wr]
    if (
      !Number.isSafeInteger(championId) ||
      championId <= 0 ||
      seen.has(championId) ||
      !Number.isSafeInteger(games) ||
      games < 0 ||
      !Number.isFinite(rate) ||
      rate < 0 ||
      rate > 100
    )
      throw new Error('Invalid or duplicate pair row')
    seen.add(championId)
    return {
      championId,
      games,
      reportedWinRate: rate / 100,
      reportedWinRatePrecisionPp: precisionPp(rate)
    }
  })
}
async function collect(options = {}) {
  const requestedIds = options.anchorChampionIds
  if (
    requestedIds !== undefined &&
    (!Array.isArray(requestedIds) ||
      requestedIds.length === 0 ||
      requestedIds.length > 250 ||
      new Set(requestedIds).size !== requestedIds.length ||
      requestedIds.some((x) => !Number.isSafeInteger(x) || x <= 0))
  )
    throw new Error('Invalid explicit anchor IDs')
  const {
    write,
    read,
    fetch: fetchImpl = globalThis.fetch,
    onProgress = () => {},
    concurrency = 2,
    delayMs = 500,
    maxAnchors = Infinity,
    anchorPickRateFloor = 0
  } = options
  if (typeof write !== 'function') throw new Error('Explicit userData write callback is required')
  const patch = options.patch ?? '16.21',
    tier = options.tier ?? 'diamond_plus',
    region = options.region ?? 'all',
    ownLane =
      options.ownLane ?? Object.keys(ROLE).find((l) => ROLE[l] === options.ownRole) ?? 'support'
  if (options.ownRole && ROLE[ownLane] !== options.ownRole)
    throw new Error('Own role/lane mismatch')
  if (
    !/^\d+\.\d+$/.test(patch) ||
    !/^\w+$/.test(tier) ||
    !/^\w+$/.test(region) ||
    !LANES.includes(ownLane)
  )
    throw new Error('Invalid requested scope')
  const scope = { source: 'lolalytics', patch, tier, region, queueId: 420 }
  const prefix = `lolalytics-${patch}-${tier}-${region}-${ownLane}`
  let requests = 0,
    cacheHits = 0
  async function get(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      requests++
      const response = await fetchImpl(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(45000)
      })
      if (response.ok) return response
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get('retry-after'),
          seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 2 ** attempt
        if (attempt < 2 && seconds <= 120) {
          await pause(Math.max(1000, seconds * 1000))
          continue
        }
      }
      throw new Error(`Public source returned HTTP ${response.status}`)
    }
    throw new Error('Request retry exhausted')
  }
  const load = async (key) => (typeof read === 'function' ? await read(`${prefix}/${key}`) : null)
  const save = async (key, value) => write(`${prefix}/${key}`, value)
  const snapshots = [],
    baselines = [],
    slugs = {}
  for (const lane of LANES) {
    let snapshot = await load(`roster-${lane}.json`)
    if (snapshot) {
      checkNav(snapshot, scope, lane)
      cacheHits++
    } else {
      const url = `https://lolalytics.com/lol/tierlist/?lane=${lane}&tier=${tier}&patch=${patch}&region=${region}`
      snapshot = parseQwik(await (await get(url)).text(), 'tierlist')
      checkNav(snapshot, scope, lane)
      await save(`roster-${lane}.json`, snapshot)
      await pause(Math.max(500, delayMs))
    }
    Object.assign(slugs, snapshot.slugs || {})
    const rows = Object.entries(snapshot.data.cid).map(([id, row]) => ({
      championId: Number(id),
      ...row
    }))
    if (
      rows.some(
        (r) =>
          r.lane !== lane ||
          !Number.isSafeInteger(r.championId) ||
          !Number.isSafeInteger(r.games) ||
          r.games < 0 ||
          !Number.isFinite(r.wr) ||
          r.wr < 0 ||
          r.wr > 100
      )
    )
      throw new Error('Invalid role roster')
    const total = rows.reduce((sum, r) => sum + r.games, 0)
    if (total <= 0) throw new Error('Role has no source games')
    for (const row of rows)
      baselines.push({
        scope: { ...scope },
        championId: row.championId,
        role: ROLE[lane],
        games: row.games,
        reportedWinRate: row.wr / 100,
        reportedWinRatePrecisionPp: precisionPp(row.wr),
        populationWinRate:
          Number.isFinite(snapshot.data.avgWr) &&
          snapshot.data.avgWr >= 0 &&
          snapshot.data.avgWr <= 100
            ? snapshot.data.avgWr / 100
            : null,
        pickRate: row.games / total,
        pickRateDenominator: 'same-role-games'
      })
    snapshots.push({
      lane,
      count: rows.length,
      listedGames: total,
      providerAverageWr: snapshot.data.avgWr,
      providerAnalysed: snapshot.data.analysed,
      fetchedAt: snapshot.fetchedAt
    })
    onProgress({ stage: 'roster', lane, rows: rows.length, requests, cacheHits })
  }
  const allCandidates = baselines.filter(
    (b) =>
      b.role === ROLE[ownLane] &&
      b.games > 0 &&
      b.reportedWinRate > 0 &&
      b.reportedWinRate < 1 &&
      b.pickRate >= anchorPickRateFloor
  )
  const candidates = allCandidates
    .filter((b) => !requestedIds || requestedIds.includes(b.championId))
    .sort((a, b) => b.pickRate - a.pickRate)
  if (requestedIds && candidates.length !== requestedIds.length)
    throw new Error('Requested reference anchor is unavailable')
  const anchors = candidates.slice(0, maxAnchors),
    reports = [],
    errors = []
  let cursor = 0,
    completed = 0
  async function worker() {
    while (cursor < anchors.length) {
      const anchor = anchors[cursor++],
        slug = slugs[String(anchor.championId)]
      try {
        if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug))
          throw new Error('Source slug is unavailable')
        let snapshot = await load(`anchor-${anchor.championId}.json`)
        if (snapshot) {
          checkNav(snapshot, scope, ownLane, slug)
          if (
            snapshot.championId !== anchor.championId ||
            snapshot.teamRequestScope?.patch !== patch ||
            snapshot.teamRequestScope?.tier !== tier ||
            snapshot.teamRequestScope?.region !== region ||
            snapshot.teamRequestScope?.lane !== ownLane ||
            snapshot.teamRequestScope?.queue !== 'ranked' ||
            snapshot.data.header?.cid !== anchor.championId ||
            snapshot.team?.response?.valid !== true
          )
            throw new Error('Cached anchor scope mismatch')
          cacheHits++
        } else {
          const url = `https://lolalytics.com/lol/${slug}/build/?lane=${ownLane}&tier=${tier}&patch=${patch}&region=${region}`
          const build = parseQwik(await (await get(url)).text(), 'build')
          checkNav(build, scope, ownLane, slug)
          if (build.data.header.cid !== anchor.championId)
            throw new Error('Build identity mismatch')
          const host = build.nav.api.build
          if (!/^a\d+$/.test(host)) throw new Error('Unexpected public API host')
          await pause(Math.max(500, delayMs))
          const teamUrl = `https://${host}.lolalytics.com/mega/?ep=build-team&v=1&patch=${patch}&c=${slug}&lane=${ownLane}&tier=${tier}&queue=ranked&region=${region}`
          const team = await (await get(teamUrl)).json()
          if (team.response?.valid !== true) throw new Error('Invalid team response')
          snapshot = {
            nav: build.nav,
            data: {
              header: build.data.header,
              enemy_h: build.data.enemy_h,
              enemy: build.data.enemy
            },
            team,
            championId: anchor.championId,
            teamRequestScope: { patch, tier, region, lane: ownLane, queue: 'ranked' },
            fetchedAt: new Date().toISOString()
          }
          await save(`anchor-${anchor.championId}.json`, snapshot)
        }
        const anchorReports = []
        for (const lane of LANES)
          anchorReports.push({
            scope: { ...scope },
            championId: anchor.championId,
            ownRole: ROLE[ownLane],
            mode: 'matchup',
            otherRole: ROLE[lane],
            pairs: parsePairs(snapshot.data.enemy_h, snapshot.data.enemy[lane])
          })
        for (const lane of LANES.filter((l) => l !== ownLane))
          anchorReports.push({
            scope: { ...scope },
            championId: anchor.championId,
            ownRole: ROLE[ownLane],
            mode: 'synergy',
            otherRole: ROLE[lane],
            pairs: parsePairs(snapshot.team.team_h, snapshot.team.team[lane])
          })
        reports.push(...anchorReports)
      } catch (error) {
        errors.push({ championId: anchor.championId, reason: String(error.message || error) })
      }
      completed++
      onProgress({
        stage: 'anchor',
        completed,
        total: anchors.length,
        requests,
        cacheHits,
        errorCount: errors.length
      })
      await pause(Math.max(500, delayMs))
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(2, concurrency)) }, worker))
  const collection = {
    requests,
    cacheHits,
    anchorPickRateFloor,
    maxAnchors: Number.isFinite(maxAnchors) ? maxAnchors : null,
    allValidReferenceAnchorsRequested:
      anchorPickRateFloor === 0 && anchors.length === candidates.length,
    rosters: snapshots,
    requestedAnchors: anchors.length,
    eligibleAnchors: candidates.length,
    completedAnchors: completed - errors.length,
    errors,
    completeEligibleAnchors: anchors.length === candidates.length && errors.length === 0,
    precision: 'source-reported percentages; no integer wins reconstructed',
    referenceRoster: requestedIds
      ? 'explicit requested own-role anchors; all five-role baselines retained'
      : 'all supplier-listed same-role champions; low-display-rate rows retained',
    rankConditioning:
      tier === 'all'
        ? 'no-player-rank-filter'
        : 'selected-player-tier; mutual-tier cohort not established',
    sampleCaveat:
      tier === 'all'
        ? 'All Ranks is not a narrower mutual-tier sample; reported ratios retained without forced symmetrization'
        : 'rank-filtered marginal rates may have non-50% population mean; no unverified correction applied',
    fetchedAt: new Date().toISOString()
  }
  const names = Object.fromEntries(
    Object.entries(slugs).map(([id, slug]) => [
      id,
      typeof slug === 'string'
        ? slug
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')
        : String(id)
    ])
  )
  collection.requestedAnchorIds = requestedIds ?? null
  collection.allSupplierAnchorsRequested = anchors.length === allCandidates.length
  collection.allValidReferenceAnchorsRequested =
    anchorPickRateFloor === 0 && anchors.length === allCandidates.length
  const result = { scope, baselines, reports, names, collection }
  await save('normalized.json', result)
  onProgress({
    stage: 'complete',
    requests,
    cacheHits,
    anchors: anchors.length,
    errors: errors.length
  })
  return result
}
module.exports = { collect, parseQwik, parsePairs }
