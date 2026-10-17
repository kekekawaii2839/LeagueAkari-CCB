import { describe, expect, test } from 'vitest'

import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION,
  MemberAnalysisGameSchema,
  MemberAnalysisJobSchema,
  MemberAnalysisPayloadSchema,
  MemberAnalysisPlayerGameSchema,
  MemberAnalysisSettingsSchema,
  MemberAnalysisUpdateSettingsRequestSchema,
  migrateLegacyMemberAnalysisPayload,
  normalizeLegacyMemberAnalysisGame
} from './schemas'
import { summarizeMemberAnalysisPayload } from './summary'

const anonymousLegacyPayload = {
  meta: {
    generatedAt: '2026-01-01T00:00:00.000Z',
    source: 'synthetic-fixture',
    gameCount: 1,
    players: ['Player Alpha']
  },
  games: [
    {
      gameId: 1,
      timestamp: 1,
      date: '2026-01-01',
      patch: '1.1',
      side: 'Blue',
      win: true,
      duration: 1800,
      roster: 'anonymous-roster',
      dragon15Diff: 1,
      grub15Diff: 0,
      objectiveFight15Diff: 1,
      counterMean: null,
      upperGold15: 100,
      botGold15: -50,
      gold20Diff: 200,
      tower20Diff: 1,
      jungle: null,
      eventDecision: {
        killEpisodes: 1,
        convertedKillEpisodes: 1,
        killToEpicEpisodes: 1,
        killToTowerEpisodes: 0,
        conversionDelayTotalSec: 15,
        conversionDelaySamples: 1,
        deathEpisodes: 0,
        highCostDeathEpisodes: 0,
        deathCostEpics: 0,
        deathCostTowers: 0,
        deathCostPlates: 0,
        deathCostPoints: 0,
        shutdownBountyLost: 0,
        objectivesTaken: 1,
        cleanObjectives: 1,
        wonFightObjectives: 0,
        evenFightObjectives: 0,
        lostFightObjectives: 0,
        objectiveFightSamples: 0,
        objectiveFightWins: 0,
        enemyObjectives: 0,
        tradedEnemyObjectives: 0,
        tradeDelayTotalSec: 0,
        tradeDelaySamples: 0
      },
      players: [
        {
          player: 'Player Alpha',
          role: 'TOP',
          champion: 'Champion A',
          minutes: 30,
          kills: 1,
          deaths: 0,
          assists: 2,
          teamKills: 5,
          teamDeaths: 3,
          damage: 1000,
          damageShare: 0.2,
          gold: 10000,
          goldShare: 0.2,
          cs: 200,
          vision: 10,
          wardsPlaced: 5,
          wardsKilled: 1,
          controlWards: 1,
          damageTaken: 500,
          takenShare: 0.1,
          damageMitigated: 200,
          objectiveDamage: 100,
          turretDamage: 50,
          healTeammates: 0,
          shieldTeammates: 0,
          ccSeconds: 2,
          soloKills: 1,
          fbPart: false,
          ftPart: true,
          kp: 0.6,
          gd10: null,
          gd15: 100,
          csd15: 5,
          xpd15: 50,
          damageDiff15: 100,
          soloDiff15: 1,
          counter: null
        }
      ]
    }
  ]
}

