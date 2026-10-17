import {
  MEMBER_ANALYSIS_CONTRACT_VERSION,
  MEMBER_ANALYSIS_DATA_VERSION
} from '@shared/shards/member-analysis'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { isProxy, reactive } from 'vue'

import { MemberAnalysisRenderer } from './index'
import { useMemberAnalysisStore } from './store'

function publishedOverview() {
  return {
    contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
    dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
    generatedAt: '2026-10-13T00:00:00Z',
    firstRun: false,
    gameCount: 1,
    playerCount: 5,
    games: [],
    source: 'Synthetic',
    collectionAudit: null,
    pagination: { nextCursor: null }
  }
}

describe('member analysis renderer IPC boundary', () => {
  test.each(['failure', 'success'] as const)(
    'keeps published results readable during a background reload: %s',
    async (outcome) => {
      setActivePinia(createPinia())
      const store = useMemberAnalysisStore()
      store.settings = { enabled: true, members: [] } as any
      store.overview = publishedOverview()
      store.loading = false
      const previous = store.overview
      let finish!: (value: unknown) => void
      const ipc = {
        call: vi.fn(async (_namespace, method) => {
          if (method === 'getCapabilities')
            return {
              ok: true,
              value: {
                contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
                dataVersion: MEMBER_ANALYSIS_DATA_VERSION
              }
            }
          if (method === 'getSettings') return { ok: true, value: store.settings }
          if (method === 'getStorageStatus') return { ok: true, value: {} }
          return new Promise((resolve) => {
            finish = resolve
          })
        })
      }
      const load = new MemberAnalysisRenderer(ipc as any).reload()
      await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
      expect(store.loading).toBe(true)
      expect(store.viewState).toBe('ready')
      expect(store.overview).toBe(previous)
      finish(
        outcome === 'failure'
          ? { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true } }
          : { ok: true, value: { ...publishedOverview(), generatedAt: '2026-10-13T01:00:00Z' } }
      )
      await load
      expect(store.loading).toBe(false)
      expect(store.viewState).toBe('ready')
      if (outcome === 'failure') {
        expect(store.overview).toBe(previous)
        expect(store.error?.code).toBe('INTERNAL_ERROR')
      } else {
        expect(store.overview?.generatedAt).toBe('2026-10-13T01:00:00Z')
        expect(store.error).toBeNull()
      }
    }
  )

  test.each(['storage', 'members', 'disable'] as const)(
    'retains only compatible published results after settings save: %s',
    async (change) => {
      setActivePinia(createPinia())
      const store = useMemberAnalysisStore()
      store.settings = { enabled: true, members: [], storageLimitGiB: 10 } as any
      store.overview = publishedOverview()
      const previous = store.overview
      const saved = {
        ...store.settings,
        ...(change === 'storage'
          ? { storageLimitGiB: 20 }
          : change === 'members'
            ? { members: [{ serverId: 'TEST', gameName: 'Synthetic', tagLine: 'TEST' }] }
            : { enabled: false })
      }
      const ipc = {
        call: vi.fn(async (_namespace, method) =>
          method === 'updateSettings'
            ? { ok: true, value: saved }
            : {
                ok: false,
                error: { code: 'INTERNAL_ERROR', message: 'Synthetic', retryable: true }
              }
        )
      }
      await new MemberAnalysisRenderer(ipc as any).updateSettings(
        change === 'storage'
          ? { storageLimitGiB: 20 }
          : change === 'members'
            ? { members: saved.members }
            : { enabled: false }
      )
      expect(store.overview).toBe(change === 'storage' ? previous : null)
      expect(store.viewState).toBe(
        change === 'storage' ? 'ready' : change === 'disable' ? 'feature-disabled' : 'error'
      )
    }
  )

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
    finishNew({
      ok: true,
      value: {
        contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
        dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
        featureEnabled: false
      }
    })
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
          return {
            ok: true,
            value: {
              contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
              dataVersion: MEMBER_ANALYSIS_DATA_VERSION
            }
          }
        if (method === 'getSettings') return { ok: true, value: { enabled: true } }
        if (method === 'getStorageStatus') return { ok: true, value: {} }
        page += 1
        return {
          ok: true,
          value: {
            contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
            dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
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

test('rank history renderer wrapper uses only the allowlisted typed method and preserves domain errors', async () => {
  const failure = {
    ok: false,
    error: { code: 'INVALID_ARGUMENT', message: 'Unavailable cursor', retryable: false }
  }
  const ipc = { call: vi.fn(async () => failure) }
  const shard = new MemberAnalysisRenderer(ipc as any)
  expect(await shard.getRankObservationHistory({ memberSlot: 1, queue: 'solo' })).toEqual(failure)
  expect(ipc.call).toHaveBeenCalledWith('member-analysis-main', 'getRankObservationHistory', {
    memberSlot: 1,
    queue: 'solo',
    pageSize: 100,
    cursor: null
  })
  ipc.call.mockClear()
  expect(
    await shard.getRankObservationHistory({ memberSlot: 1, queue: 'solo', puuid: 'forged' } as any)
  ).toMatchObject({ ok: false, error: { code: 'INVALID_ARGUMENT' } })
  expect(ipc.call).not.toHaveBeenCalled()
})

test('published identity wrapper rejects arbitrary identity arguments and forwards the bounded business request', async () => {
  const ipc = { call: vi.fn(async () => ({ ok: true, value: {} })) }
  const renderer = new MemberAnalysisRenderer(ipc as any)
  const request = {
    publicationToken: 'A'.repeat(32),
    memberSlots: [1, 2],
    pageSize: 25,
    cursor: null
  }
  const invalid = await renderer.getPublishedMemberIdentities({
    ...request,
    puuid: 'SYNTHETIC_TEST_ONLY'
  } as any)
  expect(invalid.ok).toBe(false)
  expect(ipc.call).not.toHaveBeenCalled()
  await renderer.getPublishedMemberIdentities(request)
  expect(ipc.call).toHaveBeenCalledWith(
    'member-analysis-main',
    'getPublishedMemberIdentities',
    request
  )
})

test.each(['changed-token', 'backend-rejected'] as const)(
  'published token protects same-timestamp overview pagination: %s',
  async (mode) => {
    setActivePinia(createPinia())
    const store = useMemberAnalysisStore()
    const oldOverview = publishedOverview()
    store.overview = oldOverview
    const token = 'A'.repeat(32)
    let page = 0
    const ipc = {
      call: vi.fn(async (_namespace, method) => {
        if (method === 'getCapabilities')
          return {
            ok: true,
            value: {
              contractVersion: MEMBER_ANALYSIS_CONTRACT_VERSION,
              dataVersion: MEMBER_ANALYSIS_DATA_VERSION
            }
          }
        if (method === 'getSettings') return { ok: true, value: { enabled: true } }
        if (method === 'getStorageStatus') return { ok: true, value: {} }
        page++
        if (page === 2 && mode === 'backend-rejected')
          return {
            ok: false,
            error: { code: 'INVALID_ARGUMENT', message: 'Publication changed', retryable: true }
          }
        return {
          ok: true,
          value: {
            ...publishedOverview(),
            publicationToken: page === 1 ? token : 'B'.repeat(32),
            pagination: { nextCursor: page === 1 ? 'next' : null }
          }
        }
      })
    }
    await new MemberAnalysisRenderer(ipc as any).reload()
    expect(ipc.call).toHaveBeenLastCalledWith('member-analysis-main', 'getOverview', {
      pagination: { cursor: 'next', pageSize: 100 },
      publicationToken: token
    })
    expect(store.overview).toEqual(oldOverview)
    expect(store.error).not.toBeNull()
    expect(store.loading).toBe(false)
  }
)
