'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { collect, parseQwik, parsePairs } = require('./collect-lolalytics.cjs')
const lanes = ['top', 'jungle', 'middle', 'bottom', 'support']
const header = ['id', 'wr', 'd1', 'd2', 'pr', 'n']
function fixture() {
  const saved = new Map(),
    scope = { patch: '16.21', tier: 'diamond_plus', region: 'all' }
  const prefix = 'lolalytics-16.21-diamond_plus-all-support'
  const nav = (lane) => ({ ...scope, mode: 'ranked', lane, status: 200, champion: 'thresh' })
  for (const lane of lanes)
    saved.set(`${prefix}/roster-${lane}.json`, {
      nav: nav(lane),
      data: {
        queue: 420,
        avgWr: 52.31,
        cid: { 412: { lane, games: 90, wr: 54.36 }, 1: { lane, games: 10, wr: 0 } }
      },
      slugs: { 412: 'thresh', 1: 'annie' }
    })
  const tables = () => Object.fromEntries(lanes.map((l) => [l, [[1, 51.23, 99, -99, 100, 7]]]))
  saved.set(`${prefix}/anchor-412.json`, {
    nav: nav('support'),
    championId: 412,
    data: {
      header: { ...scope, patch: '16.21', lane: 'support', queue: 420, cid: 412 },
      enemy_h: header,
      enemy: tables()
    },
    team: { response: { valid: true }, team_h: header, team: tables() },
    teamRequestScope: { ...scope, lane: 'support', queue: 'ranked' }
  })
  return {
    saved,
    prefix,
    run: (extra) =>
      collect({
        write: async (k, v) => saved.set(k, v),
        read: async (k) => saved.get(k),
        fetch: () => {
          throw Error('Network forbidden')
        },
        ownRole: 'SUP',
        ...extra
      })
  }
}
test('cache-only complete schema preserves rates, own-role reference and 5+4 direction', async () => {
  const f = fixture(),
    r = await f.run()
  assert.equal(r.collection.requests, 0)
  assert.equal(r.baselines.length, 10)
  assert.equal(r.reports.length, 9)
  assert.equal(r.names[412], 'Thresh')
  assert.equal(r.baselines.find((b) => b.championId === 412).pickRate, 0.9)
  assert.equal(r.baselines.find((b) => b.championId === 412).populationWinRate, 0.5231)
  assert.equal(r.baselines.find((b) => b.championId === 412).reportedWinRatePrecisionPp, 0.01)
  assert.equal(r.reports[0].pairs[0].reportedWinRate, 0.5123)
  assert.equal(r.reports[0].pairs[0].reportedWinRatePrecisionPp, 0.01)
  assert.ok(!('wins' in r.reports[0].pairs[0]))
  assert.equal(r.collection.allValidReferenceAnchorsRequested, true)
})
test('wrong queue provenance and partial tables fail without partial anchor reports', async () => {
  const f = fixture()
  f.saved.get(`${f.prefix}/anchor-412.json`).teamRequestScope.queue = 'aram'
  const bad = await f.run()
  assert.equal(bad.reports.length, 0)
  assert.equal(bad.collection.errors.length, 1)
  const g = fixture()
  delete g.saved.get(`${g.prefix}/anchor-412.json`).team.team.middle
  const partial = await g.run()
  assert.equal(partial.reports.length, 0)
  assert.equal(partial.collection.errors.length, 1)
})
test('scope mismatch blocks roster and role mismatch is rejected', async () => {
  const f = fixture()
  f.saved.get(`${f.prefix}/roster-top.json`).nav.patch = '16.22'
  await assert.rejects(f.run(), /requested scope/)
  await assert.rejects(f.run({ ownRole: 'MID', ownLane: 'support' }), /role\/lane mismatch/)
})
test('pair schema validates counts and labels quantization only where observed', () => {
  assert.equal(parsePairs(header, [[1, 51.234, 0, 0, 0, 3]])[0].reportedWinRatePrecisionPp, null)
  assert.throws(() => parsePairs(header, [[1, 50, 0, 0, 0, -1]]), /Invalid/)
  assert.throws(
    () =>
      parsePairs(header, [
        [1, 50, 0, 0, 0, 3],
        [1, 50, 0, 0, 0, 3]
      ]),
    /duplicate/
  )
})
test('explicit reference IDs are validated and cannot silently omit unavailable anchors', async () => {
  const f = fixture()
  const r = await f.run({ anchorChampionIds: [412] })
  assert.deepEqual(r.collection.requestedAnchorIds, [412])
  assert.equal(r.collection.completedAnchors, 1)
  for (const ids of [[412, 412], [], [0], ['412'], [1]])
    await assert.rejects(f.run({ anchorChampionIds: ids }))
})
test('All Ranks uses its own cache scope and never silently reuses Diamond+ snapshots', async () => {
  const f = fixture()
  for (const [key, value] of [...f.saved]) {
    f.saved.delete(key)
    value.nav.tier = 'all'
    if (value.teamRequestScope) value.teamRequestScope.tier = 'all'
    f.saved.set(key.replace('diamond_plus', 'all'), value)
  }
  const r = await f.run({ tier: 'all', anchorChampionIds: [412] })
  assert.equal(r.scope.tier, 'all')
  assert.equal(r.collection.rankConditioning, 'no-player-rank-filter')
  assert(r.reports.every((x) => x.scope.tier === 'all'))
  assert.equal(r.collection.requests, 0)
  const g = fixture()
  await assert.rejects(g.run({ tier: 'all' }), /Network forbidden/)
})
test('Qwik decoder resolves graph references without reparsing primitive slugs as indexes', () => {
  const objs = []
  const put = (v) => {
    const i = objs.length
    objs.push(null)
    objs[i] = Array.isArray(v)
      ? v.map(put)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, put(x)]))
        : v
    return i.toString(36)
  }
  put({ champion: 'thresh', patch: '16.21', page: 'tierlist', api: { build: 'a1' } })
  put({ fields: ['wr'], cid: { 412: { wr: 51.23 } }, queue: 420, avgWr: 52.31 })
  put({ 412: 'thresh', 1: 'annie' })
  const html = '<script type="qwik/json">' + JSON.stringify({ objs }) + '</script>'
  const result = parseQwik(html, 'tierlist')
  assert.equal(result.nav.champion, 'thresh')
  assert.equal(result.data.cid[412].wr, 51.23)
  assert.equal(result.slugs[1], 'annie')
  assert.throws(() => parseQwik('<html/>', 'tierlist'), /snapshot/)
})
