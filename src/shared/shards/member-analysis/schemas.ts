import { z } from 'zod'

export const MEMBER_ANALYSIS_CONTRACT_VERSION = 1 as const
export const MEMBER_ANALYSIS_DATA_VERSION = 4 as const

export const MemberAnalysisRoleSchema = z.enum(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
export const MemberAnalysisSideSchema = z.enum(['Blue', 'Red'])

const nullableFiniteNumber = z.number().finite().nullable()

export const MemberAnalysisPlayerGameSchema = z
  .object({
    player: z.string().trim().min(1).max(96),
    role: MemberAnalysisRoleSchema,
    champion: z.string().trim().min(1).max(64),
    minutes: z.number().finite().nonnegative(),
    kills: z.number().int().nonnegative(),
    deaths: z.number().int().nonnegative(),
    assists: z.number().int().nonnegative(),
    teamKills: z.number().int().nonnegative(),
    teamDeaths: z.number().int().nonnegative(),
    damage: z.number().finite().nonnegative(),
    damageShare: nullableFiniteNumber,
    gold: z.number().finite().nonnegative(),
    goldShare: nullableFiniteNumber,
    cs: z.number().finite().nonnegative(),
    vision: z.number().finite().nonnegative(),
    wardsPlaced: z.number().int().nonnegative(),
    wardsKilled: z.number().int().nonnegative(),
    controlWards: z.number().int().nonnegative(),
    damageTaken: z.number().finite().nonnegative(),
    takenShare: nullableFiniteNumber,
    damageMitigated: z.number().finite().nonnegative(),
    objectiveDamage: z.number().finite().nonnegative(),
    turretDamage: z.number().finite().nonnegative(),
    healTeammates: z.number().finite().nonnegative(),
    shieldTeammates: z.number().finite().nonnegative(),
    ccSeconds: z.number().finite().nonnegative(),
    soloKills: z.number().int().nonnegative(),
    fbPart: z.boolean(),
    ftPart: z.boolean(),
    kp: nullableFiniteNumber,
    gd10: nullableFiniteNumber,
    gd15: nullableFiniteNumber,
    csd15: nullableFiniteNumber,
    xpd15: nullableFiniteNumber,
    damageDiff15: nullableFiniteNumber,
    soloDiff15: nullableFiniteNumber,
    counter: nullableFiniteNumber
  })
  .strict()

export const MemberAnalysisJungleGameSchema = z
  .object({
    player: z.string().trim().min(1).max(96),
    champion: z.string().trim().min(1).max(64),
    startCamp: z.enum(['red', 'blue', 'gromp', 'wolves', 'raptors', 'krugs']).nullable(),
    startCampSide: z.enum(['blue', 'red']).nullable(),
    startCampOwn: z.boolean().nullable(),
    level3Gank: z.boolean(),
    level4Gank: z.boolean(),
    topGanks: z.number().int().nonnegative(),
    midGanks: z.number().int().nonnegative(),
    botGanks: z.number().int().nonnegative(),
    topZoneWeight: z.number().finite().nonnegative(),
    midZoneWeight: z.number().finite().nonnegative(),
    botZoneWeight: z.number().finite().nonnegative(),
    totalZoneWeight: z.number().finite().nonnegative(),
    gotFirstDragon: z.boolean().nullable(),
    dragons: z.number().int().nonnegative(),
    soloDragons: z.number().int().nonnegative(),
    firstDragonTimeSec: nullableFiniteNumber,
    voidgrubs: z.number().int().nonnegative(),
    firstVoidgrubTimeSec: nullableFiniteNumber,
    heralds: z.number().int().nonnegative(),
    firstHeraldTimeSec: nullableFiniteNumber,
    barons: z.number().int().nonnegative(),
    firstBaronTimeSec: nullableFiniteNumber
  })
  .strict()

export const MemberAnalysisEventDecisionGameSchema = z
  .object({
    killEpisodes: z.number().int().nonnegative(),
    convertedKillEpisodes: z.number().int().nonnegative(),
    killToEpicEpisodes: z.number().int().nonnegative(),
    killToTowerEpisodes: z.number().int().nonnegative(),
    conversionDelayTotalSec: z.number().finite().nonnegative(),
    conversionDelaySamples: z.number().int().nonnegative(),
    deathEpisodes: z.number().int().nonnegative(),
    highCostDeathEpisodes: z.number().int().nonnegative(),
    deathCostEpics: z.number().int().nonnegative(),
    deathCostTowers: z.number().int().nonnegative(),
    deathCostPlates: z.number().int().nonnegative(),
    deathCostPoints: z.number().finite().nonnegative(),
    shutdownBountyLost: z.number().finite().nonnegative(),
    objectivesTaken: z.number().int().nonnegative(),
    cleanObjectives: z.number().int().nonnegative(),
    wonFightObjectives: z.number().int().nonnegative(),
    evenFightObjectives: z.number().int().nonnegative(),
    lostFightObjectives: z.number().int().nonnegative(),
    objectiveFightSamples: z.number().int().nonnegative(),
    objectiveFightWins: z.number().int().nonnegative(),
    enemyObjectives: z.number().int().nonnegative(),
    tradedEnemyObjectives: z.number().int().nonnegative(),
    // A valid cross-map trade may happen up to 30 seconds before the enemy objective.
    tradeDelayTotalSec: z.number().finite(),
    tradeDelaySamples: z.number().int().nonnegative()
  })
  .strict()

export const MemberAnalysisLaneGankDeathEventSchema = z
  .object({
    victimPlayer: z.string().trim().min(1).max(96),
    victimRole: z.enum(['TOP', 'MIDDLE', 'BOTTOM', 'UTILITY']),
    victimChampion: z.string().trim().min(1).max(64),
    enemyJunglerChampion: z.string().trim().min(1).max(64),
    timestampSec: z
      .number()
      .finite()
      .min(0)
      .lt(14 * 60),
    lane: z.enum(['top', 'mid', 'bot']),
    involvement: z.enum(['killer', 'assist'])
  })
  .strict()

export const MemberAnalysisLaneGankDeathsSchema = z
  .discriminatedUnion('status', [
    z
      .object({
        methodVersion: z.literal(1),
        status: z.literal('available'),
        events: z.array(MemberAnalysisLaneGankDeathEventSchema).max(100)
      })
      .strict(),
    z
      .object({
        methodVersion: z.literal(1),
        status: z.literal('unavailable'),
        reason: z.enum(['enemy-jungler-unresolved', 'timeline-incomplete'])
      })
      .strict()
  ])
  .nullable()

export const MemberAnalysisGameSchema = z
  .object({
    gameId: z.number().int().nonnegative(),
    timestamp: z.number().int().nonnegative(),
    date: z.iso.date(),
    patch: z.string().trim().min(1).max(32),
    side: MemberAnalysisSideSchema,
    win: z.boolean(),
    duration: z.number().finite().nonnegative(),
    roster: z.string().max(512),
    dragon15Diff: z.number().finite(),
    grub15Diff: z.number().finite(),
    objectiveFight15Diff: z.number().finite(),
    counterMean: nullableFiniteNumber,
    upperGold15: z.number().finite(),
    botGold15: z.number().finite(),
    gold20Diff: z.number().finite(),
    tower20Diff: z.number().finite(),
    jungle: MemberAnalysisJungleGameSchema.nullable(),
    laneGankDeaths: MemberAnalysisLaneGankDeathsSchema.default(null),
    eventDecision: MemberAnalysisEventDecisionGameSchema,
    players: z.array(MemberAnalysisPlayerGameSchema).max(10)
  })
  .strict()

export const MemberAnalysisMetaSchema = z
  .object({
    generatedAt: z.iso.datetime(),
    source: z.string().trim().min(1).max(128),
    gameCount: z.number().int().nonnegative(),
    players: z.array(z.string().trim().min(1).max(96)).max(100)
  })
  .strict()

export const MemberAnalysisPayloadSchema = z
  .object({
    contractVersion: z.literal(MEMBER_ANALYSIS_CONTRACT_VERSION),
    dataVersion: z.literal(MEMBER_ANALYSIS_DATA_VERSION),
    meta: MemberAnalysisMetaSchema,
    games: z.array(MemberAnalysisGameSchema)
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.meta.gameCount !== payload.games.length) {
      context.addIssue({
        code: 'custom',
        path: ['meta', 'gameCount'],
        message: 'gameCount must equal games.length'
      })
    }
  })

