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
    setup: () => () => null
  }),
  NSelect: defineComponent({
    props: {
      options: Array
    },
    setup:
      (props, { attrs }) =>
      () =>
        h(
          'div',
          { 'data-control': attrs['aria-label'] },
          (props.options as Array<{ label: string }> | undefined)
            ?.map((option) => option.label)
            .join('|')
        )
  })
}))

describe('member analysis filters', () => {
  test('leaves native date hints unobstructed by a text placeholder', async () => {
    const app = createSSRApp(MemberAnalysisFilters)
    app.use(createPinia())

    const html = await renderToString(app)
    const dateInputs = html.match(/<input[^>]+type="date"[^>]*>/g) ?? []

    expect(dateInputs).toHaveLength(2)
    expect(dateInputs.every((input) => !/placeholder="[^"]+"/.test(input))).toBe(true)
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
