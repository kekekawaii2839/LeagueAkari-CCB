<template>
  <div ref="roleRoot" class="ma-panel role-view">
    <MemberRoleComparison />
    <section class="role-full-metrics" :aria-label="uiText('roleFullMetrics')">
      <div class="role-comparison">
        <div ref="groupToolbar" class="toolbar">
          <MemberAnalysisSegments
            class="role-group-tabs"
            :model-value="group"
            :options="groupOptions"
            :ariaLabel="uiText('roleFullMetrics')"
            ariaControls="role-group-panel"
            @update:model-value="selectGroup"
          />
          <label v-if="store.analysisSide === 'all'" class="side-toggle">
            <span>蓝红方拆分</span>
            <NSwitch v-model:value="store.sideBreakdown" size="small" />
          </label>
        </div>

        <div
          class="role-sections"
          id="role-group-panel"
          role="tabpanel"
          :aria-label="roleMetricGroups[group].label"
        >
          <p
            v-if="group === 'gankDeaths' && selectedTableRole === 'JUNGLE'"
            class="role-table-empty"
          >
            被抓统计不适用于打野分路。
          </p>
          <p v-else-if="!visibleRoleSections.length" class="role-table-empty">
            当前筛选下没有分路数据。
          </p>
          <NSelect
            v-if="!visibleRoleSections.length"
            v-model:value="selectedTableRole"
            class="role-table-select"
            size="small"
            :options="tableRoleOptions"
            :render-label="renderRoleSelectLabel"
            :render-tag="renderRoleSelectTag"
            aria-label="选择表格分路"
          />
          <section v-for="section in visibleRoleSections" :key="section.role" class="role-section">
            <header class="role-heading">
              <NSelect
                v-model:value="selectedTableRole"
                class="role-table-select"
                size="small"
                :options="tableRoleOptions"
                :render-label="renderRoleSelectLabel"
                :render-tag="renderRoleSelectTag"
                aria-label="选择表格分路"
              />
              <p class="role-member-count">{{ section.members }} 名成员</p>
            </header>

            <div class="role-table-wrap">
              <table
                class="role-table"
                :class="{ 'has-side-breakdown': showSideBreakdown }"
                :style="{ minWidth: `${tableMinWidth}px` }"
              >
                <colgroup>
                  <col class="member-col" />
                  <col class="sample-col" />
                  <col
                    v-for="column in visualColumns"
                    :key="column.key"
                    :style="{
                      width: `${responsiveTableColumnWidth(column)}px`
                    }"
                  />
                </colgroup>
                <thead>
                  <tr>
                    <th
                      v-for="column in tableColumns"
                      :key="column.key"
                      scope="col"
                      :class="{
                        'member-column': column.key === 'player',
                        'sample-column': column.key === 'games',
                        'gank-window-column': column.key === 'gankWindows'
                      }"
                      :aria-sort="
                        currentSort?.key === columnSortKey(column.key)
                          ? currentSort.direction
                          : 'none'
                      "
                    >
                      <div
                        class="sortable-heading"
                        :class="{ 'gank-window-heading': column.key === 'gankWindows' }"
                      >
                        <button
                          v-if="column.key !== 'gankWindows'"
                          type="button"
                          class="sort-button"
                          :aria-label="
                            sortActionLabel(
                              column.key === 'gankWindows' ? gankWindowSort : column.key,
                              column.key === 'gankWindows'
                                ? roleMetricMeta[gankWindowSort].label
                                : column.label
                            )
                          "
                          @click="
                            toggleSort(column.key === 'gankWindows' ? gankWindowSort : column.key)
                          "
                        >
                          <span class="metric-heading-text">
                            <span class="metric-heading-name">{{ column.displayName }}</span>
                          </span>
                          <span class="sort-direction" aria-hidden="true">{{
                            currentSort?.key === columnSortKey(column.key)
                              ? currentSort.direction === 'descending'
                                ? '↓'
                                : '↑'
                              : '↕'
                          }}</span>
                        </button>
                        <span v-else class="metric-heading-name">
                          {{ column.displayName }}
                        </span>
                        <MetricHelp
                          v-if="column.description && column.key !== 'gankWindows'"
                          :label="column.label"
                          :definition="column.description"
                          icon-only
                        />
                      </div>
                      <div v-if="column.key === 'gankWindows'" class="gank-window-help">
                        <span class="sort-direction" aria-hidden="true">{{
                          currentSort?.key === columnSortKey(column.key)
                            ? currentSort.direction === 'descending'
                              ? '↓'
                              : '↑'
                            : '↕'
                        }}</span>
                        <MetricHelp
                          :label="column.label"
                          :definition="column.description"
                          icon-only
                        />
                      </div>
                      <div
                        v-if="column.key === 'gankWindows'"
                        class="gank-window-axis"
                        role="group"
                        :aria-label="uiText('roleGankWindowSort')"
                      >
                        <button
                          v-for="(key, index) in gankWindowKeys"
                          :key="key"
                          type="button"
                          :aria-label="sortActionLabel(key, roleMetricMeta[key].label)"
                          :aria-pressed="currentSort?.key === key"
                          @click="chooseGankWindowSort(key)"
                        >
                          <span>{{ gankWindowLabels[index] }}</span>
                        </button>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in section.rows" :key="rowKey(row)">
                    <th class="member-cell" scope="row">
                      <span class="member-line">
                        <NTooltip
                          trigger="manual"
                          :show="
                            focusedMemberName === rowKey(row) || hoveredMemberName === rowKey(row)
                          "
                          :style="{ maxWidth: '300px', overflowWrap: 'anywhere' }"
                        >
                          <template #trigger>
                            <span
                              class="member-name"
                              tabindex="0"
                              :aria-label="row.player"
                              @focus="focusedMemberName = rowKey(row)"
                              @blur="focusedMemberName = null"
                              @mouseenter="hoveredMemberName = rowKey(row)"
                              @mouseleave="hoveredMemberName = null"
                              @keydown.esc.prevent.stop="closeMemberName"
                              >{{ short(row.player) }}</span
                            >
                          </template>
                          {{ row.player }}
                        </NTooltip>
                      </span>
                    </th>
                    <td class="sample-cell">
                      <div class="sample-main">
                        <strong>{{ row.games }} 场</strong>
                      </div>
                      <span v-if="showSideBreakdown" class="side-samples">
                        <b class="blue">蓝 {{ sideGames(row, '蓝方') }} 场</b>
                        <b class="red">红 {{ sideGames(row, '红方') }} 场</b>
                      </span>
                    </td>
                    <td
                      v-for="column in visualColumns"
                      :key="column.key"
                      class="metric-cell"
                      :class="{
                        'win-rate-cell': column.key === 'winRate',
                        'gank-window-cell': column.key === 'gankWindows'
                      }"
                    >
                      <template v-if="column.key === 'gankWindows'">
                        <LaneGankWindowBars
                          :values="gankWindowKeys.map((key) => row[key])"
                          :breakdown="
                            showSideBreakdown
                              ? [
                                  {
                                    label: '蓝方',
                                    tone: 'blue' as const,
                                    values: gankWindowKeys.map((key) => sideRow(row, '蓝方')?.[key])
                                  },
                                  {
                                    label: '红方',
                                    tone: 'red' as const,
                                    values: gankWindowKeys.map((key) => sideRow(row, '红方')?.[key])
                                  }
                                ]
                              : undefined
                          "
                          :max="gankWindowMax"
                        />
                      </template>
                      <template v-else-if="column.key === 'winRate'">
                        <div class="rate-stack">
                          <div class="rate-cell">
                            <WinRateInterval
                              class="rate-axis"
                              :wins="row.wins"
                              :games="row.games"
                              :low="row.games < minimum"
                            />
                            <div class="rate-numbers">
                              <strong>{{ display(column.key, row[column.key]) }}</strong>
                              <small>{{ row.wins }} 胜 / {{ row.games - row.wins }} 负</small>
                            </div>
                          </div>
                          <template v-if="showSideBreakdown">
                            <div
                              v-for="side in ['蓝方', '红方'] as const"
                              :key="side"
                              class="rate-cell"
                            >
                              <WinRateInterval
                                class="rate-axis"
                                :wins="sideRow(row, side)?.wins ?? 0"
                                :games="sideRow(row, side)?.games ?? 0"
                                :low="(sideRow(row, side)?.games ?? 0) < minimum"
                              />
                              <b class="rate-numbers" :class="side === '蓝方' ? 'blue' : 'red'"
                                >{{ side }} {{ sideDisplay(row, side, column.key) }}</b
                              >
                            </div>
                          </template>
                        </div>
                      </template>
                      <strong v-else :class="column.signed ? toneClass(row[column.key]) : ''">
                        {{ display(column.key, row[column.key]) }}
                      </strong>
                      <span
                        v-if="
                          showSideBreakdown &&
                          column.key !== 'gankWindows' &&
                          column.key !== 'winRate'
                        "
                        class="side-values"
                      >
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
          v-if="group === 'gankDeaths' && selectedTableRole !== 'JUNGLE'"
          class="gank-evidence"
          aria-labelledby="gank-evidence-title"
        >
          <header class="gank-evidence__header">
            <div>
              <h3 id="gank-evidence-title">被抓事件明细</h3>
              <p>14:00 前，成员在对应分路死亡，且敌方打野参与击杀。只统计产生死亡的事件。</p>
            </div>
            <NTooltip
              v-if="evidenceOptions.length"
              :show="evidenceSelectFocused && !!selectedEvidenceLabel"
              placement="top"
            >
              <template #trigger>
                <NSelect
                  v-model:value="selectedEvidenceKey"
                  class="gank-evidence__select"
                  size="small"
                  :options="evidenceOptions"
                  :render-label="renderEvidenceLabel"
                  :render-tag="renderEvidenceTag"
                  aria-label="选择要核查的成员分路"
                  :aria-description="selectedEvidenceLabel"
                  @focus="evidenceSelectFocused = true"
                  @blur="evidenceSelectFocused = false"
                />
              </template>
              <span class="gank-evidence__identity-hint">{{ selectedEvidenceLabel }}</span>
            </NTooltip>
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
                  <th>成员英雄</th>
                  <th>分路</th>
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
                  <td>{{ championLabel(event.victimChampion) }}</td>
                  <td>
                    <span class="gank-victim-role">
                      <PositionIcon
                        v-if="isCanonicalRole(event.victimRole)"
                        class="gank-victim-role-icon"
                        :position="event.victimRole"
                        aria-hidden="true"
                      />
                      <span>{{
                        isCanonicalRole(event.victimRole)
                          ? roleName[event.victimRole]
                          : event.victimRole || '—'
                      }}</span>
                    </span>
                  </td>
                  <td>{{ formatEventTime(event.timestampSec) }}</td>
                  <td>{{ championLabel(event.enemyJunglerChampion) }}</td>
                  <td>{{ event.involvement === 'killer' ? '击杀' : '助攻' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { memberOrder } from './visualization'
import { uiText } from './ui-text'
import { renderRoleSelectLabel, renderRoleSelectTag } from './role-select-label'
import type { RoleSelectOption } from './role-select-label'
import type { SelectOption } from 'naive-ui'
import { NSelect, NSwitch, NTooltip } from 'naive-ui'
import MemberAnalysisSegments from './components/MemberAnalysisSegments.vue'
import {
  computed,
  h,
  nextTick,
  onMounted,
  onBeforeUnmount,
  onActivated,
  onDeactivated,
  ref,
  watch,
  watchEffect
} from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { aggregateRolesBySide, laneGankDeathEvidence } from './analytics'
import { formatMetric, roleMetricGroups, roleMetricMeta } from './metric-defs'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { finiteOrNull, formatSigned } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import MemberRoleComparison from './MemberRoleComparison.vue'
import LaneGankWindowBars from './LaneGankWindowBars.vue'
import MetricHelp from './MetricHelp.vue'
import { nextRoleTableSort, sortRoleTableRows, type RoleTableSort } from './role-table-sort'

const store = useMemberAnalysisStore()
const league = useLeagueClientStore()
const championKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
// Labels use the same client gameData resource as hero pools and filters.
// Canonical event identities and aggregation keys remain unchanged.
const championLabels = computed(() => {
  const labels = new Map<string, string>()
  for (const champion of Object.values(league.gameData.champions)) {
    if (!champion.name.trim()) continue
    labels.set(championKey(champion.alias), champion.name)
    labels.set(championKey(champion.name), champion.name)
  }
  return labels
})
const championLabel = (canonical: string) =>
  championLabels.value.get(championKey(canonical)) ?? canonical
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const { windowGames } = useMemberAnalysisData()
const group = ref<keyof typeof roleMetricGroups>('core')
const focusedMemberName = ref<string | null>(null)
const hoveredMemberName = ref<string | null>(null)
function closeMemberName() {
  focusedMemberName.value = null
  hoveredMemberName.value = null
}
const roleRoot = ref<HTMLElement | null>(null)
const groupToolbar = ref<HTMLElement | null>(null)
const groupOptions = Object.entries(roleMetricGroups).map(([value, meta]) => ({
  value,
  label: meta.label
}))
function selectGroup(value: string | number) {
  if (typeof value === 'string' && Object.hasOwn(roleMetricGroups, value)) {
    closeMemberName()
    group.value = value as keyof typeof roleMetricGroups
  }
}
let stickyObserver: ResizeObserver | null = null
let stickyScrollOwner: HTMLElement | null = null
let stickyFrame = 0
let syncSticky: (() => void) | null = null
const availableTableWidth = ref(0)
const queueSticky = () => {
  if (!props.active || stickyFrame || !syncSticky) return
  stickyFrame = requestAnimationFrame(() => {
    stickyFrame = 0
    syncSticky?.()
  })
}
function startSticky() {
  if (!props.active || syncSticky) return
  const root = roleRoot.value
  const toolbar = groupToolbar.value
  if (
    typeof HTMLElement === 'undefined' ||
    !(root instanceof HTMLElement) ||
    !(toolbar instanceof HTMLElement)
  )
    return
  if (!root.isConnected || root.getClientRects().length === 0) return
  stickyScrollOwner = root.closest<HTMLElement>('.member-analysis-scroll')
  if (!stickyScrollOwner) return
  const ready = root.closest<HTMLElement>('.member-analysis-ready')
  const navigation = ready?.querySelector<HTMLElement>('.n-tabs-nav') ?? null
  syncSticky = () => {
    if (!stickyScrollOwner || !root.isConnected) return
    const width = root.querySelector<HTMLElement>('.role-table-wrap')?.clientWidth ?? 0
    if (width > 0) availableTableWidth.value = width
    const scrollTop = stickyScrollOwner.getBoundingClientRect().top + stickyScrollOwner.clientTop
    const navHeight = navigation?.getBoundingClientRect().height ?? 0
    const toolbarHeight = toolbar.getBoundingClientRect().height
    root.style.setProperty('--role-tab-offset', `${navHeight}px`)
    root.style.setProperty('--role-toolbar-height', `${toolbarHeight}px`)
    for (const section of root.querySelectorAll<HTMLElement>('.role-section')) {
      const heading = section.querySelector<HTMLElement>('.role-heading')
      const wrapper = section.querySelector<HTMLElement>('.role-table-wrap')
      const table = wrapper?.querySelector<HTMLTableElement>('table')
      const thead = table?.tHead
      if (!heading || !wrapper || !table || !thead) continue
      const headingHeight = heading.getBoundingClientRect().height
      section.style.setProperty('--role-heading-height', `${headingHeight}px`)
      const header = thead.getBoundingClientRect()
      const tableRect = table.getBoundingClientRect()
      const sectionTop = section.getBoundingClientRect().top + section.clientTop
      const sectionBottom = sectionTop + section.clientHeight
      const stickyTop = scrollTop + navHeight + toolbarHeight
      const nativeHeadingTop = Math.min(
        Math.max(sectionTop, stickyTop),
        sectionBottom - headingHeight
      )
      const groupedHeadingTop = Math.min(
        Math.max(sectionTop, stickyTop),
        sectionBottom - headingHeight - header.height
      )
      // Leave the section as one heading/header stack, not overlapping rows.
      heading.style.setProperty(
        '--role-heading-end-offset',
        `${groupedHeadingTop - nativeHeadingTop}px`
      )
      const targetTop = groupedHeadingTop + headingHeight
      // The horizontal overflow owner cannot also provide viewport sticky.
      // Move the existing semantic header only; its columns and horizontal
      // sticky identity cells remain in the same table (no cloned header).
      const offset = Math.max(
        0,
        Math.min(targetTop - tableRect.top, tableRect.height - header.height)
      )
      wrapper.style.setProperty('--role-table-header-offset', `${offset}px`)
    }
  }
  stickyObserver = new ResizeObserver(queueSticky)
  stickyObserver.observe(toolbar)
  stickyObserver.observe(root)
  if (navigation) stickyObserver.observe(navigation)
  stickyScrollOwner.addEventListener('scroll', queueSticky, { passive: true })
  window.addEventListener('resize', queueSticky, { passive: true })
  queueSticky()
}
function stopSticky() {
  closeMemberName()
  stickyObserver?.disconnect()
  stickyScrollOwner?.removeEventListener('scroll', queueSticky)
  if (typeof window !== 'undefined') window.removeEventListener('resize', queueSticky)
  if (stickyFrame) cancelAnimationFrame(stickyFrame)
  stickyFrame = 0
  syncSticky = null
  stickyScrollOwner = null
  stickyObserver = null
}
onMounted(startSticky)
watch(
  () => props.active,
  (active) => {
    if (active) nextTick(startSticky)
    else {
      closeMemberName()
      stopSticky()
    }
  },
  { flush: 'post' }
)
onActivated(() => {
  if (props.active) nextTick(startSticky)
})
onDeactivated(stopSticky)
onBeforeUnmount(stopSticky)
const groupSorts = ref<Partial<Record<keyof typeof roleMetricGroups, RoleTableSort>>>({})
const currentSort = computed(() => groupSorts.value[group.value] ?? null)
function toggleSort(key: string) {
  groupSorts.value[group.value] = nextRoleTableSort(currentSort.value, key)
}
function sortActionLabel(key: string, label: string) {
  const next = nextRoleTableSort(currentSort.value, key)
  return next
    ? `${label}：按${next.direction === 'descending' ? '降序' : '升序'}排序`
    : `${label}：取消排序`
}
const rows = computed(() =>
  aggregateRolesBySide(
    windowGames.value,
    store.analysisSide,
    store.filters.matchRole,
    store.filters.participant,
    store.sideBreakdown
  )
)
watch([group, rows, () => store.sideBreakdown], () => nextTick(queueSticky))
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
const isCanonicalRole = (role: unknown): role is Role =>
  typeof role === 'string' && Object.hasOwn(roleName, role)
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
const gankWindowKeys = [
  'laneGankBefore3',
  'laneGankMinute3',
  'laneGankMinute4',
  'laneGankMinute5To10',
  'laneGankMinute10To14'
] as const
const gankWindowLabels = gankWindowKeys.map((key) => roleMetricMeta[key].windowLabel!)
const gankWindowSort = ref<string>('laneGankBefore3')
const columnSortKey = (key: string) => (key === 'gankWindows' ? gankWindowSort.value : key)
function chooseGankWindowSort(key: string) {
  if (!gankWindowKeys.some((value) => value === key)) return
  gankWindowSort.value = key
  toggleSort(key)
}
const gankWindowMax = computed(() =>
  Math.max(
    0,
    ...rows.value.flatMap((row) =>
      gankWindowKeys.map((key) => {
        const value = row[key]
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
      })
    )
  )
)
const visualColumns = computed(() =>
  roleMetricGroups[group.value].columns
    .filter(
      (key) =>
        key !== 'games' &&
        !gankWindowKeys.some((window) => window === key && window !== 'laneGankBefore3')
    )
    .map((key) => ({
      key: key === 'laneGankBefore3' ? 'gankWindows' : key,
      label:
        key === 'laneGankBefore3'
          ? uiText('roleGankWindows')
          : (roleMetricMeta[key].shortLabel ?? roleMetricMeta[key].label),
      displayName:
        key === 'laneGankBefore3' ? uiText('roleGankWindows') : roleMetricMeta[key].label,
      unit: key === 'laneGankBefore3' ? '次' : roleMetricMeta[key].unit,
      description:
        key === 'laneGankBefore3'
          ? gankWindowKeys.map((window) => roleMetricMeta[window].description).join('；')
          : [
              roleMetricMeta[key].description,
              roleMetricMeta[key].unit ? `（${roleMetricMeta[key].unit}）` : ''
            ]
              .filter(Boolean)
              .join(' · '),
      signed: signed.has(key)
    }))
)
const tableColumns = computed(() => [
  { key: 'player', label: '成员', displayName: '成员', unit: undefined, description: '' },
  { key: 'games', label: '样本', displayName: '样本', unit: undefined, description: '' },
  ...visualColumns.value
])
function tableColumnWidth(column: { key: string; displayName: string }) {
  if (column.key === 'gankWindows') return 324
  const labelWidth = [...column.displayName].reduce(
    (width, character) => width + (character.charCodeAt(0) > 127 ? 14 : 8),
    0
  )
  // Reserve both cell gutters, the sort arrow and the help control. Only
  // long labels grow their column; do not widen every metric unnecessarily.
  return Math.max(184, labelWidth + 96)
}
const metricColumnsMinWidth = computed(() =>
  visualColumns.value.reduce((sum, column) => sum + tableColumnWidth(column), 0)
)
const tableMinWidth = computed(() => 268 + metricColumnsMinWidth.value)
function responsiveTableColumnWidth(column: { key: string; displayName: string }) {
  const minimum = tableColumnWidth(column)
  const remaining = Math.max(metricColumnsMinWidth.value, availableTableWidth.value - 268)
  return (remaining * minimum) / metricColumnsMinWidth.value
}
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
      const order = memberOrder(
        sectionRows.map((row) => row.player),
        store.settings?.members ?? []
      )
      sectionRows.sort((a, b) => order.indexOf(a.player) - order.indexOf(b.player))
      return {
        role,
        rows: sortRoleTableRows(sectionRows, currentSort.value),
        members: new Set(sectionRows.map((row) => row.player)).size,
        games: sectionRows.reduce((sum, row) => sum + row.games, 0)
      }
    })
    .filter((section) => section.rows.length)
)
const selectedTableRole = ref<Role>('TOP')
const tableRoleOptions = roleOrder.map((role) => ({ value: role, label: roleName[role], role }))
const visibleRoleSections = computed(() =>
  roleSections.value.filter((section) => section.role === selectedTableRole.value)
)
watch([selectedTableRole, group], () => {
  closeMemberName()
  evidenceSelectFocused.value = false
  nextTick(queueSticky)
})
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
    ? formatSigned(
        key === 'counter' && finiteOrNull(value) !== null ? Number(value) * 100 : value,
        key === 'counter' ? 3 : 1
      )
    : formatMetric(value, roleMetricMeta[key].fmt)
