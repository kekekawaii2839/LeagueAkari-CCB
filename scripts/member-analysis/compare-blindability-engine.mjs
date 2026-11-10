/** Synthetic-only differential audit. No real site data, copied engine or network access.
 * Compile scoring.ts separately, then provide three local absolute paths:
 * node this-file.mjs <reference.mjs> <reference.wasm> <compiled-scoring.js>
 * Reference artifacts are caller-supplied research tools, not shipped dependencies.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const paths = process.argv.slice(2)
if (paths.length !== 3)
  throw new Error('Expected reference JS, reference WASM and compiled scorer paths')
const referenceModule = await import(pathToFileURL(resolve(paths[0])).href)
const { scoreBlindability } = await import(pathToFileURL(resolve(paths[2])).href)
referenceModule.initSync({ module: readFileSync(resolve(paths[1])) })
const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP']
const rates = [0.4, 0.25, 0.2, 0.1, 0.05]
const fields = {
  matchupMean: 'matchup_mean',
  synergyMean: 'synergy_mean',
  aggregate: 'aggregate',
  laneMatchup: 'lane_matchup',
  outOfLaneMatchup: 'out_of_lane_matchup',
  laneSynergy: 'lane_synergy',
  outOfLaneSynergy: 'out_of_lane_synergy'
}
let state = 20261108
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0
  return state / 4294967296
}
function half(value) {
  if (value === null) return 0x7e00
  if (value === 0) return 0
  const absolute = Math.abs(value),
    exponent = Math.floor(Math.log2(absolute))
  return (
    (value < 0 ? 0x8000 : 0) |
    ((exponent + 15) << 10) |
    Math.round((absolute / 2 ** exponent - 1) * 1024)
  )
}
function fixture(ownRole) {
  const champions = Object.fromEntries(
    roles.map((role) => [role, rates.map((_, i) => `Synthetic_${role}_${i}`)])
  )
  const index = { champions, matchup: { [ownRole]: {} }, synergy: { [ownRole]: {} } }
  const bytes = [],
    blocks = []
  for (const mode of ['matchup', 'synergy'])
    for (const otherRole of roles) {
      if (mode === 'synergy' && otherRole === ownRole) continue
      const rawPp = [],
        shrunkPp = []
      for (let i = 0; i < 5; i++) {
        const raw = [],
          shrunk = []
        for (let j = 0; j < 5; j++) {
          const a = (Math.floor(random() * 33) - 16) / 2,
            b = (Math.floor(random() * 17) - 8) / 2
          // A wholly missing own row must be omitted even if explicitly in pool.
          const missing =
            (ownRole === 'JUNGLE' && i === 4) ||
            (ownRole === otherRole && i === j) ||
            random() < 0.05
          raw.push(missing ? null : a)
          shrunk.push(missing ? null : b)
        }
        rawPp.push(raw)
        shrunkPp.push(shrunk)
      }
      index[mode][ownRole][otherRole] = {
        offset: bytes.length,
        rows_n: 5,
        cols_n: 5,
        rows: champions[ownRole],
        cols: champions[otherRole]
      }
      // The reference input format stores two float16 matrices and two vectors.
      for (const value of [...shrunkPp.flat(), ...rawPp.flat(), ...Array(10).fill(0)]) {
        const encoded = half(value)
        bytes.push(encoded & 255, encoded >>> 8)
      }
      blocks.push({
        mode,
        ownRole,
        otherRole,
        champions: champions[ownRole],
        championPickRates: rates,
        targets: champions[otherRole],
        targetPickRates: rates,
        rawPp,
        shrunkPp
      })
    }
  const metadata = Object.fromEntries(
    roles.map((r) => [
      r,
      champions[r].map((champion, i) => ({ champion, pick_rate: rates[i], win_rate: 0.5 }))
    ])
  )
  return {
    index,
    bytes: new Uint8Array(bytes),
    blocks,
    metadata: {
      patches: ['synthetic'],
      latest_patch: 'synthetic',
      by_patch: { synthetic: metadata },
      default: metadata
    }
  }
}
let cases = 0,
  compared = 0,
  maxAbsoluteError = 0,
  sumAbsoluteError = 0,
  missingMismatch = 0,
  rankMismatch = 0
let nonFiniteMismatch = 0
const failures = []
for (const ownRole of roles) {
  const data = fixture(ownRole)
  const engine = new referenceModule.Engine(
    data.bytes,
    JSON.stringify(data.index),
    JSON.stringify(data.metadata)
  )
  try {
    for (const shrinkAlpha of [0, 0.2, 0.8, 1])
      for (const pickRateFloor of [0, 0.1, 0.2])
        for (const pickRateWeighted of [false, true])
          for (const keepPool of [false, true]) {
            const settings = { shrinkAlpha, pickRateFloor, pickRateWeighted }
            const pool = keepPool ? [data.index.champions[ownRole][4]] : []
            const ours = scoreBlindability(ownRole, data.blocks, settings, pool)
            const answer = engine.blindability({
              my_role: ownRole,
              pool,
              patch: 'synthetic',
              pr_floor: pickRateFloor,
              pr_weighted: pickRateWeighted,
              shrink_alpha: shrinkAlpha
            })
            const expected = new Map(answer.rows.map((row) => [row.champion, row]))
            cases++
            const actual = new Set(ours.map((r) => r.champion))
            for (const name of expected.keys()) if (!actual.has(name)) missingMismatch++
            for (const row of ours) {
              const target = expected.get(row.champion)
              if (!target) {
                missingMismatch++
                continue
              }
              for (const [local, remote] of Object.entries(fields)) {
                const a = row[local],
                  b = target[remote] ?? null
                if (a === null || b === null) {
                  if (a !== b) missingMismatch++
                  continue
                }
                if (!Number.isFinite(a) || !Number.isFinite(b)) {
                  nonFiniteMismatch++
                  continue
                }
                const error = Math.abs(a - b)
                compared++
                sumAbsoluteError += error
                maxAbsoluteError = Math.max(maxAbsoluteError, error)
                if (error > 1e-5 && failures.length < 8)
                  failures.push({ ownRole, settings, champion: row.champion, field: local, error })
              }
            }
            for (let i = 1; i < ours.length; i++) {
              const a = expected.get(ours[i - 1].champion)?.aggregate,
                b = expected.get(ours[i].champion)?.aggregate
              if (a != null && b != null && a < b - 1e-5) rankMismatch++
            }
          }
  } finally {
    engine.free()
  }
}
console.log(
  JSON.stringify(
    {
      source: 'deterministic synthetic matrices; not live data',
      cases,
      compared,
      maxAbsoluteError,
      meanAbsoluteError: sumAbsoluteError / compared,
      missingMismatch,
      rankMismatch,
      nonFiniteMismatch,
      tolerance: 1e-5,
      failures
    },
    null,
    2
  )
)
if (failures.length || missingMismatch || rankMismatch || nonFiniteMismatch) process.exitCode = 1
