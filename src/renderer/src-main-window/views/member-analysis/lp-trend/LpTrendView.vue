<template>
  <section ref="root" class="ma-panel ma-workspace lp-trend" :aria-label="uiText('lpTrendLabel')">
    <span ref="colorProbe" class="lp-trend-color-probe" aria-hidden="true" />
    <div class="ma-view-toolbar lp-trend-controls">
      <NSelect v-model:value="queue" :options="queueOptions" :aria-label="uiText('rankedModes')" />
      <NSelect
        v-model:value="selectedMember"
        :options="memberOptions"
        :aria-label="uiText('synergyAllMembers')"
      />
      <span class="ma-view-meta">{{
        uiText('lpTrendObservationCount', { count: visibleObservationCount })
      }}</span>
      <NButton
        quaternary
        circle
        :loading="updatingCurrentRanks"
        :disabled="!canRead || loading || currentRankCooldown || fullRefreshRunning"
        :aria-label="uiText('lpTrendRefreshCurrent')"
        :title="
          uiText(
            currentRankCooldown
              ? 'lpTrendRefreshCooldown'
              : fullRefreshRunning
                ? 'lpTrendRefreshAnalysisBusy'
                : 'lpTrendRefreshCurrent'
          )
        "
        @click="updateCurrentRanks"
        ><template #icon><NIcon :component="RefreshRound" /></template
      ></NButton>
      <NButton
        v-if="collectingCurrentRanks"
        quaternary
        circle
        :aria-label="uiText('lpTrendRefreshCancel')"
        @click="cancelCurrentUpdate(false)"
        ><template #icon><NIcon :component="CloseRound" /></template
      ></NButton>
    </div>
    <p v-if="currentRankMessage" class="ma-view-meta lp-trend-refresh-status" role="status">
      {{ currentRankMessage }}
    </p>
    <NAlert v-if="error" type="error" :title="uiText('lpTrendLoadFailed')">
      <NButton secondary @click="reload">{{ uiText('retry') }}</NButton>
    </NAlert>
    <NSpin v-if="loading && !histories.length" :description="uiText('lpTrendLoading')" />
    <template v-else>
      <NEmpty
        v-if="!visibleObservationCount && !error"
        :description="
          uiText(
            visibleSeries.length && visibleSeries.every((member) => member.unresolved)
              ? 'lpTrendUnresolved'
              : 'lpTrendEmpty'
          )
        "
      />
      <ul
        v-if="visibleSeries.length"
        class="lp-trend-legend"
        :aria-label="uiText('synergyAllMembers')"
      >
        <li v-for="member in visibleSeries" :key="member.slot">
          <svg
            class="lp-trend-swatch"
            viewBox="0 0 36 16"
            :style="{ color: memberColor(member.slot) }"
            aria-hidden="true"
          >
            <line
              x1="0"
              y1="8"
              x2="36"
              y2="8"
              :stroke-dasharray="memberVisual(member.slot).dash.join(' ')"
            />
            <g
              :fill="
                selectedMember === member.slot ? memberColor(member.slot) : themeVars.cardColor
              "
              :stroke="
                selectedMember === member.slot ? themeVars.cardColor : memberColor(member.slot)
              "
              :stroke-width="selectedMember === member.slot ? 2 : 1.75"
            >
              <circle
                v-if="memberVisual(member.slot).point === 'circle'"
                cx="18"
                cy="8"
                :r="selectedMember === member.slot ? 3.75 : 3"
              />
              <path v-else :d="legendPointPaths[memberVisual(member.slot).point]" />
            </g>
          </svg>
          <span>{{ member.slot }}. {{ member.name }}</span>
          <small v-if="member.unresolved">{{ uiText('lpTrendUnresolved') }}</small>
          <small v-if="member.failed">{{ uiText('matchRankMissing') }}</small>
        </li>
      </ul>
      <template v-if="visibleObservationCount">
        <div
          v-if="
            canRead &&
            domain &&
            plotSeries.some((member) => member.plotPoints.some((point) => point.y !== null))
          "
          class="lp-trend-chart"
          ref="chartRegion"
          :style="{ height: `${chartHeight}px` }"
          role="img"
          :aria-label="uiText('lpTrendLabel')"
        >
          <span
            ref="yAxisTitle"
            class="lp-trend-axis-title lp-trend-axis-title-y"
            aria-hidden="true"
            >{{ uiText('lpTrendProgress') }}</span
          >
          <span
            ref="xAxisTitle"
            class="lp-trend-axis-title lp-trend-axis-title-x"
            aria-hidden="true"
            >{{ uiText('lpTrendObservedAt') }}</span
          >
          <Line :data="chartData" :options="chartOptions" :plugins="chartPlugins" />
        </div>
        <p v-else class="ma-empty">{{ uiText('lpTrendUnavailable') }}</p>
      </template>

      <NButton
        v-if="histories.some((member) => member.nextCursor !== null)"
        secondary
        :loading="loading"
        @click="loadOlder"
        >{{ uiText('lpTrendLoadOlder') }}</NButton
      >
    </template>
  </section>
