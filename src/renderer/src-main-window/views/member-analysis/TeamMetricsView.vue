<template>
  <section ref="container" class="ma-panel team-metrics-view" aria-label="团队指标">
    <div class="team-metrics-toolbar">
      <NSelect v-model:value="group" :options="groupOptions" aria-label="团队指标分组" />
      <label v-if="store.analysisSide === 'all'" class="team-metrics-side">
        蓝红方拆分 <NSwitch v-model:value="sideBreakdown" aria-label="蓝红方拆分" />
      </label>
    </div>
    <NEmpty v-if="!games.length" description="当前筛选范围内没有团队数据" />
    <div v-else class="team-metrics-tables">
      <div
        v-for="(tableSections, tableIndex) in tables"
        :key="tableIndex"
        class="team-metrics-scroll"
        tabindex="0"
        role="region"
        aria-label="团队指标表格，可横向滚动"
      >
        <table :aria-label="tables.length > 1 ? `团队指标第 ${tableIndex + 1} 组` : '团队指标'">
          <thead>
            <tr>
              <th scope="col">指标</th>
              <th
                v-for="column in columns"
                :key="column.index"
                scope="col"
                :class="{ 'team-metrics-primary': column.index === 0 }"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <template v-for="section in tableSections" :key="section.label">
              <tr class="team-metrics-group">
                <th :colspan="columns.length + 1" scope="colgroup">{{ section.label }}</th>
              </tr>
              <tr
                v-for="row in section.rows"
                :key="row.key"
                :class="{ 'team-metrics-key': keyMetrics.has(row.key) }"
              >
                <th scope="row">
                  <MetricHelp
                    :label="row.label"
                    :definition="
                      [
                        row.definition,
                        ...columns.map((column) =>
                          row.cells[column.index].sample
                            ? `${column.label}：${row.cells[column.index].sample}`
                            : ''
                        )
                      ]
                        .filter(Boolean)
                        .join(' ')
                    "
                  />
                </th>
                <td
                  v-for="column in columns"
                  :key="column.index"
                  :class="{
                    'team-metrics-primary': column.index === 0,
                    'ma-positive': row.cells[column.index].tone === 'positive',
                    'ma-negative': row.cells[column.index].tone === 'negative',
                    'team-metrics-missing': row.cells[column.index].value === '—'
                  }"
                  :title="row.cells[column.index].sample || undefined"
                  :aria-label="
                    [row.cells[column.index].value, row.cells[column.index].sample]
                      .filter(Boolean)
                      .join('；')
                  "
                >
                  {{ row.cells[column.index].value }}
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import { NEmpty, NSelect, NSwitch } from 'naive-ui'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MetricHelp from './MetricHelp.vue'
import { teamMetricGroups, teamMetricRows } from './team-metrics'
import { useMemberAnalysisData } from './useMemberAnalysisData'

const container = ref<HTMLElement | null>(null)
const { width } = useElementSize(container)
const store = useMemberAnalysisStore()
const { games } = useMemberAnalysisData()
const group = ref('全部指标')
const sideBreakdown = ref(true)
const groupOptions = teamMetricGroups.map((label) => ({ label, value: label }))
const keyMetrics = new Set([
  'winRate',
  'gold15',
  'gold20',
  'killConversionRate',
  'highCostDeathRate',
  'objectiveFightWinRate',
  'crossMapTradeRate'
])
const rows = computed(() => teamMetricRows(games.value))
const sections = computed(() =>
  teamMetricGroups
    .slice(1)
    .filter((label) => group.value === '全部指标' || group.value === label)
    .map((label) => ({ label, rows: rows.value.filter((row) => row.group === label) }))
)
// Read down the left table, then the right; keep every metric exactly once.
const tables = computed(() => {
  if (width.value < 1360) return [sections.value]
  const visibleRows = sections.value.flatMap((section) => section.rows)
  if (visibleRows.length < 2) return [sections.value]
  const target = Math.ceil(visibleRows.length / 2)
  const boundaries = sections.value
    .slice(0, -1)
    .map((_, index) =>
      sections.value.slice(0, index + 1).reduce((count, section) => count + section.rows.length, 0)
    )
  const midpoint = boundaries.length
    ? boundaries.reduce((best, boundary) =>
        Math.abs(boundary - target) < Math.abs(best - target) ? boundary : best
      )
    : target
  return [visibleRows.slice(0, midpoint), visibleRows.slice(midpoint)].map((half) =>
    sections.value
      .map((section) => ({ ...section, rows: half.filter((row) => row.group === section.label) }))
      .filter((section) => section.rows.length)
  )
})
const columns = computed(() =>
  store.analysisSide === 'all' && sideBreakdown.value
    ? [
        { label: '总计', index: 0 },
        { label: '蓝方', index: 1 },
        { label: '红方', index: 2 }
      ]
    : [
        {
          label:
            store.analysisSide === 'all' ? '总计' : store.analysisSide === 'Blue' ? '蓝方' : '红方',
          index: 0
        }
      ]
)
</script>
<style scoped>
.team-metrics-view {
  min-width: 0;
  font-size: 14px;
}
.team-metrics-toolbar {
  display: flex;
  gap: 16px;
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.team-metrics-toolbar :deep(.n-select) {
  width: 180px;
}
.team-metrics-side {
  display: flex;
  gap: 8px;
  align-items: center;
}
.team-metrics-tables {
  display: grid;
  grid-template-columns: repeat(v-bind('tables.length'), minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.team-metrics-scroll {
  max-width: 100%;
  overflow-x: auto;
  border: 1px solid var(--ma-grid);
  border-radius: 8px;
  background: color-mix(in srgb, var(--la-card-surface-95) 88%, transparent);
}
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 4px 20px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  min-width: 144px;
  vertical-align: middle;
  box-sizing: border-box;
}
th:first-child {
  text-align: left;
  min-width: 220px;
  padding-left: 16px;
}
th {
  font-weight: 500;
}
thead th {
  height: 40px;
  color: var(--ma-muted);
  background: var(--la-color-bg-primary);
  border-bottom-color: var(--ma-grid-strong);
  white-space: nowrap;
}
tbody tr:not(.team-metrics-group) {
  height: 44px;
}
tbody tr:last-child > * {
  border-bottom: 0;
}
.team-metrics-group th {
  text-align: left;
  height: 48px;
  padding: 16px 16px 8px;
  background: var(--la-card-surface-95);
  border-bottom-color: var(--ma-grid-strong);
  color: var(--la-color-text-primary);
  font-weight: 600;
}
.team-metrics-primary {
  background: color-mix(in srgb, var(--ma-grid) 45%, transparent);
  font-weight: 600;
}
thead .team-metrics-primary {
  color: var(--la-color-text-primary);
}
.team-metrics-key > th,
.team-metrics-key > td {
  font-weight: 600;
  color: var(--la-color-text-primary);
}
.team-metrics-key > .team-metrics-primary {
  font-weight: 700;
}
td.team-metrics-missing {
  color: var(--ma-muted);
  font-weight: 400;
}
td.ma-positive {
  color: var(--ma-positive);
}
td.ma-negative {
  color: var(--ma-negative);
}
tbody tr:not(.team-metrics-group):hover {
  background: var(--ma-grid);
}
.team-metrics-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
</style>
