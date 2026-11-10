import type { ChampionPoolMatch, InteractionPopulation, MatchParticipant } from './interactions'
import type { DraftRole } from './scoring'

const POSITIONS: Readonly<Record<string, DraftRole>> = {
  TOP: 'TOP',
  JUNGLE: 'JUNGLE',
  MIDDLE: 'MID',
  BOTTOM: 'ADC',
  UTILITY: 'SUP'
}

export type RiotMatchAdmission =
  | { status: 'accepted'; match: ChampionPoolMatch }
  | {
      status: 'excluded'
      reason:
        | 'invalid-payload'
        | 'queue-mismatch'
        | 'patch-mismatch'
        | 'region-mismatch'
        | 'short-game'
        | 'unknown-role'
    }

/** Projects Match-V5 data onto champion/role/team/result only. Does not retain
 * player names, PUUIDs, rank identifiers or raw payloads. The caller must verify
 * population evidence; Match-V5 itself does not establish historical rank.
 * Duration cutoff is an explicit sampling policy, not the author's known policy.
 */
export function normalizeRiotMatch(
  input: unknown,
  scope: InteractionPopulation,
  minimumDurationSeconds: number
): RiotMatchAdmission {
  if (!Number.isFinite(minimumDurationSeconds) || minimumDurationSeconds < 0)
    throw new RangeError('Invalid duration policy')
  const excluded = (
    reason: Extract<RiotMatchAdmission, { status: 'excluded' }>['reason']
  ): RiotMatchAdmission => ({ status: 'excluded', reason })
  const record = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  const root = record(input),
    metadata = record(root?.metadata),
    info = record(root?.info)
  if (
    !metadata ||
    !info ||
    typeof metadata.matchId !== 'string' ||
    !metadata.matchId.trim() ||
    typeof info.gameVersion !== 'string' ||
    !Number.isSafeInteger(info.queueId) ||
    typeof info.gameDuration !== 'number' ||
    !Number.isFinite(info.gameDuration) ||
    info.gameDuration < 0 ||
    !Array.isArray(info.participants) ||
    info.participants.length !== 10
  )
    return excluded('invalid-payload')
  if (info.queueId !== scope.queueId) return excluded('queue-mismatch')
  if (
    metadata.matchId.split('_')[0].toLowerCase() !== scope.region.toLowerCase() ||
    (info.platformId !== undefined && info.platformId !== scope.region.toUpperCase())
  )
    return excluded('region-mismatch')
  const version = /^(\d+)\.(\d+)(?:\.|$)/.exec(info.gameVersion)
  if (!version) return excluded('invalid-payload')
  const patch = `${Number(version[1])}.${Number(version[2])}`
  if (patch !== scope.patch) return excluded('patch-mismatch')
  if (info.gameDuration < minimumDurationSeconds) return excluded('short-game')
  const participants: MatchParticipant[] = []
  for (const raw of info.participants) {
    const participant = record(raw)
    if (
      !participant ||
      typeof participant.championId !== 'number' ||
      !Number.isSafeInteger(participant.championId) ||
      participant.championId <= 0 ||
      typeof participant.win !== 'boolean' ||
      (participant.teamId !== 100 && participant.teamId !== 200)
    )
      return excluded('invalid-payload')
    const role =
      typeof participant.teamPosition === 'string' &&
      Object.hasOwn(POSITIONS, participant.teamPosition)
        ? POSITIONS[participant.teamPosition]
        : undefined
    if (!role) return excluded('unknown-role')
    participants.push({
      champion: String(participant.championId),
      role,
      team: participant.teamId,
      win: participant.win
    })
  }
  if (
    new Set(participants.map((p) => p.champion)).size !== 10 ||
    new Set(participants.map((p) => `${p.team}:${p.role}`)).size !== 10 ||
    participants.some((p) => p.win !== participants.find((q) => q.team === p.team)!.win) ||
    participants.find((p) => p.team === 100)?.win === participants.find((p) => p.team === 200)?.win
  )
    return excluded('invalid-payload')
  return { status: 'accepted', match: { ...scope, matchId: metadata.matchId, patch, participants } }
}
