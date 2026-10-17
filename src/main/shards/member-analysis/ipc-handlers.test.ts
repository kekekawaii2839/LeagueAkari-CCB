import { describe, expect, test, vi } from 'vitest'

import type { MemberAnalysisMainContext } from './context'
import { CurrentRankRefresh } from './current-rank-refresh'
import { MemberAnalysisIpcHandlers } from './ipc-handlers'
import { initializeMemberAnalysisSafely } from './lifecycle'
import { MemberAnalysisController } from './member-analysis-controller'
import { MemberAnalysisRuntimeState, MemberAnalysisSettingsState } from './state'

function createHarness() {
  const handlers = new Map<string, (...args: any[]) => any>()
  const mainWebContents = {}
  const settings = new MemberAnalysisSettingsState()
  const runtime = new MemberAnalysisRuntimeState()
  runtime.setInitialized()
  const context = {
    namespace: 'member-analysis-main',
    ipc: {
      onCall: (_namespace: string, name: string, handler: (...args: any[]) => any) =>
        handlers.set(name, handler)
    },
    logger: { warn: vi.fn(), error: vi.fn() },
    windowManager: { mainWindow: { window: { webContents: mainWebContents } } },
    settings,
    runtime,
    settingService: {
      set: vi.fn(async (key: keyof MemberAnalysisSettingsState, value: never) => {
        ;(settings[key] as unknown) = value
      })
    },
    repository: {
      waitForPublication: vi.fn(async () => {}),
      readMatchDetails: vi.fn(() => null),
      readMatchOverview: vi.fn(() => null),
      resolveConfiguredMember: vi.fn(() => null),
      opponentRanks: {
        readPlayerHistoryPage: vi.fn(() => ({ points: [], pagination: { nextCursor: null } }))
      },
      readGames: vi.fn(() => ({
        generatedAt: null,
        games: [],
        total: 0,
        playerCount: 0,
        nextCursor: null
      })),
      storageStatusAsync: vi.fn(async () => ({
        totalBytes: 0,
        rawBytes: 0,
        limitBytes: 10 * 1024 ** 3,
        overLimit: false,
        catalogGames: 0
      })),
      previewCleanup: vi.fn(),
      confirmCleanup: vi.fn()
    },
    pipeline: {
      workerAvailable: false,
      start: vi.fn(),
      get: vi.fn(() => null),
      cancel: vi.fn(() => null)
    }
  } as unknown as MemberAnalysisMainContext
  const controller = new MemberAnalysisController(context)
  new MemberAnalysisIpcHandlers(context, controller).register()
  const event = { sender: mainWebContents }
  return { handlers, event, context }
}

