import { z } from 'zod'

export const RANK_TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER'
] as const
export const RANK_TIER_NAMES: Record<(typeof RANK_TIERS)[number], string> = {
  IRON: '黑铁',
  BRONZE: '青铜',
  SILVER: '白银',
  GOLD: '黄金',
  PLATINUM: '铂金',
  EMERALD: '翡翠',
  DIAMOND: '钻石',
  MASTER: '大师',
  GRANDMASTER: '宗师',
  CHALLENGER: '王者'
}
export const RankValueSchema = z
  .object({
    tier: z.enum(RANK_TIERS),
    division: z.enum(['IV', 'III', 'II', 'I']).nullable(),
    leaguePoints: z.number().finite().nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if (RANK_TIERS.indexOf(value.tier) < 7 !== (value.division !== null))
      context.addIssue({ code: 'custom', message: 'Rank division incompatible with tier' })
  })
export const QueueRankSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ranked'), rank: RankValueSchema }).strict(),
  z.object({ status: z.enum(['unranked', 'provisional', 'missing']), rank: z.null() }).strict()
])
export const RankFailureSchema = z.enum([
  'disconnected',
  'auth-unavailable',
  'cross-region',
  'unsupported',
  'forbidden',
  'rate-limited',
  'not-found',
  'network-error',
  'network-paused',
  'invalid-response',
  'budget-exhausted',
  'identity-missing'
])
export type RankFailure = z.infer<typeof RankFailureSchema>
export const PlayerRankSnapshotSchema = z
  .object({
    attemptedAt: z.iso.datetime(),
    fetchedAt: z.iso.datetime().nullable(),
    status: z.enum(['ok', 'unavailable', 'stale']),
    reason: RankFailureSchema.nullable(),
    solo: QueueRankSchema,
    flex: QueueRankSchema,
    // Read compatibility only for removed version-axis annotations in old archives.
    // Discard this one legacy key without weakening strict validation of rank facts.
    versionEvidence: z.unknown().optional()
  })
  .strict()
  .transform(({ versionEvidence: _legacyVersionEvidence, ...snapshot }) => snapshot)
  .superRefine((value, context) => {
    if (
      (value.status === 'ok' && (!value.fetchedAt || value.reason !== null)) ||
      (value.status !== 'ok' && value.reason === null) ||
      (value.status === 'stale' && !value.fetchedAt) ||
      (value.status === 'unavailable' &&
        (value.fetchedAt !== null ||
          value.solo.status !== 'missing' ||
          value.flex.status !== 'missing'))
    )
      context.addIssue({ code: 'custom', message: 'Invalid rank snapshot provenance' })
  })
export const OpponentRanksSchema = z
  .object({
    version: z.literal(1),
    source: z.literal('SGP leagues-ledge (current snapshot)'),
    serverId: z.string().min(1).max(64),
    capture: z
      .object({
        mode: z.literal('live'),
        observedAt: z.iso.datetime(),
        phase: z.enum(['GameStart', 'InProgress', 'Reconnect'])
      })
      .strict()
      .optional(),
    opponents: z
      .array(
        z
          .object({
            capturedDuringGame: z.boolean().optional(),
            slot: z.number().int().min(1).max(5),
            role: z.enum(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']).nullable(),
            champion: z.string().min(1).max(64).nullable(),
            snapshot: PlayerRankSnapshotSchema
          })
          .strict()
      )
      .length(5)
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.opponents.map((opponent) => opponent.slot)).size !== 5)
      context.addIssue({ code: 'custom', message: 'Opponent slots must be distinct' })
  })
export type RankValue = z.infer<typeof RankValueSchema>
export type QueueRank = z.infer<typeof QueueRankSchema>
export type PlayerRankSnapshot = z.infer<typeof PlayerRankSnapshotSchema>
export type OpponentRanks = z.infer<typeof OpponentRanksSchema>
export type RankQueue = 'solo' | 'flex'
export const RANK_CACHE_TTL_MS = 24 * 60 * 60 * 1000

