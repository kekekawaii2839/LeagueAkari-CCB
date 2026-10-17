import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { describe, expect, test, vi } from 'vitest'

import { MemberAnalysisCollector } from './collector'

const MEMBERS = Array.from({ length: 5 }, (_, index) => ({
  serverId: 'TEST',
  gameName: `Member${index + 1}`,
  tagLine: 'TEST'
}))
const ROLES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const

function harness(known: string | null, targetCount = 5) {
  const participants = [
    ...Array.from({ length: targetCount }, (_, index) => ({
      puuid: `target-${index + 1}`,
      teamId: 100,
      teamPosition: ROLES[index]
    })),
    ...Array.from({ length: 5 - targetCount }, (_, index) => ({
      puuid: `outsider-${index + 1}`,
      teamId: 100
    })),
    ...Array.from({ length: 5 }, (_, index) => ({ puuid: `enemy-${index + 1}`, teamId: 200 }))
  ]
  const summary = { json: { gameId: 7, mapId: 11, queueId: 420, gameDuration: 1800, participants } }
  const riotClient = {
    api: {
      playerAccount: {
        getPlayerAccountAlias: vi.fn(async (gameName: string) => {
          const index = Number(gameName.replace('Member', ''))
          return {
            data: [{ alias: { game_name: gameName, tag_line: 'TEST' }, puuid: `target-${index}` }]
          }
        })
      }
    }
  }
  const sgp = {
    state: {
      availability: { sgpServerId: '', serversSupported: { common: false } },
      isTokenReady: false
    },
    api: {
      matchHistoryQuery: {
        getMatchHistorySummaryByPlayerPuuid: vi.fn(
          async (_puuid: string, options: { startIndex: number }) => ({
            data: { games: options.startIndex === 0 ? [summary] : [] }
          })
        ),
        getGameDetailsByGameId: vi.fn(async () => ({ data: { json: { frames: [] } } }))
      }
    }
  }
  const item = {
    serverId: 'TEST',
    gameId: 7,
    queueId: 420,
    checksum: 'checksum',
    summaryPath: 'raw/TEST/7/summary.json.gz',
    detailsPath: 'raw/TEST/7/details.json.gz'
  }
  const repository = {
    opponentRanks: {
      readGamePlayer: vi.fn(() => null),
      wasGamePlayerCapturedLive: vi.fn(() => false),
      readGame: vi.fn(),
      readPlayer: vi.fn(() => null),
      pruneAsync: vi.fn(async () => {}),
      publishGames: vi.fn()
    },
    recordMember: vi.fn(),
    checksum: vi.fn(() => 'checksum'),
    knownChecksum: vi.fn(() => known),
    catalogItem: vi.fn(() => item),
    updateRawSummary: vi.fn(),
    storeRaw: vi.fn(() => item)
  }
  return { riotClient, sgp, repository }
}

