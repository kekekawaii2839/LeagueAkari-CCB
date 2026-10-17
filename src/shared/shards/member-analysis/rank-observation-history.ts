import { z } from 'zod'

import { QueueRankSchema } from './opponent-ranks'

export const MemberAnalysisRankObservationHistoryRequestSchema = z
  .object({
    memberSlot: z.number().int().min(1).max(20),
    queue: z.enum(['solo', 'flex']),
    pageSize: z.number().int().min(1).max(100).default(100),
    cursor: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32}$/)
      .nullable()
      .default(null)
  })
  .strict()

/** Actual query-time facts, not match-time ranks or cumulative/per-game LP. */
export const MemberAnalysisRankObservationHistoryPageSchema = z
  .object({
    memberSlot: z.number().int().min(1).max(20),
    serverId: z.string().min(1).max(64),
    status: z.enum(['available', 'identity-unresolved']),
    identityResolvedAt: z.iso.datetime().nullable(),
    // Opaque account scope for renderer merges; never a PUUID or a network target.
    identityKey: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable()
      .optional(),
    queue: z.enum(['solo', 'flex']),
    source: z.literal('SGP leagues-ledge query-time observations'),
    coverage: z.literal('successful-query-observations-only'),
    points: z
      .array(
        z
          .object({
            fetchedAt: z.iso.datetime(),
            queueRank: QueueRankSchema
          })
          .strict()
      )
      .max(100),
    pagination: z
      .object({
        nextCursor: z
          .string()
          .regex(/^[A-Za-z0-9_-]{32}$/)
          .nullable()
      })
      .strict()
  })
  .strict()
export type MemberAnalysisRankObservationHistoryRequest = z.input<
  typeof MemberAnalysisRankObservationHistoryRequestSchema
>
export type MemberAnalysisRankObservationHistoryPage = z.infer<
  typeof MemberAnalysisRankObservationHistoryPageSchema
>