</template>

<script setup lang="ts">
import {
  Chart as ChartJS,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions,
  type Plugin
} from 'chart.js'
import { RefreshRound, CloseRound } from '@vicons/material'
import { NAlert, NButton, NEmpty, NIcon, NSelect, NSpin, useThemeVars } from 'naive-ui'
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue'
import { Line } from 'vue-chartjs'
import { useInstance } from '@renderer-shared/shards'
import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import type { MemberAnalysisRankObservationHistoryPage } from '@shared/shards/member-analysis'
import { rankLabel, type RankQueue } from '@shared/shards/member-analysis/opponent-ranks'
import { scatterMemberStyle } from '../scatter-member-style'
import { themeMemberColor } from '../theme-member-color'
import { uiText } from '../ui-text'
import {
  MASTER_PROGRESS_BASE,
  observationSeries,
  rankProgressDomain,
  rankProgressTick,
  rankTierBoundaries,
  type RankObservationPoint
} from './observation-series'

// Built-in registration is idempotent and runs at component setup, not render.
// The tier-boundary plugin is per chart, never registered globally;
// vue-chartjs owns Chart/resize disposal.
ChartJS.register(LinearScale, LineElement, PointElement, Tooltip)
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const memberAnalysis = useInstance(MemberAnalysisRenderer)
const store = useMemberAnalysisStore()
const themeVars = useThemeVars()
const colorProbe = ref<HTMLElement | null>(null)
const memberColors = ref<string[]>([])
const uiFont = computed(() => themeVars.value.fontFamily)
const chartRegion = ref<HTMLElement | null>(null)
const xAxisTitle = ref<HTMLElement | null>(null)
const yAxisTitle = ref<HTMLElement | null>(null)
const chartHeight = ref(440)
let layoutObserver: ResizeObserver | null = null
let layoutMutations: MutationObserver | null = null
let layoutFrame = 0
function measureChart() {
  const chart = chartRegion.value
  const scroller = root.value?.closest?.<HTMLElement>('.member-analysis-scroll')
  if (!chart || !scroller || !root.value) return
  const box = chart.getBoundingClientRect()
  let content = root.value
  while (content.parentElement && content.parentElement !== scroller)
    content = content.parentElement
  // Include the entire tab/content chain, not just the LP card: the outer
  // content wrapper owns bottom padding outside this card's bounding box.
  const top =
    box.top - scroller.getBoundingClientRect().top - (scroller.clientTop || 0) + scroller.scrollTop
  const tail = Math.max(0, content.getBoundingClientRect().bottom - box.bottom)
  const overflow = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const available = Math.min(
    scroller.clientHeight - top - tail - 1,
    overflow > 0 ? box.height - overflow : Infinity
  )
  chartHeight.value = Math.max(320, Math.min(760, Math.floor(available)))
}
function queueLayout() {
  if (!canRead.value || typeof requestAnimationFrame === 'undefined' || layoutFrame) return
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0
    measureChart()
  })
}
function disconnectLayout() {
  layoutObserver?.disconnect()
  layoutObserver = null
  layoutMutations?.disconnect()
  layoutMutations = null
  if (layoutFrame) cancelAnimationFrame(layoutFrame)
  layoutFrame = 0
}
function connectLayout() {
  disconnectLayout()
  if (!canRead.value || !root.value) return
  const scroller = root.value.closest?.<HTMLElement>('.member-analysis-scroll')
  if (typeof ResizeObserver !== 'undefined' && scroller) {
    layoutObserver = new ResizeObserver(queueLayout)
    for (let element: HTMLElement | null = root.value; element; element = element.parentElement) {
      layoutObserver.observe(element)
      if (element === scroller) break
    }
  }
  if (typeof MutationObserver !== 'undefined' && scroller) {
    layoutMutations = new MutationObserver(queueLayout)
    layoutMutations.observe(scroller, { childList: true, subtree: true, characterData: true })
  }
  queueLayout()
}
onMounted(connectLayout)
watch(chartRegion, connectLayout, { flush: 'post' })
onBeforeUnmount(disconnectLayout)
const routeActive = ref(true)
onActivated(() => {
  routeActive.value = true
})
onDeactivated(() => {
  routeActive.value = false
})
interface MemberHistory {
  slot: number
  identityKey: string | null
  name: string
  unresolved: boolean
  failed: boolean
  observations: RankObservationPoint[]
  nextCursor: string | null
}
const root = ref<HTMLElement | null>(null)
const histories = ref<MemberHistory[]>([])
const loading = ref(false)
const error = ref(false)
const updatingCurrentRanks = ref(false)
const collectingCurrentRanks = ref(false)
const currentRankCooldown = ref(false)
const currentRankMessage = ref('')
let currentRankRequestId: string | null = null
let currentRankGeneration = 0
let cooldownTimer: ReturnType<typeof setTimeout> | null = null
const fullRefreshRunning = computed(
  () =>
    store.loading ||
    (!!store.job && !['completed', 'failed', 'cancelled'].includes(store.job.status))
)
const queue = ref<RankQueue>('flex')
const selectedMember = ref<number | 'all'>('all')
const theme = ref({ muted: '', grid: '', boundary: '', dark: false })
let themeObserver: MutationObserver | null = null
function syncTheme() {
  if (!root.value) return
  const style = getComputedStyle(root.value)
  theme.value = {
    muted: style.getPropertyValue('--ma-muted').trim(),
    grid: style.getPropertyValue('--ma-grid').trim(),
    boundary: style.getPropertyValue('--ma-grid-strong').trim(),
    dark: document.documentElement.dataset.theme === 'dark'
  }
  // Resolve the shared SVG/CSS tone in this theme's actual color-scheme before
  // passing it to Canvas. Canvas paint styles cannot resolve CSS variables.
  if (colorProbe.value) {
    memberColors.value = Array.from({ length: 20 }, (_, index) => {
      colorProbe.value!.style.color = themeMemberColor(scatterMemberStyle(index).color)
      return getComputedStyle(colorProbe.value!).color
    })
  }
}
onMounted(() => {
  syncTheme()
  themeObserver = new MutationObserver(syncTheme)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-theme-id']
  })
})
onBeforeUnmount(() => themeObserver?.disconnect())
const queueOptions = computed(() => [
  { value: 'flex', label: uiText('rankFlex') },
  { value: 'solo', label: uiText('rankSolo') }
])
const memberOptions = computed(() => [
  { value: 'all', label: uiText('synergyAllMembers') },
  ...histories.value.map((member) => ({ value: member.slot, label: member.name }))
])
const allSeries = computed(() =>
  histories.value.map((member) => ({
    ...member,
    plotPoints: observationSeries(member.observations)
  }))
)
const visibleSeries = computed(() =>
  allSeries.value.filter(
    (member) => selectedMember.value === 'all' || selectedMember.value === member.slot
  )
)
const visibleObservationCount = computed(() =>
  visibleSeries.value.reduce((count, member) => count + member.observations.length, 0)
)
const plotSeries = visibleSeries
const domain = computed(() => {
  const points = plotSeries.value
    .flatMap((member) => member.plotPoints)
    .filter((point): point is NonNullable<typeof point> => point.y !== null)
  const base = rankProgressDomain([points])
  if (!base || selectedMember.value === 'all') return base
  const values = points.map((point) => point.y!)
  const low = Math.min(...values),
    high = Math.max(...values)
  const padding = Math.max(25, (high - low) * 0.1)
  let min = Math.max(0, Math.floor((low - padding) / 25) * 25)
  let max = Math.ceil((high + padding) / 25) * 25
  if (max - min < 100) {
    min = Math.max(0, Math.floor(((low + high) / 2 - 50) / 25) * 25)
    max = min + 100
  }
  return { ...base, min, max }
})
const memberColor = (slot: number) => memberColors.value[slot - 1] ?? themeVars.value.textColor1
const memberVisuals = [
  { point: 'circle', dash: [] },
  { point: 'rect', dash: [9, 4] },
  { point: 'triangle', dash: [3, 4] },
  { point: 'rectRot', dash: [12, 4, 3, 4] },
  { point: 'star', dash: [6, 3, 2, 3] }
] as const
const memberVisual = (slot: number) => memberVisuals[(slot - 1) % memberVisuals.length]
const legendPointPaths = {
  circle: '',
  rect: 'M15 5H21V11H15Z',
  triangle: 'M18 4L22 11H14Z',
  rectRot: 'M18 4L22 8L18 12L14 8Z',
  star: 'M18 4V12M14 8H22M15 5L21 11M15 11L21 5'
}
const formatTime = (value: string | number) => new Date(value).toLocaleString()
function recordRankLabel(observation: RankObservationPoint) {
  return observation.rank.status === 'ranked'
    ? `${rankLabel(observation.rank.rank)} · ${observation.rank.rank.leaguePoints === null ? '—' : observation.rank.rank.leaguePoints} LP`
    : uiText(
        observation.rank.status === 'unranked'
          ? 'matchRankUnranked'
          : observation.rank.status === 'provisional'
            ? 'matchRankProvisional'
            : 'matchRankMissing'
      )
}
const chartData = computed<ChartData<'line'>>(() => ({
  datasets: plotSeries.value.map((member) => ({
    label: member.name,
    // Linear time coordinates retain every real query, including missing-rank gaps.
    data: member.plotPoints.map((point) => ({ x: point.x, y: point.y ?? Number.NaN })),
    borderColor: memberColor(member.slot),
    backgroundColor: memberColor(member.slot),
    borderWidth: 2.5,
    borderCapStyle: 'round',
    borderJoinStyle: 'round',
    pointRadius: selectedMember.value === member.slot ? 3.75 : 3,
    pointBorderWidth: selectedMember.value === member.slot ? 2 : 1.75,
    pointBorderColor:
      selectedMember.value === member.slot ? themeVars.value.cardColor : memberColor(member.slot),
    pointBackgroundColor:
      selectedMember.value === member.slot ? memberColor(member.slot) : themeVars.value.cardColor,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2.5,
    pointHoverBorderColor: themeVars.value.cardColor,
    pointHoverBackgroundColor: memberColor(member.slot),
    pointHitRadius: 5,
    tension: 0,
    spanGaps: false,
    pointStyle: memberVisual(member.slot).point,
    borderDash: [...memberVisual(member.slot).dash]
  }))
}))
const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  layout: { padding: { left: 26, bottom: 28 } },
  font: { family: uiFont.value, size: 13, weight: 400, lineHeight: 1.5 },
  interaction: { mode: 'nearest', intersect: true },
  scales: {
    x: {
      type: 'linear',
      min: domain.value
        ? domain.value.from - (domain.value.from === domain.value.to ? 60000 : 0)
        : undefined,
      max: domain.value
        ? domain.value.to + (domain.value.from === domain.value.to ? 60000 : 0)
        : undefined,
      grid: { color: theme.value.grid },
      ticks: {
        color: theme.value.muted,
        padding: 8,
        align: 'inner',
        maxTicksLimit: 4,
        maxRotation: 0,
        font: { family: uiFont.value, size: 12, weight: 400 },
        callback: (value, index, ticks) => {
          const adjacent = ticks[index === 0 ? 1 : index - 1]
          const interval = adjacent ? Math.abs(Number(value) - adjacent.value) : Infinity
          const from = domain.value?.from
          const to = domain.value?.to
          const crossesYear =
            from !== undefined &&
            to !== undefined &&
            new Date(from).getFullYear() !== new Date(to).getFullYear()
          return new Date(Number(value)).toLocaleString(undefined, {
            ...(crossesYear ? { year: 'numeric' as const } : {}),
            month: 'numeric',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            ...(interval < 60000 ? { second: '2-digit' as const } : {}),
            ...(interval < 1000 ? { fractionalSecondDigits: 3 as const } : {})
          })
        }
      },
      title: {
        display: false,
        text: uiText('lpTrendObservedAt'),
        color: themeVars.value.textColor1,
        font: { family: uiFont.value, size: 13, weight: 600 },
        padding: { top: 12, bottom: 0 }
      }
    },
    y: {
      type: 'linear',
      min: domain.value?.min,
      max: domain.value?.max,
      afterBuildTicks: (axis) => {
        // Explicit bounds can make Chart.js divide a non-divisible range into
        // fractional ticks despite stepSize. Keep ticks on real LP divisions.
        const quantum = selectedMember.value === 'all' ? 100 : 25
        const seen = new Set<number>()
        axis.ticks = axis.ticks
          .map((tick) => ({ ...tick, value: Math.round(tick.value / quantum) * quantum }))
          .filter((tick) => {
            if (seen.has(tick.value)) return false
            seen.add(tick.value)
            return true
          })
      },
      grid: { color: theme.value.grid },
      ticks: {
        color: themeVars.value.textColor1,
        stepSize: domain.value
          ? selectedMember.value === 'all'
            ? Math.max(100, Math.ceil((domain.value.max - domain.value.min) / 1200) * 100)
            : Math.max(25, Math.ceil((domain.value.max - domain.value.min) / 200) * 25)
          : 100,
        maxTicksLimit: 12,
        padding: 10,
        font: { family: uiFont.value, size: 13, weight: 500 },
        callback: (value) => {
          const numeric = Number(value)
          if (selectedMember.value !== 'all') {
            if (numeric >= MASTER_PROGRESS_BASE)
              return `${uiText('lpTrendTopRanks')} · ${numeric - MASTER_PROGRESS_BASE} LP`
            return `${rankProgressTick(Math.floor(numeric / 100) * 100)} · ${numeric % 100} LP`
          }
          return numeric === MASTER_PROGRESS_BASE
            ? `${uiText('lpTrendTopRanks')} · 0 LP`
            : rankProgressTick(numeric)
        }
      },
      title: {
        display: false,
        text: uiText('lpTrendProgress'),
        color: themeVars.value.textColor1,
        font: { family: uiFont.value, size: 13, weight: 600 },
        padding: { top: 0, bottom: 12 }
      }
    }
  },
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
    tooltip: {
      bodyFont: { family: uiFont.value, size: 14, weight: 400, lineHeight: 1.5 },
      titleFont: { family: uiFont.value, size: 13, weight: 600, lineHeight: 1.5 },
      padding: 12,
      titleMarginBottom: 6,
      callbacks: {
        title: (items) => {
          const item = items[0]
          const point = plotSeries.value[item.datasetIndex]?.plotPoints[item.dataIndex]
          return point ? formatTime(point.observation.fetchedAt) : ''
        },
        label: (item) => {
          const member = plotSeries.value[item.datasetIndex]
          const point = member.plotPoints[item.dataIndex]
          return point ? `${member.name} · ${recordRankLabel(point.observation)}` : ''
        }
      }
    }
  }
}))
const tierBoundaryPlugin: Plugin<'line'> = {
  id: 'member-analysis-lp-tier-boundaries',
  beforeDatasetsDraw(chart) {
    const {
      ctx,
      chartArea,
      scales: { y }
    } = chart
    ctx.save()
    ctx.strokeStyle = theme.value.boundary
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 1
    for (const boundary of rankTierBoundaries) {
      if (boundary.value < y.min || boundary.value > y.max) continue
      const position = y.getPixelForValue(boundary.value)
      ctx.beginPath()
      ctx.moveTo(chartArea.left, position)
      ctx.lineTo(chartArea.right, position)
      ctx.stroke()
    }
    ctx.restore()
  }
}
const axisTitlePlugin: Plugin<'line'> = {
  id: 'rank-dom-axis-titles',
  afterLayout(chart) {
    const { left, right, top, bottom } = chart.chartArea
    if (xAxisTitle.value) {
      xAxisTitle.value.style.left = `${Math.round(left)}px`
      xAxisTitle.value.style.width = `${Math.round(right - left)}px`
    }
    if (yAxisTitle.value) yAxisTitle.value.style.top = `${Math.round((top + bottom) / 2)}px`
  }
}
const chartPlugins = [tierBoundaryPlugin, axisTitlePlugin]

