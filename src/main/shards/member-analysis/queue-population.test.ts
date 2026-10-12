import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gunzipSync } from 'node:zlib'
import { expect, test, vi } from 'vitest'

import { predictionObservationsFromGames } from '../../../../packages/prediction-lab/src/akari-metrics'
import { MemberAnalysisCollector } from './collector'
import { MemberAnalysisPipeline } from './execution'
import { MemberAnalysisRepository } from './repository'

const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
const members = roles.map((_, index) => ({
  serverId: 'TEST',
  gameName: `Member${index + 1}`,
  tagLine: 'TEST'
}))
function summary(gameId: number, queueId: number, gameDuration = 1800) {
  return {
    json: {
      gameId,
      queueId,
      gameDuration,
      gameCreation: gameId,
      mapId: 11,
      participants: [
        ...roles.map((teamPosition, index) => ({
          puuid: `synthetic-${index + 1}`,
          teamId: 100,
          teamPosition
        })),
        ...roles.map((teamPosition, index) => ({
          puuid: `synthetic-enemy-${index + 1}`,
          teamId: 200,
          teamPosition
        }))
      ]
    }
  }
}

// A deliberately small fake derivation: this tests the real collector/manifest/publication/
// overview boundary, NOT Python derive_game correctness or real sidecar execution.
function payload(source: ReturnType<typeof summary>) {
  const eventDecision = Object.fromEntries(
    [
      'killEpisodes',
      'convertedKillEpisodes',
      'killToEpicEpisodes',
      'killToTowerEpisodes',
      'conversionDelayTotalSec',
      'conversionDelaySamples',
      'deathEpisodes',
      'highCostDeathEpisodes',
      'deathCostEpics',
      'deathCostTowers',
      'deathCostPlates',
      'deathCostPoints',
      'shutdownBountyLost',
      'objectivesTaken',
      'cleanObjectives',
      'wonFightObjectives',
      'evenFightObjectives',
      'lostFightObjectives',
      'objectiveFightSamples',
      'objectiveFightWins',
      'enemyObjectives',
      'tradedEnemyObjectives',
      'tradeDelayTotalSec',
      'tradeDelaySamples'
    ].map((key) => [key, 0])
  )
  return {
    gameId: source.json.gameId,
    timestamp: source.json.gameCreation,
    date: '2026-01-01',
    patch: '1.1',
    side: 'Blue' as const,
    win: true,
    duration: source.json.gameDuration,
    roster: 'synthetic five',
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    counterMean: null,
    upperGold15: 0,
    botGold15: 0,
    gold20Diff: 0,
    tower20Diff: 0,
    jungle: null,
    eventDecision,
    players: roles.map((role, index) => ({
      player: `Member${index + 1}#TEST`,
      role,
      champion: 'Synthetic',
      minutes: 30,
      kills: 0,
      deaths: 0,
      assists: 0,
      teamKills: 0,
      teamDeaths: 0,
      damage: 0,
      damageShare: null,
      gold: 0,
      goldShare: null,
      cs: 0,
      vision: 0,
      wardsPlaced: 0,
      wardsKilled: 0,
      controlWards: 0,
      damageTaken: 0,
      takenShare: null,
      damageMitigated: 0,
      objectiveDamage: 0,
      turretDamage: 0,
      healTeammates: 0,
      shieldTeammates: 0,
      ccSeconds: 0,
      soloKills: 0,
      fbPart: false,
      ftPart: false,
      kp: null,
      gd10: null,
      gd15: null,
      csd15: null,
      xpd15: null,
      damageDiff15: null,
      soloDiff15: null,
      counter: null
    }))
  }
}

