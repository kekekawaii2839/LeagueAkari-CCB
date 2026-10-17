// sort-imports-ignore
import './test-i18n'
import { describe, expect, test, vi } from 'vitest'
import { computed, createSSRApp, defineComponent, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import MatchNativeDetails from './MatchNativeDetails.vue'

const fixture = vi.hoisted(() => ({
  loading: false,
  error: false,
  match: null as any,
  ranksSeen: null as any
}))
vi.mock('./useMemberMatchDetails', () => ({
  useMemberMatchDetails: () => ({
    match: computed(() => fixture.match),
    loading: computed(() => fixture.loading),
    error: computed(() => fixture.error),
    load: vi.fn()
  })
}))
vi.mock('@renderer-shared/components/match-card/MatchCard.vue', () => ({
  default: defineComponent({
    props: ['extraDetailsTabLabel'],
    setup:
      (props, { slots }) =>
      () =>
        h('section', [props.extraDetailsTabLabel, slots['extra-details-tab']?.()])
  })
}))
vi.mock('./opponent-ranks/OpponentRankDetails.vue', () => ({
  default: (props: any) => {
    fixture.ranksSeen = props.ranks
    return h('p', 'Existing opponent rank evidence')
  }
}))
vi.mock('@main-window/shards/player-tabs', () => ({ PlayerTabsRenderer: class {} }))
vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => ({ useNavigateToTab: () => ({ navigateToTabByPuuidAndSgpServerId: vi.fn() }) })
}))
vi.mock('@renderer-shared/shards/app-common/store', () => ({
  useAppCommonStore: () => ({ settings: { streamerMode: false } })
}))
vi.mock('naive-ui', () => ({
  NSpin: () => null,
  NButton: (props: Record<string, unknown>, { slots }: { slots: Record<string, Function> }) =>
    h('button', props, slots.default?.())
}))
const render = () =>
  renderToString(createSSRApp({ render: () => h(MatchNativeDetails, { gameId: 1 }) }))
describe('native match detail recovery copy', () => {
  test('passes the existing opponent snapshot into the native extension slot without replacing it', async () => {
    const ranks = { source: 'Synthetic original rank source' }
    fixture.match = { summary: {}, details: {} }
    try {
      const html = await renderToString(
        createSSRApp({
          render: () => h(MatchNativeDetails, { gameId: 1, opponentRanks: ranks as any })
        })
      )
      expect(html).toContain('对手段位')
      expect(html).toContain('Existing opponent rank evidence')
      expect(fixture.ranksSeen).toBe(ranks)
      expect(html).not.toContain('20 分钟经济差')
    } finally {
      fixture.match = null
    }
  })
  test('does not guess why the local raw cache is unavailable', async () => {
    const html = await render()
    expect(html).toContain('本局战绩详情不可用，请刷新分析重试。')
    expect(html).not.toContain('清理')
  })
  test('preserves loading and failed-read retry states', async () => {
    fixture.loading = true
    expect(await render()).toContain('正在读取本地战绩详情')
    fixture.loading = false
    fixture.error = true
    expect(await render()).toContain('无法读取本局战绩详情。')
    expect(await render()).toContain('重试')
    fixture.error = false
  })
})
