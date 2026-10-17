import {
  type MemberAnalysisParticipantRanks,
  MemberAnalysisParticipantRanksSchema
} from '@shared/shards/member-analysis/match-details'
import { PlayerRankSnapshotSchema } from '@shared/shards/member-analysis/opponent-ranks'
import { z } from 'zod'

import type { OpponentRankRepository } from './opponent-ranks/repository'

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
// League history uses Unix epoch milliseconds, not duration seconds. Reject
// seconds-looking bounds rather than inferring a missing game end from duration.
const epochMs = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isSafeInteger(value) &&
  value >= 1_000_000_000_000 &&
  value <= 8_640_000_000_000_000
const identity = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value

type RankReader = Pick<OpponentRankRepository, 'readGamePlayers' | 'readGame'>

/** No cache fallback or IO beyond exact, local per-game rank repository reads.
 * Missing/ambiguous legacy summaries omit this additive enrichment, not the match.
 */
export function matchDetailRanks(
  serverId: string,
  gameId: number,
  summary: unknown,
  ranks: RankReader
): MemberAnalysisParticipantRanks | undefined {
  if (
    !object(summary) ||
    summary.gameId !== gameId ||
    !Array.isArray(summary.participants) ||
    summary.participants.length !== 10
  )
    return undefined
  const identities = z
    .array(
      z
        .object({
          participantId: z.number().int().min(1).max(10),
          puuid: z.unknown().optional()
        })
        .passthrough()
    )
    .length(10)
    .safeParse(summary.participants)
  if (!identities.success) return undefined
  const players = identities.data
  if (new Set(players.map((player) => player.participantId)).size !== 10) return undefined
  const start = summary.gameStartTimestamp,
    end = summary.gameEndTimestamp
  if (!epochMs(start) || !epochMs(end) || end <= start) return undefined
  const puuids = players.map((player) => player.puuid)
  const gameSnapshot = ranks.readGame(serverId, gameId)
  const capture = gameSnapshot?.serverId === serverId ? gameSnapshot.capture : undefined
  const eligible = puuids.filter(
    (puuid): puuid is string =>
      identity(puuid) && puuids.filter((value) => value === puuid).length === 1
  )
  const snapshots = ranks.readGamePlayers(serverId, gameId, eligible)
  const participants = players.map((player) => {
    const { participantId, puuid } = player
    const unavailable = {
      participantId,
      snapshot: null,
      timing: 'unknown' as const,
      observedAt: null
    }
    if (!identity(puuid) || puuids.filter((value) => value === puuid).length !== 1)
      return unavailable
    const entry = snapshots.get(puuid)
    const parsed = PlayerRankSnapshotSchema.safeParse(entry?.snapshot)
    if (!parsed.success) return unavailable
    const snapshot = parsed.data
    const live = entry?.capturedDuringGame === true
    const observedAt = live && capture?.mode === 'live' ? capture.observedAt : null
    const fetched = snapshot.fetchedAt === null ? NaN : Date.parse(snapshot.fetchedAt)
    const observed = observedAt === null ? NaN : Date.parse(observedAt)
    const timing = !Number.isFinite(fetched)
      ? 'unknown'
      : fetched > end
        ? 'after-game'
        : live &&
            capture?.mode === 'live' &&
            start <= observed &&
            observed <= fetched &&
            fetched <= end
          ? 'during-game'
          : 'unknown'
    return { participantId, snapshot, timing, observedAt }
  })
  return MemberAnalysisParticipantRanksSchema.parse({
    version: 1,
    source: 'local-game-player-rank-snapshot',
    participants
  })
}