const toneClass = (value: unknown) => {
  const number = finiteOrNull(value)
  return number === null || number === 0 ? '' : number > 0 ? 'ma-positive' : 'ma-negative'
}
const evidenceRows = computed(() =>
  rows.value.filter(
    (row) =>
      row.role === selectedTableRole.value &&
      (!showSideBreakdown.value || row.sideLabel === '总计') &&
      row.role !== 'JUNGLE' &&
      row.laneGankEligibleGames !== null
  )
)
const evidenceOptions = computed(() =>
  evidenceRows.value.map((row) => ({
    label: `${roleName[row.role]} · ${row.player}`,
    role: row.role,
    memberLabel: row.player,
    value: `${row.role}|${row.player}`
  }))
)
const selectedEvidenceKey = ref('')
const evidenceSelectFocused = ref(false)
const selectedEvidenceLabel = computed(
  () =>
    evidenceOptions.value.find((option) => option.value === selectedEvidenceKey.value)?.label ?? ''
)
function renderEvidenceLabel(option: SelectOption) {
  const metadata = option as RoleSelectOption
  const label = typeof option.label === 'string' ? option.label : ''
  const ellipsis = {
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  } as const
  if (!isCanonicalRole(metadata.role)) return h('span', { title: label, style: ellipsis }, label)
  return h(
    'span',
    {
      title: label,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        minWidth: '0',
        width: '100%',
        maxWidth: '100%',
        whiteSpace: 'nowrap',
        lineHeight: '22px'
      }
    },
    [
      h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '4px', flex: 'none' } },
        [
          h(PositionIcon, {
            position: metadata.role,
            'aria-hidden': 'true',
            style: { fontSize: '16px', flex: 'none' }
          }),
          h('span', roleName[metadata.role])
        ]
      ),
      h('span', { style: { flex: 'none' } }, '·'),
      h(
        'span',
        { title: metadata.memberLabel, style: { ...ellipsis, flex: '1' } },
        metadata.memberLabel
      )
    ]
  )
}
const renderEvidenceTag = ({ option }: { option: SelectOption }) => renderEvidenceLabel(option)
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
.metric-help {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  padding: 4px 0;
  min-height: 32px;
  text-align: inherit;
  cursor: pointer;
}
.gank-evidence {
  scroll-margin-top: 12px;
}

