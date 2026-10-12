import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'

import type { createOpportunityLedger } from '../../../../../packages/prediction-lab/runner/opportunity-ledger.mjs'
import type { TeamLineup } from '../../../../../packages/prediction-lab/src/legacy/model'
import { buildSidePredictionDataset } from '../../../../../packages/prediction-lab/src/legacy/side-history'
import type {
  PredictionOpportunityReply,
  PredictionOpportunityRequest
} from '../../../../shared/shards/member-analysis/prediction'
import type { NativePredictionOutcome, NativePredictionRequest } from './native-prediction-executor'
import type {
  NativePredictionMember,
  loadNativePredictionInitialSnapshot
} from './native-prediction-loader'
import { nativePredictionIdentity } from './native-prediction-loader'
import type { NativePredictionSnapshotStore } from './native-prediction-snapshot-executor'

type Ledger = ReturnType<typeof createOpportunityLedger>
type Snapshot = Awaited<ReturnType<typeof loadNativePredictionInitialSnapshot>>
type Frozen = ReturnType<NativePredictionSnapshotStore['freeze']>
const STUDY = 'native-prospective-capture-v1'
const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
export interface PredictionRuntime {
  connected: boolean
  serverId: string
  phase: string | null
  self: string | null
  game: { serverId: string; gameId: number } | null
}
export interface NativePredictionDependencies {
  ledger: Ledger
  userDataPath: string
  clock?: () => number
  fingerprint: () => { code: string; protocol: string }
  runtime: () => PredictionRuntime
  resolve: (
    request: PredictionOpportunityRequest,
    signal: AbortSignal
  ) => Promise<NativePredictionMember[]>
  capture: (members: NativePredictionMember[], studyCreatedAtMs: number) => Promise<Snapshot>
  freeze: (snapshot: Snapshot) => Frozen
  execute: (
    request: NativePredictionRequest,
    signal: AbortSignal
  ) => Promise<NativePredictionOutcome>
  readResult: (serverId: string, gameId: number) => Promise<unknown>
}

/** One main-owned transaction plus first-game observer. Never accepts results or paths from renderer. */
export class NativePredictionController {
  private _busy = false
  private _disposed = false
  private _abort: AbortController | null = null
  private _timer: ReturnType<typeof setInterval> | null = null
  private _ticking = false
  private _live = new Set<string>()
  private _gaps = new Set<string>()
  private _contexts = new Map<string, { serverId: string; self: string }>()
  private _draftSeen = new Set<string>()
  private _pollAt = new Map<string, number>()
  private _running = new Set<Promise<unknown>>()
  private readonly _clock: () => number
  constructor(private readonly _dependencies: NativePredictionDependencies) {
    this._clock = _dependencies.clock ?? Date.now
  }

  watch() {
    if (this._timer || this._disposed) return
    this._timer = setInterval(() => {
      void this.tick().catch(() => {})
    }, 1000)
    this._timer.unref()
  }

