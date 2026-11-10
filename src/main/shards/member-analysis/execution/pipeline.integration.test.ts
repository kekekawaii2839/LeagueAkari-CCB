import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'

import { MemberAnalysisRepository } from '../repository'
import { MemberAnalysisPipeline } from './pipeline'
import { MemberAnalysisWorkerSupervisor, resolveWorkerLaunch } from './worker-supervisor'

const python = process.env.MEMBER_ANALYSIS_TEST_PYTHON

// Vitest does not implement Electron Vite's ?nodeWorker transform. Substitute
// only that factory with actual built worker bundles. Callers must build the
// current source before setting the two bundle paths for a release check.
// Identity verification and SQLite rank publication still run in real threads.
vi.mock('../published-identities-worker?nodeWorker', async () => {
  const { Worker } = await import('node:worker_threads')
  return {
    default: (options: ConstructorParameters<typeof Worker>[1]) => {
      const path = process.env.MEMBER_ANALYSIS_TEST_IDENTITIES_WORKER
      if (!path) throw new Error('Build main and set MEMBER_ANALYSIS_TEST_IDENTITIES_WORKER')
      return new Worker(path, options)
    }
  }
})
vi.mock('../opponent-ranks/rank-publication-worker?nodeWorker', async () => {
  const { Worker } = await import('node:worker_threads')
  return {
    default: (options: ConstructorParameters<typeof Worker>[1]) => {
      const path = process.env.MEMBER_ANALYSIS_TEST_RANK_PUBLICATION_WORKER
      if (!path) throw new Error('Build main and set MEMBER_ANALYSIS_TEST_RANK_PUBLICATION_WORKER')
      return new Worker(path, options)
    }
  }
})

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
            participants: Array.from({ length: 10 }, (_, index) => ({
              _target: index < 5,
              _targetName: `Member${index + 1}#TEST`,
              participantId: index + 1,
              puuid: `anonymous-${index}`,
              teamId: index < 5 ? 100 : 200,
              teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][index % 5],
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
            teams: [
              { teamId: 100, win: true, objectives: {}, bans: [{ championId: 1 }] },
              { teamId: 200, win: false, objectives: {}, bans: [] }
            ]
          }
        }
        // Collector hashes the original response before adding its two target annotations.
        const original = JSON.parse(JSON.stringify(summary))
        for (const actor of original.json.participants) {
          delete actor._target
          delete actor._targetName
        }
        const item = repository.storeRaw(
          'TEST',
          17,
          420,
          repository.checksum(original),
          summary,
          {}
        )
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
        const workerMessages: unknown[] = []
        const runWorker = worker.run.bind(worker)
        const workerRun = vi.spyOn(worker, 'run').mockImplementation((args, onMessage) =>
          runWorker(args, (message) => {
            workerMessages.push(message)
            onMessage(message)
          })
        )
        const job = pipeline.start()
        const publication = vi.spyOn(repository, 'publishStagingAsync')
        await waitFor(() => ['completed', 'failed'].includes(pipeline.get(job.jobId)?.status ?? ''))
        // Surface the real publication failure rather than only the sanitized job error.
        if (publication.mock.results[0]?.type === 'return') await publication.mock.results[0].value
        expect(workerMessages.filter((message: any) => message.type === 'error')).toEqual([])
        if (workerRun.mock.results[0]?.type === 'return') {
          await expect(
            workerRun.mock.results[0].value,
            JSON.stringify(workerMessages)
          ).resolves.toMatchObject({ type: 'result', status: 'completed' })
        }
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
        expect(published.games[0].teamMetrics).toMatchObject({
          totalKills: 20,
          dragons: null,
          firstTowerTime: null
        })
        expect(published.games[0].bans).toEqual({ own: [1], enemy: [] })
        await pipeline.dispose()
      } finally {
        repository.close()
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
