// sort-imports-ignore
import './test-i18n'

import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { createSSRApp, h, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test, vi } from 'vitest'

import MemberAnalysisEvidenceTable from './MemberAnalysisEvidenceTable.vue'

const table = vi.hoisted(() => ({ columns: [] as any[], props: {} as any }))
vi.mock('naive-ui', () => ({
  NDataTable: (props: { columns: any[] } & Record<string, unknown>) => {
    table.columns = props.columns
    table.props = {
      ...props,
      flexHeight: props.flexHeight ?? props['flex-height'],
      expandedRowKeys: props.expandedRowKeys ?? props['expanded-row-keys'],
      renderExpandIcon: props.renderExpandIcon ?? props['render-expand-icon']
    }
    return null
  },
  NButton: (_: unknown, { slots }: any) => h('button', slots.default?.())
}))

test('sortable evidence uses role-table direction glyphs without replacing native sorting', async () => {
  const sorter = (a: MemberAnalysisGame, b: MemberAnalysisGame) => a.gameId - b.gameId
  const column = { title: '15 分钟经济差（金币）', key: 'diff', sorter, align: 'right' as const }
  await renderToString(
    createSSRApp(MemberAnalysisEvidenceTable, {
      games: [],
      columns: [column, { title: '样本', key: 'sample' }],
      contextKey: 'sortable',
      navigateToMatch: vi.fn()
    })
  )
  const renderedColumn = table.columns.find((item) => item.key === 'diff')
  expect(renderedColumn.sorter).toBe(sorter)
  expect(renderedColumn.title).toBe(column.title)
  expect(renderedColumn.align).toBe('right')
  expect(column).not.toHaveProperty('renderSorter')
  expect(table.columns.find((item) => item.key === 'sample').renderSorter).toBeUndefined()
  for (const [order, direction, description] of [
    [false, '↕', '未排序'],
    ['ascend', '↑', '升序'],
    ['descend', '↓', '降序']
  ] as const) {
    const button = renderedColumn.renderSorter({ order }) as VNode
    expect(button.type).toBe('button')
    expect(button.props!.type).toBe('button')
    expect(button.props!['aria-label']).toBe(`${column.title}：${description}`)
    // Native Enter/Space activation must bubble to Naive's existing TH handler,
    // not install another comparator or duplicate click/keydown transitions.
    expect(button.props!.onClick).toBeUndefined()
    expect(button.props!.onKeydown).toBeUndefined()
    const html = await renderToString(createSSRApp({ render: () => button }))
    expect(html).toContain(`aria-hidden="true">${direction}</span>`)
  }
})

test('every evidence action navigates to the exact game without opening an inline detail', async () => {
  const game = { gameId: 900041, players: [] } as unknown as MemberAnalysisGame
  for (const viewportHeight of [undefined, 240]) {
    const navigateToMatch = vi.fn()
    await renderToString(
      createSSRApp(MemberAnalysisEvidenceTable, {
        games: [game],
        columns: [],
        contextKey: 'synthetic-event',
        viewportHeight,
        navigateToMatch
      })
    )
    const column = table.columns.at(-1)
    expect(column.type).toBeUndefined()
    expect(column.renderExpand).toBeUndefined()
    expect(table.props.renderExpandIcon).toBeUndefined()
    expect(table.props.expandedRowKeys).toBeUndefined()
    const button = column.render(game) as VNode
    expect(button.props!['aria-label']).toBe(`查看对局 ${game.gameId}`)
    expect(button.props!['aria-expanded']).toBeUndefined()
    expect(await renderToString(createSSRApp({ render: () => button }))).toContain('查看对局')
    const stopPropagation = vi.fn()
    await button.props!.onClick({ stopPropagation })
    expect(navigateToMatch).toHaveBeenCalledExactlyOnceWith(game)
    expect(stopPropagation).toHaveBeenCalledTimes(viewportHeight ? 1 : 0)
    // Returning to the evidence row never changes its action into collapse.
    const again = column.render(game) as VNode
    await again.props!.onClick({ stopPropagation })
    expect(navigateToMatch).toHaveBeenCalledTimes(2)
    expect(navigateToMatch).toHaveBeenLastCalledWith(game)
    expect(await renderToString(createSSRApp({ render: () => again }))).toContain('查看对局')
  }
})

test('bounded evidence retains native height, pagination, data identity and exact row keys', async () => {
  const games = Array.from({ length: 20 }, (_, index) => ({
    gameId: index + 1,
    players: []
  })) as unknown as MemberAnalysisGame[]
  await renderToString(
    createSSRApp(MemberAnalysisEvidenceTable, {
      games,
      columns: [],
      contextKey: 'bounded',
      viewportHeight: 240,
      navigateToMatch: vi.fn()
    })
  )
  expect(table.props.flexHeight).toBe(true)
  expect(table.props.style).toEqual({ height: '240px' })
  expect(table.props.pagination).toEqual({ page: 1, pageSize: 10 })
  expect(table.props.data).toBe(games)
  const rowKey = table.props.rowKey ?? table.props['row-key']
  expect(rowKey(games[0])).toBe(1)
  expect(rowKey(games.at(-1))).toBe(20)
  expect(table.columns.at(-1).type).toBeUndefined()
})

test('short or unbounded evidence keeps native auto height without unnecessary pagination', async () => {
  for (const viewportHeight of [undefined, 0, -1, Number.NaN]) {
    await renderToString(
      createSSRApp(MemberAnalysisEvidenceTable, {
        games: [],
        columns: [],
        contextKey: 'ordinary',
        viewportHeight,
        scrollX: 650,
        navigateToMatch: vi.fn()
      })
    )
    expect(table.props.flexHeight).toBe(false)
    expect(table.props.style).toBeUndefined()
    expect(table.props.pagination).toBe(false)
    expect(table.props.scrollX ?? table.props['scroll-x']).toBe(650)
  }
})
