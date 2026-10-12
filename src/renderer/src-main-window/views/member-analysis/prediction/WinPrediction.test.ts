// sort-imports-ignore
import '../test-i18n'

import { createPinia, setActivePinia } from 'pinia'
import { expect, test, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import WinPrediction from './WinPrediction.vue'

vi.mock('./prediction.worker?worker', () => ({ default: class {} }))
vi.mock('naive-ui', () => ({
  NButton: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('button', slots.default?.())
  }),
  NSelect: defineComponent({ setup: () => () => h('select') }),
  NProgress: defineComponent({ setup: () => () => h('progress') })
}))

test('offers collapsed help before selecting a lineup, without applying review filters', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMemberAnalysisStore()
  store.filters.query = '合成筛选'
  store.sampleSize = 20
  const before = JSON.stringify({ filters: store.filters, sampleSize: store.sampleSize })
  const app = createSSRApp(WinPrediction)
  app.use(pinia)
  const html = await renderToString(app)

  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('使用说明')
  expect(html).not.toContain('id="prediction-method"')
  expect(html).toContain('顶部复盘筛选及范围不用于预测')
  expect(html).toMatch(/<button[^>]*disabled[^>]*>计算胜率/)
  expect(JSON.stringify({ filters: store.filters, sampleSize: store.sampleSize })).toBe(before)
})
