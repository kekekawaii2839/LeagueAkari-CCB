import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { join } from 'node:path'

import {
  predictionObservationsFromGames,
  validatePredictionGames
} from '../../../../../packages/prediction-lab/src/akari-metrics'
import {
  type TeamLineup,
  predictionRoles
} from '../../../../../packages/prediction-lab/src/legacy/model'
import type { PredictionSide } from '../../../../../packages/prediction-lab/src/legacy/side-history'
import type { NativePredictionRequest } from './native-prediction-executor'

const SEED_HASH = '549bb8d7b864dc49dba85da9276da63bcd75caaf11ffd632b4fcd1bf3ff9487c'
const SEED_PARTS = [
  'prediction-lab',
  'profile-value-experiments',
  '7873aac4-2ca1-46a9-82e0-66db9e2891f2',
  'development-input.json'
] as const
const MAX_BYTES = 32 * 1024 * 1024
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 256
const epoch = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
function reject(): never {
  throw Error('Initial prediction snapshot rejected')
}
export interface NativePredictionMember {
  serverId: string
  gameName: string
  tagLine: string
  puuid: string
}
export interface NativePredictionFutureInput {
  games: readonly unknown[]
  queueEntries: readonly (readonly [string, number])[]
  /** Study creation, not the historical source ingestion time. */
  studyCreatedAtMs: number
  /** Main-owned observation receipt completed before forecast initiation. */
  observedAtMs: number
}
interface SnapshotOptions {
  selectedMembers: readonly NativePredictionMember[]
  side: PredictionSide
  additional?: NativePredictionFutureInput
  dataCutoffMs: number
  /** Caller initiation time only; authoritative observation stamps are captured below. */
  studyObservedAtMs: number
  readSource: (gameId: number) => Promise<{ serverId: string; summary: unknown } | null>
}

/** Server-qualified identity; never infer identity from a display name or another server. */
export function nativePredictionIdentity(serverId: string, puuid: string) {
  if (!text(serverId) || !text(puuid)) reject()
  return `p_${digest(JSON.stringify([serverId, puuid])).slice(0, 40)}`
}

/** Pure-input boundary for synthetic tests. Production callers use the fixed-seed loader below.
 * All returned provenance is PRIVATE and belongs in Electron userData, not renderer payloads/logs.
 */
