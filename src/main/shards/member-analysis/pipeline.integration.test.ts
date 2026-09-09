import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { MemberAnalysisPipeline } from './pipeline'
import { MemberAnalysisRepository } from './repository'
import { MemberAnalysisWorkerSupervisor, resolveWorkerLaunch } from './worker-supervisor'

const python = process.env.MEMBER_ANALYSIS_TEST_PYTHON

async function waitFor(predicate: () => boolean) {
  for (let index = 0; index < 200; index += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('integration pipeline timed out')
}

describe('member analysis main + real Python sidecar', () => {
  test.skipIf(!python)(
    'publishes an anonymous normalized match from temporary userData',
    async () => {
      const root = mkdtempSync(join(tmpdir(), 'member-analysis-integration-'))
      const repository = new MemberAnalysisRepository(root)
      repository.initialize()
      try {
        const summary = {
          json: {
            gameId: 17,
            gameCreation: 1_700_000_000_000,
            gameDuration: 1800,
            gameVersion: '26.1.2',
            mapId: 11,
            queueId: 420,
            participants: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((role, index) => ({
              _target: true,
              _targetName: `Member${index + 1}#TEST`,
              participantId: index + 1,
              puuid: `anonymous-${index}`,
              teamId: 100,
              teamPosition: role,
              riotIdGameName: `Player${index}`,
              riotIdTagline: 'TEST',
              championName: `Champion${index}`,
              kills: 2,
              deaths: 1,
              assists: 3,
              totalDamageDealtToChampions: 10000,
              goldEarned: 10000,
              totalMinionsKilled: 150,
              neutralMinionsKilled: 0,
              visionScore: 20,
              wardsPlaced: 5,
              wardsKilled: 2,
              visionWardsBoughtInGame: 1,
              totalDamageTaken: 8000,
              damageSelfMitigated: 3000,
              damageDealtToObjectives: 1500,
              damageDealtToTurrets: 500,
              totalHealsOnTeammates: 0,
              totalDamageShieldedOnTeammates: 0,
              timeCCingOthers: 5,
              firstBloodKill: false,
              firstBloodAssist: false,
              firstTowerKill: false,
              firstTowerAssist: false,
              win: true,
              challenges: { soloKills: 0 }
            })),
            teams: [{ teamId: 100, win: true, objectives: {} }]
          }
        }
        const item = repository.storeRaw('TEST', 17, 420, repository.checksum(summary), summary, {})
        const collector = {
          collect: async () => ({
            items: [item],
            changed: [item],
            skipped: 0,
            memberErrors: 0,
            audit: {
              requestedMembers: 5,
              resolvedMembers: 5,
              memberScans: Array.from({ length: 5 }, (_, index) => ({
                member: index + 1,
                status: 'RESOLVED',
                historyGames: 1,
                pages: 1,
                stopReason: 'source-exhausted'
              })),
              targetHistoryDepth: 100,
              scanLimitPerMember: 2000,
              collectionStopReason: 'source-exhausted',
              sourceUnion: 1,
              sourceIntersection: 1,
              fivePresent: 1,
              fiveSameTeam: 1,
              mapEligible: 1,
              queueEligible: 1,
              roleEligible: 1,
              targetSelected: 1,
              detailSucceeded: 1,
              detailFetched: 1,
              cacheHits: 0,
              rawCatalog: 1,
              workerReceived: 0,
              stagingGames: 0,
              publishedGames: 0
            }
          })
        }
        const launch = resolveWorkerLaunch({
          packaged: false,
          resourcesPath: '',
          developmentPython: python,
          sourceRoot: process.cwd()
        })
        const worker = new MemberAnalysisWorkerSupervisor(launch, null, 20_000)
        const pipeline = new MemberAnalysisPipeline(collector as any, repository, worker, {
          enabled: true,
          members: [{ serverId: 'TEST', gameName: 'Anonymous', tagLine: 'TEST' }],
          historyDepth: 100,
          scanLimitPerMember: 2000,
          historyTag: 'ranked',
          storageLimitGiB: 10,
          opggEnabled: false
        })
        const job = pipeline.start()
        await waitFor(() => ['completed', 'failed'].includes(pipeline.get(job.jobId)?.status ?? ''))
        expect(pipeline.get(job.jobId)).toMatchObject({ status: 'completed', progress: 1 })
        const published = repository.readGames()
        expect(published.games).toHaveLength(1)
        expect(published.collectionAudit).toMatchObject({
          rawCatalog: 1,
          workerReceived: 1,
          stagingGames: 1,
          publishedGames: 1
        })
        expect(published.games[0]).toMatchObject({ gameId: 17, patch: '26.1', side: 'Blue' })
        await pipeline.dispose()
      } finally {
        repository.close()
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