let readGeneration = 0
const canRead = computed(
  () =>
    props.active &&
    routeActive.value &&
    store.settings?.enabled === true &&
    store.settings.experimentalLpTrendEnabled === true
)
watch(canRead, connectLayout, { flush: 'post' })
const rosterKey = computed(() => JSON.stringify(store.settings?.members ?? []))
function reload() {
  return readHistory(false)
}
function loadOlder() {
  return readHistory(true)
}
function cancelCurrentUpdate(invalidate: boolean) {
  const requestId = currentRankRequestId
  if (invalidate) {
    currentRankGeneration++
    currentRankRequestId = null
    updatingCurrentRanks.value = false
    collectingCurrentRanks.value = false
    currentRankMessage.value = ''
  }
  if (!requestId) return
  if (!invalidate) currentRankMessage.value = uiText('lpTrendRefreshCancelling')
  void memberAnalysis.cancelCurrentRankRefresh({ requestId }).catch(() => {})
}
async function updateCurrentRanks() {
  if (
    !canRead.value ||
    loading.value ||
    updatingCurrentRanks.value ||
    currentRankCooldown.value ||
    fullRefreshRunning.value
  )
    return
  const requestId = crypto.randomUUID()
  const generation = ++currentRankGeneration
  currentRankRequestId = requestId
  updatingCurrentRanks.value = true
  collectingCurrentRanks.value = true
  currentRankMessage.value = uiText('lpTrendRefreshWorking')
  try {
    const result = await memberAnalysis.refreshCurrentRanks({ requestId })
    if (generation !== currentRankGeneration || !canRead.value) return
    collectingCurrentRanks.value = false
    currentRankRequestId = null
    if (!result.ok) {
      currentRankMessage.value = uiText('lpTrendRefreshFailed')
      void memberAnalysis.cancelCurrentRankRefresh({ requestId }).catch(() => {})
      return
    }
    const updated = result.value.members.filter((member) => member.status === 'updated').length
    const failed = result.value.members.filter((member) => member.status !== 'updated')
    currentRankMessage.value =
      result.value.status === 'cancelled'
        ? uiText('lpTrendRefreshCancelled')
        : uiText('lpTrendRefreshResult', { updated, total: result.value.members.length })
    if (failed.length && result.value.status !== 'cancelled') {
      const names = failed.map((member) => {
        const configured = store.settings?.members[member.memberSlot - 1]
        return configured
          ? `${member.memberSlot}. ${configured.gameName}#${configured.tagLine}`
          : String(member.memberSlot)
      })
      currentRankMessage.value += ` · ${uiText('lpTrendRefreshMembersFailed', { members: names.join('、') })}`
    }
    // Merge new facts into already-loaded history, including older cursor pages.
    await readHistory(false, true)
  } catch {
    if (generation === currentRankGeneration)
      currentRankMessage.value = uiText('lpTrendRefreshFailed')
    void memberAnalysis.cancelCurrentRankRefresh({ requestId }).catch(() => {})
  } finally {
    if (generation === currentRankGeneration) {
      updatingCurrentRanks.value = false
      collectingCurrentRanks.value = false
      currentRankRequestId = null
      currentRankCooldown.value = true
      if (cooldownTimer) clearTimeout(cooldownTimer)
      cooldownTimer = setTimeout(() => {
        currentRankCooldown.value = false
        cooldownTimer = null
      }, 5000)
    }
  }
}
async function readHistory(append: boolean, mergeExisting = false) {
  if (!canRead.value || (append && loading.value)) return
  const generation = ++readGeneration
  const configuredMembers = [...(store.settings?.members ?? [])]
  const requestedQueue = queue.value
  const previous = histories.value
  loading.value = true
  error.value = false
  try {
    const next: MemberHistory[] = []
    for (const [index, member] of configuredMembers.entries()) {
      if (generation !== readGeneration || !canRead.value) return
      const memberSlot = index + 1
      const existing = previous.find((record) => record.slot === memberSlot)
      if (append && existing?.nextCursor === null) {
        next.push(existing)
        continue
      }
      let page: MemberAnalysisRankObservationHistoryPage | null = null
      try {
        const reply = await memberAnalysis.getRankObservationHistory({
          memberSlot,
          queue: requestedQueue,
          pageSize: 100,
          cursor: append ? (existing?.nextCursor ?? null) : null
        })
        if (reply.ok) page = reply.value
      } catch {
        // Transport failure is confined to this configured member, not a fake
        // missing observation. Existing facts remain readable and retry is explicit.
      }
      if (generation !== readGeneration || !canRead.value) return
      if (!page) {
        next.push(
          existing
            ? { ...existing, failed: true }
            : {
                slot: memberSlot,
                identityKey: null,
                name: `${member.gameName}#${member.tagLine}`,
                unresolved: false,
                failed: true,
                observations: [],
                nextCursor: null
              }
        )
        continue
      }
      // Keep older loaded pages within this identity. A repeated timestamp uses
      // the complete current IPC fact rather than retaining stale rank data.
      const observations = new Map<string, RankObservationPoint>()
      for (const observation of (append || mergeExisting) &&
      existing?.identityKey === (page.identityKey ?? null)
        ? (existing?.observations ?? [])
        : [])
        observations.set(observation.fetchedAt, observation)
      for (const point of page.points)
        observations.set(point.fetchedAt, {
          fetchedAt: point.fetchedAt,
          rank: point.queueRank
        })
      next.push({
        slot: memberSlot,
        identityKey: page.identityKey ?? null,
        name: `${member.gameName}#${member.tagLine}`,
        unresolved: page.status === 'identity-unresolved',
        failed: false,
        observations: [...observations.values()],
        nextCursor: page.pagination.nextCursor
      })
    }
    if (generation !== readGeneration || !canRead.value) return
    histories.value = next
    error.value = next.some((member) => member.failed)
    if (
      selectedMember.value !== 'all' &&
      !next.some((member) => member.slot === selectedMember.value)
    )
      selectedMember.value = 'all'
  } catch {
    if (generation === readGeneration && canRead.value) error.value = true
  } finally {
    if (generation === readGeneration) loading.value = false
  }
}
watch(
  [queue, rosterKey],
  () => {
    cancelCurrentUpdate(true)
    readGeneration++
    loading.value = false
    // A queue/identity change must never relabel old facts as the new selection.
    histories.value = []
    error.value = false
    if (canRead.value) void reload()
  },
  { immediate: true, flush: 'sync' }
)
watch(
  canRead,
  (readable) => {
    if (!readable) cancelCurrentUpdate(true)
    readGeneration++
    loading.value = false
    // Tab changes suspend IO/chart work, not the already loaded facts or selection.
    if (readable && !histories.value.length) void reload()
  },
  { flush: 'sync' }
)
onBeforeUnmount(() => {
  cancelCurrentUpdate(true)
  if (cooldownTimer) clearTimeout(cooldownTimer)
  readGeneration++
})
</script>

