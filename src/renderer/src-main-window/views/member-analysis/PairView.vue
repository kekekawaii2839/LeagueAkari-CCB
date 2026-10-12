<template>
  <div ref="root" class="ma-panel ma-workspace pair-view">
    <div class="pair-controls ma-view-toolbar">
      <NRadioGroup v-model:value="pairType"
        ><NRadioButton v-for="(name, value) in names" :key="value" :value="value">{{
          name
        }}</NRadioButton></NRadioGroup
      >
      <NSelect v-model:value="metric" :options="[...metricOptions]" aria-label="组合比较指标" />
      <span class="pair-metric-unit">{{ metricUnit }}</span>
      <NSelect
        :value="sortValue"
        :options="sortOptions"
        :aria-label="uiText('combinationRoleSort')"
        @update:value="selectSort"
        class="pair-sort-select"
      />
      <details ref="sortMenu" class="pair-sort-menu" @keydown.esc.stop.prevent="closeSortMenu">
        <summary :aria-label="uiText('combinationRoleSort')">↕</summary>
        <div class="pair-sort-content">
          <NSelect
            :value="sortValue"
            :options="sortOptions"
            :aria-label="uiText('combinationRoleSort')"
            @update:value="selectSort"
          /><NButton size="small" quaternary @click="closeSortMenu">{{
            uiText('combinationCloseSort')
          }}</NButton>
        </div>
      </details>
      <span class="ma-view-meta">{{ rows.length }} 组</span>
    </div>
    <div v-if="linkedMembers" class="pair-related-controls" role="status" tabindex="-1">
      <NSelect
        v-if="relatedOptions.length"
        :value="relatedValue"
        :options="relatedOptions"
        :aria-label="uiText('combinationRelatedRoles')"
        @update:value="selectRelated"
      />
      <span v-else>{{ uiText('combinationNoRelatedRoles') }}</span>
    </div>
    <p v-if="selectionUnavailable" class="ma-chart-note" role="status">
      {{ uiText('combinationSelectionUnavailable') }}
    </p>
    <p class="ma-chart-note">{{ uiText('rateLegend') }}</p>
    <div v-if="!rows.length" class="ma-empty">{{ uiText('noData') }}</div>
    <template v-else>
      <div class="combination-comparison-grid">
        <div
          class="pair-table-wrap combination-comparison-list"
          tabindex="0"
          role="region"
          :aria-label="uiText('pairComparison')"
        >
          <table class="pair-table">
            <thead>
              <tr>
                <th
                  v-for="column in sortColumns.filter(
                    (column) => !['wins', 'losses'].includes(column.key)
                  )"
                  :key="column.key"
                  scope="col"
                  :aria-sort="currentSort?.key === column.key ? currentSort.direction : 'none'"
                >
                  <button
                    type="button"
                    class="ma-table-sort"
                    :aria-label="sortActionLabel(column.key, column.label)"
                    @click="toggleSort(column.key)"
                  >
                    {{ column.label }}
                    <span aria-hidden="true">{{
                      currentSort?.key === column.key
                        ? currentSort.direction === 'descending'
                          ? '↓'
                          : '↑'
                        : '↕'
                    }}</span>
                  </button>
                  <div v-if="column.key === 'winRate'" class="pair-rate-axis" aria-hidden="true">
                    <span v-for="tick in [0, 25, 50, 75, 100]" :key="tick">{{ tick }}%</span>
                  </div>
                  <small v-if="column.key === metric" class="pair-scale"
                    >−{{ formatMetric(domain) }} · 0 · +{{ formatMetric(domain) }}</small
                  >
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.pair" :class="{ selected: selected === row.pair }">
                <th scope="row">
                  <button
                    type="button"
                    class="role-pair-select"
                    :aria-pressed="selected === row.pair"
                    :aria-expanded="selected === row.pair"
                    :aria-controls="detailId"
                    @click="toggleDetail(row.pair)"
                  >
                    <b>{{ cleanPair(row.pair) }}</b
                    ><small
                      >{{ names[row.pairType]
                      }}<span v-if="selected === row.pair">
                        · {{ uiText('synergySelected') }}</span
                      ></small
                    ><small v-if="row.games < minimum">{{
                      uiText('synergyHeroSmallSample')
                    }}</small>
                  </button>
                </th>
                <td>
                  {{ uiText('synergyGames', { count: row.games })
                  }}<small>{{
                    uiText('synergyRecord', { wins: row.wins, losses: row.losses })
                  }}</small>
                </td>
                <td>
                  <strong>{{ formatMetric(row.winRate, 'pct') }}</strong
                  ><WinRateInterval :wins="row.wins" :games="row.games" />
                </td>
                <td>
                  <div class="pair-value">
                    <strong :class="toneClass(row[metric])">{{
                      formatSigned(row[metric], 1)
                    }}</strong
                    ><span class="pair-track" aria-hidden="true"
                      ><i
                        v-if="finiteOrNull(row[metric]) !== null"
                        :class="toneClass(row[metric])"
                        :style="barStyle(row[metric])"
                    /></span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <aside
          v-if="selectedRow"
          :id="detailId"
          class="pair-detail combination-comparison-evidence"
          role="region"
          tabindex="-1"
          :aria-label="uiText('combinationRoleEvidence')"
          @keydown.esc.stop.prevent="closeDetail"
        >
          <header class="pair-detail-heading">
            <h3>{{ cleanPair(selectedRow.pair) }}</h3>
            <NButton size="small" quaternary @click="closeDetail">{{
              uiText('synergyClose')
            }}</NButton>
          </header>
          <p class="ma-chart-note">
            {{ names[selectedRow.pairType] }} ·
            {{ uiText('synergySharedGames', { count: selectedRow.games }) }} ·
            {{ uiText('synergyRecord', { wins: selectedRow.wins, losses: selectedRow.losses }) }}
          </p>
          <div class="pair-link-action">
            <NButton
              size="small"
              secondary
              :disabled="!evidence"
              @click="openSynergy(selectedRow)"
              >{{ uiText('combinationOpenMembers') }}</NButton
            ><span v-if="!evidence">{{ uiText('combinationIdentityUnavailable') }}</span>
          </div>
          <dl>
            <div>
              <dt>{{ uiText('synergyJointRate') }}</dt>
              <dd>{{ formatMetric(selectedRow.winRate, 'pct') }}</dd>
            </div>
            <div>
              <dt>{{ uiText('synergyInterval') }} · 95% Wilson</dt>
              <dd>
                {{
                  interval
                    ? formatMetric(interval.low, 'pct') + '–' + formatMetric(interval.high, 'pct')
                    : '—'
                }}
              </dd>
            </div>
            <div v-for="option in otherMetrics" :key="option.value">
              <dt>{{ option.label }}</dt>
              <dd>{{ formatSigned(selectedRow[option.value], 1) }}</dd>
            </div>
          </dl>
          <div class="pair-side-results">
            <span
              v-for="side in sideRows(selectedRow)"
              :key="side.sideLabel"
              :class="side.sideLabel === '蓝方' ? 'ma-blue' : 'ma-red'"
              >{{ side.sideLabel }} · {{ side.games }} 场 ·
              {{ formatMetric(side.winRate, 'pct') }}</span
            >
          </div>
          <p class="pair-reference">
            OP.GG 线杀率参考差值：{{
              selectedRow.counterMean === null
                ? '— 无参考数据'
                : uiText('percentagePoints', {
                    value: formatSigned(selectedRow.counterMean * 100, 1)
                  })
            }}
          </p>
          <p class="ma-chart-note">{{ uiText('combinationRoleEvidenceNote') }}</p>
        </aside>
        <aside
          v-else
          class="combination-comparison-evidence combination-comparison-placeholder"
          :aria-label="uiText('combinationEvidencePlaceholder')"
        >
          <h3>{{ uiText('combinationEvidencePlaceholder') }}</h3>
          <p>{{ uiText('combinationSelectRoles') }}</p>
        </aside>
      </div>
      <SynergyHeroStats
        v-if="heroStats"
        :key="JSON.stringify([pairType, selected])"
        :stats="heroStats"
        :minimum="minimum"
        scope="role-pair"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import { NButton, NRadioButton, NRadioGroup, NSelect } from 'naive-ui'
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric } from './metric-defs'
import { finiteOrNull, formatSigned } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import SynergyHeroStats from './SynergyHeroStats.vue'
import { sharedHeroStats } from './synergy-analysis'
import { wilsonInterval } from './visualization'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import './combination-comparison.css'
import { uiText } from './ui-text'
import { nextRoleTableSort, sortAnalysisTableRows, type RoleTableSort } from './role-table-sort'
import {
  relatedRolePairs,
  rolePairMembers,
  rolePairEvidence,
  type CombinationMembers,
  type RolePairLink
} from './combination-navigation'
const props = defineProps<{ linkedContext?: CombinationMembers | null }>()
const emit = defineEmits<{ 'open-synergy': [link: RolePairLink] }>()
const root = ref<HTMLElement | null>(null)
const { pairs, games } = useMemberAnalysisData()
const linkedMembers = computed(() => props.linkedContext ?? null)
const selectionUnavailable = ref(false)
const names = { upper_pair: '上野', mid_jg_pair: '中野', bot_pair: '下辅' } as const
const pairType = ref<keyof typeof names>('upper_pair')
const metricOptions = [
  { value: 'upperGold15', label: '15 分钟上半区经济差（金币）', unit: '金币' },
  { value: 'botGold15', label: '15 分钟下半区经济差（金币）', unit: '金币' },
  { value: 'gold20Diff', label: '20 分钟经济差（金币）', unit: '金币' },
  { value: 'tower20Diff', label: '20 分钟防御塔差（座）', unit: '座' },
  { value: 'objectiveFight15Diff', label: '15 分钟资源团净击杀（次）', unit: '次' },
  { value: 'dragon15Diff', label: '15 分钟小龙差（条）', unit: '条' },
  { value: 'grub15Diff', label: '15 分钟巢虫差（只）', unit: '只' }
] as const
const metric = ref<(typeof metricOptions)[number]['value']>('upperGold15')
const otherMetrics = computed(() => metricOptions.filter((option) => option.value !== metric.value))
const detailId = useId()
const metricLabel = computed(
  () => metricOptions.find((option) => option.value === metric.value)?.label
)
const metricUnit = computed(
  () => metricOptions.find((option) => option.value === metric.value)?.unit
)
const defaultRows = computed(() =>
  pairs.value
    .filter((row) => row.pairType === pairType.value && row.sideLabel === '总计')
    .sort((a, b) => b.games - a.games)
    .map((row) => ({ ...row, losses: row.games - row.wins }))
)
const pairSorts = ref<Partial<Record<keyof typeof names, RoleTableSort>>>({})
const currentSort = computed(() => pairSorts.value[pairType.value] ?? null)
const sortColumns = computed(() => [
  { key: 'pair', label: '成员组合' },
  { key: 'games', label: '场数' },
  { key: 'winRate', label: '胜率' },
  { key: 'wins', label: '胜场' },
  { key: 'losses', label: '负场' },
  { key: metric.value, label: metricLabel.value ?? '' }
])
const rows = computed(() => sortAnalysisTableRows(defaultRows.value, currentSort.value, ['pair']))
const identities = computed(
  () => new Map(rows.value.map((row) => [row.pair, rolePairMembers(games.value, row)]))
)
const related = computed(() =>
  linkedMembers.value ? relatedRolePairs(pairs.value, games.value, linkedMembers.value) : []
)
const relatedOptions = computed(() =>
  related.value.map((row) => ({
    value: JSON.stringify([row.pairType, row.pair]),
    label: `${names[row.pairType]} · ${cleanPair(row.pair)}`
  }))
)
const relatedValue = computed(() =>
  selected.value ? JSON.stringify([pairType.value, selected.value]) : null
)
let detailTrigger: HTMLElement | null = null
function openSynergy(row: (typeof pairs.value)[number]) {
  const members = identities.value.get(row.pair)
  if (members) emit('open-synergy', { pairType: row.pairType, pair: row.pair, members })
}
async function selectRelated(value: string) {
  const match = related.value.find((row) => JSON.stringify([row.pairType, row.pair]) === value)
  if (!match) return
  pairType.value = match.pairType
  selected.value = match.pair
  selectionUnavailable.value = false
  await nextTick()
  detailTrigger = root.value?.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? null
  root.value?.querySelector<HTMLElement>('.pair-detail')?.focus({ preventScroll: true })
}
async function selectMembers(members: CombinationMembers) {
  const candidates = relatedRolePairs(pairs.value, games.value, members)
  const match =
    candidates.find((row) => row.pairType === pairType.value && row.pair === selected.value) ??
    candidates.find((row) => row.pairType === pairType.value) ??
    candidates[0]
  if (!match) {
    selected.value = ''
    await nextTick()
    root.value
      ?.querySelector<HTMLElement>('.pair-related-controls')
      ?.scrollIntoView({ block: 'center' })
    root.value?.querySelector<HTMLElement>('.pair-related-controls')?.focus({ preventScroll: true })
    return
  }
  await selectRelated(JSON.stringify([match.pairType, match.pair]))
  root.value?.querySelector<HTMLElement>('.pair-detail')?.scrollIntoView({ block: 'center' })
}
defineExpose({ selectMembers })
function toggleSort(key: string) {
  pairSorts.value[pairType.value] = nextRoleTableSort(currentSort.value, key)
}
function sortActionLabel(key: string, label: string) {
  const next = nextRoleTableSort(currentSort.value, key)
  return uiText(
    next ? (next.direction === 'descending' ? 'sortDescending' : 'sortAscending') : 'sortDefault',
    { label }
  )
}
watch(metric, (next, previous) => {
  for (const type of Object.keys(names) as (keyof typeof names)[]) {
    const sort = pairSorts.value[type]
    if (sort?.key === previous) pairSorts.value[type] = { ...sort, key: next }
  }
})
const domain = computed(() =>
  Math.max(1, ...rows.value.map((row) => Math.abs(finiteOrNull(row[metric.value]) ?? 0)))
)
const barStyle = (value: unknown) => {
  const n = finiteOrNull(value) ?? 0
  return {
    width: `${(Math.abs(n) / domain.value) * 50}%`,
    left: `${n < 0 ? 50 - (Math.abs(n) / domain.value) * 50 : 50}%`
  }
}
const selected = ref('')
const sortMenu = ref<HTMLDetailsElement | null>(null)
function closeSortMenu() {
  if (sortMenu.value) {
    sortMenu.value.open = false
    sortMenu.value.querySelector('summary')?.focus()
  }
}
const store = useMemberAnalysisStore()
const minimum = computed(() => (store.sampleSize === 20 ? 2 : store.sampleSize === 50 ? 3 : 5))
const selectedRow = computed(() => rows.value.find((row) => row.pair === selected.value))
const evidence = computed(() =>
  selectedRow.value ? rolePairEvidence(games.value, selectedRow.value) : null
)
const heroStats = computed(() =>
  evidence.value && selectedRow.value
    ? sharedHeroStats({
        playerA: evidence.value.members[0],
        playerB: evidence.value.members[1],
        games: selectedRow.value.games,
        gamesList: evidence.value.gamesList
      })
    : null
)
const interval = computed(() =>
  selectedRow.value ? wilsonInterval(selectedRow.value.wins, selectedRow.value.games) : null
)
const sortValue = computed(() =>
  currentSort.value ? JSON.stringify(currentSort.value) : 'default'
)
const sortOptions = computed(() => [
  { value: 'default', label: uiText('combinationDefaultSort') },
  ...sortColumns.value.flatMap((column) =>
    ['descending', 'ascending'].map((direction) => ({
      value: JSON.stringify({ key: column.key, direction }),
      label: uiText(direction === 'descending' ? 'sortDescending' : 'sortAscending', {
        label: column.label
      })
    }))
  )
])
function selectSort(value: string) {
  pairSorts.value[pairType.value] = value === 'default' ? null : JSON.parse(value)
}