describe('member analysis main-only collector', () => {
  test('retries a transient history 500 on the same page without losing samples', async () => {
    const value = harness('checksum')
    const read = value.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid
    const original = read.getMockImplementation()!
    read.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500 } })
    read.mockImplementation(original)
    const collector = new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    )
    const result = await collector.collect({
      members: MEMBERS,
      historyDepth: 100,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items).toHaveLength(1)
    const firstMemberReads = read.mock.calls.filter(([puuid]) => puuid === 'target-1')
    expect(firstMemberReads.map(([, options]) => options.startIndex)).toEqual([0, 0, 1])
  })

  test.each([
    [500, 3],
    [401, 1]
  ])(
    'bounds retries for HTTP %s and never treats failure as exhaustion',
    async (status, attempts) => {
      const value = harness('checksum')
      const read = value.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid
      const failure = { isAxiosError: true, response: { status } }
      read.mockRejectedValue(failure)
      const collector = new MemberAnalysisCollector(
        value.riotClient as any,
        value.sgp as any,
        value.repository as any
      )
      await expect(
        collector.collect({
          members: MEMBERS,
          historyDepth: 100,
          historyTag: 'ranked',
          signal: new AbortController().signal,
          onProgress: vi.fn()
        })
      ).rejects.toBe(failure)
      expect(read.mock.calls.filter(([puuid]) => puuid === 'target-1')).toHaveLength(attempts)
      expect(value.repository.storeRaw).not.toHaveBeenCalled()
    }
  )

  test('cancels during history retry backoff without another request', async () => {
    const value = harness('checksum')
    const abort = new AbortController()
    const read = value.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid
    read.mockImplementation(async () => {
      setImmediate(() => abort.abort(new Error('cancelled')))
      throw { isAxiosError: true, response: { status: 503 } }
    })
    const collector = new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    )
    await expect(
      collector.collect({
        members: MEMBERS,
        historyDepth: 100,
        historyTag: 'ranked',
        signal: abort.signal,
        onProgress: vi.fn()
      })
    ).rejects.toThrow()
    expect(read.mock.calls.filter(([puuid]) => puuid === 'target-1')).toHaveLength(1)
  })

  test('reuses cached DETAILS but refreshes the configured-five annotations', async () => {
    const value = harness('checksum')
    const collector = new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    )
    const result = await collector.collect({
      members: MEMBERS,
      historyDepth: 100,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result).toMatchObject({
      items: [{ gameId: 7 }],
      changed: [],
      skipped: 0,
      memberErrors: 0
    })
    expect(result.rankSnapshots[0].playerSnapshots).toHaveLength(10)
    expect(new Set(result.rankSnapshots[0].playerSnapshots?.map((p) => p.puuid)).size).toBe(10)
    expect(
      result.rankSnapshots[0].playerSnapshots?.every(
        (p) => p.snapshot.reason === 'disconnected' && !p.capturedDuringGame
      )
    ).toBe(true)
    expect(result.rankSnapshots[0].ranks.opponents).toHaveLength(5)
    expect(
      result.rankSnapshots[0].ranks.opponents.every(
        ({ snapshot }) => snapshot.reason === 'disconnected'
      )
    ).toBe(true)
    expect(value.repository.opponentRanks.publishGames).not.toHaveBeenCalled()
    expect(value.sgp.api.matchHistoryQuery.getGameDetailsByGameId).not.toHaveBeenCalled()
    expect(value.repository.updateRawSummary).toHaveBeenCalledOnce()
    const normalized = value.repository.updateRawSummary.mock.calls[0][1] as any
    expect(
      normalized.json.participants.filter((participant: any) => participant._target)
    ).toHaveLength(5)
    expect(
      normalized.json.participants.filter((participant: any) => participant._targetName)
    ).toHaveLength(5)
  })

  test('rejects a match unless exactly five configured members share one team', async () => {
    const value = harness(null, 4)
    const collector = new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    )
    const result = await collector.collect({
      members: MEMBERS,
      historyDepth: 100,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result).toMatchObject({ items: [], changed: [], skipped: 1, memberErrors: 0 })
    expect(value.repository.storeRaw).not.toHaveBeenCalled()
    expect(value.sgp.api.matchHistoryQuery.getGameDetailsByGameId).not.toHaveBeenCalled()
  })

  test('passes only server, pagination and AbortSignal to authenticated API helpers', async () => {
    const value = harness(null)
    const collector = new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    )
    const result = await collector.collect({
      members: MEMBERS,
      historyDepth: 100,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items).toHaveLength(1)
    expect(result.changed).toHaveLength(1)
    const historyCalls = value.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid.mock
      .calls as unknown as unknown[][]
    const detailCalls = value.sgp.api.matchHistoryQuery.getGameDetailsByGameId.mock
      .calls as unknown as unknown[][]
    const historyOptions = historyCalls[0][1] as Record<string, unknown>
    const detailOptions = detailCalls[0][1] as Record<string, unknown>
    expect(Object.keys(historyOptions).sort()).toEqual([
      '__sgpServerId',
      'count',
      'signal',
      'startIndex',
      'tag',
      'tagsQueryType'
    ])
    expect(historyOptions).toMatchObject({ tag: 'ranked', tagsQueryType: 'AND' })
    expect(Object.keys(detailOptions).sort()).toEqual(['__sgpServerId', 'signal'])
    expect(JSON.stringify([historyOptions, detailOptions]).toLowerCase()).not.toContain('token')
    const storeCalls = value.repository.storeRaw.mock.calls as unknown as unknown[][]
    const normalized = storeCalls[0][4] as any
    expect(normalized).not.toHaveProperty('authorization')
    expect(
      normalized.json.participants.filter((participant: any) => participant._target)
    ).toHaveLength(5)
  })

  test.each([20, 50, 100])(
    'treats historyDepth=%i as the final five-stack target and scans beyond the first 100',
    async (historyDepth) => {
      const games = [
        ...Array.from({ length: 120 }, (_, index) => syntheticSummary(1_000 - index, false)),
        ...Array.from({ length: 100 }, (_, index) => syntheticSummary(800 - index, true))
      ]
      const value = pagedHarness(Array.from({ length: 5 }, () => games))
      const result = await new MemberAnalysisCollector(
        value.riotClient as any,
        value.sgp as any,
        value.repository as any
      ).collect({
        members: MEMBERS,
        historyDepth,
        historyTag: 'ranked',
        signal: new AbortController().signal,
        onProgress: vi.fn()
      })
      expect(result.items).toHaveLength(historyDepth)
      expect(result.audit.targetSelected).toBe(historyDepth)
      expect(result.audit.memberScans.every((member) => member.historyGames > 100)).toBe(true)
      expect(result.audit.memberScans.every((member) => member.pages >= 2)).toBe(true)
    }
  )

  test('publishes every eligible game for the all target until the source is exhausted', async () => {
    const games = Array.from({ length: 120 }, (_, index) => syntheticSummary(10_000 - index, true))
    const value = pagedHarness(Array.from({ length: 5 }, () => games))
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members: MEMBERS,
      historyDepth: 'all',
      scanLimitPerMember: 500,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items).toHaveLength(120)
    expect(result.audit).toMatchObject({
      targetHistoryDepth: 'all',
      scanLimitPerMember: 500,
      collectionStopReason: 'source-exhausted',
      targetSelected: 120
    })
  })

  test('advances by the server page length when SGP caps pages below the requested count', async () => {
    const games = [
      ...Array.from({ length: 120 }, (_, index) => syntheticSummary(1_000 - index, false)),
      ...Array.from({ length: 50 }, (_, index) => syntheticSummary(800 - index, true))
    ]
    const value = pagedHarness(
      Array.from({ length: 5 }, () => games),
      false,
      20
    )
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members: MEMBERS,
      historyDepth: 50,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items).toHaveLength(50)
    expect(result.audit.collectionStopReason).toBe('target-reached')
    expect(result.audit.memberScans.every((member) => member.pages === 9)).toBe(true)
    const starts = value.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid.mock.calls
      .filter(([puuid]) => puuid === 'target-1')
      .map(([, options]) => options.startIndex)
    expect(starts).toEqual([0, 20, 40, 60, 80, 100, 120, 140, 160])
  })

  test('continues scanning past five-stack matches that cannot resolve all five roles', async () => {
    const unresolved = Array.from({ length: 100 }, (_, index) => {
      const game = syntheticSummary(1_000 - index, true)
      ;(game.json.participants[4] as any).teamPosition = ''
      return game
    })
    const valid = Array.from({ length: 20 }, (_, index) => syntheticSummary(800 - index, true))
    const value = pagedHarness(Array.from({ length: 5 }, () => [...unresolved, ...valid]))
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members: MEMBERS,
      historyDepth: 20,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items).toHaveLength(20)
    expect(result.audit).toMatchObject({ queueEligible: 120, roleEligible: 20 })
  })

  test('passes a selected Akari queue tag through and verifies its queue id', async () => {
    const recentNormal = Array.from({ length: 10 }, (_, index) =>
      syntheticSummary(1_000 - index, true, 400)
    )
    const olderRanked = Array.from({ length: 20 }, (_, index) =>
      syntheticSummary(900 - index, true, 440)
    )
    const value = pagedHarness(
      Array.from({ length: 5 }, () => recentNormal),
      false,
      Infinity,
      Array.from({ length: 5 }, () => olderRanked)
    )
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members: MEMBERS,
      historyDepth: 20,
      scanLimitPerMember: 2000,
      historyTag: 'q_440',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items).toHaveLength(20)
    expect(result.audit).toMatchObject({
      collectionStopReason: 'target-reached',
      queueEligible: 20,
      targetSelected: 20
    })
    const calls = value.sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid.mock.calls
    expect(calls.every(([, options]) => options.tag === 'q_440')).toBe(true)
    expect(calls.every(([, options]) => options.tagsQueryType === 'AND')).toBe(true)
  })

  test('audits source union/intersection, stable-PUUID same-team filtering, queue filtering and deduplication', async () => {
    const common = syntheticSummary(70, true)
    common.json.participants.reverse()
    common.json.participants.forEach((participant: any, index: number) => {
      participant.teamPosition = ['UTILITY', 'BOTTOM', 'MIDDLE', 'JUNGLE', 'TOP'][index % 5]
      participant.riotIdGameName = 'renamed-display'
      participant.riotIdTagline = 'NEW'
    })
    ;(common.json.participants as any[]).push({
      puuid: 'same-display-different-puuid',
      teamId: 100,
      riotIdGameName: 'Member1'
    })
    const wrongQueue = syntheticSummary(69, true, 450)
    const histories = Array.from({ length: 5 }, (_, member) => [
      common,
      wrongQueue,
      syntheticSummary(60 - member, false)
    ])
    const value = pagedHarness(histories)
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members: MEMBERS,
      historyDepth: 50,
      scanLimitPerMember: 2000,
      historyTag: 'q_420',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items.map((item) => item.gameId)).toEqual([70])
    expect(result.audit).toMatchObject({
      sourceUnion: 7,
      sourceIntersection: 2,
      fivePresent: 7,
      fiveSameTeam: 2,
      queueEligible: 1,
      detailSucceeded: 1
    })
  })

  test('supports a larger member pool with different five-player rotations', async () => {
    const members = [...MEMBERS, { serverId: 'TEST', gameName: 'Member6', tagLine: 'TEST' }]
    const first = rotatingSummary(72, [1, 2, 3, 4, 5])
    const second = rotatingSummary(71, [2, 3, 4, 5, 6])
    const histories = [
      [first],
      [first, second],
      [first, second],
      [first, second],
      [first, second],
      [second]
    ]
    const value = pagedHarness(histories)
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members,
      historyDepth: 20,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: vi.fn()
    })
    expect(result.items.map((item) => item.gameId)).toEqual([72, 71])
    expect(result.audit).toMatchObject({
      requestedMembers: 6,
      resolvedMembers: 6,
      fiveSameTeam: 2,
      queueEligible: 2
    })
  })

  test('detects a repeated pagination page instead of silently publishing partial history', async () => {
    const repeated = Array.from({ length: 100 }, (_, index) => syntheticSummary(500 - index, false))
    const value = pagedHarness(
      Array.from({ length: 5 }, () => repeated),
      true
    )
    await expect(
      new MemberAnalysisCollector(
        value.riotClient as any,
        value.sgp as any,
        value.repository as any
      ).collect({
        members: MEMBERS,
        historyDepth: 50,
        scanLimitPerMember: 2000,
        historyTag: 'ranked',
        signal: new AbortController().signal,
        onProgress: vi.fn()
      })
    ).rejects.toThrow('pagination repeated a page for anonymous member')
  })
})

