// sort-imports-ignore
import './test-i18n'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ScatterExactTable from './ScatterExactTable.vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({
    gameData: {
      champions: { 103: { id: 103, alias: 'Ahri', name: '阿狸' } },
      championName: () => '阿狸'
    }
  })
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: (props: any) =>
    h('svg', { 'data-native-position': props.position, 'aria-hidden': 'true' })
}))
vi.mock('./MemberProfileAvatar.vue', () => ({
  default: (props: any) =>
    h('span', { 'data-avatar-id': props.iconId, 'data-avatar-size': props.size })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: (props: any) => h('span', { 'data-champion-id': props.championId })
}))
beforeEach(() => setActivePinia(createPinia()))

const captured = vi.hoisted(() => ({ props: null as any }))
vi.mock('naive-ui', () => ({
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.()),
  NDataTable: (props: any) => {
    captured.props = props
    return h('table')
  }
}))
test.each([0, 5, 100])(
  'keeps native flex-height header and pager outside bounded row scrolling: %i rows',
  async (count) => {
    const rows = Array.from({ length: count }, (_, index) => ({ id: index }))
    const key = (row: Record<string, unknown>) => String(row.id)
    await renderToString(
      createSSRApp(ScatterExactTable, {
        rows,
        columns: [{ title: '合成值', key: 'id' }],
        rowKey: key,
        rowClassName: () => '',
        viewportHeight: 172,
        contextKey: 'synthetic',
        scrollX: 650
      })
    )
    expect(captured.props['flex-height']).toBe(true)
    expect(captured.props['theme-overrides']).toEqual({ emptyPadding: '12px 0' })
    expect(captured.props['virtual-scroll']).toBe(count > 25)
    expect(captured.props.style).toEqual({ height: '172px' })
    expect(captured.props.data).toHaveLength(count)
    expect(captured.props.pagination).toEqual(count > 25 ? { page: 1, pageSize: 25 } : false)
    expect(captured.props['row-key'](rows[0] ?? { id: 0 })).toBe('0')
  }
)

async function cells(row: Record<string, unknown>, keys: string[]) {
  const metric = {
    key: 'x',
    title: '精确值',
    render: (r: Record<string, unknown>) => (r.x === null ? '—' : `${r.x} 金币/分钟`)
  }
  await renderToString(
    createSSRApp(ScatterExactTable, {
      rows: [row],
      columns: [...keys.map((key) => ({ key, title: key })), metric],
      rowKey: () => 'synthetic',
      rowClassName: () => 'scatter-selected-row',
      viewportHeight: 172,
      contextKey: 'synthetic',
      scrollX: 650
    })
  )
  const cols = captured.props.columns
  const html = await renderToString(
    createSSRApp({
      render: () =>
        h(
          'div',
          cols.map((c: any) => h('div', c.render?.(row) ?? String(row[c.key] ?? '—')))
        )
    })
  )
  return { html, cols, metric }
}
test('match identity cells use client assets and plain full IDs while retaining exact metric units/missingness', async () => {
  const row = {
    player: '匿名长成员#LONG_TAG',
    champion: '103',
    gameId: 90001,
    date: '2026-01-01',
    result: '胜',
    x: 123.45
  }
  const { html, cols, metric } = await cells(row, [
    'player',
    'champion',
    'gameId',
    'date',
    'result'
  ])
  expect(html).toContain('匿名长成员')
  expect(html).toContain('#LONG_TAG')
  expect(html).toContain('title="匿名长成员#LONG_TAG"')
  expect(html).toContain('data-avatar-size="24"')
  expect(html).toContain('data-champion-id="103"')
  expect(html).toContain('阿狸')
  expect(html).toContain('2026-01-01')
  expect(html).toContain('123.45 金币/分钟')
  expect(html.match(/<button/g) ?? []).toHaveLength(1)
  expect(html).toContain('aria-label="查看对局 90001"')
  expect(html).not.toContain('<a ')
  expect(cols.find((c: any) => c.key === 'x')).toBe(metric)
  expect(metric.render({ x: null })).toBe('—')
  expect(captured.props['row-class-name'](row)).toBe('scatter-selected-row')
})
test.each([
  ['短名#SYNTHETIC_LONG_TAG_ONLY', '短名', '#SYNTHETIC_LONG_TAG_ONLY'],
  ['匿名完整长成员名称#A', '匿名完整长成员名称', '#A'],
  ['匿名无标签成员', '匿名无标签成员', '']
])('retains complete identity text and accessible full identity: %s', async (player, name, tag) => {
  const { html } = await cells({ player, x: null }, ['player'])
  expect(html).toContain(`title="${player}"`)
  expect(html).toContain(name)
  if (tag) expect(html).toContain(tag)
  expect(html).toContain('data-avatar-size="24"')
})