  begin(request: PredictionOpportunityRequest) {
    return this._track(this._begin(request))
  }
  private async _begin(request: PredictionOpportunityRequest): Promise<PredictionOpportunityReply> {
    if (this._disposed) return { status: 'rejected', reason: 'not-ready' }
    if (this._busy) return { status: 'rejected', reason: 'busy' }
    this._busy = true
    const abort = new AbortController()
    this._abort = abort
    let id: string | null = null
    let registered = false
    try {
      const runtime = this._dependencies.runtime()
      if (
        !runtime.connected ||
        !runtime.self ||
        !['Lobby', 'None'].includes(runtime.phase ?? '') ||
        request.members.some((member) => member.serverId !== runtime.serverId)
      )
        return { status: 'rejected', reason: 'not-ready' }
      const context = { serverId: runtime.serverId, self: runtime.self }
      let members: NativePredictionMember[]
      try {
        members = await this._dependencies.resolve(request, abort.signal)
      } catch {
        return { status: 'rejected', reason: 'identity' }
      }
      if (members.length !== 5 || !members.some((member) => member.puuid === runtime.self))
        return { status: 'rejected', reason: 'not-ready' }
      if (!this._preDraft(context)) return { status: 'rejected', reason: 'not-ready' }
      const fingerprint = this._dependencies.fingerprint()
      const old = this._dependencies.ledger.getStudy(STUDY)
      if (
        old &&
        (old.study.codeFingerprint !== fingerprint.code ||
          old.study.protocolFingerprint !== fingerprint.protocol)
      )
        return { status: 'rejected', reason: 'integrity' }
      this._dependencies.ledger.createStudy({
        id: STUDY,
        algorithm: 'product-adaptive-v1',
        codeFingerprint: fingerprint.code,
        protocolFingerprint: fingerprint.protocol,
        eligibilitySeconds: 900,
        updateRule: 'expanding-history',
        models: [
          { id: 'baseline', version: '1' },
          { id: 'product-adaptive', version: '1' }
        ]
      })
      const state = this._dependencies.ledger.listOpportunities(STUDY)
      const now = this._clock()
      if (state.opportunities.length >= 12 || now >= state.createdAtMs + 14 * 86400000)
        return { status: 'rejected', reason: 'budget' }
      if (state.opportunities.some((entry) => !entry.terminal))
        return { status: 'rejected', reason: 'busy' }
      const lineup = Object.fromEntries(
        roles.map((role, index) => [
          role,
          nativePredictionIdentity(members[index].serverId, members[index].puuid)
        ])
      ) as TeamLineup
      if (new Set(Object.values(lineup)).size !== 5 || !this._preDraft(context))
        return { status: 'rejected', reason: 'not-ready' }
      id = randomUUID()
      this._saveContext(id, context)
      const expiresAtMs = now + 2 * 3600000
      this._dependencies.ledger.openOpportunity({
        id,
        studyId: STUDY,
        lineup,
        side: 'all',
        targetQueue: request.targetQueue,
        expiresAtMs
      })
      registered = true
      this._live.add(id)
      // Registration is durable before input capture or compute; failures stay in denominator.
      const input = await this._dependencies.capture(members, state.createdAtMs)
      if (JSON.stringify(input.request.lineup) !== JSON.stringify(lineup))
        throw Error('Lineup binding rejected')
      const frozen = this._dependencies.freeze(input)
      this._diagnostic(id, {
        kind: 'input-frozen',
        snapshotId: frozen.id,
        dataHash: frozen.dataHash,
        requestHash: frozen.requestHash,
        durableCompletedAtMs: frozen.durableCompletedAtMs
      })
      if (
        !this._preDraft(context) ||
        this._gaps.has(id) ||
        this._draftSeen.has(id) ||
        abort.signal.aborted
      )
        throw Error('Forecast no longer pre-draft')
      const rows = buildSidePredictionDataset(
        frozen.request.observations,
        frozen.request.lineup,
        'all',
        'isolated'
      ).rows
      const baseline = rows.length
        ? (rows.filter((row) => row.y === 1).length + 1) / (rows.length + 2)
        : null
      const outcome = await this._dependencies.execute(frozen.request, abort.signal)
      this._diagnostic(id, { kind: 'execution', outcome })
      if (
        !this._preDraft(context) ||
        this._gaps.has(id) ||
        this._draftSeen.has(id) ||
        abort.signal.aborted
      )
        throw Error('Forecast no longer pre-draft')
      const current = this._dependencies.fingerprint()
      if (current.code !== fingerprint.code || current.protocol !== fingerprint.protocol)
        throw Error('Study source changed')
      const adaptive =
        outcome.status === 'completed' &&
        outcome.inputHash === frozen.requestHash &&
        outcome.result.status === 'available'
          ? outcome.result.probability
          : null
      this._dependencies.ledger.commitForecast(id, {
        dataFingerprint: frozen.dataHash,
        dataCutoffMs: frozen.request.dataCutoffMs,
        models: [
          baseline === null
            ? { id: 'baseline', version: '1', status: 'failed' }
            : { id: 'baseline', version: '1', status: 'success', probability: baseline },
          adaptive === null
            ? { id: 'product-adaptive', version: '1', status: 'failed' }
            : { id: 'product-adaptive', version: '1', status: 'success', probability: adaptive }
        ]
      })
      return { status: 'forecasted', id, baseline, adaptive, expiresAtMs }
    } catch {
      if (id && registered) {
        this._diagnostic(id, { kind: 'registered-failure' })
        return { status: 'registered-failed', id }
      }
      return { status: 'rejected', reason: 'integrity' }
    } finally {
      this._busy = false
      this._abort = null
    }
  }

