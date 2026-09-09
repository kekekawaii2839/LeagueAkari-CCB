<template>
  <div class="ma-panel role-view">
    <MemberRoleComparison />
    <details class="role-full-metrics">
      <summary>完整指标与事件明细 <span>全部分路 · 蓝红方拆分</span></summary>
      <p class="ma-chart-note">
        {{ roleCount }} 个成员分路 · 参考样本线 {{ minimum }} 场。{{ uiText('rateLegend') }}
      </p>
      <div class="role-comparison">
        <div class="toolbar">
          <NRadioGroup v-model:value="group" size="small">
            <NRadioButton v-for="(value, name) in roleMetricGroups" :key="name" :value="name">
              {{ value.label }}
            </NRadioButton>
          </NRadioGroup>
          <label v-if="store.analysisSide === 'all'" class="side-toggle">
            <span>蓝红方拆分</span>
            <NSwitch v-model:value="store.sideBreakdown" size="small" />
          </label>
        </div>

        <div class="role-sections">
          <section v-for="section in roleSections" :key="section.role" class="role-section">
            <header class="role-heading">
              <div class="role-mark" aria-hidden="true">{{ roleAbbr[section.role] }}</div>
              <div>
                <h3>{{ roleName[section.role] }}</h3>
                <p>{{ section.members }} 名成员 · 共 {{ section.games }} 场分路样本</p>
              </div>
            </header>

            <div class="role-table-wrap">
              <table class="role-table" :style="{ minWidth: `${tableMinWidth}px` }">
                <thead>
                  <tr>
                    <th class="member-column">成员 / 样本</th>
                    <th v-for="column in visualColumns" :key="column.key">
                      <MetricHelp
                        v-if="column.description"
                        :label="column.label"
                        :definition="column.description"
                      />
                      <span v-else class="metric-heading">{{ column.label }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in section.rows" :key="rowKey(row)">
                    <th class="member-cell" scope="row">
                      <span class="member-line">
                        <button
                          v-if="group === 'gankDeaths'"
                          type="button"
                          class="evidence-link"
                          @click="openEvidence(row)"
                        >
                          {{ short(row.player) }} <span aria-hidden="true">↗</span>
                        </button>
                        <strong v-else>{{ short(row.player) }}</strong>
                      </span>
                      <small>{{ row.games }} 场 · {{ reliabilityLabel(row.games, minimum) }}</small>
                      <span v-if="showSideBreakdown" class="side-samples">
                        <b class="blue">蓝 {{ sideGames(row, '蓝方') }} 场</b>
                        <b class="red">红 {{ sideGames(row, '红方') }} 场</b>
                      </span>
                    </th>
                    <td v-for="column in visualColumns" :key="column.key" class="metric-cell">
                      <template v-if="column.key === 'winRate'">
                        <div class="rate-value">
                          <strong>{{ display(column.key, row[column.key]) }}</strong>
                          <small>{{ row.wins }}胜 {{ row.games - row.wins }}负</small>
                        </div>
                        <WinRateInterval
                          class="rate-axis"
                          :wins="row.wins"
                          :games="row.games"
                          :low="row.games < minimum"
                        />
                      </template>
                      <strong v-else :class="column.signed ? toneClass(row[column.key]) : ''">
                        {{ display(column.key, row[column.key]) }}
                      </strong>
                      <span v-if="showSideBreakdown" class="side-values">
                        <b class="blue">蓝 {{ sideDisplay(row, '蓝方', column.key) }}</b>
                        <b class="red">红 {{ sideDisplay(row, '红方', column.key) }}</b>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section
          v-if="group === 'gankDeaths'"
          class="gank-evidence"
          ref="evidencePanel"
          tabindex="-1"
          aria-labelledby="gank-evidence-title"
        >
          <header class="gank-evidence__header">
            <div>
              <h3 id="gank-evidence-title">被抓事件明细</h3>
              <p>14:00 前，成员在对应分路死亡，且敌方打野参与击杀。只统计产生死亡的事件。</p>
            </div>
            <NSelect
              v-if="evidenceOptions.length"
              v-model:value="selectedEvidenceKey"
              class="gank-evidence__select"
              size="small"
              :options="evidenceOptions"
              aria-label="选择要核查的成员分路"
            />
          </header>

          <div v-if="!availableLaneGankGames" class="gank-evidence__empty">
            当前分析数据尚未生成被抓事件，请刷新数据。
          </div>
          <div v-else-if="!selectedEvidence.length" class="gank-evidence__empty">
            所选成员分路在当前样本中没有符合规则的被抓死亡。
          </div>
          <div v-else class="gank-evidence__table-wrap">
            <table class="gank-evidence__table">
              <thead>
                <tr>
                  <th>日期 / 边方</th>
                  <th>对局</th>
                  <th>成员英雄 / 分路</th>
                  <th>时间</th>
                  <th>敌方打野</th>
                  <th>参与方式</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="event in selectedEvidence"
                  :key="`${event.gameId}-${event.timestampSec}-${event.victimPlayer}`"
                >
                  <td>{{ event.date }} · {{ event.side === 'Blue' ? '蓝方' : '红方' }}</td>
                  <td>尾号 {{ String(event.gameId).slice(-6) }}</td>
                  <td>{{ event.victimChampion }} / {{ roleName[event.victimRole] }}</td>
                  <td>{{ formatEventTime(event.timestampSec) }}</td>
                  <td>{{ event.enemyJunglerChampion }}</td>
                  <td>{{ event.involvement === 'killer' ? '击杀' : '助攻' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { memberOrder } from './visualization'
import { uiText } from './ui-text'
import { NRadioButton, NRadioGroup, NSelect, NSwitch } from 'naive-ui'
import { computed, nextTick, ref, watchEffect } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { aggregateRolesBySide, laneGankDeathEvidence } from './analytics'
import { formatMetric, roleMetricGroups, roleMetricMeta } from './metric-defs'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { finiteOrNull, formatSigned, reliabilityLabel } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import MemberRoleComparison from './MemberRoleComparison.vue'
import MetricHelp from './MetricHelp.vue'

const store = useMemberAnalysisStore()
const { windowGames } = useMemberAnalysisData()
const group = ref<keyof typeof roleMetricGroups>('core')
const rows = computed(() =>
  aggregateRolesBySide(
    windowGames.value,
    store.analysisSide,
    store.filters.matchRole,
    store.filters.participant,
    store.sideBreakdown
  )
)
const minimum = computed(() => (store.sampleSize === 20 ? 3 : store.sampleSize === 50 ? 5 : 8))
const roleOrder = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
type Role = (typeof roleOrder)[number]
const roleName: Record<Role, string> = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
}
const roleAbbr: Record<Role, string> = {
  TOP: '上',
  JUNGLE: '野',
  MIDDLE: '中',
  BOTTOM: '下',
  UTILITY: '辅'
}
const signed = new Set([
  'gd10',
  'gd15',
  'csd15',
  'xpd15',
  'damageDiff15',
  'soloDiff15',
  'counter',
  'dragon15',
  'grub15',
  'objectiveFight15'
])
const visualColumns = computed(() =>
  roleMetricGroups[group.value].columns
    .filter((key) => key !== 'games')
    .map((key) => ({
      key,
      label: roleMetricMeta[key].label,
      description: roleMetricMeta[key].description,
      signed: signed.has(key)
    }))
)
const tableMinWidth = computed(() => 160 + visualColumns.value.length * 108)
const showSideBreakdown = computed(() => store.analysisSide === 'all' && store.sideBreakdown)
const sideRows = computed(() => {
  const map = new Map<string, (typeof rows.value)[number]>()
  for (const row of rows.value) map.set(`${row.role}|${row.player}|${row.sideLabel}`, row)
  return map
})
const roleSections = computed(() =>
  roleOrder
    .filter((role) => group.value !== 'gankDeaths' || role !== 'JUNGLE')
    .map((role) => {
      const sectionRows = rows.value.filter(
        (row) => row.role === role && (!showSideBreakdown.value || row.sideLabel === '总计')
      )
      return {
        role,
        rows: sectionRows.sort(
          (a, b) =>
            memberOrder(
              sectionRows.map((row) => row.player),
              store.settings?.members ?? []
            ).indexOf(a.player) -
            memberOrder(
              sectionRows.map((row) => row.player),
              store.settings?.members ?? []
            ).indexOf(b.player)
        ),
        members: new Set(sectionRows.map((row) => row.player)).size,
        games: sectionRows.reduce((sum, row) => sum + row.games, 0)
      }
    })
    .filter((section) => section.rows.length)
)
const roleCount = computed(() =>
  roleSections.value.reduce((sum, section) => sum + section.members, 0)
)
const short = (value: string) => value.split('#')[0]
const rowKey = (row: { role: string; player: string }) => `${row.role}|${row.player}`
const sideRow = (row: { role: string; player: string }, sideLabel: '蓝方' | '红方') =>
  sideRows.value.get(`${row.role}|${row.player}|${sideLabel}`)
const sideGames = (row: { role: string; player: string }, sideLabel: '蓝方' | '红方') =>
  sideRow(row, sideLabel)?.games ?? 0
const sideDisplay = (
  row: { role: string; player: string },
  sideLabel: '蓝方' | '红方',
  key: string
) => {
  const selected = sideRow(row, sideLabel)
  return selected ? display(key, selected[key]) : '—'
}
const display = (key: string, value: unknown) =>
  signed.has(key)
    ? formatSigned(value, key === 'counter' ? 3 : 1)
    : formatMetric(value, roleMetricMeta[key].fmt)
const toneClass = (value: unknown) => {
  const number = finiteOrNull(value)
  return number === null || number === 0 ? '' : number > 0 ? 'ma-positive' : 'ma-negative'
}
const evidenceRows = computed(() =>
  rows.value.filter(
    (row) =>
      (!showSideBreakdown.value || row.sideLabel === '总计') &&
      row.role !== 'JUNGLE' &&
      row.laneGankEligibleGames !== null
  )
)
const evidenceOptions = computed(() =>
  evidenceRows.value.map((row) => ({
    label: `${short(row.player)} / ${roleName[row.role]}`,
    value: `${row.role}|${row.player}`
  }))
)
const selectedEvidenceKey = ref('')
const evidencePanel = ref<HTMLElement | null>(null)
async function openEvidence(row: { role: string; player: string }) {
  selectedEvidenceKey.value = `${row.role}|${row.player}`
  await nextTick()
  evidencePanel.value?.scrollIntoView({ block: 'start' })
  evidencePanel.value?.focus({ preventScroll: true })
}
watchEffect(() => {
  if (!evidenceOptions.value.some((option) => option.value === selectedEvidenceKey.value))
    selectedEvidenceKey.value = evidenceOptions.value[0]?.value ?? ''
})
const selectedEvidenceRow = computed(() =>
  evidenceRows.value.find((row) => `${row.role}|${row.player}` === selectedEvidenceKey.value)
)
const selectedEvidence = computed(() => {
  const selected = selectedEvidenceRow.value
  return selected ? laneGankDeathEvidence(windowGames.value, selected.player, selected.role) : []
})
const availableLaneGankGames = computed(
  () => windowGames.value.filter((game) => game.laneGankDeaths?.status === 'available').length
)
const formatEventTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
</script>

<style scoped>
.role-full-metrics {
  border-top: 1px solid var(--ma-grid);
  padding-top: 8px;
}
.role-full-metrics > summary {
  cursor: pointer;
  padding: 12px 0;
  font-size: 14px;
  font-weight: 500;
}
.role-full-metrics > summary span {
  margin-left: 12px;
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}

.metric-help,
.evidence-link {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  padding: 4px 0;
  min-height: 32px;
  text-align: inherit;
  cursor: pointer;
}
.metric-help > span {
  color: var(--ma-muted);
  font-size: 12px;
}
.evidence-link {
  color: var(--la-color-link);
  font-weight: 600;
}
.evidence-link:hover {
  text-decoration: underline;
}
.gank-evidence {
  scroll-margin-top: 12px;
}

.role-view {
  /* Keep view-local controls directly below the native analysis-tab nav. */
  --role-tab-offset: 50px;
  --role-toolbar-height: 48px;
  --role-heading-height: 50px;
  --role-row-height: 62px;
}
.role-comparison {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.toolbar {
  position: static;
  z-index: 4;
  top: var(--role-tab-offset);
  display: flex;
  min-height: 36px;
  box-sizing: border-box;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 7px 0;
  border-bottom: 1px solid var(--ma-grid-strong);
  background: var(--la-color-bg-primary);
}
.side-toggle {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  color: var(--ma-muted);
  font-size: 12px;
  cursor: pointer;
}
.role-sections {
  display: grid;
  gap: 16px;
}
.role-section {
  overflow: clip;
  border: 1px solid var(--ma-grid-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--la-card-surface-95) 88%, transparent);
}
.role-heading {
  position: static;
  z-index: 3;
  top: calc(var(--role-tab-offset) + var(--role-toolbar-height));
  display: flex;
  min-height: var(--role-heading-height);
  box-sizing: border-box;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ma-grid-strong);
  background: var(--la-color-bg-primary);
}
.role-heading > div:nth-child(2) {
  flex: 1;
}
.role-heading h3 {
  margin: 0;
  font-size: 13px;
}
.role-heading p {
  margin: 2px 0 0;
  color: var(--ma-muted);
  font-size: 14px;
}
.role-mark {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid var(--ma-grid-strong);
  border-radius: 6px;
  font-weight: 700;
}
.role-table-wrap {
  overflow-x: auto;
}
.role-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 14px;
}
.role-table th,
.role-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  vertical-align: middle;
}
.role-table thead th {
  position: static;
  z-index: 3;
  top: calc(var(--role-tab-offset) + var(--role-toolbar-height) + var(--role-heading-height));
  height: 26px;
  color: var(--ma-muted);
  background: var(--la-color-bg-primary);
  box-shadow: 0 1px 0 var(--ma-grid-strong);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
}
.role-table tbody tr:last-child > * {
  border-bottom: 0;
}
.role-table tbody tr:hover {
  background: var(--ma-grid);
}
.role-table .member-column,
.role-table .member-cell {
  width: 148px;
  text-align: left;
}
.member-line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}
.member-line strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-cell small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-cell small {
  margin-top: 3px;
  color: var(--ma-muted);
  font-size: 12px;
  font-weight: 400;
}
.side-samples {
  display: flex;
  gap: 8px;
  margin-top: 5px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.side-samples b,
.side-values b {
  font-weight: 500;
  white-space: nowrap;
}
.side-samples .blue,
.side-values .blue {
  color: var(--ma-blue);
}
.side-samples .red,
.side-values .red {
  color: var(--ma-red);
}
.metric-heading.explained {
  border-bottom: 1px dotted currentcolor;
  cursor: help;
}
.metric-heading:focus-visible {
  outline: 1px solid var(--la-color-link);
  outline-offset: 3px;
}
.metric-cell {
  width: 98px;
  font-variant-numeric: tabular-nums;
}
.metric-cell > strong {
  font-size: 14px;
}
.side-values {
  display: grid;
  justify-content: end;
  gap: 1px;
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.25;
}
.rate-value {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 5px;
}
.rate-value strong {
  font-size: 13px;
}
.rate-value small {
  color: var(--ma-muted);
  font-size: 14px;
}
.rate-axis {
  margin-top: 4px;
}
.gank-evidence {
  overflow: clip;
  border: 1px solid var(--ma-grid-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--la-card-surface-95) 88%, transparent);
}
.gank-evidence__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.gank-evidence__header h3,
.gank-evidence__header p {
  margin: 0;
}
.gank-evidence__header h3 {
  font-size: 13px;
}
.gank-evidence__header p,
.gank-evidence__empty {
  color: var(--ma-muted);
  font-size: 14px;
}
.gank-evidence__header p {
  margin-top: 4px;
}
.gank-evidence__select {
  width: 220px;
  flex: none;
}
.gank-evidence__empty {
  padding: 18px 12px;
}
.gank-evidence__table-wrap {
  overflow-x: auto;
}
.gank-evidence__table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.gank-evidence__table th,
.gank-evidence__table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: left;
  white-space: nowrap;
}
.gank-evidence__table th {
  color: var(--ma-muted);
  font-weight: 500;
}
.gank-evidence__table tbody tr:last-child td {
  border-bottom: 0;
}
@media (max-width: 920px) {
  .role-view {
    --role-toolbar-height: 72px;
  }
  .gank-evidence__header {
    align-items: stretch;
    flex-direction: column;
  }
  .gank-evidence__select {
    width: 100%;
  }
  .toolbar {
    align-items: flex-start;
    flex-direction: column;
    justify-content: center;
  }
  .rate-value small {
    display: inline;
  }
}
</style>
