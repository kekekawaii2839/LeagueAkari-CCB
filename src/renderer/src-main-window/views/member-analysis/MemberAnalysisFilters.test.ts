// sort-imports-ignore
import './test-i18n'
import type { MemberAnalysisOverview } from '@shared/shards/member-analysis'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import MemberAnalysisFilters from './MemberAnalysisFilters.vue'

vi.mock('naive-ui', () => ({
  NButton: defineComponent({
    setup:
      (_, { slots }) =>
      () =>
        h('button', slots.default?.())
  }),
  NInput: defineComponent({
    props: {
      inputProps: Object,
      placeholder: String
    },
    setup: (props) => () =>
      h('input', { ...(props.inputProps ?? {}), placeholder: props.placeholder })
  }),
  NInputNumber: defineComponent({
    setup: () => () => h('input', { type: 'number' })
  }),
  NSelect: defineComponent({
    props: {
      options: Array,
      show: Boolean,
      menuProps: Object
    },
    setup:
      (props, { attrs }) =>
      () =>
        h(
          'div',
          {
            'data-control': attrs['aria-label'],
            'data-menu-open': props.show,
            'data-menu-inert': props.menuProps?.inert,
            'data-menu-pointer': props.menuProps?.style?.pointerEvents
          },
          (props.options as Array<{ label: string }> | undefined)
            ?.map((option) => option.label)
            .join('|')
        )
  })
}))

describe('member analysis filters', () => {
  test('initially closed menus stay noninteractive without modifying applied values', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useMemberAnalysisStore()
    store.filters.matchRole = 'TOP'
    store.sampleSize = 20
    const before = JSON.stringify({ filters: store.filters, sample: store.sampleSize })
    const app = createSSRApp(MemberAnalysisFilters)
    app.use(pinia)
    const html = await renderToString(app)
    expect(html.match(/data-menu-open="false"/g)).toHaveLength(7)
    expect(html.match(/data-menu-inert="true"/g)).toHaveLength(7)
    expect(html.match(/data-menu-pointer="none"/g)).toHaveLength(7)
    expect(JSON.stringify({ filters: store.filters, sample: store.sampleSize })).toBe(before)
  })
  test.each([false, true])('keeps all controls visible with disabled=%s', async (disabled) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useMemberAnalysisStore()
    store.filters.query = '合成搜索'
    store.filters.matchRole = 'TOP'
    store.sampleSize = 50
    const original = JSON.stringify({ filters: store.filters, sample: store.sampleSize })
    const app = createSSRApp(MemberAnalysisFilters, { disabled })
    app.use(pinia)

    const html = await renderToString(app)
    const controls = html.match(/<(?:input|button|div data-control)[^>]*>/g) ?? []
    expect(controls).toHaveLength(14)
    expect(controls.every((control) => /\bdisabled(?:=|\s|>)/.test(control) === disabled)).toBe(
      true
    )
    expect(html).toContain('搜索对局、成员或英雄')
    expect(html).toContain('最近 50 场')
    expect(html).toContain('重置 2')
    expect(html.includes('aria-describedby="member-analysis-prediction-filter-note"')).toBe(
      disabled
    )
    expect(JSON.stringify({ filters: store.filters, sample: store.sampleSize })).toBe(original)
  })

  test('leaves native date hints unobstructed by a text placeholder', async () => {
    const app = createSSRApp(MemberAnalysisFilters)
    app.use(createPinia())

    const html = await renderToString(app)
    const dateInputs = html.match(/<input[^>]+type="date"[^>]*>/g) ?? []

    expect(dateInputs).toHaveLength(2)
    expect(dateInputs.every((input) => !/placeholder="[^"]+"/.test(input))).toBe(true)
  })

  test('compact controls preserve applied conditions and values while offering expansion', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useMemberAnalysisStore()
    store.filters.query = '合成搜索'
    store.filters.matchRole = 'TOP'
    store.filters.patch = '26.1'
    store.sampleSize = 20
    store.analysisSide = 'Red'
    store.filters.outcome = 'loss'
    const before = JSON.stringify({
      filters: store.filters,
      sample: store.sampleSize,
      side: store.analysisSide
    })
    const app = createSSRApp(MemberAnalysisFilters, { compact: true })
    app.use(pinia)
    const html = await renderToString(app)
    expect(html).toContain('展开筛选')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('最近 20 场 · 仅红方 · 失败')
    expect(html).toContain('搜索 合成搜索')
    expect(html).toContain('搜索 合成搜索 · 仅红方 · 失败 · 上路 · 版本 26.1')
    expect(html).toContain('版本 26.1')
    expect(
      JSON.stringify({ filters: store.filters, sample: store.sampleSize, side: store.analysisSide })
    ).toBe(before)
  })

  test('orders multi-digit patch segments from newest to oldest', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useMemberAnalysisStore()
    store.overview = {
      games: ['9.24', '14.9', '14.10', '14.2', '14.10.1'].map((patch) => ({
        patch,
        players: []
      }))
    } as unknown as MemberAnalysisOverview
    const app = createSSRApp(MemberAnalysisFilters)
    app.use(pinia)

    const html = await renderToString(app)

    expect(html).toContain('全部版本|14.10.1|14.10|14.9|14.2|9.24')
  })
})
