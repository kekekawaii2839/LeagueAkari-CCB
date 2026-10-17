<template>
  <div ref="root" class="ma-panel ma-workspace ma-results event-results">
    <div v-if="!conversion.length" class="ma-empty">当前筛选下没有事件结果。</div>
    <template v-else>
      <div
        ref="comparisonViewport"
        class="event-comparison-viewport"
        :style="comparisonHeight ? { maxHeight: `${comparisonHeight}px` } : undefined"
        tabindex="0"
        role="region"
        aria-label="事件结果指标"
      >
        <div class="event-sections">
          <section
            v-for="section in sections"
            :key="section.title"
            class="event-section"
            :aria-label="section.title"
          >
            <h3>{{ section.title }}</h3>
            <div class="ma-result-table-wrap">
              <table
                class="ma-result-table event-result-table"
                :aria-label="`${section.title}的总计与蓝红方比较`"
              >
                <thead>
                  <tr>
                    <th scope="col">指标</th>
                    <th v-for="row in comparison" :key="row.sideLabel" scope="col">
                      {{ row.sideLabel }}
                      <small v-if="row.sideLabel !== '总计'">· {{ row.games.length }} 场</small>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="metric in section.metrics" :key="metric.key">
                    <th scope="row">
                      <MetricHelp :label="metric.label" :definition="metric.help" />
                    </th>
                    <td
                      v-for="row in comparison"
                      :key="row.sideLabel"
                      :class="{ 'is-selected': isSelected(metric.key, row.sideLabel) }"
                    >
                      <button
                        type="button"
                        class="event-cell"
                        :aria-pressed="isSelected(metric.key, row.sideLabel)"
                        :aria-label="`${row.sideLabel}，${metric.label}，${row.cells[metric.key]?.value}，${row.cells[metric.key]?.sample}，查看对应对局`"
                        @click="selectMetric(metric.key, row.sideLabel, $event)"
                      >
                        <strong>{{ row.cells[metric.key]?.value }}</strong>
                        <small>{{ row.cells[metric.key]?.sample }}</small>
                        <span
                          v-if="isSelected(metric.key, row.sideLabel)"
                          class="ma-result-selected"
                          >已选</span
                        >
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      <div v-if="selection" class="ma-section-title">
        <strong
          >{{ uiText('matchingGames')
          }}<template v-if="selection">
            · {{ selection.side }} · {{ selectedMetric?.label }}</template
          ></strong
        >
        <NButton v-if="selection" size="small" quaternary @click="clearSelection">{{
          uiText('clearSelection')
        }}</NButton>
      </div>
      <p v-if="notice" class="ma-chart-note" role="status">{{ notice }}</p>
      <template v-if="selection">
        <div class="ma-view-toolbar">
          <span class="ma-view-meta">{{ evidenceGames.length }} 场</span>
          <NRadioGroup
            v-if="selectedSection?.title === '死亡代价'"
            v-model:value="deathOrder"
            size="small"
            aria-label="死亡代价对局排序"
            ><NRadioButton value="cost">死亡代价降序</NRadioButton
            ><NRadioButton value="date">最近对局在前</NRadioButton></NRadioGroup
          >
        </div>
        <section
          ref="evidenceViewport"
          class="event-evidence-viewport"
          role="region"
          tabindex="0"
          :aria-label="uiText('matchingGames')"
        >
          <MemberAnalysisEvidenceTable
            :viewport-height="evidenceHeight"
            :games="evidenceGames"
            :columns="gameColumns"
            :context-key="`${selection.side}|${selection.key}`"
            :navigate-to-match="navigateToMatch"
          />
        </section>
      </template>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { NButton, NRadioButton, NRadioGroup, type DataTableColumns } from 'naive-ui'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { type ConversionAggregate, type SideLabel } from './analytics'
