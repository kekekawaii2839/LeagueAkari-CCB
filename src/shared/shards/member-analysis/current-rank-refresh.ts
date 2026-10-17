import { z } from 'zod'

import { RankFailureSchema } from './opponent-ranks'

// The renderer supplies only an operation id, never identities, targets or URLs.
export const MemberAnalysisCurrentRankRefreshRequestSchema = z
  .object({ requestId: z.uuid() })
  .strict()
export const MemberAnalysisCurrentRankRefreshResultSchema = z
  .object({
    requestId: z.uuid(),
    status: z.enum(['completed', 'cancelled']),
    startedAt: z.iso.datetime(),
    finishedAt: z.iso.datetime(),
    members: z
      .array(
        z
          .object({
            memberSlot: z.number().int().min(1).max(20),
            status: z.enum(['updated', 'failed', 'cancelled']),
            fetchedAt: z.iso.datetime().nullable(),
            reason: z
              .union([
                RankFailureSchema,
                z.literal('identity-unresolved'),
                z.literal('query-failed'),
                z.literal('cancelled')
              ])
              .nullable()
          })
          .strict()
      )
      .max(20)
  })
  .strict()
export const MemberAnalysisCurrentRankRefreshCancelResultSchema = z
  .object({ cancelled: z.boolean() })
  .strict()
export type MemberAnalysisCurrentRankRefreshRequest = z.infer<
  typeof MemberAnalysisCurrentRankRefreshRequestSchema
>
export type MemberAnalysisCurrentRankRefreshResult = z.infer<
  typeof MemberAnalysisCurrentRankRefreshResultSchema
>
