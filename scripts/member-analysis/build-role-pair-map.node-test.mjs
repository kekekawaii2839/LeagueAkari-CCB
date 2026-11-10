import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { buildRolePairMap } from './build-role-pair-map.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const built = spawnSync(
  process.execPath,
  [
    '.yarn/releases/yarn-4.18.0.cjs',
    'exec',
    'tsc',
    '--ignoreConfig',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'CommonJS',
    '--rootDir',
    'src',
    '--outDir',
    '.cache/five-role-test-core',
    'src/shared/shards/member-analysis/champion-pool/index.ts'
  ],
  { cwd: root, encoding: 'utf8' }
)
assert.equal(built.status, 0, built.stdout + built.stderr)
const core = createRequire(import.meta.url)(
  '../../.cache/five-role-test-core/shared/shards/member-analysis/champion-pool/index.js'
)
function fixture(ownRole) {
  const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP'],
    champions = ['1', '2', '3'],
    scope = {
      source: 'synthetic',
      interactionPatch: '16.21',
      playRatePatch: '16.21',
      region: 'synthetic',
      population: 'all',
      queueId: 420
    }
  const blocks = ['matchup', 'synergy'].flatMap((mode) =>
    roles
      .filter((r) => mode === 'matchup' || r !== ownRole)
      .map((otherRole) => ({
        ownRole,
        mode,
        otherRole,
        scope,
        champions,
        targets: champions,
        championPickRates: [0.5, 0.3, 0.2],
        targetPickRates: [0.5, 0.3, 0.2],
        rawPp: champions.map((_, i) => champions.map((_, j) => (i === j ? null : i - j))),
        shrunkPp: champions.map(() => champions.map(() => null))
      }))
  )
  const baselines = roles.flatMap((role) =>
    champions.map((id, i) => ({
      championId: +id,
      role,
      pickRate: [0.5, 0.3, 0.2][i],
      games: 10000,
      scope: {
        source: 'lolalytics',
        patch: '16.21',
        tier: 'all',
        region: 'synthetic',
        queueId: 420
      }
    }))
  )
  const pairSamples = blocks.flatMap((b) =>
    champions.flatMap((id, i) =>
      champions.flatMap((target, j) =>
        i === j
          ? []
          : [
              {
                selectedChampionId: +id,
                championId: +target,
                mode: b.mode,
                otherRole: b.otherRole,
                games: 1000,
                rawDeltaPp: i - j,
                state: 'available'
              }
            ]
      )
    )
  )
  return {
    data: { blocks, baselines, pairSamples },
    names: { 1: 'SyntheticA', 2: 'SyntheticB', 3: 'SyntheticC' },
    universe: Object.fromEntries(roles.map((r) => [r, champions]))
  }
}
test('all five roles retain complete five-enemy/four-ally estimates with same-patch PR', () => {
  for (const role of ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']) {
    const f = fixture(role),
      before = structuredClone(f.data),
      r = buildRolePairMap(f.data, f.names, f.universe, role, core)
    assert.equal(r.plot.rows.length, 3)
    assert.equal(r.plot.ownRole, role)
    assert.equal(r.plot.scope.playRatePatch, '16.21')
    assert(r.plot.rows.every((r) => r.matchupRoles === 5 && r.synergyRoles === 4))
    assert.deepEqual(f.data, before)
  }
})
test('omitted meta heroes, mixed population and missing pair data fail closed', () => {
  for (const mutate of [
    (f) => f.universe.JUNGLE.pop(),
    (f) => {
      f.data.baselines[0].scope.tier = 'diamond_plus'
    },
    (f) => f.data.pairSamples.pop(),
    (f) => f.data.blocks.pop()
  ]) {
    const f = fixture('MID')
    mutate(f)
    assert.throws(() => buildRolePairMap(f.data, f.names, f.universe, 'MID', core))
  }
})
