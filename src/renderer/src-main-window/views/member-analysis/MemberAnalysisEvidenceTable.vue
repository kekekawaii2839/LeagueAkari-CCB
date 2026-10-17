<template>
  <div class="ma-evidence">
    <NDataTable
      :flex-height="bounded"
      :style="bounded ? { height: `${viewportHeight}px` } : undefined"
      :columns="tableColumns"
      :data="games"
      :row-key="(game: MemberAnalysisGame) => game.gameId"
      :pagination="games.length > 10 ? { page, pageSize: 10 } : false"
      :scroll-x="scrollX"
      :bordered="false"
      size="small"
      class="member-analysis-metric-table"
      @update:page="changePage"
    />
  </div>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { NButton, NDataTable, type DataTableColumns, type DataTableSortOrder } from 'naive-ui'
import { computed, h, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    games: MemberAnalysisGame[]
    columns: DataTableColumns<MemberAnalysisGame>
    contextKey: string
    scrollX?: number
    viewportHeight?: number
    navigateToMatch: (game: MemberAnalysisGame) => void
  }>(),
  { scrollX: 720 }
)
const bounded = computed(
  () =>
    typeof props.viewportHeight === 'number' &&
    Number.isFinite(props.viewportHeight) &&
    props.viewportHeight > 0
)
const page = ref(1)
function changePage(value: number) {
  page.value = value
}
watch(
  () => props.contextKey,
  () => {
    page.value = 1
  }
)
watch(
  () => props.games.length,
  (count) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(count / 10)))
  }
)
const renderNavigationButton = (game: MemberAnalysisGame) =>
  h(
    NButton,
    {
      size: 'small',
      quaternary: true,
      'aria-label': `查看对局 ${game.gameId}`,
      onClick: (event: MouseEvent) => {
        if (bounded.value) event.stopPropagation()
        return props.navigateToMatch(game)
      }
    },
    { default: () => '查看对局' }
  )
const tableColumns = computed<DataTableColumns<MemberAnalysisGame>>(() => [
  { title: '对局', key: 'gameId', width: 120 },
  { title: '日期', key: 'date', width: 125 },
  {
    title: '结果 / 阵营',
    key: 'result',
    width: 130,
    render: (game) => `${game.win ? '胜利' : '失败'} · ${game.side === 'Blue' ? '蓝方' : '红方'}`
  },
  ...props.columns.map((column) => {
    if (!('sorter' in column) || !column.sorter || column.renderSorter) return column
    const label = typeof column.title === 'string' ? column.title : '指标'
    return {
      ...column,
      // Keep Naive's comparator, order cycle and header click handling. A native
      // button adds the same keyboard entry as role-table headings; its click
      // bubbles to that existing handler exactly once.
      renderSorter: ({ order }: { order: DataTableSortOrder }) =>
        h(
          'button',
          {
            type: 'button',
            class: ['evidence-sort-button', { 'is-sorted': !!order }],
            'aria-label': `${label}：${order === 'ascend' ? '升序' : order === 'descend' ? '降序' : '未排序'}`
          },
          h(
            'span',
            { class: 'evidence-sort-direction', 'aria-hidden': 'true' },
            order === 'ascend' ? '↑' : order === 'descend' ? '↓' : '↕'
          )
        )
    }
  }),
  {
    title: '',
    key: 'detail',
    width: 115,
    render: renderNavigationButton
  }
])
</script>
<style scoped>
.ma-evidence {
  min-width: 0;
}
.member-analysis-metric-table {
  border-top: 1px solid var(--ma-grid-strong);
  --n-td-color: transparent !important;
  --n-th-color: transparent !important;
  --n-td-color-hover: var(--ma-hover) !important;
}
.member-analysis-metric-table :deep(.n-data-table-th),
.member-analysis-metric-table :deep(.n-data-table-td) {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.member-analysis-metric-table :deep(.n-data-table-th) {
  color: var(--ma-muted);
  font-weight: 500;
}
.member-analysis-metric-table :deep(.evidence-sort-button) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  width: 24px;
  min-height: 32px;
  margin-left: 4px;
  padding: 0 4px;
  box-sizing: border-box;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.member-analysis-metric-table :deep(.evidence-sort-direction) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 21px;
  line-height: 21px;
  text-align: center;
  white-space: nowrap;
}
.member-analysis-metric-table :deep(.evidence-sort-button:hover),
.member-analysis-metric-table :deep(.evidence-sort-button.is-sorted) {
  color: var(--la-color-link);
}
.member-analysis-metric-table :deep(.evidence-sort-button.is-sorted) {
  font-weight: 600;
}
.member-analysis-metric-table :deep(.evidence-sort-button:focus-visible) {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
</style>