describe('member analysis contract', () => {
  test('preserves exact match-local participant IDs without inventing them for legacy rows', () => {
    const payload = migrateLegacyMemberAnalysisPayload(anonymousLegacyPayload)
    const player = payload.games[0].players[0]
    expect(MemberAnalysisPlayerGameSchema.parse(player).participantId).toBeUndefined()
    expect(
      MemberAnalysisPlayerGameSchema.parse({ ...player, participantId: 6 }).participantId
    ).toBe(6)
    for (const participantId of [0, 11, 1.5]) {
      expect(MemberAnalysisPlayerGameSchema.safeParse({ ...player, participantId }).success).toBe(
        false
      )
    }
  })
  test('migrates and validates the legacy dashboard payload at the explicit legacy boundary', () => {
    const payload = migrateLegacyMemberAnalysisPayload(anonymousLegacyPayload)
    expect(payload.contractVersion).toBe(MEMBER_ANALYSIS_CONTRACT_VERSION)
    expect(payload.dataVersion).toBe(MEMBER_ANALYSIS_DATA_VERSION)
    expect(MemberAnalysisPayloadSchema.parse(payload)).toEqual(payload)
    expect(summarizeMemberAnalysisPayload(payload)).toEqual({
      gameCount: 1,
      playerCount: 1,
      wins: 1,
      winRate: 1
    })
  })

  test('summary excludes short games but retains exactly 15 minutes and raw payload', () => {
    const payload = migrateLegacyMemberAnalysisPayload(anonymousLegacyPayload)
    const base = payload.games[0]
    payload.games = [
      { ...base, gameId: 1, duration: 900, win: true },
      { ...base, gameId: 2, duration: 901, win: false },
      { ...base, gameId: 3, duration: 899, win: true },
      { ...base, gameId: 4, duration: 0, win: true }
    ]
    expect(summarizeMemberAnalysisPayload(payload)).toEqual({
      gameCount: 2,
      playerCount: 1,
      wins: 1,
      winRate: 0.5
    })
    expect(payload.games).toHaveLength(4)
    expect(summarizeMemberAnalysisPayload({ ...payload, games: payload.games.slice(2) })).toEqual({
      gameCount: 0,
      playerCount: 0,
      wins: 0,
      winRate: 0
    })
  })

  test('rejects invalid enums, oversized strings, and unversioned current payloads', () => {
    expect(
      MemberAnalysisPayloadSchema.safeParse({
        ...anonymousLegacyPayload,
        contractVersion: 1,
        dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
        games: [{ ...anonymousLegacyPayload.games[0], side: 'Purple' }]
      }).success
    ).toBe(false)
    expect(
      MemberAnalysisPayloadSchema.safeParse({
        ...anonymousLegacyPayload,
        contractVersion: 1,
        dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
        meta: { ...anonymousLegacyPayload.meta, source: 'x'.repeat(129) }
      }).success
    ).toBe(false)
    expect(MemberAnalysisPayloadSchema.safeParse(anonymousLegacyPayload).success).toBe(false)
  })

  test('accepts a cross-map trade completed shortly before the enemy objective', () => {
    const payload = MemberAnalysisPayloadSchema.parse({
      ...anonymousLegacyPayload,
      contractVersion: 1,
      dataVersion: MEMBER_ANALYSIS_DATA_VERSION
    })
    payload.games[0].eventDecision!.tradeDelayTotalSec = -12
    payload.games[0].eventDecision!.tradeDelaySamples = 1
    expect(
      MemberAnalysisPayloadSchema.parse(payload).games[0].eventDecision!.tradeDelayTotalSec
    ).toBe(-12)
  })

  test('keeps legacy gank data missing and validates timestamped gank evidence', () => {
    const migrated = migrateLegacyMemberAnalysisPayload(anonymousLegacyPayload)
    expect(migrated.games[0].laneGankDeaths).toBeNull()

    const event = {
      victimPlayer: 'Player Alpha',
      victimRole: 'TOP',
      victimChampion: 'Champion A',
      enemyJunglerChampion: 'Champion B',
      timestampSec: 180,
      lane: 'top',
      involvement: 'assist'
    }
    const payload = {
      ...migrated,
      games: [
        {
          ...migrated.games[0],
          laneGankDeaths: { methodVersion: 1, status: 'available', events: [event] }
        }
      ]
    }
    expect(MemberAnalysisPayloadSchema.safeParse(payload).success).toBe(true)
    expect(
      MemberAnalysisPayloadSchema.safeParse({
        ...payload,
        games: [
          {
            ...payload.games[0],
            laneGankDeaths: {
              methodVersion: 1,
              status: 'available',
              events: [{ ...event, timestampSec: 840 }]
            }
          }
        ]
      }).success
    ).toBe(false)
  })

  test('validates the versioned job contract and rejects invalid progress', () => {
    const job = {
      jobId: 'job-1',
      status: 'analyzing',
      progress: 0.5,
      message: 'Synthetic progress',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: null,
      checkpointAt: '2026-01-01T00:00:01.000Z',
      error: null
    }
    expect(MemberAnalysisJobSchema.parse(job)).toEqual(job)
    expect(MemberAnalysisJobSchema.safeParse({ ...job, progress: 2 }).success).toBe(false)
  })

  test('enforces the approved fixed-member refresh policy', () => {
    const settings = {
      enabled: true,
      members: [{ serverId: 'TENCENT_TEST', gameName: 'Anonymous', tagLine: 'TEST' }],
      historyDepth: 100,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      storageLimitGiB: 10,
      opggEnabled: false
    }
    expect(MemberAnalysisSettingsSchema.parse(settings)).toEqual(settings)
    expect(MemberAnalysisSettingsSchema.safeParse({ ...settings, historyTag: 'q_6' }).success).toBe(
      true
    )
    expect(MemberAnalysisSettingsSchema.safeParse({ ...settings, historyTag: 'all' }).success).toBe(
      false
    )
    expect(
      MemberAnalysisSettingsSchema.safeParse({ ...settings, historyTag: 'q_invalid' }).success
    ).toBe(false)
    expect(MemberAnalysisSettingsSchema.safeParse({ ...settings, historyDepth: 20 }).success).toBe(
      true
    )
    expect(MemberAnalysisUpdateSettingsRequestSchema.parse({ enabled: false })).toEqual({
      enabled: false
    })
    expect(
      MemberAnalysisSettingsSchema.safeParse({
        ...settings,
        members: [{ ...settings.members[0], serverId: '../escape' }]
      }).success
    ).toBe(false)
    expect(MemberAnalysisSettingsSchema.safeParse({ ...settings, historyDepth: 500 }).success).toBe(
      true
    )
    expect(
      MemberAnalysisSettingsSchema.safeParse({ ...settings, historyDepth: 'all' }).success
    ).toBe(true)
    expect(
      MemberAnalysisSettingsSchema.safeParse({ ...settings, historyDepth: 2000 }).success
    ).toBe(false)
    expect(
      MemberAnalysisSettingsSchema.safeParse({ ...settings, scanLimitPerMember: 5001 }).success
    ).toBe(false)
  })
})

