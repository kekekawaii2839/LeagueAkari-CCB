import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { NativePredictionRequest } from './native-prediction-executor'
import type { loadNativePredictionInitialSnapshot } from './native-prediction-loader'

type LoaderProvenance = Awaited<
  ReturnType<typeof loadNativePredictionInitialSnapshot>
>['provenance']

const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
function reject(): never {
  throw new Error('Prediction snapshot operation rejected')
}

/** Main-owned private store. No renderer paths, overwrite, export or generic IO surface. */
export class NativePredictionSnapshotStore {
  private readonly _userData: string
  private readonly _root: string

  constructor(
    userDataPath: string,
    private readonly _clock = Date.now
  ) {
    if (!isAbsolute(userDataPath) || lstatSync(userDataPath).isSymbolicLink()) reject()
    const userData = realpathSync(userDataPath)
    this._userData = userData
    this._root = join(userData, 'prediction-lab', 'native-snapshots-v1')
    this._inspect(userData, this._root)
    mkdirSync(this._root, { recursive: true })
    this._inspect(userData, this._root)
  }

  freeze(input: { request: NativePredictionRequest; provenance: unknown }) {
    const now = this._clock()
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !Number.isSafeInteger(input.request.dataCutoffMs) ||
      input.request.dataCutoffMs < 0 ||
      input.request.dataCutoffMs > now
    )
      reject()
    const snapshot = structuredClone(input)
    let nodes = 0
    const serializable = (value: unknown, depth = 0): void => {
      if (++nodes > 500000 || depth > 32 || value === undefined) reject()
      if (value === null || typeof value === 'string' || typeof value === 'boolean') return
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) reject()
        return
      }
      if (Array.isArray(value)) {
        for (const item of Array.from(value)) serializable(item, depth + 1)
        return
      }
      if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
        reject()
      for (const item of Object.values(value)) serializable(item, depth + 1)
    }
    serializable(snapshot)
    const requestHash = digest(JSON.stringify(snapshot.request))
    this._validateEvidence(snapshot, requestHash, now)
    const envelope = { schemaVersion: 1, frozenAtMs: now, requestHash, input: snapshot }
    const bytes = Buffer.from(JSON.stringify(envelope))
    if (bytes.length > 8 * 1024 * 1024) reject()
    const id = randomUUID()
    const directory = join(this._root, id)
    this._inspect(this._userData, this._root)
    mkdirSync(directory)
    const path = join(directory, 'snapshot.json')
    const file = openSync(path, 'wx', 0o600)
    try {
      writeFileSync(file, bytes)
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    const dataHash = digest(bytes)
    const frozen = this.verify(id, dataHash)
    const durableCompletedAtMs = this._clock()
    if (!Number.isSafeInteger(durableCompletedAtMs) || durableCompletedAtMs < now) reject()
    return {
      id,
      dataHash,
      requestHash,
      frozenAtMs: now,
      durableCompletedAtMs,
      request: frozen.input.request
    }
  }

  verify(id: string, expectedHash: string) {
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id) ||
      !/^[a-f0-9]{64}$/.test(expectedHash)
    )
      reject()
    const path = join(this._root, id, 'snapshot.json')
    this._inspect(this._userData, path)
    if (lstatSync(path).size > 8 * 1024 * 1024 || !lstatSync(path).isFile()) reject()
    const bytes = readFileSync(path)
    if (bytes.length > 8 * 1024 * 1024 || digest(bytes) !== expectedHash) reject()
    const value = JSON.parse(bytes.toString('utf8')) as {
      schemaVersion: number
      frozenAtMs: number
      requestHash: string
      input: { request: NativePredictionRequest; provenance: unknown }
    }
    if (
      value.schemaVersion !== 1 ||
      digest(JSON.stringify(value.input.request)) !== value.requestHash
    )
      reject()
    this._validateEvidence(value.input, value.requestHash, value.frozenAtMs)
    return value
  }

  private _validateEvidence(
    input: { request: NativePredictionRequest; provenance: unknown },
    requestHash: string,
    frozenAtMs: number
  ) {
    const provenance = input.provenance as LoaderProvenance | null
    if (
      !provenance ||
      provenance.schemaVersion !== 1 ||
      ![
        'immutable-development-seed-only',
        'immutable-development-seed-plus-observed-future'
      ].includes(provenance.scope) ||
      provenance.availabilityEvidence !== 'study-initial-observation-not-original-ingestion' ||
      provenance.requestHash !== requestHash ||
      provenance.dataCutoffMs !== input.request.dataCutoffMs
    )
      reject()
    if (provenance.scope === 'immutable-development-seed-plus-observed-future') {
      const future = provenance.futureInput
      if (
        !future ||
        !Number.isSafeInteger(future.studyCreatedAtMs) ||
        future.studyCreatedAtMs < 0 ||
        !Number.isSafeInteger(future.observedAtMs) ||
        future.observedAtMs < future.studyCreatedAtMs ||
        future.observedAtMs > provenance.studyInitiatedAtMs ||
        !Number.isSafeInteger(future.gameCount) ||
        future.gameCount < 0 ||
        future.gameCount > 167 ||
        !/^[a-f0-9]{64}$/.test(future.inputHash) ||
        future.availabilityEvidence !== 'study-observation-not-original-ingestion'
      )
        reject()
    } else if (provenance.futureInput !== undefined) reject()
    const chain = [
      input.request.dataCutoffMs,
      provenance.studyInitiatedAtMs,
      provenance.inputReadCompletedAtMs,
      provenance.sourceReadCompletedAtMs,
      provenance.studyObservedAtMs,
      frozenAtMs
    ]
    if (
      chain.some(
        (value, index) =>
          !Number.isSafeInteger(value) || value < 0 || (index > 0 && value < chain[index - 1])
      )
    )
      reject()
  }

  private _inspect(root: string, path: string) {
    const rel = relative(root, path)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) reject()
    let part = resolve(root)
    for (const segment of ['', ...rel.split(sep).filter(Boolean)]) {
      if (segment) part = join(part, segment)
      try {
        if (lstatSync(part).isSymbolicLink()) reject()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
  }
}
