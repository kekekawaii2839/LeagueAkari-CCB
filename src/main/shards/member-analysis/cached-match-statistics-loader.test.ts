import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test } from 'vitest'

import {
  CachedMatchStatisticsLoader,
  cachedSummaryStatistics
} from './cached-match-statistics-loader'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))
const game = { gameId: 1, side: 'Blue' } as MemberAnalysisGame
const summary = () => ({
  json: {
    gameId: 1,
    participants: Array.from({ length: 10 }, (_, i) => ({
      participantId: i + 1,
      teamId: i < 5 ? 100 : 200,
      kills: 2
    })),
    teams: [
      {
        teamId: 100,
        bans: [{ championId: 3 }, { championId: -1 }],
        objectives: { baron: { kills: 0 } }
      },
      { teamId: 200, bans: [] }
    ]
  }
})
test('summary enrichment separates absent, observed zero and team scope without timeline guesses', () => {
  expect(cachedSummaryStatistics(summary(), game)).toEqual({
    bans: { own: [3], enemy: [] },
    teamMetrics: {
      totalKills: 20,
      barons: 0,
      dragons: null,
      dragonSouls: null,
      elderDragons: null,
      firstDragonTime: null,
      firstTowerTime: null
    }
  })
  expect(cachedSummaryStatistics(summary(), { ...game, side: 'Red' })?.bans).toEqual({
    own: [],
    enemy: [3]
  })
  expect(
    cachedSummaryStatistics({ ...summary(), json: { ...summary().json, gameId: 2 } }, game)
  ).toBeNull()
})
test('bounded cache reads exact verified local summaries and invalidates with publication', async () => {
  const root = mkdtempSync(join(tmpdir(), 'akari-cached-statistics-'))
  roots.push(root)
  mkdirSync(join(root, 'raw/TEST/1'), { recursive: true })
  const raw = summary(),
    original = JSON.stringify(raw),
    checksum = createHash('sha256').update(original).digest('hex')
  const file = join(root, 'raw/TEST/1/summary.json.gz')
  writeFileSync(file, gzipSync(original))
  let token = 'gen-a'
  const repo = {
    dataRoot: root,
    publicationToken: () => token,
    readPublishedProfileRows: () => [{ server_id: 'TEST', game_id: 1, checksum, ambiguous: 1 }],
    catalogItem: () => ({ checksum, summaryPath: 'raw/TEST/1/summary.json.gz' })
  }
  const loader = new CachedMatchStatisticsLoader(repo as any)
  expect((await loader.enrich([game], token))[0].bans?.own).toEqual([3])
  writeFileSync(file, gzipSync(JSON.stringify({ ...raw, json: { ...raw.json, gameId: 999 } })))
  expect((await loader.enrich([game], token))[0].bans?.own).toEqual([3])
  token = 'gen-b'
  expect((await loader.enrich([game], token))[0].bans).toBeUndefined()
  await expect(loader.enrich(Array(101).fill(game), token)).rejects.toThrow(
    'Invalid cached statistics page'
  )
  loader.dispose()
  await expect(loader.enrich([game], token)).rejects.toThrow('Stale cached statistics request')
})