import { eventGameCells, eventMetricCell, eventSections, eventSideGames } from './event-results'
import MemberAnalysisEvidenceTable from './MemberAnalysisEvidenceTable.vue'
import MetricHelp from './MetricHelp.vue'
import { uiText } from './ui-text'
import { useMemberAnalysisData } from './useMemberAnalysisData'
const { conversion, games } = useMemberAnalysisData()
const store = useMemberAnalysisStore()
const root = ref<HTMLElement | null>(null)
const comparisonViewport = ref<HTMLElement | null>(null)
const comparisonHeight = ref(0)
const evidenceViewport = ref<HTMLElement | null>(null)
const evidenceHeight = ref(280)
let layoutObserver: ResizeObserver | undefined
let layoutMutations: MutationObserver | undefined
let budgetFrame = 0
function measureEvidenceSpace() {
  const panel = root.value
  const comparison = comparisonViewport.value
  const region = evidenceViewport.value
  const scroller = panel?.closest<HTMLElement>('.member-analysis-scroll')
  if (
    !panel ||
    !comparison ||
    !scroller ||
    scroller.clientHeight <= 0 ||
    comparison.getClientRects().length === 0
  )
    return
  const ownerTop = scroller.getBoundingClientRect().top
  const compareRect = comparison.getBoundingClientRect()
  const compareTop = compareRect.top - ownerTop + scroller.scrollTop
  let bottomPadding = 8
  let ancestor: HTMLElement | null = panel
  while (ancestor && ancestor !== scroller) {
    const style = getComputedStyle(ancestor)
    for (const value of [style.paddingBottom, style.borderBottomWidth, style.marginBottom])
      bottomPadding += Number.parseFloat(value) || 0
    ancestor = ancestor.parentElement
  }
  const header = region?.querySelector<HTMLElement>('.n-data-table-thead')
  const row = region?.querySelector<HTMLElement>('.n-data-table-tbody > tr')
  const pager = region?.querySelector<HTMLElement>('.n-data-table__pagination')
  const minimum =
    header && row
      ? Math.ceil(
          header.getBoundingClientRect().height +
            row.getBoundingClientRect().height +
            (pager
              ? pager.getBoundingClientRect().height +
                (Number.parseFloat(getComputedStyle(pager).marginTop) || 0)
              : 0) +
            2
        )
      : 128
  const following = region
    ? region.getBoundingClientRect().top - compareRect.bottom + minimum
    : Math.max(
        0,
        panel.getBoundingClientRect().bottom -
          compareRect.bottom -
          (Number.parseFloat(getComputedStyle(panel).paddingBottom) || 0)
      )
  // The primary metric list may scroll only when all sections plus a complete
  // evidence row cannot fit. No section or indicator is removed to make space.
  const budget = Math.max(
    180,
    Math.floor(scroller.clientHeight - compareTop - bottomPadding - following)
  )
  if (comparisonHeight.value !== budget) {
    comparisonHeight.value = budget
    void nextTick(queueEvidenceSpace)
  }
  if (!region || region.getClientRects().length === 0) return
  const top = region.getBoundingClientRect().top - ownerTop + scroller.scrollTop
  evidenceHeight.value = Math.max(minimum, Math.floor(scroller.clientHeight - top - bottomPadding))
}
function queueEvidenceSpace() {
  if (budgetFrame || typeof requestAnimationFrame === 'undefined') {
    if (typeof requestAnimationFrame === 'undefined') measureEvidenceSpace()
    return
  }
  budgetFrame = requestAnimationFrame(() => {
    budgetFrame = 0
    measureEvidenceSpace()
  })
}
onMounted(() => {
  const scroller = root.value?.closest<HTMLElement>('.member-analysis-scroll')
  if (!scroller || !root.value) return
  if (typeof ResizeObserver !== 'undefined') {
    layoutObserver = new ResizeObserver(queueEvidenceSpace)
    // A sibling status banner can move the view without resizing it.
    let ancestor: HTMLElement | null = root.value
    while (ancestor) {
      layoutObserver.observe(ancestor)
      if (ancestor === scroller) break
      ancestor = ancestor.parentElement
    }
  }
  if (typeof MutationObserver !== 'undefined') {
    layoutMutations = new MutationObserver(queueEvidenceSpace)
    layoutMutations.observe(scroller, { childList: true, subtree: true, characterData: true })
  }
  measureEvidenceSpace()
})
onBeforeUnmount(() => {
  layoutObserver?.disconnect()
  layoutMutations?.disconnect()
  if (budgetFrame) cancelAnimationFrame(budgetFrame)
})
function navigateToMatch(game: MemberAnalysisGame) {
  store.navigateToMatch(
    game.gameId,
    uiText('matchEventSource', { side: selection.value?.side, metric: selectedMetric.value?.label })
  )
}
const sections = eventSections.map((section) => ({
  title: section.title,
  metrics: [...section.metrics, ...section.extra]
}))
const visibleMetrics = sections.flatMap((section) => section.metrics)
const deathOrder = ref('cost')
const selection = ref<{ key: keyof ConversionAggregate; side: SideLabel } | null>(null)
const notice = ref('')
let trigger: HTMLElement | null = null
const selectedSection = computed(() =>
  sections.find((section) => section.metrics.some((metric) => metric.key === selection.value?.key))
)
const selectedMetric = computed(() =>
  visibleMetrics.find((metric) => metric.key === selection.value?.key)
)
const comparison = computed(() =>
  conversion.value.map((row) => {
    const sideGames = eventSideGames(games.value, row.sideLabel)
    return {
      sideLabel: row.sideLabel,
      games: sideGames,
      cells: Object.fromEntries(
        visibleMetrics.map((metric) => [metric.key, eventMetricCell(metric, row, sideGames)])
      )
    }
  })
)
const isSelected = (key: keyof ConversionAggregate, side: SideLabel) =>
  selection.value?.key === key && selection.value.side === side
