// sort-imports-ignore
import './test-i18n'
import type { MemberAnalysisOverview } from '@shared/shards/member-analysis'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'

import MemberAnalysisFilters from './MemberAnalysisFilters.vue'

const championControl = vi.hoisted(() => ({
  options: [] as { label: string; value: string }[],
  filter: null as ((pattern: string, option: { label: string; value: string }) => boolean) | null
}))

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
      menuProps: Object,
      filter: Function
    },
    setup: (props, { attrs }) => {
      if (attrs['aria-label'] === '英雄') {
        championControl.options = props.options as { label: string; value: string }[]
        championControl.filter = props.filter as typeof championControl.filter
      }
      return () =>
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
    }
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
    const advancedToggle = controls.filter((control) =>
      control.includes('aria-controls="member-analysis-advanced-filters"')
    )
    expect(advancedToggle).toHaveLength(1)
    expect(advancedToggle[0]).not.toMatch(/\bdisabled(?:=|\s|>)/)
    const businessControls = controls.filter((control) => !advancedToggle.includes(control))
    expect(businessControls).toHaveLength(13)
    expect(
      businessControls.every((control) => /\bdisabled(?:=|\s|>)/.test(control) === disabled)
    ).toBe(true)
    expect(html).toContain('搜索对局、成员或英雄')
    expect(html).toContain('最近 50 场')
    expect(html).toContain('重置 2')
    expect(html.includes('aria-describedby="member-analysis-prediction-filter-note"')).toBe(false)
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

  test.each([false, true])(
    'omits collapsed summaries while preserving conditions with compact=%s',
    async (compact) => {
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
      const app = createSSRApp(MemberAnalysisFilters, { compact })
      app.use(pinia)
      const html = await renderToString(app)
      if (compact) expect(html).toContain('展开筛选')
      expect(html).toContain('aria-expanded="false"')
      expect(html).not.toContain('最近 20 场 · 仅红方 · 失败')
      expect(html).not.toContain('搜索 合成搜索')
      expect(html).not.toContain('当前筛选：')
      expect(html).not.toContain('版本 26.1')
      expect(html).toContain('高级筛选 · 2')
      expect(html).toContain('重置 5')
      expect(
        JSON.stringify({
          filters: store.filters,
          sample: store.sampleSize,
          side: store.analysisSide
        })
      ).toBe(before)
    }
  )

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

test('embedded header filters retain their original controls and applied values', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMemberAnalysisStore()
  store.filters.query = 'SYNTHETIC_TEST_ONLY'
  store.analysisSide = 'Red'
  const before = JSON.stringify({
    filters: store.filters,
    sample: store.sampleSize,
    side: store.analysisSide
  })
  const app = createSSRApp(MemberAnalysisFilters, { embedded: true, disabled: true })
  app.use(pinia)
  const html = await renderToString(app)
  const controls = html.match(/<(?:input|button|div data-control)[^>]*>/g) ?? []
  expect(controls).toHaveLength(14)
  const advancedToggle = controls.filter((control) =>
    control.includes('aria-controls="member-analysis-advanced-filters"')
  )
  expect(advancedToggle).toHaveLength(1)
  expect(advancedToggle[0]).not.toMatch(/\bdisabled(?:=|\s|>)/)
  const businessControls = controls.filter((control) => !advancedToggle.includes(control))
  expect(businessControls).toHaveLength(13)
  expect(businessControls.every((control) => /\bdisabled(?:=|\s|>)/.test(control))).toBe(true)
  expect(html).toContain('搜索对局、成员或英雄')
  expect(html).toContain('最近 50 场')
  expect(
    JSON.stringify({ filters: store.filters, sample: store.sampleSize, side: store.analysisSide })
  ).toBe(before)
})

test('duration limits share one adjacent group without changing values or minute units', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMemberAnalysisStore()
  store.filters.durationMin = 17
  store.filters.durationMax = 43
  const app = createSSRApp(MemberAnalysisFilters, { embedded: true })
  app.use(pinia)
  const html = await renderToString(app)
  const group = html.match(
    /<div[^>]*role="group"[^>]*aria-label="对局时长（分钟）"[^>]*>([\s\S]*?)<\/div>/
  )?.[1]
  expect(group).toBeDefined()
  expect(group!.indexOf('aria-label="最短对局分钟"')).toBeGreaterThanOrEqual(0)
  expect(group!.indexOf('aria-label="最长对局分钟"')).toBeGreaterThan(
    group!.indexOf('aria-label="最短对局分钟"')
  )
  expect(group).toContain('placeholder="最短分钟"')
  expect(group).toContain('placeholder="最长分钟"')
  expect(group).not.toContain('type="date"')
  expect([store.filters.durationMin, store.filters.durationMax]).toEqual([17, 43])
})
test('champion labels follow actual client names while selection and canonical search remain stable', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useMemberAnalysisStore()
  const league = useLeagueClientStore()
  store.filters.champion = 'SyntheticCanonical_TEST_ONLY'
  store.overview = {
    games: [
      {
        players: [
          { champion: 'SyntheticCanonical_TEST_ONLY' },
          { champion: 'SyntheticNoMapping_TEST_ONLY' }
        ],
        patch: '15.17'
      }
    ]
  } as unknown as MemberAnalysisOverview
  league.gameData.champions = {
    1: {
      id: 1,
      alias: 'SyntheticCanonical_TEST_ONLY',
      name: '合成英雄',
      roles: [],
      squarePortraitPath: ''
    }
  }
  const render = async () => {
    const app = createSSRApp(MemberAnalysisFilters)
    app.use(pinia)
    return renderToString(app)
  }
  expect(await render()).toContain('合成英雄')
  const option = championControl.options.find(
    (option) => option.value === 'SyntheticCanonical_TEST_ONLY'
  )!
  expect(option.label).toBe('合成英雄')
  expect(championControl.filter!('合成英', option)).toBe(true)
  expect(championControl.filter!('syntheticcanonical', option)).toBe(true)
  expect(
    championControl.options.find((option) => option.value === 'SyntheticNoMapping_TEST_ONLY')?.label
  ).toBe('SyntheticNoMapping_TEST_ONLY')
  league.gameData.champions = {
    1: {
      id: 1,
      alias: 'SyntheticCanonical_TEST_ONLY',
      name: 'Synthetic client hero',
      roles: [],
      squarePortraitPath: ''
    }
  }
  expect(await render()).toContain('Synthetic client hero')
  expect(store.filters.champion).toBe('SyntheticCanonical_TEST_ONLY')
  expect(
    championControl.options.find((option) => option.value === store.filters.champion)?.label
  ).toBe('Synthetic client hero')
})