.role-view {
  /* Keep view-local controls directly below the native analysis-tab nav. */
  --role-tab-offset: 50px;
  --role-toolbar-height: 48px;
  --role-heading-height: 50px;
  --role-row-height: 48px;
  --role-table-heading-height: 48px;
}
.role-comparison {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.toolbar {
  position: sticky;
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
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}
.role-section {
  overflow: visible;
  border: 1px solid var(--ma-grid-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--la-card-surface-95) 88%, transparent);
}
.role-heading {
  position: sticky;
  z-index: 3;
  top: calc(var(--role-tab-offset) + var(--role-toolbar-height));
  transform: translateY(var(--role-heading-end-offset, 0px));
  display: flex;
  min-height: var(--role-heading-height);
  box-sizing: border-box;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ma-grid-strong);
  /* Match the section’s inner curve without clipping its sticky children. */
  border-radius: 7px 7px 0 0;
  background: var(--la-color-bg-primary);
}
.role-table-select {
  width: 140px;
  flex: none;
}
.role-member-count,
.role-table-empty {
  margin: 0;
  color: var(--ma-muted);
  font-size: 14px;
}
.role-table-wrap {
  /* Bound frozen column/header layers to this table. They may overlap body
     cells inside it, but cannot rise above the role heading or group toolbar. */
  position: relative;
  isolation: isolate;
  z-index: 1;
  max-width: 100%;
  overflow-x: auto;
  /* The existing scroll surface must not square off the outer bottom corners. */
  border-radius: 0 0 7px 7px;
  scroll-padding-left: 268px;
}
.role-table {
  --gank-window-track-height: 40px;
  width: 100%;
  /* Sticky cells must own their borders. Collapsed borders can stay in the
     scrolling paint layer and expose a device-pixel seam between frozen cells. */
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 14px;
}
.role-table th,
.role-table td {
  padding: 8px 20px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  vertical-align: middle;
}
.role-table tr > :not(:last-child) {
  border-right: 1px solid var(--ma-grid);
}
.role-table tbody th,
.role-table tbody td {
  padding-top: 2px;
  padding-bottom: 2px;
}
.role-table.has-side-breakdown tbody tr {
  height: 72px;
}
.role-table tbody td.win-rate-cell {
  padding-left: 20px;
}
.role-table thead th {
  padding-top: 1px;
  padding-bottom: 1px;
  position: relative;
  z-index: 3;
  top: auto;
  transform: translateY(var(--role-table-header-offset, 0px));
  color: var(--ma-muted);
  background: var(--la-color-bg-primary);
  /* The translated header needs opaque paint beneath its translucent divider;
     otherwise scrolling body glyphs can show through this horizontal seam. */
  box-shadow:
    0 1px 0 var(--ma-grid-strong),
    0 2px 0 var(--la-color-bg-primary);
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  height: var(--role-table-heading-height);
  box-sizing: border-box;
}
.role-table tbody tr:last-child > * {
  border-bottom: 0;
}
.role-table tbody tr:hover {
  background: var(--ma-grid);
}
.role-table tbody tr {
  height: var(--role-row-height);
}
.role-table .member-col {
  width: 168px;
}
.role-table .sample-col {
  width: 100px;
}
.role-table .member-column,
.role-table .member-cell {
  position: sticky;
  top: auto;
  left: 0;
  z-index: 2;
  background: var(--la-color-bg-primary);
  text-align: left;
  padding-left: 10px;
}
.role-table .sample-column,
.role-table .sample-cell {
  position: sticky;
  top: auto;
  left: 168px;
  z-index: 2;
  background: var(--la-color-bg-primary);
  box-shadow: 1px 0 0 var(--ma-grid);
}
.role-table thead .member-column,
.role-table thead .sample-column {
  z-index: 4;
}
.role-table thead .sample-column {
  box-shadow:
    1px 0 0 var(--ma-grid),
    0 1px 0 var(--ma-grid-strong),
    0 2px 0 var(--la-color-bg-primary);
}
.sample-cell small {
  display: block;
  margin-top: 3px;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 16px;
}
.sortable-heading {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
}
/* Reserve a separate help target at the full header-row center. The title is
   intentionally on its upper line; the help follows the other column icons. */
