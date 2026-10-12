import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'

import type { NativePredictionRequest } from './native-prediction-executor'
import { NativePredictionSnapshotStore } from './native-prediction-snapshot-executor'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'akari-native-snapshot-synthetic-'))
  roots.push(root)
  return { root, store: new NativePredictionSnapshotStore(root, () => 1000) }
}
function input() {
  const request = {
    observations: [],
    lineup: {
      TOP: 'synthetic-a',
      JUNGLE: 'synthetic-b',
      MIDDLE: 'synthetic-c',
      BOTTOM: 'synthetic-d',
      UTILITY: 'synthetic-e'
    },
    side: 'all',
    dataCutoffMs: 999
  } as NativePredictionRequest
  return {
    request,
    provenance: {
      schemaVersion: 1,
      scope: 'immutable-development-seed-only',
      availabilityEvidence: 'study-initial-observation-not-original-ingestion',
      dataCutoffMs: 999,
      studyInitiatedAtMs: 999,
      inputReadCompletedAtMs: 999,
      sourceReadCompletedAtMs: 999,
      studyObservedAtMs: 999,
      requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex')
    }
  }
}

test('freeze is exclusive, survives reopen, binds exact bytes and request and isolates caller mutation', () => {
  const { root, store } = setup()
  const source = input()
  const receipt = store.freeze(source)
  source.request.lineup.TOP = 'mutated'
  expect(receipt.request.lineup.TOP).toBe('synthetic-a')
  const reopened = new NativePredictionSnapshotStore(root)
  expect(reopened.verify(receipt.id, receipt.dataHash).input.request).toEqual(receipt.request)
  const path = join(root, 'prediction-lab', 'native-snapshots-v1', receipt.id, 'snapshot.json')
  expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(receipt.dataHash)
  expect(receipt.requestHash).toBe(
    createHash('sha256').update(JSON.stringify(receipt.request)).digest('hex')
  )
  expect(store.freeze(input()).id).not.toBe(receipt.id)
})

test('tampered bytes, traversal IDs, incorrect hash and future cutoff fail closed', () => {
  const { root, store } = setup()
  const receipt = store.freeze(input())
  expect(() => store.verify('../snapshot', receipt.dataHash)).toThrow()
  expect(() => store.verify(receipt.id, '0'.repeat(64))).toThrow()
  const future = input()
  future.request.dataCutoffMs = 1001
  expect(() => store.freeze(future)).toThrow()
  writeFileSync(
    join(root, 'prediction-lab', 'native-snapshots-v1', receipt.id, 'snapshot.json'),
    '{}'
  )
  expect(() => store.verify(receipt.id, receipt.dataHash)).toThrow()
})

test('non-JSON evidence and sparse inputs cannot be silently converted to null or omitted', () => {
  const { store } = setup()
  for (const provenance of [{ x: undefined }, { x: NaN }, { x: Infinity }, { x: Array(2) }])
    expect(() => store.freeze({ ...input(), provenance })).toThrow()
})

test('non-directory storage collision is not replaced', () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-native-snapshot-synthetic-'))
  roots.push(root)
  writeFileSync(join(root, 'prediction-lab'), 'do not replace')
  expect(() => new NativePredictionSnapshotStore(root)).toThrow()
  expect(readFileSync(join(root, 'prediction-lab'), 'utf8')).toBe('do not replace')
})

test('storage parent replaced by a junction is rejected after construction', () => {
  const { root, store } = setup()
  const original = join(root, 'prediction-lab')
  const moved = join(root, 'moved')
  renameSync(original, moved)
  symlinkSync(moved, original, 'junction')
  expect(() => store.freeze(input())).toThrow()
})

test('invalid cutoff and unsupported evidence objects fail before any snapshot write', () => {
  const { root, store } = setup()
  for (const dataCutoffMs of [-1, 1.5, NaN]) {
    const source = input()
    source.request.dataCutoffMs = dataCutoffMs
    expect(() => store.freeze(source)).toThrow()
  }
  expect(() => store.freeze({ ...input(), provenance: new Date() })).toThrow()
  // A collision in an unrelated private directory is not modified by failed capture.
  mkdirSync(join(root, 'unrelated'))
})

test('loader request hash and observation chain cannot be detached from captured input', () => {
  const { store } = setup()
  const changed = input()
  changed.request.side = 'Blue'
  expect(() => store.freeze(changed)).toThrow()
  expect(() =>
    store.freeze({ ...input(), provenance: { ...input().provenance, studyObservedAtMs: 1001 } })
  ).toThrow()
})

test('expanded evidence reopens with old schema while seed-only archives retain their original scope', () => {
  const { root, store } = setup()
  const old = store.freeze(input())
  const source = input()
  const provenance = {
    ...source.provenance,
    scope: 'immutable-development-seed-plus-observed-future',
    futureInput: {
      studyCreatedAtMs: 900,
      observedAtMs: 998,
      gameCount: 1,
      inputHash: 'a'.repeat(64),
      availabilityEvidence: 'study-observation-not-original-ingestion'
    }
  }
  const expanded = store.freeze({ ...source, provenance })
  const reopened = new NativePredictionSnapshotStore(root)
  expect(reopened.verify(old.id, old.dataHash).input.provenance).toEqual(source.provenance)
  expect(reopened.verify(expanded.id, expanded.dataHash).input.provenance).toEqual(provenance)
  for (const futureInput of [
    { ...provenance.futureInput, observedAtMs: 1000 },
    { ...provenance.futureInput, studyCreatedAtMs: 999 },
    { ...provenance.futureInput, gameCount: 168 },
    { ...provenance.futureInput, inputHash: 'bad' },
    { ...provenance.futureInput, availabilityEvidence: 'original-ingestion' }
  ])
    expect(() => store.freeze({ ...source, provenance: { ...provenance, futureInput } })).toThrow()
  expect(() =>
    store.freeze({ ...source, provenance: { ...provenance, futureInput: undefined } })
  ).toThrow()
  expect(() =>
    store.freeze({ ...source, provenance: { ...provenance, scope: source.provenance.scope } })
  ).toThrow()
})