test.each(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])(
  'a genuine canonical role %s uses its native icon and retains row text in either row grain',
  async (roleKey) => {
    for (const gameId of [90001, null]) {
      const { html, cols } = await cells({ roleKey, role: '真实分路文本', gameId, x: null }, [
        'role'
      ])
      expect(html).toContain(`data-native-position="${roleKey}"`)
      expect(html).toContain('aria-hidden="true"')
      expect(html).toContain('真实分路文本')
      expect(cols.find((c: any) => c.key === 'role').key).toBe('role')
    }
  }
)

test.each([undefined, null, '', 'ALL', 'FILL', 'MIXED', 'UNKNOWN', 'middle'])(
  'missing or noncanonical role %s never receives a fabricated position icon',
  async (roleKey) => {
    const { html } = await cells({ roleKey, role: '—', x: null }, ['role'])
    expect(html).not.toContain('data-native-position')
    expect(html).toContain('—')
  }
)

test.each(['Ahri', '阿狸'])(
  'champion alias %s resolves through the existing client dictionary',
  async (champion) => {
    const { html } = await cells({ player: '匿名#TAG', champion, x: null }, ['player', 'champion'])
    expect(html).toContain('data-champion-id="103"')
    expect(html).toContain('阿狸')
  }
)
test('summary rows do not acquire fictional match metadata, and unknown champions remain truthful text', async () => {
  const summary = await cells({ player: '匿名#TAG', games: 0, x: null }, ['player', 'games'])
  expect(summary.cols.map((c: any) => c.key)).toEqual(['player', 'games', 'x'])
  expect(summary.html).not.toContain('data-champion-id')
  expect(summary.html).not.toContain('<button')
  expect(captured.props['scroll-x']).toBe(650)
  const unknown = await cells({ champion: 'Unknown synthetic', x: null }, [
    'champion',
    'date',
    'gameId',
    'result'
  ])
  expect(unknown.html).toContain('Unknown synthetic')
  expect(unknown.html).not.toContain('data-champion-id')
  expect(unknown.html).toContain('—')
})

test.each([26, 51])(
  'selected row on a short last page retains complete data, the real key and native pagination: %i',
  async (count) => {
    const rows = Array.from({ length: count }, (_, id) => ({ id }))
    await renderToString(
      createSSRApp(ScatterExactTable, {
        rows,
        columns: [{ key: 'id', title: '合成值' }],
        rowKey: (r: any) => String(r.id),
        rowClassName: (r: any) => (r.id === count - 1 ? 'scatter-selected-row' : ''),
        selectedRowKey: String(count - 1),
        active: true,
        viewportHeight: 140,
        contextKey: 'synthetic-last-page',
        scrollX: 650
      })
    )
    expect(captured.props.data).toHaveLength(count)
    expect(captured.props.pagination).toEqual({ page: Math.ceil(count / 25), pageSize: 25 })
    expect(captured.props['row-props'](rows.at(-1))).toEqual({
      'data-scatter-row-key': String(count - 1)
    })
    expect(captured.props['row-class-name'](rows.at(-1))).toBe('scatter-selected-row')
  }
)

test('only a real single-match row exposes a native action, which stops bubbling and reuses precise match navigation', async () => {
  const store = useMemberAnalysisStore()
  const navigate = vi.spyOn(store, 'navigateToMatch')
  const { cols } = await cells({ gameId: 9800123, player: '匿名#TAG', x: null }, [
    'player',
    'gameId'
  ])
  const action = cols.find((column: any) => column.key === 'match-action')
  const button = action.render({ gameId: 9800123 })
  const stopPropagation = vi.fn()
  button.props.onKeydown({ stopPropagation })
  expect(navigate).not.toHaveBeenCalled()
  button.props.onClick({ stopPropagation })
  expect(stopPropagation).toHaveBeenCalledTimes(2)
  expect(navigate).toHaveBeenCalledExactlyOnceWith(9800123, '全部精确值')
  expect(store.matchNavigation?.gameId).toBe(9800123)
  expect(captured.props['scroll-x']).toBe(758)
  for (const gameId of [null, undefined, '', '9800123', 0, -1, NaN, Infinity, 1.5])
    expect(action.render({ gameId })).toBeNull()
})
