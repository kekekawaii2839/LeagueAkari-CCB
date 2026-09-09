import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { isProxy, reactive } from 'vue'

import { MemberAnalysisRenderer } from './index'
import { useMemberAnalysisStore } from './store'

describe('member analysis renderer IPC boundary', () => {
  test('converts reactive settings into a validated plain request before IPC', async () => {
    setActivePinia(createPinia())
    const settings = reactive({
      enabled: false,
      members: [{ serverId: 'TENCENT_HN1', gameName: 'Anonymous', tagLine: 'TEST' }],
      historyDepth: 50 as const,
      historyTag: 'ranked',
      storageLimitGiB: 10,
      opggEnabled: false
    })
    const ipc = {
      call: vi.fn().mockResolvedValue({ ok: true, value: settings })
    }
    const renderer = new MemberAnalysisRenderer(ipc as any)

    const result = await renderer.updateSettings(settings)

    expect(result.ok).toBe(true)
    const request = ipc.call.mock.calls[0][2]
    expect(isProxy(request)).toBe(false)
    expect(() => structuredClone(request)).not.toThrow()
    expect(request).toEqual({
      enabled: false,
      members: [{ serverId: 'TENCENT_HN1', gameName: 'Anonymous', tagLine: 'TEST' }],
      historyDepth: 50,
      historyTag: 'ranked',
      storageLimitGiB: 10,
      opggEnabled: false
    })
  })

  test('a partial settings update does not reset the saved scan limit', async () => {
    setActivePinia(createPinia())
    const ipc = {
      call: vi
        .fn()
        .mockResolvedValue({ ok: true, value: { enabled: false, scanLimitPerMember: 4200 } })
    }
    const renderer = new MemberAnalysisRenderer(ipc as any)
    await renderer.updateSettings({ enabled: false })
    expect(ipc.call).toHaveBeenCalledWith('member-analysis-main', 'updateSettings', {
      enabled: false
    })
  })

  test('a superseded reload cannot overwrite newer state or clear its loading state', async () => {
    setActivePinia(createPinia())
    let finishOld!: (value: unknown) => void
    let finishNew!: (value: unknown) => void
    const ipc = {
      call: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishOld = resolve
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finishNew = resolve
            })
        )
        .mockResolvedValue({ ok: true, value: { enabled: false } })
    }
    const renderer = new MemberAnalysisRenderer(ipc as any)
    const old = renderer.reload()
    const current = renderer.reload()
    finishOld({ ok: false, error: { code: 'INTERNAL_ERROR' } })
    await old
    expect(useMemberAnalysisStore().loading).toBe(true)
    expect(useMemberAnalysisStore().error).toBeNull()
    finishNew({ ok: true, value: { contractVersion: 1, dataVersion: 4, featureEnabled: false } })
    await current
    expect(useMemberAnalysisStore().loading).toBe(false)
    expect(useMemberAnalysisStore().settings?.enabled).toBe(false)
  })

  test('rejects mixed-generation pages without replacing the previous overview', async () => {
    setActivePinia(createPinia())
    const store = useMemberAnalysisStore()
    const oldOverview = { generatedAt: 'previous' } as any
    store.overview = oldOverview
    let page = 0
    const ipc = {
      call: vi.fn(async (_namespace, method) => {
        if (method === 'getCapabilities')
          return { ok: true, value: { contractVersion: 1, dataVersion: 4 } }
        if (method === 'getSettings') return { ok: true, value: { enabled: true } }
        if (method === 'getStorageStatus') return { ok: true, value: {} }
        page += 1
        return {
          ok: true,
          value: {
            contractVersion: 1,
            dataVersion: 4,
            generatedAt: `generation-${page}`,
            gameCount: 2,
            games: [],
            source: 'Synthetic',
            pagination: { nextCursor: page === 1 ? 'next' : null }
          }
        }
      })
    }
    await new MemberAnalysisRenderer(ipc as any).reload()
    expect(store.overview).toEqual(oldOverview)
    expect(store.error?.code).toBe('INTERNAL_ERROR')
  })

  test('transport failures become safe domain errors for event callbacks', async () => {
    setActivePinia(createPinia())
    const renderer = new MemberAnalysisRenderer({
      call: vi.fn().mockRejectedValue(new Error('private diagnostic'))
    } as any)
    const result = await renderer.startRefresh()
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } })
    expect(JSON.stringify(result)).not.toContain('private diagnostic')
  })

  test('keeps refresh actions bound when Vue invokes them as event callbacks', async () => {
    setActivePinia(createPinia())
    const error = {
      code: 'WORKER_UNAVAILABLE',
      message: 'synthetic unavailable worker',
      retryable: true
    }
    const ipc = { call: vi.fn().mockResolvedValue({ ok: false, error }) }
    const renderer = new MemberAnalysisRenderer(ipc as any)
    const startRefresh = renderer.startRefresh
    const cancelRefresh = renderer.cancelRefresh

    await expect(startRefresh()).resolves.toEqual({ ok: false, error })
    await expect(cancelRefresh()).resolves.toEqual({ ok: false, error })

    expect(ipc.call.mock.calls.map((call) => call[1])).toEqual(['startRefresh', 'cancelJob'])
  })
})
