// sort-imports-ignore
import '../test-i18n'

import { createPinia, setActivePinia } from 'pinia'
import { expect, test, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import WinPrediction from './WinPrediction.vue'

vi.mock('./prediction.worker?worker', () => ({ default: class {} }))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: (props: any) => h('position-icon', props)
}))
vi.mock('../MetricHelp.vue', () => ({
  default: (props: any) => h('metric-help', { 'data-definition': props.definition }, props.label)
}))
vi.mock('naive-ui', () => ({
  NIcon: (props: any, { slots }: any) => h('i', props, slots.default?.()),
  useMessage: () => ({}),
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
  expect(html).toContain('阵容配置')
  expect(html).toContain('娱乐预测')
  expect(html).toContain('仅供娱乐，非校准获胜概率。')
  expect(html).not.toContain('50.0%')
  expect(html).toContain('选择五位不同成员')
  expect(html).toContain('数据与说明')
  expect(html).not.toContain('id="prediction-method"')
  expect(html).toContain('顶部复盘筛选及范围不用于预测')
  expect(html).toMatch(/<button[^>]*disabled[^>]*>计算娱乐预测/)
  expect(JSON.stringify({ filters: store.filters, sampleSize: store.sampleSize })).toBe(before)
})