export const LegacyMemberAnalysisPayloadSchema = z
  .object({
    meta: MemberAnalysisMetaSchema,
    games: z.array(MemberAnalysisGameSchema)
  })
  .strict()

export const MemberAnalysisFiltersSchema = z
  .object({
    outcome: z.enum(['all', 'win', 'loss']).default('all'),
    patch: z.string().max(32).default('all'),
    dateFrom: z.union([z.literal(''), z.iso.date()]).default(''),
    dateTo: z.union([z.literal(''), z.iso.date()]).default(''),
    durationMin: z.number().finite().nonnegative().max(180).nullable().default(null),
    durationMax: z.number().finite().nonnegative().max(180).nullable().default(null),
    participant: z.string().max(96).default('all'),
    matchRole: z.union([z.literal('all'), MemberAnalysisRoleSchema]).default('all'),
    champion: z.string().max(64).default('all'),
    query: z.string().trim().max(128).default('')
  })
  .strict()
  .superRefine((filters, context) => {
    if (
      filters.durationMin !== null &&
      filters.durationMax !== null &&
      filters.durationMin > filters.durationMax
    ) {
      context.addIssue({
        code: 'custom',
        path: ['durationMax'],
        message: 'durationMax must be greater than or equal to durationMin'
      })
    }
  })