<style scoped>
.lp-trend {
  color-scheme: light;
  font-family: v-bind(uiFont);
  font-size: 14px;
  min-width: 0;
}
.member-analysis-page .lp-trend {
  box-sizing: border-box;
  width: 75%;
  margin-inline: auto;
}
@media (max-width: 1360px) {
  .member-analysis-page .lp-trend {
    width: 100%;
  }
}
:global([data-theme='dark'] .lp-trend) {
  color-scheme: dark;
}
.lp-trend-color-probe {
  position: absolute;
  width: 0;
  height: 0;
  visibility: hidden;
  pointer-events: none;
  overflow: hidden;
}
.lp-trend-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.lp-trend-refresh-status {
  margin: 0;
  overflow-wrap: anywhere;
}
.lp-trend-controls > .n-select {
  width: 240px;
  max-width: 100%;
}
.lp-trend-chart {
  position: relative;
  min-height: 320px;
  min-width: 0;
}
.lp-trend-axis-title {
  position: absolute;
  z-index: 1;
  pointer-events: none;
  color: v-bind('themeVars.textColor1');
  font-family: v-bind(uiFont);
  font-size: 13px;
  font-weight: 600;
  line-height: 20px;
}
.lp-trend-axis-title-x {
  bottom: 0;
  left: 0;
  width: 100%;
  text-align: center;
}
.lp-trend-axis-title-y {
  left: 0;
  top: 50%;
  writing-mode: horizontal-tb;
  white-space: nowrap;
  transform: translateY(-50%);
  letter-spacing: 0;
}
.lp-trend-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  padding: 0;
  margin: 0;
  list-style: none;
}
.lp-trend-legend li {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-wrap: anywhere;
}
.lp-trend-swatch {
  width: 36px;
  height: 16px;
  flex: none;
  fill: v-bind('themeVars.cardColor');
  stroke: currentColor;
  stroke-width: 2.5px;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.lp-trend small {
  font-size: 12px;
  color: var(--ma-muted);
}
</style>