function selectMetric(key: keyof ConversionAggregate, side: SideLabel, event: MouseEvent) {
  trigger = event.currentTarget as HTMLElement
  selection.value = isSelected(key, side) ? null : { key, side }
  notice.value = ''
}
async function clearSelection() {
  selection.value = null
  await nextTick()
  if (trigger?.isConnected) {
    trigger.scrollIntoView({ block: 'nearest' })
    trigger.focus({ preventScroll: true })
  }
}
watch(comparison, (rows) => {
  if (selection.value && !rows.some((row) => row.sideLabel === selection.value?.side)) {
    selection.value = null
    notice.value = uiText('selectionUnavailable')
  }
})
const evidenceGames = computed(() => {
  if (!selection.value) return []
  const rows = [...eventSideGames(games.value, selection.value.side)]
  return rows.sort(
    selectedSection.value?.title === '死亡代价' && deathOrder.value === 'cost'
      ? (a, b) =>
          (b.eventDecision?.deathCostPoints ?? -Infinity) -
            (a.eventDecision?.deathCostPoints ?? -Infinity) || b.timestamp - a.timestamp
      : (a, b) => b.timestamp - a.timestamp
  )
})
watch([selection, comparison], async () => {
  await nextTick()
  measureEvidenceSpace()
})
const cellsByGame = computed(() =>
  selectedMetric.value ? eventGameCells(selectedMetric.value, evidenceGames.value) : new Map()
)
const gameColumns = computed<DataTableColumns<MemberAnalysisGame>>(() => [
  {
    title: selectedMetric.value?.label ?? '指标',
    key: 'metric',
    width: 135,
    align: 'right',
    render: (game) => cellsByGame.value.get(game.gameId)?.value ?? '—'
  },
  {
    title: selectedMetric.value?.windows ?? (selectedMetric.value?.samples ? '延迟样本' : '样本'),
    key: 'sample',
    width: 160,
    render: (game) => cellsByGame.value.get(game.gameId)?.sample ?? '—'
  }
])
</script>
<style scoped>
.event-results.ma-workspace.ma-results {
  padding: 12px 16px;
  gap: 8px;
}
.event-results > .ma-section-title {
  margin-top: 0;
  padding-top: 8px;
}
.event-comparison-viewport {
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.event-comparison-viewport:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
.event-sections {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  align-items: start;
}
.event-section {
  min-width: 0;
}
.event-section h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  text-align: left;
}
@container ma-results (max-width: 1080px) {
  .event-sections {
    grid-template-columns: 1fr;
  }
}
.event-evidence-viewport {
  min-width: 0;
  min-height: 0;
}
.event-evidence-viewport:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}

.event-result-table {
  min-width: 500px;
  table-layout: fixed;
}
.event-result-table th:first-child {
  width: 24%;
}
/* Match the painted circle to the adjacent CJK glyphs, not the line box.
   This is optical-only: keep the button, table rows and evidence budget unchanged. */
.event-result-table :deep(.metric-help__icon) {
  transform: translateY(0.5px);
}
.event-cell {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4px 12px;
  width: 100%;
  min-height: 32px;
  padding: 4px 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-align: right;
}
.event-cell strong {
  font-size: 14px;
  font-weight: 600;
}
.event-cell:focus-visible {
  outline: 2px solid var(--la-color-text-primary);
  outline-offset: 3px;
  border-radius: 4px;
}
</style>

<style scoped>
@media (max-height: 900px) {
  .event-results .event-result-table th,
  .event-results .event-result-table td {
    padding-top: 2px;
    padding-bottom: 2px;
  }
}
</style>
