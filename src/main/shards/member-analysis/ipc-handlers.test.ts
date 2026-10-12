import { describe, expect, test, vi } from 'vitest'

import type { MemberAnalysisMainContext } from './context'
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
      readMatchDetails: vi.fn(() => null),
      readGames: vi.fn(() => ({
        generatedAt: null,
        games: [],
        total: 0,
        playerCount: 0,
        nextCursor: null
      })),
      storageStatus: vi.fn(() => ({
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
  test('restricts cached native match details to enabled main renderer and a strict game ID', () => {
    const { handlers, event, context } = createHarness()
    const invoke = handlers.get('getMatchDetails')!
    expect(invoke(event, { gameId: 1 })).toMatchObject({
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
      expect(invoke(event, ...args)).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ARGUMENT' }
      })
    }
    expect(invoke({ sender: {} }, { gameId: 1 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENT' }
    })
    expect(context.repository.readMatchDetails).not.toHaveBeenCalled()
    expect(invoke(event, { gameId: 1 })).toEqual({ ok: true, value: null })
    vi.mocked(context.repository.readMatchDetails).mockImplementation(() => {
      throw new Error('private path')
    })
    expect(invoke(event, { gameId: 1 })).toMatchObject({
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
        experimentalPredictionEnabled: false
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
