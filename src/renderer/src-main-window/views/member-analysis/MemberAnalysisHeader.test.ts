// sort-imports-ignore
import './test-i18n'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test, vi } from 'vitest'
import MemberAnalysisHeader from './MemberAnalysisHeader.vue'

vi.mock('@vicons/material', () => ({
  AnalyticsRound: () => null,
  InfoOutlined: () => null,
  RefreshRound: () => null,
  SettingsRound: () => null
}))
vi.mock('naive-ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('naive-ui')>()),
  NPopover: (_: unknown, { slots }: { slots: Record<string, Function> }) => slots.trigger?.()
}))

const renderHeader = (announcement: boolean) =>
  renderToString(
    createSSRApp({
      render: () =>
        h(MemberAnalysisHeader, {
          generatedAt: '2026-10-26T12:00:00Z',
          loading: false,
          refreshDisabled: false,
          ...(announcement ? { showRefresh: false, showDataTimestamp: false } : {}),
          refreshReason: { kind: 'service', text: '合成采集服务提示' }
        })
    })
  )

test('announcement context omits collection action, timestamp and collection service notice', async () => {
  const html = await renderHeader(true)
  expect(html).not.toContain('aria-label="刷新"')
  expect(html).not.toContain('<time')
  expect(html).not.toContain('合成采集服务提示')
  expect(html).toContain('aria-label="设置"')
})

test('existing analysis pages retain collection controls and timestamp by default', async () => {
  const html = await renderHeader(false)
  expect(html).toContain('aria-label="刷新"')
  expect(html).toContain('<time')
  expect(html).toContain('合成采集服务提示')
})