test('v5 preserves actual zero/null and legacy recovery never guesses zero provenance', () => {
  const input = structuredClone(anonymousLegacyPayload.games[0])
  input.players[0].damage = 0
  const current = MemberAnalysisGameSchema.parse(input)
  expect(current.players[0].damage).toBe(0)
  expect(current.gold20Diff).toBe(200)
  const legacy = normalizeLegacyMemberAnalysisGame(input)
  expect(legacy.players[0].damage).toBeNull()
  expect(legacy.players[0].gold).toBe(input.players[0].gold)
  expect(legacy.gold20Diff).toBeNull()
  expect(legacy.eventDecision).toBeNull()
  expect(legacy.metricSemantics).toBe('legacy-unknown')
  expect(input.players[0].damage).toBe(0)
})

test('a mixed compatibility payload keeps each game semantics and unavailable fields', () => {
  const raw = structuredClone(anonymousLegacyPayload.games[0])
  const legacy = normalizeLegacyMemberAnalysisGame(raw)
  const current = MemberAnalysisGameSchema.parse({
    ...raw,
    gameId: 2,
    metricSemantics: 'current-v5'
  })
  const payload = MemberAnalysisPayloadSchema.parse({
    contractVersion: 1,
    dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
    meta: { ...anonymousLegacyPayload.meta, gameCount: 2 },
    games: [legacy, current]
  })
  expect(payload.games[0].gold20Diff).toBeNull()
  expect(payload.games[1].gold20Diff).toBe(200)
  expect(payload.games.map((g) => g.metricSemantics)).toEqual(['legacy-unknown', 'current-v5'])
})

test('LP trend experiment is additive, optional for old settings and strictly boolean', () => {
  expect(
    MemberAnalysisUpdateSettingsRequestSchema.safeParse({ experimentalLpTrendEnabled: true })
      .success
  ).toBe(true)
  expect(
    MemberAnalysisUpdateSettingsRequestSchema.safeParse({ experimentalLpTrendEnabled: 'true' })
      .success
  ).toBe(false)
  expect(MemberAnalysisUpdateSettingsRequestSchema.safeParse({}).success).toBe(true)
})

test('optional match avatar metadata preserves old players and rejects malformed identity/icon values without weakening strict rows', () => {
  const player = migrateLegacyMemberAnalysisPayload(anonymousLegacyPayload).games[0].players[0]
  expect(MemberAnalysisPlayerGameSchema.parse(player).profileIconId).toBeUndefined()
  expect(
    MemberAnalysisPlayerGameSchema.parse({
      ...player,
      profileIdentity: 'a'.repeat(64),
      profileIconId: 0
    }).profileIconId
  ).toBe(0)
  expect(
    MemberAnalysisPlayerGameSchema.parse({ ...player, profileIdentity: null, profileIconId: null })
      .profileIconId
  ).toBeNull()
  for (const profileIconId of [-1, 0.1, Infinity, '1', Number.MAX_SAFE_INTEGER + 1])
    expect(MemberAnalysisPlayerGameSchema.safeParse({ ...player, profileIconId }).success).toBe(
      false
    )
  expect(
    MemberAnalysisPlayerGameSchema.safeParse({ ...player, profileIdentity: 'raw-puuid' }).success
  ).toBe(false)
  expect(
    MemberAnalysisPlayerGameSchema.safeParse({
      ...player,
      profileIconId: 0,
      arbitraryPath: '/tmp/icon'
    }).success
  ).toBe(false)
})
