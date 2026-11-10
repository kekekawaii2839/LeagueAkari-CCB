import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  compareSourceScores,
  decodeSourceBlocks,
  scoreSourceDataset
} from './source-dataset-audit.mjs'

function fixture() {
  const roles = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUP'],
    bytes = []
  const champions = Object.fromEntries(roles.map((r) => [r, [r + 'A', r + 'B']]))
  const index = { champions, matchup: { MID: {} }, synergy: { MID: {} } }
  for (const mode of ['matchup', 'synergy'])
    for (const role of roles) {
      if (mode === 'synergy' && role === 'MID') continue
      index[mode].MID[role] = {
        offset: bytes.length,
        rows_n: 2,
        cols_n: 2,
        rows: champions.MID,
        cols: [...champions[role]].reverse()
      }
      // shrunk [1,2;3,4], raw [-1,-2;-3,NaN], two unused row vectors
      for (const h of [0x3c00, 0x4000, 0x4200, 0x4400, 0xbc00, 0xc000, 0xc200, 0x7e00, 0, 0, 0, 0])
        bytes.push(h & 255, h >>> 8)
    }
  return {
    bytes: Uint8Array.from(bytes),
    index,
    metadata: {
      by_patch: {
        diamond: Object.fromEntries(
          roles.map((r) => [
            r,
            champions[r].map((champion, i) => ({ champion, pick_rate: i ? 0.2 : 0.8 }))
          ])
        )
      }
    }
  }
}
test('source decoder respects each block column order and the raw/shrunk layout', () => {
  const f = fixture(),
    r = decodeSourceBlocks(f.bytes, f.index, f.metadata, 'MID', 'diamond')
  assert.equal(r.length, 9)
  assert.deepEqual(r[0].targetPickRates, [0.2, 0.8])
  assert.deepEqual(r[0].shrunkPp, [
    [1, 2],
    [3, 4]
  ])
  assert.deepEqual(r[0].rawPp, [
    [-1, -2],
    [-3, null]
  ])
})
test('missing metadata is reference PR zero but not an invented zero interaction', () => {
  const f = fixture()
  f.metadata.by_patch.diamond.MID.pop()
  const r = decodeSourceBlocks(f.bytes, f.index, f.metadata, 'MID', 'diamond')
  assert.deepEqual(r[0].championPickRates, [0.8, 0])
  assert.equal(r[0].rawPp[1][0], -3)
  const output = scoreSourceDataset(
    f.bytes,
    f.index,
    f.metadata,
    'MID',
    'diamond',
    {},
    (_role, blocks) => {
      assert.equal(blocks[0].champions.length, 2)
      return blocks[0].champions.map((champion) => ({ champion }))
    }
  )
  assert.equal(output.rows.length, 1)
  assert.equal(output.referenceRoster.length, 2)
  assert.deepEqual(output.missingMetadataCandidates, ['MIDB'])
})
test('truncated buffers, duplicate axes, unknown bracket and infinity fail closed', () => {
  for (const mutate of [
    (f) => {
      f.bytes = f.bytes.slice(0, 5)
    },
    (f) => {
      f.index.matchup.MID.TOP.cols = ['TOPA', 'TOPA']
    },
    (f) => {
      f.bytes[0] = 0
      f.bytes[1] = 0x7c
    }
  ]) {
    const f = fixture()
    mutate(f)
    assert.throws(() => decodeSourceBlocks(f.bytes, f.index, f.metadata, 'MID', 'diamond'))
  }
  const f = fixture()
  assert.throws(() => decodeSourceBlocks(f.bytes, f.index, f.metadata, 'MID', 'missing'))
})
test('same-input comparator preserves valid zero and rejects missing/nonfinite/mismatched candidates', () => {
  assert.equal(
    compareSourceScores([{ champion: 'A', matchupMean: 0 }], [{ champion: 'A', matchup_mean: 0 }])
      .maximumError,
    0
  )
  for (const [ours, source] of [
    [[], [{ champion: 'A' }]],
    [[{ champion: 'B' }], [{ champion: 'A' }]],
    [[{ champion: 'A', matchupMean: NaN }], [{ champion: 'A', matchup_mean: 0 }]],
    [[{ champion: 'A', matchupMean: 0 }], [{ champion: 'A' }]]
  ])
    assert.throws(() => compareSourceScores(ours, source))
})