function fixture(games: ReturnType<typeof summary>[], historyDepth: 20 | 100 = 100) {
  const expectedParent = resolve(tmpdir())
  const root = mkdtempSync(join(expectedParent, 'member-analysis-queue-synthetic-'))
  const repository = new MemberAnalysisRepository(root)
  repository.initialize()
  const riotClient = {
    api: {
      playerAccount: {
        getPlayerAccountAlias: vi.fn(async (gameName: string) => ({
          data: [
            {
              alias: { game_name: gameName, tag_line: 'TEST' },
              puuid: `synthetic-${gameName.replace('Member', '')}`
            }
          ]
        }))
      }
    }
  }
  const details = vi.fn(async () => ({ data: {} }))
  const history = vi.fn(async (_puuid: string, options: { startIndex: number; count: number }) => ({
    // Intentionally return both queues: the real collector must enforce q_N itself.
    data: { games: games.slice(options.startIndex, options.startIndex + options.count) }
  }))
  const sgp = {
    state: {
      availability: { sgpServerId: '', serversSupported: { common: false } },
      isTokenReady: false
    },
    api: {
      matchHistoryQuery: {
        getMatchHistorySummaryByPlayerPuuid: history,
        getGameDetailsByGameId: details
      }
    }
  }
  const collector = new MemberAnalysisCollector(riotClient as any, sgp as any, repository)
  const manifests: any[] = []
  let failWorker = false
  const worker = {
    available: true,
    cancel: vi.fn(),
    dispose: vi.fn(async () => {}),
    run: vi.fn(async (args: string[]) => {
      const manifest = JSON.parse(
        readFileSync(join(root, args[args.indexOf('--manifest') + 1]), 'utf8')
      )
      manifests.push(manifest)
      if (failWorker) return { type: 'result', status: 'failed' }
      rmSync(repository.stagingAnalysisPath, { force: true })
      const db = new DatabaseSync(repository.stagingAnalysisPath)
      try {
        db.exec(
          'CREATE TABLE derived_games(server_id TEXT,game_id INTEGER,payload_json TEXT); CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);'
        )
        db.prepare('INSERT INTO metadata VALUES(?,?)').run(
          'generated_at',
          '2026-01-01T00:00:00.000Z'
        )
        db.prepare('INSERT INTO metadata VALUES(?,?)').run('derivation_version', '4')
        db.prepare('INSERT INTO metadata VALUES(?,?)').run(
          'collection_audit',
          JSON.stringify({
            ...manifest.audit,
            workerReceived: manifest.items.length,
            stagingGames: manifest.items.length,
            publishedGames: manifest.items.length
          })
        )
        for (const item of manifest.items) {
          const raw = JSON.parse(gunzipSync(readFileSync(join(root, item.summaryPath))).toString())
          db.prepare('INSERT INTO derived_games VALUES(?,?,?)').run(
            item.serverId,
            item.gameId,
            JSON.stringify(payload(raw))
          )
        }
      } finally {
        db.close()
      }
      return { type: 'result', status: 'completed' }
    })
  }
  const settings = {
    enabled: true,
    members,
    historyDepth,
    scanLimitPerMember: 100,
    historyTag: 'q_430',
    storageLimitGiB: 10,
    opggEnabled: false
  }
  const pipeline = new MemberAnalysisPipeline(collector, repository, worker as any, settings)
  return {
    repository,
    pipeline,
    settings,
    manifests,
    details,
    history,
    fail: () => {
      failWorker = true
    },
    async close() {
      await pipeline.dispose()
      repository.close()
      expect(dirname(resolve(root))).toBe(expectedParent)
      expect(basename(resolve(root)).startsWith('member-analysis-queue-synthetic-')).toBe(true)
      rmSync(root, { recursive: true, force: true })
    }
  }
}

async function refresh(value: ReturnType<typeof fixture>) {
  const job = value.pipeline.start()
  for (let i = 0; i < 200; i++) {
    const state = value.pipeline.get(job.jobId)!
    if (['completed', 'failed', 'cancelled'].includes(state.status)) return state.status
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw Error('synthetic refresh timed out')
}

test('queue A then B retains raw union but replaces manifest/analysis/overview population', async () => {
  const value = fixture([summary(20, 440), summary(10, 430)])
  try {
    expect(await refresh(value)).toBe('completed')
    expect(value.repository.readGames().games.map((g) => g.gameId)).toEqual([10])
    value.settings.historyTag = 'q_440'
    // Saving/changing collection settings alone does not regenerate existing analysis.
    expect(value.repository.readGames().games.map((g) => g.gameId)).toEqual([10])
    expect(await refresh(value)).toBe('completed')
    expect(value.repository.catalogItem('TEST', 10)?.queueId).toBe(430)
    expect(value.repository.catalogItem('TEST', 20)?.queueId).toBe(440)
    expect(value.repository.storageStatus(10).catalogGames).toBe(2)
    expect(value.manifests.map((m) => m.items.map((i: any) => i.gameId))).toEqual([[10], [20]])
    const db = new DatabaseSync(value.repository.currentAnalysisPath, { readOnly: true })
    try {
      expect(db.prepare('SELECT game_id FROM derived_games').all()).toEqual([{ game_id: 20 }])
    } finally {
      db.close()
    }
    const overview = value.repository.readGames()
    expect(overview.games.map((g) => g.gameId)).toEqual([20])
    expect(
      new Set(predictionObservationsFromGames(overview.games).map((row) => row.gameId))
    ).toEqual(new Set([20]))
    expect(await refresh(value)).toBe('completed')
    expect(value.details).toHaveBeenCalledTimes(2)
    expect(value.manifests[2].audit.cacheHits).toBe(1)
    expect(value.manifests[2].items.map((i: any) => i.gameId)).toEqual([20])
    value.settings.historyTag = 'q_430'
    value.fail()
    expect(await refresh(value)).toBe('failed')
    expect(value.repository.readGames().games.map((g) => g.gameId)).toEqual([20])
  } finally {
    await value.close()
  }
})

test('short latest matches consume collection depth before overview eligibility exclusion', async () => {
  const value = fixture(
    [...Array.from({ length: 20 }, (_, index) => summary(30 + index, 430, 600)), summary(10, 430)],
    20
  )
  try {
    expect(await refresh(value)).toBe('completed')
    expect(value.manifests[0].items.map((i: any) => i.gameId)).toEqual(
      Array.from({ length: 20 }, (_, index) => 49 - index)
    )
    expect(value.manifests[0].audit).toMatchObject({
      targetSelected: 20,
      collectionStopReason: 'target-reached'
    })
    expect(value.repository.catalogItem('TEST', 10)).toBeNull()
    const overview = value.repository.readGames()
    expect(overview.total).toBe(0)
    expect(overview.games).toEqual([])
    expect(predictionObservationsFromGames(overview.games)).toEqual([])
  } finally {
    await value.close()
  }
})
