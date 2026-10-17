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

  test('optional combination reference and quarter grid preserve the same Wilson bounds', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(WinRateInterval, {
            wins: 5,
            games: 10,
            reference: 0.6,
            scaleGrid: true,
            description: '胜率 50.0%，基准 60.0%，95% 区间 23.7%–76.3%'
          })
      })
    )
    expect(html).toContain('胜率 50.0%，基准 60.0%，95% 区间 23.7%–76.3%')
    expect(html).toContain('class="scale-grid"')
    expect(html).toContain('class="reference" style="left:60%;"')
    expect(html).not.toContain('class="balance"')
    expect(html).toContain('left:23.658')
    expect(html).toContain('width:52.682')
  })
  test.each([0, 1])(
    'keeps real rate and reference endpoints at %s without shifting the scale',
    async (rate) => {
      const html = await renderToString(
        createSSRApp({
          render: () =>
            h(WinRateInterval, { wins: rate * 10, games: 10, reference: rate, scaleGrid: true })
        })
      )
      expect(html).toContain(`胜率 ${(rate * 100).toFixed(1)}%`)
      expect(html).toContain(`class="reference" style="left:${rate * 100}%;"`)
      expect(html).toMatch(new RegExp(`<em[^>]*style="left:${rate * 100}%;"`))
    }
  )
  test.each([NaN, Infinity, -0.1, 1.1])(
    'does not clamp invalid reference %s into a made-up baseline',
    async (reference) => {
      const html = await renderToString(
        createSSRApp({
          render: () => h(WinRateInterval, { wins: 1, games: 2, reference })
        })
      )
      expect(html).not.toContain('class="reference"')
      expect(html).toContain('class="balance"')
      expect(html).not.toContain('class="scale-grid"')
    }
  )
  test('reference and grid never turn missing samples into a numeric rate', async () => {
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(WinRateInterval, {
            wins: 0,
            games: 0,
            reference: 0,
            scaleGrid: true,
            description: 'must not replace missing'
          })
      })
    )
    expect(html).toContain('无有效样本')
    expect(html).not.toContain('must not replace missing')
    expect(html).not.toContain('class="reference"')
    expect(html).not.toContain('class="scale-grid"')
  })
})
