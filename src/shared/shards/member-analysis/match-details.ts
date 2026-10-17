import type { SgpGameDetails, SgpGameSummary } from '@shared/data-adapter/wrapper'
import { z } from 'zod'

import { PlayerRankSnapshotSchema } from './opponent-ranks'

export const MemberAnalysisMatchRequestSchema = z
  .object({
    gameId: z.number().int().positive().safe()
  })
  .strict()

/** Local cached data only; no renderer-supplied paths, identities or network targets. */
export type MemberAnalysisMatchDetails = {
  serverId: string
  summary: SgpGameSummary
  details: SgpGameDetails | null
  participantRanks?: MemberAnalysisParticipantRanks
}

/** Summary-only local view: timeline availability is intentionally not observed. */
export type MemberAnalysisMatchOverview = Pick<
  MemberAnalysisMatchDetails,
  'serverId' | 'summary' | 'participantRanks'
>

/** Local per-game identity association; participantId is the raw summary ID,
 * never a rank slot, roster position, name, champion or role inference. */
export const MemberAnalysisParticipantRanksSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('local-game-player-rank-snapshot'),
    participants: z
      .array(
        z
          .object({
            participantId: z.number().int().min(1).max(10),
            snapshot: PlayerRankSnapshotSchema.nullable(),
            timing: z.enum(['during-game', 'after-game', 'unknown']),
            observedAt: z.iso.datetime().nullable()
          })
          .strict()
      )
      .length(10)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.participants.map((player) => player.participantId)).size !== 10)
      context.addIssue({ code: 'custom', message: 'Participant IDs must be unique' })
    for (const [index, player] of value.participants.entries())
      if (player.snapshot === null && (player.timing !== 'unknown' || player.observedAt !== null))
        context.addIssue({
          code: 'custom',
          path: ['participants', index],
          message: 'Absent snapshot has no capture provenance'
        })
  })
export type MemberAnalysisParticipantRanks = z.infer<typeof MemberAnalysisParticipantRanksSchema>