describe('member analysis IPC boundary', () => {
  test('complete refresh cancels an in-flight current-rank action before starting; late identity replies cannot write', async () => {
    const { handlers, event, context } = createHarness()
    context.settings.enabled = true
    context.settings.experimentalLpTrendEnabled = true
    context.settings.members = Array.from({ length: 5 }, (_, index) => ({
      serverId: 'TEST',
      gameName: `Synthetic ${index + 1}`,
      tagLine: 'TEST_ONLY'
    }))
    Object.defineProperty(context.pipeline, 'workerAvailable', { value: true })
    let reply!: (puuid: string) => void
    let signal!: AbortSignal
    const recordMember = vi.fn(),
      capture = vi.fn()
    context.currentRankRefresh = new CurrentRankRefresh({ recordMember }, () => context.settings, {
      session: () => 'SYNTHETIC_SESSION',
      resolve: (_member, requestSignal) => {
        signal = requestSignal
        return new Promise((resolve) => {
          reply = resolve
        })
      },
      capture
    })
    vi.mocked(context.pipeline.start).mockImplementation(() => {
      expect(signal.aborted).toBe(true)
      return {
        jobId: 'synthetic-job',
        status: 'starting',
        progress: 0,
        message: '',
        startedAt: null,
        finishedAt: null,
        checkpointAt: null,
        error: null
      }
    })
    const pending = handlers.get('refreshCurrentRanks')!(event, {
      requestId: '11111111-1111-4111-8111-111111111111'
    })
    expect(await handlers.get('startRefresh')!(event)).toMatchObject({ ok: true })
    reply('LATE_TEST_ONLY')
    expect(await pending).toMatchObject({ ok: true, value: { status: 'cancelled' } })
    expect(recordMember).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
    expect(context.pipeline.start).toHaveBeenCalledTimes(1)
  })
  test('current-rank actions accept only an operation id from the main renderer, never caller-selected identities or URLs', async () => {
    const { handlers, event, context } = createHarness()
    const start = vi.fn(async () => ({ ok: true, value: { synthetic: true } })),
      cancel = vi.fn(() => true)
    context.currentRankRefresh = { start, cancel, dispose: vi.fn() } as unknown as NonNullable<
      MemberAnalysisMainContext['currentRankRefresh']
    >
    context.settings.enabled = true
    const request = { requestId: '11111111-1111-4111-8111-111111111111' }
    for (const method of ['refreshCurrentRanks', 'cancelCurrentRankRefresh']) {
      expect(await handlers.get(method)!({ sender: {} }, request)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' }
      })
      for (const value of [
        { ...request, puuid: 'FORGED_TEST_ONLY' },
        { ...request, url: 'https://synthetic.invalid' },
        { ...request, memberSlot: 1 },
        { requestId: 'bad' }
      ])
        expect(await handlers.get(method)!(event, value)).toMatchObject({
          ok: false,
          error: { code: 'INVALID_ARGUMENT' }
        })
    }
    expect(start).not.toHaveBeenCalled()
    expect(cancel).not.toHaveBeenCalled()
    expect(await handlers.get('refreshCurrentRanks')!(event, request)).toMatchObject({ ok: true })
    expect(start).toHaveBeenCalledWith(request.requestId)
    expect(await handlers.get('cancelCurrentRankRefresh')!(event, request)).toEqual({
      ok: true,
      value: { cancelled: true }
    })
    expect(cancel).toHaveBeenCalledWith(request.requestId)
  })
  test('member settings retain dedicated source, full field validation and normalized reads/writes', async () => {
    const { handlers, event, context } = createHarness()
    expect(handlers.get('getSettings')!({ sender: {} })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(await handlers.get('updateSettings')!({ sender: {} }, { enabled: false })).toMatchObject(
      { ok: false, error: { code: 'INVALID_ARGUMENT' } }
    )
    for (const settings of [
      { storageLimitGiB: null },
      { scanLimitPerMember: 100.5 },
      { members: [{ serverId: 'bad/server', gameName: 'Synthetic', tagLine: 'TEST' }] },
      { members: [{ serverId: 'SYNTHETIC', gameName: '   ', tagLine: 'TEST' }] }
    ])
      expect(await handlers.get('updateSettings')!(event, settings)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' }
      })
    expect(context.settingService.set).not.toHaveBeenCalled()
    const result = await handlers.get('updateSettings')!(event, {
      members: [{ serverId: ' SYNTHETIC ', gameName: ' Synthetic Name ', tagLine: ' TEST ' }]
    })
    expect(result).toMatchObject({
      ok: true,
      value: { members: [{ serverId: 'SYNTHETIC', gameName: 'Synthetic Name', tagLine: 'TEST' }] }
    })
    expect(handlers.get('getSettings')!(event)).toEqual(result)
  })

  test('keeps the prediction experiment off by default and saves it via validated settings', async () => {
    const { handlers, event, context } = createHarness()
    const get = handlers.get('getSettings')!
    const update = handlers.get('updateSettings')!
    expect(await get(event)).toMatchObject({
      ok: true,
      value: { experimentalPredictionEnabled: false }
    })
    expect(await update(event, { experimentalPredictionEnabled: 'true' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(await update(event, { experimentalPredictionEnabled: true })).toMatchObject({
      ok: true,
      value: { experimentalPredictionEnabled: true }
    })
    expect(context.settingService.set).toHaveBeenCalledWith('experimentalPredictionEnabled', true)
    await update(event, { opggEnabled: true })
    expect(await get(event)).toMatchObject({
      ok: true,
      value: { experimentalPredictionEnabled: true }
    })
    await update(event, { experimentalPredictionEnabled: false })
    expect(await get(event)).toMatchObject({
      ok: true,
      value: { experimentalPredictionEnabled: false }
    })
  })
  test('prediction registration accepts only five declared aliases and rejects forged forecasts, paths and non-main senders', () => {
    const { handlers, event } = createHarness()
    const invoke = handlers.get('startPredictionOpportunity')!
    const request = {
      members: Array.from({ length: 5 }, (_, i) => ({
        serverId: 'SYNTHETIC',
        gameName: `Member${i}`,
        tagLine: 'TEST'
      })),
      side: 'all',
      targetQueue: null
    }
    for (const args of [
      [],
      [{ ...request, probability: 0.99 }],
      [{ ...request, path: 'private-input.json' }],
      [{ ...request, members: request.members.slice(0, 4) }],
      [{ ...request, side: 'Blue' }],
      [request, 'extra']
    ])
      expect(invoke(event, ...args)).resolves.toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' }
      })
    expect(invoke({ sender: {} }, request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(invoke(event, request)).resolves.toEqual({
      ok: true,
      value: { status: 'rejected', reason: 'not-ready' }
    })
    expect(handlers.get('getPredictionPilotSummary')!(event, 'extra')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(
      handlers.get('cancelPredictionOpportunity')!(event, { id: '../private-input' })
    ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
  })
  test('summary-only match overview enforces caller, strict arguments and publication state', async () => {
    const { handlers, event, context } = createHarness()
    const invoke = handlers.get('getMatchOverview')!
    expect(await invoke(event, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' }
    })
    context.settings.enabled = true
    for (const args of [
      [],
      [{ gameId: 0 }],
      [{ gameId: 1.5 }],
      [{ gameId: Number.MAX_SAFE_INTEGER + 1 }],
      [{ gameId: 1, path: 'private' }],
      [{ gameId: 1, puuid: 'private' }],
      [{ gameId: 1 }, 'extra']
    ])
      expect(await invoke(event, ...args)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' }
      })
    expect(await invoke({ sender: {} }, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(context.repository.readMatchOverview).not.toHaveBeenCalled()
    let release!: () => void
    vi.mocked(context.repository.waitForPublication).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const pending = invoke(event, { gameId: 1 })
    expect(context.repository.readMatchOverview).not.toHaveBeenCalled()
    context.settings.enabled = false
    release()
    expect(await pending).toMatchObject({ ok: false, error: { code: 'FEATURE_DISABLED' } })
    expect(context.repository.readMatchOverview).not.toHaveBeenCalled()
    context.settings.enabled = true
    expect(await invoke(event, { gameId: 1 })).toEqual({ ok: true, value: null })
    vi.mocked(context.repository.waitForPublication).mockRejectedValueOnce(
      new Error('private publication recovery')
    )
    expect(await invoke(event, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Cached match overview could not be read' }
    })
    vi.mocked(context.repository.readMatchOverview).mockImplementationOnce(() => {
      throw new Error('private path')
    })
    expect(await invoke(event, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Cached match overview could not be read' }
    })
    expect(context.repository.readMatchDetails).not.toHaveBeenCalled()
    expect(handlers.get('getCapabilities')!(event).value.methods).toContain('getMatchOverview')
  })

  test('restricts cached native match details to enabled main renderer and a strict game ID', async () => {
    const { handlers, event, context } = createHarness()
    const invoke = handlers.get('getMatchDetails')!
    expect(await invoke(event, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' }
    })
    context.settings.enabled = true
    for (const args of [
      [],
      [{ gameId: -1 }],
      [{ gameId: 1.5 }],
      [{ gameId: Number.MAX_SAFE_INTEGER + 1 }],
      [{ gameId: 1, path: 'x' }],
      [{ gameId: 1 }, 'extra']
    ]) {
      expect(await invoke(event, ...args)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' }
      })
    }
    expect(await invoke({ sender: {} }, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(context.repository.readMatchDetails).not.toHaveBeenCalled()
    expect(await invoke(event, { gameId: 1 })).toEqual({ ok: true, value: null })
    vi.mocked(context.repository.readMatchDetails).mockImplementation(() => {
      throw new Error('private path')
    })
    expect(await invoke(event, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Cached match details could not be read' }
    })
  })
  test('blocks settings changes during refresh and cancels when disabling', async () => {
    const { handlers, event, context } = createHarness()
    vi.mocked(context.pipeline.get).mockReturnValue({
      jobId: 'running',
      status: 'collecting'
    } as any)
    expect(
      await handlers.get('updateSettings')!(event, { scanLimitPerMember: 3000 })
    ).toMatchObject({ ok: false, error: { code: 'JOB_ALREADY_RUNNING' } })
    expect(context.settingService.set).not.toHaveBeenCalled()
    expect(await handlers.get('updateSettings')!(event, { enabled: false })).toMatchObject({
      ok: true
    })
    expect(context.pipeline.cancel).toHaveBeenCalledWith('running')
  })
  test('rejects invalid arguments and calls from a non-main renderer', async () => {
    const { handlers, event } = createHarness()
    expect(await handlers.get('updateSettings')!(event, { enabled: 'yes' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(await handlers.get('getOverview')!({ sender: {} }, undefined)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(await handlers.get('getJob')!(event, { jobId: 'x'.repeat(65) })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(await handlers.get('getOverview')!(event, undefined, 'extra')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
  })

  test('does not start background capability while disabled and exposes stable errors', async () => {
    const { handlers, event } = createHarness()
    expect(await handlers.get('startRefresh')!(event, undefined)).toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' }
    })
    expect(await handlers.get('getJob')!(event)).toMatchObject({
      ok: false,
      error: { code: 'FEATURE_DISABLED' }
    })
    expect(await handlers.get('updateSettings')!(event, { enabled: true })).toEqual({
      ok: true,
      value: {
        enabled: true,
        members: [],
        historyDepth: 100,
        scanLimitPerMember: 2000,
        historyTag: 'ranked',
        storageLimitGiB: 10,
        opggEnabled: false,
        experimentalPredictionEnabled: false,
        experimentalLpTrendEnabled: false,
        experimentalVersionTrendEnabled: false
      }
    })
    expect(await handlers.get('startRefresh')!(event, undefined)).toMatchObject({
      ok: false,
      error: { code: 'WORKER_UNAVAILABLE' }
    })
  })

  test('does not misreport a stored payload validation failure as an invalid filter', async () => {
    const { handlers, event, context } = createHarness()
    await handlers.get('updateSettings')!(event, { enabled: true })
    vi.mocked(context.repository.readGames).mockImplementation(() => {
      throw new Error('payload validation failed')
    })
    expect(await handlers.get('getOverview')!(event, undefined)).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: 'Stored member analysis data failed validation' }
    })
  })

  test('ordinary storage reads await async statistics and retain initialization and IO errors', async () => {
    const { handlers, event, context } = createHarness()
    const status = {
      totalBytes: 123,
      rawBytes: 23,
      limitBytes: 10 * 1024 ** 3,
      overLimit: false,
      catalogGames: 2
    }
    vi.mocked(context.repository.storageStatusAsync).mockResolvedValue(status)
    expect(await handlers.get('getStorageStatus')!(event)).toEqual({ ok: true, value: status })
    expect(context.repository.storageStatusAsync).toHaveBeenCalledWith(10)
    vi.mocked(context.repository.storageStatusAsync).mockRejectedValue(
      new Error('synthetic IO error')
    )
    await expect(handlers.get('getStorageStatus')!(event)).rejects.toThrow('synthetic IO error')
    context.runtime.setDegraded('synthetic not initialized')
    expect(await handlers.get('getStorageStatus')!(event)).toMatchObject({
      ok: false,
      error: { code: 'NOT_INITIALIZED' }
    })
    expect(context.repository.storageStatusAsync).toHaveBeenCalledTimes(2)
  })

  test('keeps cleanup behind a server-issued preview and strict confirmation schema', async () => {
    const { handlers, event, context } = createHarness()
    const preview = {
      previewId: 'a'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      currentBytes: 20,
      limitBytes: 10,
      reclaimableBytes: 12,
      gameCount: 1
    }
    vi.mocked(context.repository.previewCleanup).mockReturnValue(preview)
    vi.mocked(context.repository.confirmCleanup).mockReturnValue({
      totalBytes: 8,
      rawBytes: 0,
      limitBytes: 10 * 1024 ** 3,
      overLimit: false,
      catalogGames: 0
    })
    expect(await handlers.get('previewCleanup')!(event)).toEqual({ ok: true, value: preview })
    expect(await handlers.get('confirmCleanup')!(event, { previewId: 'short' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(
      await handlers.get('confirmCleanup')!(event, { previewId: 'a'.repeat(64) })
    ).toMatchObject({
      ok: true,
      value: { catalogGames: 0 }
    })
  })

  test('does not delete files while a refresh is using them', async () => {
    const { handlers, event, context } = createHarness()
    vi.mocked(context.pipeline.get).mockReturnValue({
      jobId: 'running',
      status: 'collecting'
    } as any)
    expect(
      await handlers.get('confirmCleanup')!(event, { previewId: 'a'.repeat(64) })
    ).toMatchObject({ ok: false, error: { code: 'JOB_ALREADY_RUNNING' } })
    expect(context.repository.confirmCleanup).not.toHaveBeenCalled()
  })

  test('converts initialization failure into degraded state instead of throwing', async () => {
    const onReady = vi.fn()
    const onDegraded = vi.fn()
    await expect(
      initializeMemberAnalysisSafely(
        async () => {
          throw new Error('synthetic failure')
        },
        onReady,
        onDegraded
      )
    ).resolves.toBeUndefined()
    expect(onReady).not.toHaveBeenCalled()
    expect(onDegraded).toHaveBeenCalledOnce()
  })
})

test('rank observation history validates sender, configured slot, queue and bounded cursor without exposing identities', async () => {
  const { handlers, event, context } = createHarness()
  const invoke = handlers.get('getRankObservationHistory')!
  context.settings.enabled = true
  context.settings.members = [{ serverId: 'TEST', gameName: 'Configured', tagLine: 'TAG' }]
  for (const request of [
    { memberSlot: 1, queue: 'solo', puuid: 'forged' },
    { memberSlot: 1, queue: 'solo', serverId: 'OTHER' },
    { memberSlot: 1, queue: 'solo', pageSize: 101 },
    { memberSlot: 0, queue: 'solo' },
    { memberSlot: 1, queue: 'other' },
    { memberSlot: 1, queue: 'solo', cursor: '{}' }
  ])
    expect(await invoke(event, request)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
  expect(await invoke({ sender: {} }, { memberSlot: 1, queue: 'solo' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_ARGUMENT' }
  })
  expect(await invoke(event, { memberSlot: 2, queue: 'solo' })).toMatchObject({
    ok: false,
    error: { code: 'INVALID_ARGUMENT' }
  })
  expect(await invoke(event, { memberSlot: 1, queue: 'solo' })).toMatchObject({
    ok: true,
    value: { status: 'identity-unresolved', points: [] }
  })
  vi.mocked(context.repository.resolveConfiguredMember).mockReturnValue({
    puuid: 'synthetic-secret-identity',
    resolvedAt: '2026-10-13T12:00:00.000Z'
  })
  const result = await invoke(event, { memberSlot: 1, queue: 'solo' })
  expect(result).toMatchObject({
    ok: true,
    value: {
      status: 'available',
      memberSlot: 1,
      queue: 'solo',
      coverage: 'successful-query-observations-only'
    }
  })
  expect(JSON.stringify(result)).not.toContain('synthetic-secret-identity')
  expect(context.repository.opponentRanks.readPlayerHistoryPage).toHaveBeenCalledWith(
    'TEST',
    'synthetic-secret-identity',
    'solo',
    100,
    null,
    expect.any(String)
  )
  context.settings.enabled = false
  expect(await invoke(event, { memberSlot: 1, queue: 'solo' })).toMatchObject({
    ok: false,
    error: { code: 'FEATURE_DISABLED' }
  })
})
test('LP trend default-hidden flag persists through the protected settings path without deleting observations', async () => {
  const { handlers, event, context } = createHarness()
  expect(handlers.get('getSettings')!(event)).toMatchObject({
    ok: true,
    value: { experimentalLpTrendEnabled: false }
  })
  expect(
    await handlers.get('updateSettings')!(event, { experimentalLpTrendEnabled: 'true' })
  ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
  expect(
    await handlers.get('updateSettings')!(event, { experimentalLpTrendEnabled: true })
  ).toMatchObject({ ok: true, value: { experimentalLpTrendEnabled: true } })
  expect(
    await handlers.get('updateSettings')!(event, { experimentalLpTrendEnabled: false })
  ).toMatchObject({ ok: true, value: { experimentalLpTrendEnabled: false } })
  expect(context.repository.opponentRanks.readPlayerHistoryPage).not.toHaveBeenCalled()
})

test('published identity IPC rejects foreign caller, arbitrary identity IO and oversized/duplicate slots', async () => {
  const { handlers, event } = createHarness()
  const valid = { publicationToken: 'A'.repeat(32), memberSlots: [1], pageSize: 25, cursor: null }
  for (const input of [
    { ...valid, puuid: 'secret' },
    { ...valid, pageSize: 26 },
    { ...valid, memberSlots: [1, 1] },
    { ...valid, publicationToken: 'file:///secret' }
  ]) {
    expect(await handlers.get('getPublishedMemberIdentities')!(event, input)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
  }
  expect(await handlers.get('getPublishedMemberIdentities')!({ sender: {} }, valid)).toMatchObject({
    ok: false,
    error: { code: 'INVALID_ARGUMENT' }
  })
})

test('version trend setting defaults off, validates boolean and uses protected persistence', async () => {
  const { handlers, event, context } = createHarness()
  expect(context.settings.experimentalVersionTrendEnabled).toBe(false)
  expect(
    await handlers.get('updateSettings')!(event, { experimentalVersionTrendEnabled: 'true' })
  ).toMatchObject({ ok: false })
  expect(
    await handlers.get('updateSettings')!(event, { experimentalVersionTrendEnabled: true })
  ).toMatchObject({ ok: true, value: { experimentalVersionTrendEnabled: true } })
  expect(context.settingService.set).toHaveBeenCalledWith('experimentalVersionTrendEnabled', true)
})
