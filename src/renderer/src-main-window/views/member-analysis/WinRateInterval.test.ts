// sort-imports-ignore
// Register locale mocks before importing renderer components.
import './test-i18n'

import { i18next } from '@renderer-shared/i18n'
import { beforeEach, describe, expect, test } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import WinRateInterval from './WinRateInterval.vue'

describe('WinRateInterval', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('zh-CN')
  })
  test('does not render an estimated zero when there are no eligible samples', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(WinRateInterval, { wins: 0, games: 0 }) })
    )
    expect(html).toContain('无有效样本')
    expect(html).not.toContain('胜率 0.0%')
    expect(html).not.toContain('<em')
  })
  test('renders the sample estimate, Wilson range and 50% reference', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(WinRateInterval, { wins: 5, games: 10 }) })
    )

    expect(html).toContain('95% 区间')
    expect(html).toContain('class="balance"')
    expect(html).toContain('class="range"')
    expect(html).toContain('left:23.658')
    expect(html).toContain('width:52.682')
  })

  test('marks low samples without converting a real zero win rate to missing', async () => {
    const html = await renderToString(
      createSSRApp({ render: () => h(WinRateInterval, { wins: 0, games: 3, low: true }) })
    )

    expect(html).toContain('胜率 0.0%')
    expect(html).toContain('class="low"')
    expect(html).toContain('left:0%')
  })
})
