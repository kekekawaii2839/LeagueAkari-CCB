import { z } from 'zod'

const member = z
  .object({
    serverId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    gameName: z.string().trim().min(1).max(96),
    tagLine: z.string().trim().min(1).max(32)
  })
  .strict()

/** Explicit role order. No probabilities, canonical identity, data paths or model knobs. */
export const PredictionOpportunityRequestSchema = z
  .object({
    members: z.tuple([member, member, member, member, member]),
    side: z.literal('all'),
    targetQueue: z.number().int().positive().safe().nullable()
  })
  .strict()
  .refine(
    (value) =>
      new Set(
        value.members.map((m) =>
          JSON.stringify([
            m.serverId,
            m.gameName.toLocaleLowerCase(),
            m.tagLine.toLocaleLowerCase()
          ])
        )
      ).size === 5
  )

export const PredictionOpportunityIdSchema = z.object({ id: z.string().uuid() }).strict()
export type PredictionOpportunityRequest = z.infer<typeof PredictionOpportunityRequestSchema>
export type PredictionOpportunityReply =
  | {
      status: 'forecasted'
      id: string
      baseline: number | null
      adaptive: number | null
      expiresAtMs: number
    }
  | { status: 'rejected'; reason: 'not-ready' | 'busy' | 'budget' | 'identity' | 'integrity' }
  | { status: 'registered-failed'; id: string }

export interface PredictionPilotSummary {
  opportunities: number
  pending: number
  eligible: number
  models: readonly {
    id: string
    scored: number
    accuracy: number | null
    brier: number | null
    logLoss: number | null
  }[]
}