export const MemberAnalysisPaginationSchema = z
  .object({
    cursor: z.string().max(256).nullable().default(null),
    pageSize: z.number().int().min(1).max(100).default(25)
  })
  .strict()

export const MemberAnalysisJobStatusSchema = z.enum([
  'idle',
  'starting',
  'collecting',
  'indexing',
  'analyzing',
  'publishing',
  'completed',
  'failed',
  'cancelled'
])

export const MemberAnalysisCollectionAuditSchema = z
  .object({
    requestedMembers: z.number().int().nonnegative(),
    resolvedMembers: z.number().int().nonnegative(),
    memberScans: z.array(
      z
        .object({
          member: z.number().int().positive(),
          status: z.enum(['RESOLVED', 'IDENTITY_LOOKUP_FAILED']),
          historyGames: z.number().int().nonnegative(),
          pages: z.number().int().nonnegative(),
          stopReason: z.enum(['not-started', 'target-reached', 'source-exhausted', 'safety-limit'])
        })
        .strict()
    ),
    targetHistoryDepth: z.union([z.number().int().positive(), z.literal('all')]),
    scanLimitPerMember: z.number().int().positive(),
    collectionStopReason: z.enum(['target-reached', 'source-exhausted', 'safety-limit']),
    sourceUnion: z.number().int().nonnegative(),
    sourceIntersection: z.number().int().nonnegative(),
    fivePresent: z.number().int().nonnegative(),
    fiveSameTeam: z.number().int().nonnegative(),
    mapEligible: z.number().int().nonnegative(),
    queueEligible: z.number().int().nonnegative(),
    roleEligible: z.number().int().nonnegative(),
    targetSelected: z.number().int().nonnegative(),
    detailSucceeded: z.number().int().nonnegative(),
    detailFetched: z.number().int().nonnegative(),
    cacheHits: z.number().int().nonnegative(),
    rawCatalog: z.number().int().nonnegative(),
    workerReceived: z.number().int().nonnegative(),
    stagingGames: z.number().int().nonnegative(),
    publishedGames: z.number().int().nonnegative(),
    opggEnabled: z.boolean().optional(),
    opggMatchups: z.number().int().nonnegative().optional(),
    opggResolved: z.number().int().nonnegative().optional()
  })
  .strict()

