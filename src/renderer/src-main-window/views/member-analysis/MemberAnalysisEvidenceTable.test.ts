// sort-imports-ignore
import './test-i18n'

import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { createSSRApp, h, type VNode } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, test, vi } from 'vitest'

import MemberAnalysisEvidenceTable from './MemberAnalysisEvidenceTable.vue'

const table = vi.hoisted(() => ({ columns: [] as any[] }))
vi.mock('naive-ui', () => ({
  NDataTable: (props: { columns: any[] }) => {
    table.columns = props.columns
    return null
  },
  NButton: (_: unknown, { slots }: any) => h('button', slots.default?.())
}))

test('an opted-in single evidence row sends that exact game; other evidence keeps local expansion', async () => {
  const game = { gameId: 900041, players: [] } as unknown as MemberAnalysisGame
  const navigateToMatch = vi.fn()
  const render = (navigate?: typeof navigateToMatch) =>
    renderToString(
      createSSRApp(MemberAnalysisEvidenceTable, {
        games: [game],
        columns: [],
        contextKey: 'synthetic-event',
        navigateToMatch: navigate
      })
    )
  await render(navigateToMatch)
  const button = table.columns.at(-1).render(game) as VNode
  await button.props!.onClick({ currentTarget: null })
  expect(navigateToMatch).toHaveBeenCalledExactlyOnceWith(game)
  // A sibling without the optional callback still takes the original local path.
  await render()
  const local = table.columns.at(-1).render(game) as VNode
  await local.props!.onClick({ currentTarget: null })
  expect(navigateToMatch).toHaveBeenCalledOnce()
  const expanded = table.columns.at(-1).render(game) as VNode
  expect(expanded.props!['aria-expanded']).toBe(true)
})