  cancel(id: string) {
    const entry = this._dependencies.ledger
      .listOpportunities(STUDY)
      .opportunities.find((row) => row.intent.value.id === id)
    if (!entry || entry.binding || entry.terminal) return false
    this._dependencies.ledger.closeOpportunity(id, 'cancelled')
    this._live.delete(id)
    this._abort?.abort()
    return true
  }

  tick() {
    return this._track(this._tick())
  }
  /** Called synchronously by main's connection/identity/gameflow reaction, not only the timer. */
  runtimeChanged() {
    if (this._disposed) return
    const runtime = this._dependencies.runtime()
    for (const id of this._live) {
      const context = this._contexts.get(id)
      if (
        !runtime.connected ||
        !context ||
        runtime.serverId !== context.serverId ||
        runtime.self !== context.self
      )
        this._gaps.add(id)
      if (['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'].includes(runtime.phase ?? ''))
        this._draftSeen.add(id)
    }
    void this.tick().catch(() => {})
  }
  private async _tick() {
    if (this._disposed || this._ticking || !this._dependencies.ledger.getStudy(STUDY)) return
    this._ticking = true
    try {
      const runtime = this._dependencies.runtime()
      const state = this._dependencies.ledger.listOpportunities(STUDY)
      for (const entry of state.opportunities) {
        if (entry.terminal) continue
        const id = entry.intent.value.id
        const now = this._clock()
        if (!entry.binding) {
          const context = this._contexts.get(id)
          if (
            !this._live.has(id) ||
            !runtime.connected ||
            !context ||
            context.serverId !== runtime.serverId ||
            context.self !== runtime.self
          )
            this._gaps.add(id)
          if (now >= entry.intent.value.expiresAtMs) {
            this._dependencies.ledger.closeOpportunity(
              id,
              this._gaps.has(id) ? 'unobserved' : 'expired'
            )
            continue
          }
          if (runtime.game && !this._gaps.has(id))
            this._dependencies.ledger.observeFirstStart(id, runtime.game)
          continue
        }
        if (now >= entry.intent.value.expiresAtMs + 86400000) {
          this._dependencies.ledger.closeOpportunity(id, 'unobserved')
          continue
        }
        if (now < (this._pollAt.get(id) ?? 0)) continue
        this._pollAt.set(id, now + 30000)
        const binding = entry.binding.value
        try {
          const result = await this._dependencies.readResult(binding.serverId, binding.gameId)
          const context = this._contexts.get(id) ?? this._readContext(id)
          const actual = this._actual(
            result,
            binding.serverId,
            binding.gameId,
            context?.self ?? null
          )
          if (!actual) continue
          this._dependencies.ledger.resolveObserved(id, actual)
          this._diagnostic(id, { kind: 'first-game-source', summary: result })
        } catch {
          /* Missing source remains pending, never substituted with another game. */
        }
      }
    } finally {
      this._ticking = false
    }
  }