export const MemberAnalysisJobSchema = z
  .object({
    jobId: z.string().trim().min(1).max(64),
    status: MemberAnalysisJobStatusSchema,
    progress: z.number().finite().min(0).max(1),
    message: z.string().max(512),
    startedAt: z.iso.datetime().nullable(),
    finishedAt: z.iso.datetime().nullable(),
    checkpointAt: z.iso.datetime().nullable(),
    error: z
      .object({
        code: z.string().trim().min(1).max(64),
        message: z.string().max(512)
      })
      .strict()
      .nullable()
  })
  .strict()

export const MemberAnalysisErrorCodeSchema = z.enum([
  'FEATURE_DISABLED',
  'NOT_INITIALIZED',
  'INVALID_ARGUMENT',
  'WORKER_UNAVAILABLE',
  'JOB_ALREADY_RUNNING',
  'JOB_NOT_FOUND',
  'CANCELLED',
  'INTERNAL_ERROR'
])

export const MemberAnalysisErrorSchema = z
  .object({
    code: MemberAnalysisErrorCodeSchema,
    message: z.string().max(512),
    retryable: z.boolean()
  })
  .strict()

export const MemberAnalysisMemberSchema = z
  .object({
    serverId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{1,64}$/),
    gameName: z.string().trim().min(1).max(96),
    tagLine: z.string().trim().min(1).max(32)
  })
  .strict()

export const MEMBER_ANALYSIS_DEFAULT_HISTORY_TAG = 'ranked'
export const MemberAnalysisHistoryTagSchema = z
  .string()
  .regex(/^(?:ranked|normal|q_[1-9][0-9]{0,5})$/)
export const MemberAnalysisHistoryDepthSchema = z.union([
  z.literal(20),
  z.literal(50),
  z.literal(100),
  z.literal(200),
  z.literal(500),
  z.literal(1000),
  z.literal('all')
])

export const MemberAnalysisSettingsSchema = z
  .object({
    enabled: z.boolean(),
    members: z.array(MemberAnalysisMemberSchema).max(20),
    historyDepth: MemberAnalysisHistoryDepthSchema,
    scanLimitPerMember: z.number().int().min(100).max(5000),
    historyTag: MemberAnalysisHistoryTagSchema,
    storageLimitGiB: z.number().int().min(1).max(1000),
    opggEnabled: z.boolean()
  })
  .strict()

export const MemberAnalysisStorageStatusSchema = z
  .object({
    totalBytes: z.number().int().nonnegative(),
    rawBytes: z.number().int().nonnegative(),
    limitBytes: z.number().int().positive(),
    overLimit: z.boolean(),
    catalogGames: z.number().int().nonnegative()
  })
  .strict()

export const MemberAnalysisCleanupPreviewSchema = z
  .object({
    previewId: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
    currentBytes: z.number().int().nonnegative(),
    limitBytes: z.number().int().positive(),
    reclaimableBytes: z.number().int().nonnegative(),
    gameCount: z.number().int().nonnegative()
  })
  .strict()

export const MemberAnalysisCapabilitiesSchema = z
  .object({
    contractVersion: z.literal(MEMBER_ANALYSIS_CONTRACT_VERSION),
    dataVersion: z.literal(MEMBER_ANALYSIS_DATA_VERSION),
    featureEnabled: z.boolean(),
    workerAvailable: z.boolean(),
    methods: z.array(
      z.enum([
        'getCapabilities',
        'getOverview',
        'getSettings',
        'updateSettings',
        'startRefresh',
        'getJob',
        'cancelJob',
        'getStorageStatus',
        'previewCleanup',
        'confirmCleanup'
      ])
    )
  })
  .strict()

