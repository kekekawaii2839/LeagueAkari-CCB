<template>
  <div class="ma-panel ma-workspace ma-results">
    <div class="ma-view-toolbar">
      <div class="ma-result-controls">
        <NRadioGroup v-model:value="sectionIndex" aria-label="事件结果类别"
          ><NRadioButton
            v-for="(section, index) in eventSections"
            :key="section.title"
            :value="index"
            >{{ section.title }}</NRadioButton
          ></NRadioGroup
        >
      </div>
    </div>
    <div v-if="!conversion.length" class="ma-empty">当前筛选下没有事件结果。</div>
    <template v-else>
      <div class="ma-result-table-wrap">
        <table
          class="ma-result-table event-result-table"
          aria-label="当前事件类别的总计与蓝红方比较"
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
            <tr v-for="metric in visibleMetrics" :key="metric.key">
              <th scope="row"><MetricHelp :label="metric.label" :definition="metric.help" /></th>
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
                  <strong>{{ row.cells[metric.key]?.value }}</strong
                  ><small>{{ row.cells[metric.key]?.sample }}</small>
                  <span v-if="isSelected(metric.key, row.sideLabel)" class="ma-result-selected"
                    >已选</span
                  >
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <NButton
        v-if="currentSection.extra.length"
        size="small"
        quaternary
        class="event-extras"
        :aria-expanded="showExtra"
        @click="toggleExtra"
        >{{ showExtra ? '收起' : '展开' }}类别补充指标</NButton
      >
      <p class="ma-chart-note">{{ uiText('eventWindowNote') }}</p>
      <div class="ma-section-title">
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
      <p v-if="!selection" class="ma-chart-note">{{ uiText('noEventSelection') }}</p>
      <template v-else>
        <div class="ma-view-toolbar">
          <span class="ma-view-meta"
            >{{ evidenceGames.length }} 场 · {{ uiText('eventGameNote') }}</span
          >
          <NRadioGroup
            v-if="sectionIndex === 1"
            v-model:value="deathOrder"
            size="small"
            aria-label="死亡代价对局排序"
            ><NRadioButton value="cost">死亡代价降序</NRadioButton
            ><NRadioButton value="date">最近对局在前</NRadioButton></NRadioGroup
          >
        </div>
        <MemberAnalysisEvidenceTable
          :games="evidenceGames"
          :columns="gameColumns"
          :context-key="`${sectionIndex}|${selection.side}|${selection.key}`"
          :navigate-to-match="navigateToMatch"
        >
          <template #detail="{ game }"
            ><p class="ma-chart-note">
              {{ selectedMetric?.label }}：{{ cellsByGame.get(game.gameId)?.value }} ·
              {{ cellsByGame.get(game.gameId)?.sample }}
            </p>
            <p v-if="sectionIndex === 1" class="ma-chart-note">
              死亡代价 {{ formatMetric(game.eventDecision?.deathCostPoints) }} 点 · 资源
              {{ formatMetric(game.eventDecision?.deathCostEpics, 'int') }} 个 · 塔
              {{ formatMetric(game.eventDecision?.deathCostTowers, 'int') }} 座 · 镀层
              {{ formatMetric(game.eventDecision?.deathCostPlates, 'int') }} 层
            </p></template
          >
        </MemberAnalysisEvidenceTable>
      </template>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { NButton, NRadioButton, NRadioGroup, type DataTableColumns } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { type ConversionAggregate, type SideLabel } from './analytics'
import { eventGameCells, eventMetricCell, eventSections, eventSideGames } from './event-results'
import MemberAnalysisEvidenceTable from './MemberAnalysisEvidenceTable.vue'
import MetricHelp from './MetricHelp.vue'
import { formatMetric } from './metric-defs'
import { uiText } from './ui-text'
import { useMemberAnalysisData } from './useMemberAnalysisData'
const { conversion, games } = useMemberAnalysisData()
const store = useMemberAnalysisStore()
function navigateToMatch(game: MemberAnalysisGame) {
  store.navigateToMatch(
    game.gameId,
    uiText('matchEventSource', { side: selection.value?.side, metric: selectedMetric.value?.label })
  )
}
const sectionIndex = ref(0)
const showExtra = ref(false)
const deathOrder = ref('cost')
const selection = ref<{ key: keyof ConversionAggregate; side: SideLabel } | null>(null)
const notice = ref('')
let trigger: HTMLElement | null = null
const currentSection = computed(() => eventSections[sectionIndex.value])
const visibleMetrics = computed(() => [
  ...currentSection.value.metrics,
  ...(showExtra.value ? currentSection.value.extra : [])
])
const selectedMetric = computed(() =>
  visibleMetrics.value.find((metric) => metric.key === selection.value?.key)
)
const comparison = computed(() =>
  conversion.value.map((row) => {
    const sideGames = eventSideGames(games.value, row.sideLabel)
    return {
      sideLabel: row.sideLabel,
      games: sideGames,
      cells: Object.fromEntries(
        visibleMetrics.value.map((metric) => [metric.key, eventMetricCell(metric, row, sideGames)])
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
function toggleExtra() {
  showExtra.value = !showExtra.value
  if (
    !showExtra.value &&
    currentSection.value.extra.some((metric) => metric.key === selection.value?.key)
  )
    selection.value = null
}
watch(sectionIndex, () => {
  selection.value = null
  showExtra.value = false
  notice.value = ''
})
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
    sectionIndex.value === 1 && deathOrder.value === 'cost'
      ? (a, b) =>
          (b.eventDecision?.deathCostPoints ?? -Infinity) -
            (a.eventDecision?.deathCostPoints ?? -Infinity) || b.timestamp - a.timestamp
      : (a, b) => b.timestamp - a.timestamp
  )
})
const cellsByGame = computed(() =>
  selectedMetric.value ? eventGameCells(selectedMetric.value, evidenceGames.value) : new Map()
)
const gameColumns = computed<DataTableColumns<MemberAnalysisGame>>(() => [
  {
    title: selectedMetric.value?.label ?? '指标',
    key: 'metric',
    width: 135,
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
.event-result-table {
  min-width: 550px;
  table-layout: fixed;
}
.event-result-table th:first-child {
  width: 24%;
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
.event-extras {
  align-self: flex-start;
}
.event-cell:focus-visible {
  outline: 2px solid var(--la-color-text-primary);
  outline-offset: 3px;
  border-radius: 4px;
}
</style>