export function unavailableRank(reason: RankFailure, attemptedAt: string): PlayerRankSnapshot {
  return {
    attemptedAt,
    fetchedAt: null,
    status: 'unavailable',
    reason,
    solo: { status: 'missing', rank: null },
    flex: { status: 'missing', rank: null }
  }
}

const SourceSchema = z.object({ queues: z.array(z.unknown()).max(32) })
const QueueHeaderSchema = z.object({ queueType: z.string() })
const QueueSourceSchema = z.object({
  queueType: z.string(),
  tier: z.string().optional(),
  rank: z.string().optional(),
  leaguePoints: z.number().finite().optional(),
  provisionalGamesRemaining: z.number().int().nonnegative().optional()
})

/** Only current queue facts: never substitute highest/previous-season ranks. */
export function normalizeRankedStats(input: unknown, fetchedAt: string): PlayerRankSnapshot {
  const parsed = SourceSchema.safeParse(input)
  if (!parsed.success) return unavailableRank('invalid-response', fetchedAt)
  const queue = (queueType: string): QueueRank => {
    const entries = parsed.data.queues.filter((entry) => {
      const header = QueueHeaderSchema.safeParse(entry)
      return header.success && header.data.queueType === queueType
    })
    if (entries.length !== 1) return { status: 'missing', rank: null }
    const validated = QueueSourceSchema.safeParse(entries[0])
    if (!validated.success) return { status: 'missing', rank: null }
    const entry = validated.data
    if ((entry.provisionalGamesRemaining ?? 0) > 0) return { status: 'provisional', rank: null }
    if (entry.tier === 'NONE' || entry.tier === 'UNRANKED')
      return { status: 'unranked', rank: null }
    const rank = RankValueSchema.safeParse({
      tier: entry.tier,
      division: RANK_TIERS.indexOf(entry.tier as RankValue['tier']) >= 7 ? null : entry.rank,
      leaguePoints: entry.leaguePoints ?? null
    })
    return rank.success ? { status: 'ranked', rank: rank.data } : { status: 'missing', rank: null }
  }
  return {
    attemptedAt: fetchedAt,
    fetchedAt,
    status: 'ok',
    reason: null,
    solo: queue('RANKED_SOLO_5x5'),
    flex: queue('RANKED_FLEX_SR')
  }
}

/** Ordinal approximation, not an equal-interval skill/MMR scale. LP is excluded.
 * IV..I occupy four steps below Master; Master/Grandmaster/Challenger one each.
 */
export const rankOrder = (rank: RankValue) => {
  const tier = RANK_TIERS.indexOf(rank.tier)
  return tier < 7 ? tier * 4 + ['IV', 'III', 'II', 'I'].indexOf(rank.division!) : 28 + tier - 7
}
export const rankLabel = (rank: RankValue) =>
  `${RANK_TIER_NAMES[rank.tier]}${rank.division ? ` ${rank.division}` : ''}`
export function opponentRankAverage(
  value: OpponentRanks | undefined,
  queue: RankQueue
): { score: number; rank: RankValue; count: number } | null {
  if (!value) return null
  const ranked = value.opponents.flatMap(({ snapshot }) =>
    snapshot.status === 'ok' && snapshot[queue].status === 'ranked' ? [snapshot[queue].rank] : []
  )
  if (!ranked.length) return null
  const score = ranked.reduce((sum, rank) => sum + rankOrder(rank), 0) / ranked.length
  // Preserve the exact mean; display/group label rounds half toward the higher rank.
  const rounded = Math.round(score)
  const tier = rounded < 28 ? Math.floor(rounded / 4) : 7 + rounded - 28
  return {
    score,
    count: ranked.length,
    rank: {
      tier: RANK_TIERS[tier],
      division: rounded < 28 ? (['IV', 'III', 'II', 'I'] as const)[rounded % 4] : null,
      leaguePoints: null
    }
  }
}
