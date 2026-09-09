import { describe, expect, test, vi } from 'vitest'

import { router } from '@main-window/routes'

import { MEMBER_ANALYSIS_NAVIGATION, MEMBER_ANALYSIS_ROUTE } from './navigation'

vi.mock('@main-window/views/automation/Automation.vue', () => ({ default: {} }))
vi.mock('@main-window/views/member-analysis/MemberAnalysis.vue', () => ({ default: {} }))
vi.mock('@main-window/views/ongoing-game/OngoingGame.vue', () => ({ default: {} }))
vi.mock('@main-window/views/player-tabs/PlayerTabs.vue', () => ({ default: {} }))
vi.mock('@main-window/views/test/Test.vue', () => ({ default: {} }))
vi.mock('@main-window/views/toolkit/Toolkit.vue', () => ({ default: {} }))
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
  return { ...actual, createWebHashHistory: actual.createMemoryHistory }
})

describe('member analysis navigation contract', () => {
  test('uses the stable route and sidebar entry', () => {
    expect(MEMBER_ANALYSIS_ROUTE).toEqual({
      name: 'member-analysis',
      path: '/member-analysis/:section?'
    })
    expect(MEMBER_ANALYSIS_NAVIGATION).toEqual({
      key: 'member-analysis',
      label: '成员分析'
    })
  })

  test('is registered in the real main-window router', () => {
    const route = router.getRoutes().find((candidate) => candidate.name === 'member-analysis')
    expect(route?.path).toBe('/member-analysis/:section?')
  })
})