.gank-window-help {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}
.gank-window-help :deep(.metric-help) {
  width: 24px;
}
.role-table td.gank-window-cell {
  padding-right: 64px;
}
.gank-window-column .gank-window-heading {
  position: absolute;
  top: 0;
  left: 20px;
  right: 64px;
  height: 24px;
}
.gank-window-axis {
  position: absolute;
  bottom: 0;
  left: 20px;
  right: 64px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  height: 24px;
}
.gank-window-axis button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-width: 0;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--ma-muted);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.gank-window-axis button:hover,
.gank-window-axis button[aria-pressed='true'] {
  background: var(--la-card-muted-surface);
  color: var(--la-color-link);
}
.gank-window-axis button[aria-pressed='true'] {
  font-weight: 600;
}
.gank-window-axis button:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
.sample-main {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  white-space: nowrap;
}
.sortable-heading :deep(.metric-help) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 24px;
  min-width: 24px;
}
.sortable-heading .sort-button {
  flex: 0 0 auto;
  min-width: max-content;
}
.member-column .sortable-heading {
  justify-content: flex-start;
}
.sort-button {
  display: grid;
  grid-template-columns: max-content 16px;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 4px 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: inherit;
  white-space: normal;
  cursor: pointer;
}
.metric-heading-text {
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
}
.metric-heading-name {
  display: block;
  line-height: 21px;
  white-space: nowrap;
}
.sort-direction {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 21px;
  line-height: 21px;
  text-align: center;
  white-space: nowrap;
}
.sort-button:hover {
  color: var(--la-color-link);
}
.sort-button:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.role-table th[aria-sort='descending'] .sort-button,
.role-table th[aria-sort='ascending'] .sort-button {
  color: var(--la-color-link);
  font-weight: 600;
}
.member-line {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}
.member-line > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-name:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
  border-radius: 3px;
}
.member-line strong {
  min-width: 0;
  overflow-wrap: anywhere;
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
  flex-direction: column;
  gap: 2px;
  margin-top: 5px;
  font-size: 12px;
  line-height: 16px;
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
.rate-stack {
  display: flex;
  flex-direction: column;
  gap: 0;
  line-height: 1.5;
  white-space: nowrap;
}
.rate-numbers strong {
  font-size: 14px;
  font-weight: 600;
  color: inherit;
}
.rate-numbers small {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 14px;
  font-weight: 400;
}
.rate-axis {
  min-width: 0;
  flex: 1 1 0;
  transform: translateX(10px);
}
.rate-cell :deep(.no-rate) {
  font-size: 12px;
  line-height: 14px;
}
.rate-cell {
  display: flex;
  align-items: center;
  gap: 20px;
}
.rate-numbers {
  flex: 0 0 96px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.rate-numbers.blue {
  color: var(--ma-blue);
  font-size: 12px;
  line-height: 14px;
}
.rate-numbers.red {
  color: var(--ma-red);
  font-size: 12px;
  line-height: 14px;
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
.gank-victim-role {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  line-height: 1.5;
  white-space: nowrap;
}
.gank-evidence__identity-hint {
  display: block;
  max-width: min(360px, calc(100vw - 32px));
  white-space: normal;
  overflow-wrap: anywhere;
}
.gank-victim-role-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: none;
  font-size: 14px;
  line-height: 1;
}
.gank-victim-role-icon :deep(svg) {
  display: block;
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
}
</style>