export const MemberAnalysisOverviewSchema = z
  .object({
    contractVersion: z.literal(MEMBER_ANALYSIS_CONTRACT_VERSION),
    dataVersion: z.literal(MEMBER_ANALYSIS_DATA_VERSION),
    firstRun: z.boolean(),
    generatedAt: z.iso.datetime().nullable(),
    source: z.string().trim().min(1).max(128),
    gameCount: z.number().int().nonnegative(),
    playerCount: z.number().int().nonnegative(),
    collectionAudit: MemberAnalysisCollectionAuditSchema.nullable(),
    games: z.array(MemberAnalysisGameSchema),
    pagination: z.object({ nextCursor: z.string().max(256).nullable() }).strict()
  })
  .strict()

export const MemberAnalysisOverviewRequestSchema = z
  .object({
    filters: MemberAnalysisFiltersSchema.optional(),
    pagination: MemberAnalysisPaginationSchema.optional()
  })
  .strict()
  .optional()

export const MemberAnalysisUpdateSettingsRequestSchema =
  MemberAnalysisSettingsSchema.partial().strict()
export const MemberAnalysisStartRefreshRequestSchema = z
  .object({ filters: MemberAnalysisFiltersSchema.optional() })
  .strict()
  .optional()
export const MemberAnalysisJobRequestSchema = z
  .object({ jobId: z.string().trim().min(1).max(64) })
  .strict()
  .optional()
export const MemberAnalysisConfirmCleanupRequestSchema = z
  .object({ previewId: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict()

export type MemberAnalysisPayload = z.infer<typeof MemberAnalysisPayloadSchema>
export type MemberAnalysisGame = z.infer<typeof MemberAnalysisGameSchema>
export type MemberAnalysisPlayerGame = z.infer<typeof MemberAnalysisPlayerGameSchema>
export type MemberAnalysisLaneGankDeathEvent = z.infer<
  typeof MemberAnalysisLaneGankDeathEventSchema
>
export type MemberAnalysisFilters = z.infer<typeof MemberAnalysisFiltersSchema>
export type MemberAnalysisSettings = z.infer<typeof MemberAnalysisSettingsSchema>
export type MemberAnalysisSettingsUpdate = z.infer<typeof MemberAnalysisUpdateSettingsRequestSchema>
export type MemberAnalysisStorageStatus = z.infer<typeof MemberAnalysisStorageStatusSchema>
export type MemberAnalysisCleanupPreview = z.infer<typeof MemberAnalysisCleanupPreviewSchema>
export type MemberAnalysisCapabilities = z.infer<typeof MemberAnalysisCapabilitiesSchema>
export type MemberAnalysisOverview = z.infer<typeof MemberAnalysisOverviewSchema>
export type MemberAnalysisError = z.infer<typeof MemberAnalysisErrorSchema>
export type MemberAnalysisErrorCode = z.infer<typeof MemberAnalysisErrorCodeSchema>
export type MemberAnalysisJobStatus = z.infer<typeof MemberAnalysisJobStatusSchema>
export type MemberAnalysisJob = z.infer<typeof MemberAnalysisJobSchema>
export type MemberAnalysisCollectionAudit = z.infer<typeof MemberAnalysisCollectionAuditSchema>

export type MemberAnalysisResult<T> =
  { ok: true; value: T } | { ok: false; error: MemberAnalysisError }

export function migrateLegacyMemberAnalysisPayload(input: unknown): MemberAnalysisPayload {
  const legacy = LegacyMemberAnalysisPayloadSchema.parse(input)
  return MemberAnalysisPayloadSchema.parse({
    contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
    dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
    ...legacy
  })
}
