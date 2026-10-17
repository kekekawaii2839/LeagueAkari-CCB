import type { MemberAnalysisGame, MemberAnalysisMatchDetails } from '@shared/shards/member-analysis'
import type { SgpParticipantLol } from '@shared/types/sgp/match-history'

export type MemberMatchOverviewInput = {
  summary: {
    data: {
      json: {
        gameId: number
        // Raw-cache transport checks the array, not each JSON element.
        participants: readonly unknown[]
      }
    }
  }
  participantRanks?: MemberAnalysisMatchDetails['participantRanks']
}

export type MemberMatchParticipant = {
  participantId: number
  championId: number
  name: string
  identity: string
  position: 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | null
  rank: NonNullable<MemberAnalysisMatchDetails['participantRanks']>['participants'][number] | null
}
const roles = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
const roleOrder: Record<Exclude<MemberMatchParticipant['position'], null>, number> = {
  TOP: 0,
  JUNGLE: 1,
  MIDDLE: 2,
  BOTTOM: 3,
  UTILITY: 4
}
type IdentityParticipant = Pick<
  SgpParticipantLol,
  'puuid' | 'participantId' | 'championId' | 'teamId'
> & {
  teamPosition?: unknown
  riotIdGameName?: unknown
  summonerName?: unknown
  riotIdTagline?: unknown
}

function isIdentityParticipant(value: unknown): value is IdentityParticipant {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return (
    'puuid' in value &&
    typeof value.puuid === 'string' &&
    value.puuid.trim().length > 0 &&
    'participantId' in value &&
    typeof value.participantId === 'number' &&
    Number.isSafeInteger(value.participantId) &&
    value.participantId >= 1 &&
    value.participantId <= 10 &&
    'teamId' in value &&
    (value.teamId === 100 || value.teamId === 200) &&
    'championId' in value &&
    typeof value.championId === 'number' &&
    Number.isSafeInteger(value.championId) &&
    value.championId >= 0
  )
}

/** No inferred opponents, no chosen protagonist and no rank join by order/name. */
export function memberMatchTeams(
  game: Pick<MemberAnalysisGame, 'gameId' | 'side'>,
  match: MemberMatchOverviewInput | null
) {
  const raw = match?.summary?.data?.json
  if (
    !raw ||
    raw.gameId !== game.gameId ||
    !Array.isArray(raw.participants) ||
    raw.participants.length !== 10
  )
    return null
  const players: readonly unknown[] = raw.participants
  if (!players.every(isIdentityParticipant)) return null
  if (
    new Set(players.map((p) => p.puuid)).size !== 10 ||
    players.some((p) => !p.puuid) ||
    new Set(players.map((p) => p.participantId)).size !== 10
  )
    return null
  const ownId = game.side === 'Blue' ? 100 : 200
  const groups = [100, 200].map((id) => ({
    id,
    own: id === ownId,
    players: players
      .filter((p) => p.teamId === id)
      .map((p): MemberMatchParticipant => {
        const role = typeof p.teamPosition === 'string' ? p.teamPosition.toUpperCase() : ''
        const position = role === 'MID' ? 'MIDDLE' : role === 'SUPPORT' ? 'UTILITY' : role
        const name =
          typeof p.riotIdGameName === 'string' && p.riotIdGameName
            ? p.riotIdGameName
            : typeof p.summonerName === 'string'
              ? p.summonerName
              : ''
        const tag = typeof p.riotIdTagline === 'string' ? p.riotIdTagline : ''
        return {
          participantId: p.participantId,
          championId: p.championId,
          name,
          identity: `${name}${tag ? `#${tag}` : ''}`,
          position:
            roles.has(position) &&
            (position === 'TOP' ||
              position === 'JUNGLE' ||
              position === 'MIDDLE' ||
              position === 'BOTTOM' ||
              position === 'UTILITY')
              ? position
              : null,
          rank: (() => {
            const payload = match?.participantRanks
            if (
              !payload ||
              payload.version !== 1 ||
              payload.source !== 'local-game-player-rank-snapshot'
            )
              return null
            const entries = payload.participants.filter(
              (entry) => entry.participantId === p.participantId
            )
            return entries.length === 1 ? entries[0] : null
          })()
        }
      })
      // Sort the mapped copy only. Rank association above uses participantId,
      // never a display column, role or the raw participant-array order.
      .sort(
        (left, right) =>
          (left.position ? roleOrder[left.position] : 5) -
            (right.position ? roleOrder[right.position] : 5) ||
          left.participantId - right.participantId
      )
  }))
  return groups.every((team) => team.players.length === 5) ? groups : null
}