  summary() {
    return this._dependencies.ledger.getStudy(STUDY)
      ? this._dependencies.ledger.aggregate(STUDY)
      : null
  }
  async dispose() {
    this._disposed = true
    if (this._timer) clearInterval(this._timer)
    this._timer = null
    this._abort?.abort()
    await Promise.allSettled([...this._running])
  }
  private _track<T>(operation: Promise<T>) {
    this._running.add(operation)
    void operation.then(
      () => this._running.delete(operation),
      () => this._running.delete(operation)
    )
    return operation
  }
  private _preDraft(context: { serverId: string; self: string }) {
    const runtime = this._dependencies.runtime()
    return (
      !this._disposed &&
      runtime.connected &&
      runtime.serverId === context.serverId &&
      runtime.self === context.self &&
      ['Lobby', 'None', 'Matchmaking', 'ReadyCheck'].includes(runtime.phase ?? '')
    )
  }
  private _saveContext(id: string, context: { serverId: string; self: string }) {
    const root = this._evidenceRoot(id)
    mkdirSync(root, { recursive: true })
    const file = openSync(join(root, 'context.json'), 'wx', 0o600)
    try {
      writeFileSync(file, JSON.stringify(context))
      fsyncSync(file)
    } finally {
      closeSync(file)
    }
    this._contexts.set(id, context)
  }
  private _readContext(id: string) {
    try {
      const root = this._evidenceRoot(id)
      const path = join(root, 'context.json')
      if (lstatSync(path).isSymbolicLink() || lstatSync(path).size > 4096) return null
      const value = JSON.parse(readFileSync(path, 'utf8')) as { serverId: string; self: string }
      if (
        typeof value.serverId !== 'string' ||
        typeof value.self !== 'string' ||
        !value.self ||
        value.self.length > 256
      )
        return null
      return value
    } catch {
      return null
    }
  }
  private _evidenceRoot(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid opportunity evidence identifier')
    let path = this._dependencies.userDataPath
    for (const part of ['', 'prediction-lab', 'native-opportunity-evidence', id]) {
      if (part) path = join(path, part)
      try {
        if (lstatSync(path).isSymbolicLink()) throw Error('Invalid evidence directory')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    return path
  }
  private _diagnostic(id: string, value: unknown) {
    try {
      const root = this._evidenceRoot(id)
      mkdirSync(root, { recursive: true })
      writeFileSync(
        join(root, `${randomUUID()}.json`),
        JSON.stringify({ atMs: this._clock(), value }),
        { flag: 'wx', mode: 0o600 }
      )
    } catch {
      /* The authoritative registered intent remains even if diagnostic storage fails. */
    }
  }
  private _actual(summary: unknown, serverId: string, gameId: number, self: string | null) {
    const raw = (summary as { json?: Record<string, unknown> } | null)?.json
    if (
      !raw ||
      raw.gameId !== gameId ||
      !Array.isArray(raw.participants) ||
      !Array.isArray(raw.teams) ||
      !self
    )
      return null
    const players = raw.participants as Record<string, unknown>[]
    const own = players.find((p) => p.puuid === self)
    if (!own || (own.teamId !== 100 && own.teamId !== 200)) return null
    const team = players.filter((p) => p.teamId === own.teamId)
    if (team.length !== 5) return null
    const lineup: Partial<TeamLineup> = {}
    for (const player of team) {
      let role = String(
        player.teamPosition || player.individualPosition || player.lane || ''
      ).toUpperCase()
      if (role === 'MID') role = 'MIDDLE'
      if (role === 'SUPPORT') role = 'UTILITY'
      if (
        !roles.includes(role as (typeof roles)[number]) ||
        lineup[role as (typeof roles)[number]] ||
        typeof player.puuid !== 'string'
      )
        return null
      lineup[role as (typeof roles)[number]] = nativePredictionIdentity(serverId, player.puuid)
    }
    const wins = (raw.teams as Record<string, unknown>[]).filter((t) => t.teamId === own.teamId)
    if (wins.length !== 1 || typeof wins[0].win !== 'boolean') return null
    return {
      startAtMs: Number(raw.gameStartTimestamp || raw.gameCreation),
      endAtMs: Number(raw.gameEndTimestamp),
      durationSec: Number(raw.gameDuration),
      lineup: lineup as TeamLineup,
      side: own.teamId === 100 ? ('Blue' as const) : ('Red' as const),
      queueId: Number(raw.queueId),
      win: wins[0].win
    }
  }
}