async function toggleDetail(pair: string) {
  const closing = selected.value === pair
  const trigger = document.activeElement as HTMLElement | null
  detailTrigger = trigger
  selectionUnavailable.value = false
  selected.value = closing ? '' : pair
  if (!closing) {
    await nextTick()
    const detail = root.value?.querySelector<HTMLElement>('.pair-detail')
    const list = root.value?.querySelector<HTMLElement>('.pair-table-wrap')
    if (detail && list && detail.getBoundingClientRect().left <= list.getBoundingClientRect().left)
      detail.scrollIntoView({ block: 'start' })
    detail?.focus({ preventScroll: true })
  }
  if (closing) {
    await nextTick()
    trigger?.focus({ preventScroll: true })
  }
}
async function closeDetail() {
  selected.value = ''
  selectionUnavailable.value = false
  await nextTick()
  if (detailTrigger?.isConnected) {
    const list = detailTrigger.closest<HTMLElement>('.combination-comparison-list')
    if (list)
      list.scrollTop = Math.max(
        0,
        list.scrollTop +
          detailTrigger.getBoundingClientRect().top -
          list.getBoundingClientRect().top -
          100
      )
    detailTrigger.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    detailTrigger.focus({ preventScroll: true })
  }
}
watch(rows, (value) => {
  if (selected.value && !value.some((row) => row.pair === selected.value)) {
    selected.value = ''
    selectionUnavailable.value = true
  }
})
const cleanPair = (value: string) =>
  value
    .split(' + ')
    .map((name) => name.split('#')[0])
    .join(' × ')