export async function buildNativePredictionInitialSnapshot(
  seedBytes: Uint8Array,
  options: SnapshotOptions,
  contract: { expectedSeedHash: string; expectedGames: number }
) {
  // The production entry reaches this boundary only after the bounded seed read completes.
  const inputReadCompletedAtMs = Date.now()
  const inputHash = digest(seedBytes)
  if (
    seedBytes.byteLength > MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(contract.expectedSeedHash) ||
    inputHash !== contract.expectedSeedHash ||
    !Number.isSafeInteger(contract.expectedGames) ||
    contract.expectedGames < 1 ||
    contract.expectedGames > 333
  )
    reject()
  if (
    !epoch(options.studyObservedAtMs) ||
    options.studyObservedAtMs > inputReadCompletedAtMs ||
    !epoch(options.dataCutoffMs) ||
    options.dataCutoffMs > options.studyObservedAtMs ||
    !['all', 'Blue', 'Red'].includes(options.side) ||
    !Array.isArray(options.selectedMembers) ||
    options.selectedMembers.length !== 5
  )
    reject()
  const identities = new Map<string, string>()
  const identity = (serverId: string, puuid: string) => {
    const id = nativePredictionIdentity(serverId, puuid)
    const key = JSON.stringify([serverId, puuid])
    if (identities.has(id) && identities.get(id) !== key) reject()
    identities.set(id, key)
    return id
  }
  const selected = Array.from(options.selectedMembers, (member) => {
    if (
      !member ||
      !text(member.gameName) ||
      !text(member.tagLine) ||
      !text(member.serverId) ||
      !text(member.puuid)
    )
      reject()
    return identity(member.serverId, member.puuid)
  })
  if (new Set(selected).size !== 5) reject()
  const lineup = Object.fromEntries(
    predictionRoles.map((role, i) => [role, selected[i]])
  ) as TeamLineup
  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(seedBytes).toString('utf8'))
  } catch {
    reject()
  }
  if (
    !object(parsed) ||
    !Array.isArray(parsed.games) ||
    parsed.games.length !== contract.expectedGames ||
    !Array.isArray(parsed.queueEntries) ||
    parsed.queueEntries.length !== contract.expectedGames ||
    typeof parsed.receiptSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(parsed.receiptSha256)
  )
    reject()
  const additional = options.additional
  if (
    additional &&
    (!Array.isArray(additional.games) ||
      !Array.isArray(additional.queueEntries) ||
      additional.games.length !== additional.queueEntries.length ||
      parsed.games.length + additional.games.length > 500 ||
      !epoch(additional.studyCreatedAtMs) ||
      !epoch(additional.observedAtMs) ||
      additional.studyCreatedAtMs > additional.observedAtMs ||
      additional.observedAtMs > options.studyObservedAtMs)
  )
    reject()
  // Clone additional records: normalization must never mutate the repository-owned payload.
  let futureGames: unknown[] = []
  let futureHash: string | null = null
  if (additional) {
    try {
      const bytes = JSON.stringify({
        games: additional.games,
        queueEntries: additional.queueEntries
      })
      if (Buffer.byteLength(bytes) > MAX_BYTES) reject()
      futureHash = digest(bytes)
      futureGames = structuredClone(Array.from(additional.games))
    } catch {
      reject()
    }
  }
  let games: ReturnType<typeof validatePredictionGames>
  try {
    games = validatePredictionGames([...parsed.games, ...futureGames])
  } catch {
    reject()
  }
  const queues = new Map<string, number>()
  for (const entry of [...parsed.queueEntries, ...(additional?.queueEntries ?? [])]) {
    if (
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      typeof entry[0] !== 'string' ||
      !Number.isSafeInteger(entry[1]) ||
      entry[1] <= 0 ||
      queues.has(entry[0])
    )
      reject()
    queues.set(entry[0], entry[1])
  }
  const seen = new Set<number>()
  // Validate the complete immutable population before making any source reads.
  for (const [index, game] of games.entries()) {
    if (
      !Number.isSafeInteger(game.gameId) ||
      seen.has(game.gameId) ||
      game.timestamp >= options.dataCutoffMs ||
      (index >= contract.expectedGames &&
        (!additional || game.timestamp < additional.studyCreatedAtMs)) ||
      game.duration < 900 ||
      game.players.length !== 5 ||
      new Set(game.players.map((p) => p.player)).size !== 5 ||
      predictionRoles.some((role) => game.players.filter((p) => p.role === role).length !== 1) ||
      !queues.has(`${game.timestamp}|${game.gameId}`)
    )
      reject()
    seen.add(game.gameId)
  }
  const sources: {
    gameId: number
    serverId: string
    startMs: number
    endMs: number
    queueId: number
    summaryHash: string
  }[] = []
  let sourceReadCompletedAtMs = inputReadCompletedAtMs
  for (const [index, game] of games.entries()) {
    let source: Awaited<ReturnType<SnapshotOptions['readSource']>>
    try {
      source = await options.readSource(game.gameId)
      const completedAtMs = Date.now()
      if (completedAtMs < sourceReadCompletedAtMs) reject()
      sourceReadCompletedAtMs = completedAtMs
    } catch {
      reject()
    }
    if (
      !source ||
      !text(source.serverId) ||
      !object(source.summary) ||
      !object(source.summary.json)
    )
      reject()
    const raw = source.summary.json
    const start = raw.gameStartTimestamp || raw.gameCreation
    if (
      raw.gameId !== game.gameId ||
      start !== game.timestamp ||
      !epoch(raw.gameEndTimestamp) ||
      raw.gameEndTimestamp <= game.timestamp ||
      raw.gameEndTimestamp >= options.dataCutoffMs ||
      (index >= contract.expectedGames &&
        (!additional || raw.gameEndTimestamp > additional.observedAtMs)) ||
      raw.gameDuration !== game.duration ||
      raw.queueId !== queues.get(`${game.timestamp}|${game.gameId}`) ||
      !Array.isArray(raw.participants) ||
      raw.participants.length > 10 ||
      !Array.isArray(raw.teams) ||
      raw.teams.length > 2
    )
      reject()
    const teamId = game.side === 'Blue' ? 100 : 200
    const teams = raw.teams.filter((v) => object(v) && v.teamId === teamId)
    if (teams.length !== 1 || !object(teams[0]) || teams[0].win !== game.win) reject()
    const teamPlayers = raw.participants.filter((v) => object(v) && v.teamId === teamId)
    if (teamPlayers.length !== 5) reject()
    const byName = new Map<string, string>()
    for (const player of game.players) {
      const matches = raw.participants.filter((v) => object(v) && v._targetName === player.player)
      if (matches.length !== 1 || !object(matches[0])) reject()
      const participant = matches[0]
      let role = participant.teamPosition || participant.individualPosition || participant.lane
      if (typeof role === 'string') role = role.toUpperCase()
      if (role === 'MID') role = 'MIDDLE'
      if (role === 'SUPPORT') role = 'UTILITY'
      if (
        participant._target !== true ||
        participant.teamId !== teamId ||
        participant.win !== game.win ||
        role !== player.role ||
        !text(participant.puuid)
      )
        reject()
      byName.set(player.player, identity(source.serverId, participant.puuid))
    }
    if (new Set(byName.values()).size !== 5) reject()
    if (game.laneGankDeaths?.status === 'available')
      for (const event of game.laneGankDeaths.events) {
        const player = game.players.find((p) => p.player === event.victimPlayer)
        if (!player || player.role !== event.victimRole || !byName.has(event.victimPlayer)) reject()
        event.victimPlayer = byName.get(event.victimPlayer)!
      }
    for (const player of game.players) player.player = byName.get(player.player)!
    sources.push({
      gameId: game.gameId,
      serverId: source.serverId,
      startMs: game.timestamp,
      endMs: raw.gameEndTimestamp,
      queueId: raw.queueId as number,
      summaryHash: digest(JSON.stringify(source.summary))
    })
  }
  const observations = predictionObservationsFromGames(games)
  if (
    observations.length !== games.length * 5 ||
    observations.length > 2500 ||
    observations.some(
      (o) => o.metrics.length !== 40 || o.metrics.some((v) => v !== null && !Number.isFinite(v))
    )
  )
    reject()
  const request: NativePredictionRequest = {
    observations,
    lineup,
    side: options.side,
    dataCutoffMs: options.dataCutoffMs
  }
  const requestHash = digest(JSON.stringify(request))
  const studyObservedAtMs = Date.now()
  if (studyObservedAtMs < sourceReadCompletedAtMs || studyObservedAtMs < options.dataCutoffMs)
    reject()
  return {
    request,
    provenance: {
      schemaVersion: 1 as const,
      scope: additional
        ? ('immutable-development-seed-plus-observed-future' as const)
        : ('immutable-development-seed-only' as const),
      ...(additional
        ? {
            futureInput: {
              studyCreatedAtMs: additional.studyCreatedAtMs,
              observedAtMs: additional.observedAtMs,
              gameCount: additional.games.length,
              inputHash: futureHash!,
              availabilityEvidence: 'study-observation-not-original-ingestion' as const
            }
          }
        : {}),
      availabilityEvidence: 'study-initial-observation-not-original-ingestion' as const,
      studyInitiatedAtMs: options.studyObservedAtMs,
      inputReadCompletedAtMs,
      sourceReadCompletedAtMs,
      studyObservedAtMs,
      dataCutoffMs: options.dataCutoffMs,
      inputHash,
      requestHash,
      receiptSha256: parsed.receiptSha256,
      sources
    }
  }
}

/** Main-owned userData root only; no renderer-supplied filename, current derived union or tail. */
export async function loadNativePredictionInitialSnapshot(
  userDataPath: string,
  options: SnapshotOptions
) {
  try {
    const handle = await open(join(userDataPath, ...SEED_PARTS), 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_BYTES) reject()
      const bytes = Buffer.alloc(stat.size + 1)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
      }
      if (offset !== stat.size) reject()
      return await buildNativePredictionInitialSnapshot(bytes.subarray(0, offset), options, {
        expectedSeedHash: SEED_HASH,
        expectedGames: 333
      })
    } finally {
      await handle.close()
    }
  } catch {
    reject()
  }
}
