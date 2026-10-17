import { z } from 'zod'

const opaqueToken = z.string().regex(/^[A-Za-z0-9_-]{32}$/)
export const MemberAnalysisPublishedMemberIdentitiesRequestSchema = z
  .object({
    publicationToken: opaqueToken,
    memberSlots: z
      .array(z.number().int().min(1).max(20))
      .min(1)
      .max(20)
      .refine((values) => new Set(values).size === values.length),
    pageSize: z.number().int().min(1).max(25).default(25),
    cursor: opaqueToken.nullable().default(null)
  })
  .strict()
export const MemberAnalysisPublishedMemberIdentitiesPageSchema = z
  .object({
    publicationToken: opaqueToken,
    configurationToken: opaqueToken,
    configuredMemberIds: z.array(z.string().regex(/^member-slot-([1-9]|1[0-9]|20)$/)).max(20),
    games: z
      .array(
        z
          .object({
            gameId: z.number().int().positive(),
            status: z.enum(['available', 'raw-missing', 'identity-unavailable', 'ambiguous-game']),
            profiles: z
              .array(
                z
                  .object({
                    player: z.string().min(1).max(96),
                    identity: z.string().regex(/^[a-f0-9]{64}$/),
                    profileIconId: z
                      .number()
                      .int()
                      .nonnegative()
                      .max(Number.MAX_SAFE_INTEGER)
                      .nullable()
                  })
                  .strict()
              )
              .max(5)
              .optional(),
            members: z
              .array(
                z
                  .object({
                    memberId: z.string().regex(/^member-slot-([1-9]|1[0-9]|20)$/),
                    player: z.string().min(1).max(96)
                  })
                  .strict()
              )
              .max(20)
          })
          .strict()
      )
      .max(25),
    pagination: z.object({ nextCursor: opaqueToken.nullable() }).strict()
  })
  .strict()
export type MemberAnalysisPublishedMemberIdentitiesRequest = z.input<
  typeof MemberAnalysisPublishedMemberIdentitiesRequestSchema
>
export type MemberAnalysisPublishedMemberIdentitiesPage = z.infer<
  typeof MemberAnalysisPublishedMemberIdentitiesPageSchema
>