describe('cached raw item event-loop boundaries', () => {
  function cachedBatch() {
    const history = Array.from({ length: 16 }, (_, index) => syntheticSummary(index + 1, true))
    const value = pagedHarness(Array.from({ length: 5 }, () => history))
    const repository = {
      ...value.repository,
      knownChecksum: vi.fn((_server: string, id: number) => `checksum-${id}`),
      catalogItem: vi.fn((serverId: string, gameId: number) => ({
        serverId,
        gameId,
        queueId: 420,
        checksum: `checksum-${gameId}`,
        summaryPath: `raw/${serverId}/${gameId}/summary.json.gz`,
        detailsPath: `raw/${serverId}/${gameId}/details.json.gz`
      }))
    }
    return { ...value, repository }
  }

  test('lets a queued event-loop callback run before a fully cached batch finishes without changing collection facts', async () => {
    const value = cachedBatch()
    let observedWrites: number | null = null
    let observer: Promise<void> | null = null
    const progress: number[] = []
    const result = await new MemberAnalysisCollector(
      value.riotClient as any,
      value.sgp as any,
      value.repository as any
    ).collect({
      members: MEMBERS,
      historyDepth: 20,
      scanLimitPerMember: 100,
      historyTag: 'ranked',
      signal: new AbortController().signal,
      onProgress: (processed, _total, message) => {
        if (message !== 'loading-details') return
        progress.push(processed)
        if (processed === 1)
          observer = yieldToEventLoop().then(() => {
            observedWrites = value.repository.updateRawSummary.mock.calls.length
          })
      }
    })
    expect(observedWrites).toBe(1)
    await observer
    expect(progress).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(result.items.map((item) => item.gameId)).toEqual(
      Array.from({ length: 16 }, (_, i) => 16 - i)
    )
    expect(result.changed).toEqual([])
    expect(result.audit.cacheHits).toBe(16)
    expect(result.audit.detailFetched).toBe(0)
    expect(value.repository.updateRawSummary).toHaveBeenCalledTimes(16)
    expect(value.repository.storeRaw).not.toHaveBeenCalled()
    expect(value.sgp.api.matchHistoryQuery.getGameDetailsByGameId).not.toHaveBeenCalled()
  })

  test('honors cancellation during a yield after one complete cached item, before the next item', async () => {
    const value = cachedBatch()
    const control = new AbortController()
    let cancellation: Promise<void> | null = null
    await expect(
      new MemberAnalysisCollector(
        value.riotClient as any,
        value.sgp as any,
        value.repository as any
      ).collect({
        members: MEMBERS,
        historyDepth: 20,
        scanLimitPerMember: 100,
        historyTag: 'ranked',
        signal: control.signal,
        onProgress: (processed, _total, message) => {
          if (message === 'loading-details' && processed === 1)
            cancellation = yieldToEventLoop().then(() => {
              control.abort(new Error('Synthetic cancellation'))
            })
        }
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    await cancellation
    expect(value.repository.updateRawSummary).toHaveBeenCalledTimes(1)
    expect(value.repository.catalogItem).toHaveBeenCalledWith('TEST', 16)
    expect(value.repository.opponentRanks.publishGames).not.toHaveBeenCalled()
    expect(value.repository.storeRaw).not.toHaveBeenCalled()
    expect(value.sgp.api.matchHistoryQuery.getGameDetailsByGameId).not.toHaveBeenCalled()
  })
})

function syntheticSummary(gameId: number, sameTeam: boolean, queueId = 420) {
  return {
    json: {
      gameId,
      gameCreation: gameId,
      mapId: 11,
      queueId,
      participants: [
        ...Array.from({ length: 5 }, (_, index) => ({
          puuid: `target-${index + 1}`,
          teamId: sameTeam || index < 4 ? 100 : 200,
          teamPosition: ROLES[index]
        })),
        ...Array.from({ length: 5 }, (_, index) => ({ puuid: `enemy-${index}`, teamId: 200 }))
      ]
    }
  }
}

function rotatingSummary(gameId: number, members: number[]) {
  return {
    json: {
      gameId,
      gameCreation: gameId,
      mapId: 11,
      queueId: 420,
      participants: [
        ...members.map((member, index) => ({
          puuid: `target-${member}`,
          teamId: 100,
          teamPosition: ROLES[index]
        })),
        ...Array.from({ length: 5 }, (_, index) => ({ puuid: `enemy-${index}`, teamId: 200 }))
      ]
    }
  }
}

function pagedHarness(
  histories: any[][],
  repeatFirstPage = false,
  serverPageCap = Infinity,
  rankedHistories: any[][] | null = null
) {
  const riotClient = {
    api: {
      playerAccount: {
        getPlayerAccountAlias: vi.fn(async (gameName: string) => {
          const index = Number(gameName.replace('Member', ''))
          return {
            data: [{ alias: { game_name: gameName, tag_line: 'test' }, puuid: `target-${index}` }]
          }
        })
      }
    }
  }
  const history = vi.fn(
    async (
      puuid: string,
      options: { startIndex: number; count: number; tag?: string; tagsQueryType?: string }
    ) => {
      const member = Number(puuid.replace('target-', '')) - 1
      const start = repeatFirstPage ? 0 : options.startIndex
      const source = options.tag && rankedHistories ? rankedHistories : histories
      return {
        data: {
          games: source[member].slice(start, start + Math.min(options.count, serverPageCap))
        }
      }
    }
  )
  const item = (gameId: number) => ({
    serverId: 'TEST',
    gameId,
    queueId: 420,
    checksum: `checksum-${gameId}`,
    summaryPath: `raw/TEST/${gameId}/summary.json.gz`,
    detailsPath: `raw/TEST/${gameId}/details.json.gz`
  })
  return {
    riotClient,
    sgp: {
      api: {
        matchHistoryQuery: {
          getMatchHistorySummaryByPlayerPuuid: history,
          getGameDetailsByGameId: vi.fn(async () => ({ data: { json: { frames: [] } } }))
        }
      }
    },
    repository: {
      opponentRanks: {
        readGame: vi.fn(),
        pruneAsync: vi.fn(async () => {}),
        publishGames: vi.fn()
      },
      recordMember: vi.fn(),
      checksum: vi.fn((summary: any) => `checksum-${summary.json.gameId}`),
      knownChecksum: vi.fn(() => null),
      catalogItem: vi.fn(),
      updateRawSummary: vi.fn(),
      storeRaw: vi.fn((_server: string, gameId: number) => item(gameId))
    }
  }
}
