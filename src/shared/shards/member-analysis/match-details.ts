import type { SgpGameDetails, SgpGameSummary } from '@shared/data-adapter/wrapper'
import { z } from 'zod'

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
}