const sideRows = (row: (typeof pairs.value)[number]) =>
  pairs.value.filter(
    (candidate) =>
      candidate.pair === row.pair &&
      candidate.pairType === row.pairType &&
      candidate.sideLabel !== '总计'
  )
const toneClass = (value: unknown) => {
  const n = finiteOrNull(value)
  return n === null || n === 0 ? '' : n > 0 ? 'ma-positive' : 'ma-negative'
}
</script>
<style scoped>
.pair-view.ma-workspace {
  container-type: inline-size;
  font-size: 14px;
  line-height: 1.5;
}
.pair-view > .ma-chart-note {
  margin: 0;
}
.pair-controls,
.pair-related-controls,
.pair-link-action,
.pair-detail-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.pair-controls :deep(.n-select) {
  width: 280px;
}
.pair-controls :deep(.pair-sort-select) {
  width: 210px;
}
.pair-sort-menu {
  display: none;
  position: relative;
}
.pair-sort-menu > summary {
  display: flex;
  align-items: center;
  justify-content: center;
  list-style: none;
  width: 32px;
  min-height: 32px;
  box-sizing: border-box;
  padding: 0;
  border: 1px solid var(--ma-grid-strong);
  border-radius: 4px;
  background: var(--la-color-bg-primary);
  cursor: pointer;
  font: inherit;
}
.pair-sort-content {
  position: absolute;
  top: 36px;
  right: 0;
  z-index: 10;
  width: 230px;
  padding: 12px;
  background: var(--la-color-bg-primary);
  border: 1px solid var(--ma-grid-strong);
  border-radius: 8px;
}
.pair-sort-content :deep(.n-select) {
  width: 100%;
}
.pair-metric-unit {
  display: none;
  font-size: 12px;
  white-space: nowrap;
}
.pair-related-controls :deep(.n-select) {
  width: 320px;
  max-width: 100%;
}
.pair-table {
  border-collapse: collapse;
  width: 100%;
  min-width: 980px;
  table-layout: fixed;
  font-variant-numeric: tabular-nums;
}
.pair-table th,
.pair-table td {
  padding: 8px 12px;
  text-align: right;
  border-bottom: 1px solid var(--ma-grid);
}
.pair-table th:first-child {
  width: 230px;
  text-align: left;
}
.pair-table th:nth-child(2) {
  width: 130px;
}
.pair-table th:nth-child(3) {
  width: 230px;
}
.pair-table thead th {
  font-size: 13px;
  font-weight: 500;
  color: var(--ma-muted);
}
.role-pair-select {
  display: block;
  width: 100%;
  border: 0;
  border-radius: 4px;
  padding: 2px 0;
  min-height: 32px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.role-pair-select b {
  font-weight: 500;
}
.pair-table small {
  display: block;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
}
.pair-table tbody tr.selected {
  background: var(--ma-hover);
}
.pair-table tbody tr:hover {
  background: var(--ma-hover);
}
.pair-table td:nth-child(3) strong {
  font-weight: 500;
}
.pair-table :deep(.win-rate-interval) {
  width: 100%;
  margin-top: 4px;
}
.pair-rate-axis {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}
.pair-scale {
  margin-top: 4px;
}
.pair-value {
  display: grid;
  gap: 4px;
}
.pair-value strong {
  font-size: 14px;
  font-weight: 500;
}
.pair-track {
  position: relative;
  display: block;
  height: 10px;
  background: linear-gradient(var(--ma-grid), var(--ma-grid)) center/100% 1px no-repeat;
}
.pair-track::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--ma-muted);
}
.pair-track i {
  position: absolute;
  height: 100%;
  background: currentColor;
  border-radius: 2px;
}
.pair-detail {
  padding-top: 12px;
  border-top: 1px solid var(--ma-grid-strong);
  font-size: 14px;
}
.pair-detail-heading {
  justify-content: space-between;
}
.pair-detail-heading h3 {
  margin: 0;
  font-size: 15px;
  overflow-wrap: anywhere;
}
.pair-detail > .ma-chart-note {
  margin: 8px 0;
}
.pair-detail dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 24px;
  margin: 12px 0;
}
.pair-detail dl > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-bottom: 1px solid var(--ma-grid);
}
.pair-detail dt {
  color: var(--ma-muted);
  font-size: 13px;
}
.pair-detail dd {
  margin: 0;
  text-align: right;
  white-space: nowrap;
}
.pair-side-results {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}
.pair-reference {
  font-size: 13px;
  margin: 12px 0;
}
@container (min-width:1560px) {
  .pair-detail {
    border-top: 0;
    border-left: 1px solid var(--ma-grid-strong);
    padding: 0 0 0 24px;
  }
  .pair-detail dl {
    grid-template-columns: minmax(0, 1fr);
  }
}
@container (max-width:680px) {
  .pair-detail dl {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-height: 600px) {
  .pair-controls {
    gap: 8px;
  }
  .pair-controls :deep(.n-select) {
    width: 132px;
  }
  .pair-controls :deep(.pair-sort-select) {
    display: none;
  }
  .pair-sort-menu {
    display: block;
  }
  .pair-controls :deep(.n-radio-group) {
    gap: 2px;
  }
  .pair-controls > .ma-view-meta {
    flex-basis: auto;
    margin-left: auto;
  }
  .pair-metric-unit {
    display: inline;
  }
  .pair-table thead th {
    padding-top: 6px;
    padding-bottom: 6px;
  }
}
</style>
