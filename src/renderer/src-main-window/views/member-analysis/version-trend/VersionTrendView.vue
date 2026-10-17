<template>
  <section ref="root" class="version-trend ma-panel ma-workspace">
    <div class="controls">
      <label
        >{{ text('member')
        }}<NSelect
          :value="request.memberId"
          :options="members"
          @update:value="update({ memberId: $event, includeMemberIds: [], excludeMemberIds: [] })"
      /></label>
      <label class="role-control"
        >{{ text('role')
        }}<NSelect
          :value="request.role"
          :options="roles"
          :render-label="renderRoleSelectLabel"
          @update:value="update({ role: $event })"
      /></label>
      <label class="metric-control"
        >{{ text('metric')
        }}<NSelect
          :value="request.metric"
          :options="metricOptions"
          :consistent-menu-width="false"
          :render-label="renderMetricLabel"
          filterable
          @update:value="update({ metric: $event })"
      /></label>
      <label
        >{{ text('champion')
        }}<NSelect
          :value="request.champion"
          :options="championOptions"
          clearable
          filterable
          :filter="filterChampion"
          @update:value="update({ champion: $event })"
      /></label>
      <label class="axis-control"
        >{{ text('axis')
        }}<NSelect
          :value="request.axis"
          :options="axisOptions"
          @update:value="update({ axis: $event })"
      /></label>
      <label v-if="request.axis === 'time'" class="bucket-control"
        >{{ text('timeBucket')
        }}<NSelect
          :value="request.timeBucket"
          :options="timeBucketOptions"
          @update:value="update({ timeBucket: $event })"
      /></label>
      <NButton :aria-expanded="advanced" @click="advanced = !advanced">{{
        text('filters')
      }}</NButton>
    </div>
    <div v-if="advanced" class="controls advanced">
      <label
        >{{ text('patchFrom')
        }}<NInput :value="request.patchFrom" @update:value="update({ patchFrom: $event })"
      /></label>
      <label
        >{{ text('patchTo')
        }}<NInput :value="request.patchTo" @update:value="update({ patchTo: $event })"
      /></label>
      <label
        >{{ text('dateFrom')
        }}<NInput
          :value="request.dateFrom"
          placeholder="YYYY-MM-DD"
          @update:value="update({ dateFrom: $event })"
      /></label>
      <label
        >{{ text('dateTo')
        }}<NInput
          :value="request.dateTo"
          placeholder="YYYY-MM-DD"
          @update:value="update({ dateTo: $event })"
      /></label>
      <label
        >{{ text('side')
        }}<NSelect
          :value="request.side"
          :options="sideOptions"
          @update:value="update({ side: $event })"
      /></label>
      <label
        >{{ text('outcome')
        }}<NSelect
          :value="request.outcome"
          :options="outcomeOptions"
          @update:value="update({ outcome: $event })"
      /></label>
      <label
        >{{ text('durationMin')
        }}<NInputNumber
          :value="request.durationMin"
          :min="0"
          :max="180"
          @update:value="update({ durationMin: $event })"
      /></label>
      <label
        >{{ text('durationMax')
        }}<NInputNumber
          :value="request.durationMax"
          :min="0"
          :max="180"
          @update:value="update({ durationMax: $event })"
      /></label>
      <label
        >{{ text('includeMembers')
        }}<NSelect
          :value="request.includeMemberIds"
          multiple
          :options="includeOptions"
          @update:value="update({ includeMemberIds: $event })"
      /></label>
      <label
        >{{ text('excludeMembers')
        }}<NSelect
          :value="request.excludeMemberIds"
          multiple
          :options="excludeOptions"
          @update:value="update({ excludeMemberIds: $event })"
      /></label>
      <label
        >{{ text('completeness')
        }}<NSelect
          :value="request.completeness"
          :options="completenessOptions"
          @update:value="update({ completeness: $event })"
      /></label>
    </div>
    <p v-if="loading" class="trend-status-copy trend-status-standalone" role="status">
      {{ text('loading') }}
    </p>
    <div v-if="error" class="trend-status-row">
      <p class="trend-status-copy" role="alert">{{ error }}</p>
      <div v-if="$slots['error-action']" class="trend-status-action">
        <slot name="error-action" :loading="loading" />
      </div>
    </div>
    <p v-if="result && !current" class="trend-status-copy trend-status-standalone" role="status">
      {{ text('stale') }}
    </p>
    <template v-if="result">
      <p v-if="!result.points.length" class="ma-empty">{{ text('empty') }}</p>
      <template v-else>
        <div class="chart-heading">
          <h3>{{ result.metric.label }}</h3>
          <span class="unit">{{ displayUnit(result.metric.unit) }}</span>
          <span v-if="gapSegments.length" :id="gapLegendId" class="unit">{{
            text('gapLegend')
          }}</span>
        </div>
        <div ref="plotArea" class="plot-scroll" tabindex="0" :aria-label="text('chart')">
          <svg
            :viewBox="`0 0 ${plotWidth} ${plotHeight}`"
            width="100%"
            :height="plotHeight"
            role="img"
            :aria-label="`${result.metric.label} · ${text('chart')}`"
            :aria-describedby="gapSegments.length ? gapLegendId : undefined"
          >
            <g class="grid">
              <line
                v-for="tick in ticks"
                :key="tick"
                x1="78"
                :x2="plotWidth - 28"
                :y1="y(tick)"
                :y2="y(tick)"
                :class="{ zero: tick === 0 }"
              />
            </g>
            <g class="axis">
              <text v-for="tick in ticks" :key="tick" x="70" :y="y(tick) + 4" text-anchor="end">
                {{ axisLabel(tick) }}
              </text>
              <template v-for="(point, index) in visiblePoints" :key="point.bucketKey">
                <text
                  v-if="visibleLabels.has(index)"
                  :x="x(index)"
                  :y="plotHeight - 25"
                  text-anchor="middle"
                >
                  {{ point.label }}
                </text>
              </template>
            </g>
            <g aria-hidden="true" pointer-events="none">
              <line
                v-for="segment in gapSegments"
                :key="segment.key"
                class="series"
                stroke-dasharray="5 5"
                :x1="x(segment.from)"
                :y1="y(visiblePoints[segment.from].value!)"
                :x2="x(segment.to)"
                :y2="y(visiblePoints[segment.to].value!)"
              />
            </g>
            <g aria-hidden="true" pointer-events="none">
              <line
                v-for="segment in solidSegments"
                :key="segment.key"
                class="series"
                :x1="x(segment.from)"
                :y1="y(visiblePoints[segment.from].value!)"
                :x2="x(segment.to)"
                :y2="y(visiblePoints[segment.to].value!)"
              />
            </g>
            <g
              v-for="(point, index) in visiblePoints"
              :key="point.bucketKey"
              role="button"
              tabindex="0"
              :aria-label="`${point.bucketKey} · ${point.value === null ? text('missing') : formatted(point.value)} · ${point.validGames}/${point.games}`"
              :aria-pressed="selectedBucket === point.bucketKey"
              @click="select(point.bucketKey)"
              @keydown.enter.prevent="select(point.bucketKey)"
              @keydown.space.prevent="select(point.bucketKey)"
            >
              <circle
                v-if="point.value !== null"
                class="point"
                :class="{ selected: selectedBucket === point.bucketKey }"
                :cx="x(index)"
                :cy="y(point.value)"
                r="6"
              />
              <text v-else class="axis" :x="x(index)" :y="plotHeight / 2" text-anchor="middle">
                —
              </text>
            </g>
          </svg>
        </div>

        <div class="table-heading">
          <h3>{{ text('exactValues') }}</h3>
          <NPagination
            v-if="result.points.length > 50"
            v-model:page="page"
            :page-size="50"
            :item-count="result.points.length"
            :page-slot="5"
          />
        </div>
        <div
          ref="tableArea"
          class="table-scroll"
          tabindex="0"
          role="region"
          :aria-label="text('exactValues')"
          :style="{ maxHeight: `${tableHeight}px` }"
        >
          <table :aria-label="text('exactValues')">
            <thead>
              <tr>
                <th>{{ text(result.axis === 'time' ? 'time' : 'patch') }}</th>
                <th>{{ result.metric.label }}</th>
                <th>{{ text('sample') }}</th>
                <th>{{ text('denominator') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="point in visiblePoints"
                :key="point.bucketKey"
                :class="{ selected: selectedBucket === point.bucketKey }"
              >
                <th>
                  <NButton
                    text
                    :aria-pressed="selectedBucket === point.bucketKey"
                    @click="select(point.bucketKey)"
                    >{{ point.label }}</NButton
                  ><span v-if="result.axis === 'time'" class="bucket-patches">{{
                    point.patches.join(' · ')
                  }}</span>
                </th>
                <td
                  :title="point.interval ? intervalLabel(point) : undefined"
                  :tabindex="point.interval ? 0 : undefined"
                  :aria-label="point.interval ? intervalLabel(point) : undefined"
                >
                  {{ point.value === null ? text('missing') : formatted(point.value) }}
                </td>
                <td>{{ point.validGames }}/{{ point.games }}</td>
                <td>
                  {{
                    point.denominator === null
                      ? '—'
                      : text('exposure', {
                          value: point.denominator,
                          unit: displayUnit(point.denominatorUnit)
                        })
                  }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>
  </section>
</template>

<script lang="ts">
// Budget the secondary table, never clip the primary chart on short windows.
export function calculateTrendTableHeight(
  availableHeight: number,
  precedingHeight: number,
  bottomPadding: number
): number {
  if (![availableHeight, precedingHeight, bottomPadding].every(Number.isFinite)) return 240
  // Keep the header and at least one data row reachable without reserving a
  // large secondary viewport that pushes the whole page below a short window.
  return Math.max(80, Math.min(320, availableHeight - precedingHeight - bottomPadding - 4))
}
export function calculateTrendPlotHeight(
  availableHeight: number,
  precedingHeight: number,
  bottomPadding: number,
  currentPlotHeight: number
): number {
  if (![availableHeight, precedingHeight, bottomPadding, currentPlotHeight].every(Number.isFinite))
    return 280
  // Reposition SVG marks/axes instead of scaling their text. Reserve a table
  // header plus one row; expanded filters may still need ordinary page scroll.
  return Math.max(
    180,
    Math.min(280, currentPlotHeight + availableHeight - precedingHeight - bottomPadding - 80 - 4)
  )
}
</script>
<script setup lang="ts">
import { computed, h, ref, useId, watch, nextTick, onMounted, onUnmounted } from 'vue'
import {
  NButton,
  NInput,
  NInputNumber,
  NSelect,
  NPagination,
  useThemeVars,
  type SelectOption
} from 'naive-ui'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { formatMetric } from '../metric-defs'
import { renderRoleSelectLabel } from '../role-select-label'
import { trendMetrics, trendRequestKey, type TrendRequest, type TrendResult } from './domain'

export type TrendCopyKey =
  | 'gapLegend'
  | 'unitGames'
  | 'unitMinutes'
  | 'unitCount'
  | 'unitGold'
  | 'unitWeight'
  | 'unitShare'
  | 'unitCountPerGame'
  | 'unitSeconds'
  | 'unitRatio'
  | 'method'
  | 'member'
  | 'role'
  | 'metric'
  | 'champion'
  | 'filters'
  | 'patchFrom'
  | 'patchTo'
  | 'dateFrom'
  | 'dateTo'
  | 'side'
  | 'outcome'
  | 'durationMin'
  | 'durationMax'
  | 'includeMembers'
  | 'excludeMembers'
  | 'completeness'
  | 'population'
  | 'confounding'
  | 'loading'
  | 'stale'
  | 'coverage'
  | 'teamContext'
  | 'empty'
  | 'axisNote'
  | 'unit'
  | 'chart'
  | 'wilson'
  | 'uncertainty'
  | 'exactValues'
  | 'patch'
  | 'sample'
  | 'denominator'
  | 'missing'
  | 'exposure'
  | 'all'
  | 'blue'
  | 'red'
  | 'win'
  | 'loss'
  | 'metricKnown'
  | 'axis'
  | 'time'
  | 'timeBucket'
  | 'day'
  | 'week'
  | 'month'
  | 'timeAxisNote'
  | 'unknownTimes'
const props = defineProps<{
  request: TrendRequest
  result: TrendResult | null
  loading: boolean
  error: string | null
  members: { label: string; value: string }[]
  roles: { label: string; value: TrendRequest['role'] }[]
  champions: { label: string; value: string }[]
  filterSummary: string
  text: (key: TrendCopyKey, values?: Record<string, string | number>) => string
}>()
const emit = defineEmits<{ 'update:request': [request: TrendRequest] }>()
const league = useLeagueClientStore()
const statusTheme = useThemeVars()
const championSearchText = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
// Display labels follow the same client game-data source as the hero pool.
// Canonical option values remain stable as client language/resources change.
const championLabels = computed(() => {
  const labels = new Map<string, string>()
  for (const champion of Object.values(league.gameData.champions)) {
    if (!champion.name.trim()) continue
    labels.set(championSearchText(champion.alias), champion.name)
    labels.set(championSearchText(champion.name), champion.name)
  }
  return labels
})
const championOptions = computed(() =>
  props.champions.map((option) => ({
    ...option,
    label: championLabels.value.get(championSearchText(option.value)) ?? option.value
  }))
)
const filterChampion = (pattern: string, option: SelectOption) => {
  const query = championSearchText(pattern)
  return [
    typeof option.label === 'string' ? option.label : '',
    typeof option.value === 'string' ? option.value : ''
  ].some((value) => championSearchText(value).includes(query))
}
const advanced = ref(false)
const root = ref<HTMLElement | null>(null)
const plotArea = ref<HTMLElement | null>(null)
const tableArea = ref<HTMLElement | null>(null)
const tableHeight = ref(240)
const chartWidth = ref(900)
const plotHeight = ref(280)
let observer: ResizeObserver | undefined
let frame = 0
let scrollOwner: HTMLElement | null = null
function updateLayout() {
  const panel = root.value
  const table = tableArea.value
  if (!panel?.isConnected || !scrollOwner || !table) return
  const panelRect = panel.getBoundingClientRect()
  const ownerRect = scrollOwner.getBoundingClientRect()
  const naturalTop = panelRect.top - ownerRect.top - scrollOwner.clientTop + scrollOwner.scrollTop
  // The scroll owner's remaining height includes ancestor gutters as well as
  // this panel. Leaving those out makes the outer page overflow by 24px even
  // when the secondary table itself has been correctly constrained.
  let padding = Number.parseFloat(getComputedStyle(panel).paddingBottom) || 0
  for (
    let ancestor = panel.parentElement;
    ancestor && ancestor !== scrollOwner;
    ancestor = ancestor.parentElement
  ) {
    const style = getComputedStyle(ancestor)
    padding +=
      (Number.parseFloat(style.paddingBottom) || 0) +
      (Number.parseFloat(style.borderBottomWidth) || 0)
  }
  const available = scrollOwner.clientHeight - naturalTop
  const preceding = table.getBoundingClientRect().top - panelRect.top
  const previousPlotHeight = plotArea.value?.getBoundingClientRect().height ?? plotHeight.value
  const nextPlotHeight = calculateTrendPlotHeight(available, preceding, padding, previousPlotHeight)
  plotHeight.value = nextPlotHeight
  tableHeight.value = calculateTrendTableHeight(
    available,
    preceding + nextPlotHeight - previousPlotHeight,
    padding
  )
  chartWidth.value = Math.max(560, plotArea.value?.clientWidth ?? 900)
}
function queueLayout() {
  if (frame || typeof requestAnimationFrame === 'undefined') return
  frame = requestAnimationFrame(() => {
    frame = 0
    updateLayout()
  })
}
onMounted(() => {
  if (
    typeof ResizeObserver === 'undefined' ||
    typeof HTMLElement === 'undefined' ||
    !(root.value instanceof HTMLElement)
  )
    return
  scrollOwner = root.value.closest<HTMLElement>('.member-analysis-scroll')
  observer = new ResizeObserver(queueLayout)
  observer.observe(root.value)
  if (scrollOwner) observer.observe(scrollOwner)
  queueLayout()
})
onUnmounted(() => {
  observer?.disconnect()
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  scrollOwner = null
})
watch([advanced, () => props.result, () => props.loading, () => props.error], () =>
  nextTick(queueLayout)
)
const intervalLabel = (point: TrendResult['points'][number]) =>
  point.interval
    ? `${point.value === null ? props.text('missing') : formatted(point.value)} · 95%: ${formatted(point.interval.low)} – ${formatted(point.interval.high)}`
    : ''
const displayUnit = (unit: string) => {
  const keys: Record<string, TrendCopyKey> = {
    games: 'unitGames',
    minutes: 'unitMinutes',
    count: 'unitCount',
    gold: 'unitGold',
    weight: 'unitWeight',
    share: 'unitShare',
    'count/game': 'unitCountPerGame',
    seconds: 'unitSeconds',
    ratio: 'unitRatio'
  }
  return keys[unit] ? props.text(keys[unit]) : unit
}
const selectedBucket = ref<string | null>(null)
const gapLegendId = useId()
const page = ref(1)
const visiblePoints = computed(
  () => props.result?.points.slice((page.value - 1) * 50, page.value * 50) ?? []
)
const segments = computed(() =>
  visiblePoints.value.flatMap((point, index) => {
    const previous = visiblePoints.value[index - 1]
    // A missing value is not an observed endpoint. Dashed spans only distinguish
    // gaps between two real observations; they add no values or interactive marks.
    if (!previous || previous.value === null || point.value === null) return []
    return [{ key: point.bucketKey, from: index - 1, to: index, gap: !point.connectPrevious }]
  })
)
const gapSegments = computed(() => segments.value.filter((segment) => segment.gap))
const solidSegments = computed(() => segments.value.filter((segment) => !segment.gap))
const current = computed(() => props.result?.requestKey === trendRequestKey(props.request))
const metricAvailable = (metric: (typeof trendMetrics)[number], role: TrendRequest['role']) =>
  !(metric.scope === 'jungle' && role !== 'JUNGLE') &&
  !(metric.key.startsWith('player:laneGank') && role === 'JUNGLE')
const update = (change: Partial<TrendRequest>) => {
  const next = { ...props.request, ...change }
  const metric = trendMetrics.find((metric) => metric.key === next.metric)
  if (metric && !metricAvailable(metric, next.role)) next.metric = 'player:winRate'
  emit('update:request', next)
}
const includeOptions = computed(() =>
  props.members.map((member) => ({
    ...member,
    disabled:
      member.value === props.request.memberId ||
      props.request.excludeMemberIds.includes(member.value)
  }))
)
const excludeOptions = computed(() =>
  props.members.map((member) => ({
    ...member,
    disabled:
      member.value === props.request.memberId ||
      props.request.includeMemberIds.includes(member.value)
  }))
)
const metricOptions = computed(() =>
  trendMetrics.map((metric) => ({
    label: metric.label,
    value: metric.key,
    disabled: !metricAvailable(metric, props.request.role)
  }))
)
const renderMetricLabel = (option: SelectOption, selected: boolean) => {
  const label = String(option.label ?? '')
  return selected
    ? label
    : h(
        'span',
        {
          style: {
            display: 'block',
            whiteSpace: 'normal',
            overflowWrap: 'anywhere',
            maxWidth: 'min(520px, calc(100vw - 80px))'
          }
        },
        label
      )
}
const sideOptions = computed(() => [
  { label: props.text('all'), value: 'all' },
  { label: props.text('blue'), value: 'Blue' },
  { label: props.text('red'), value: 'Red' }
])
const outcomeOptions = computed(() =>
  ['all', 'win', 'loss'].map((value) => ({ label: props.text(value as TrendCopyKey), value }))
)
const completenessOptions = computed(() => [
  { label: props.text('all'), value: 'all' },
  { label: props.text('metricKnown'), value: 'metric-known' }
])
const axisOptions = computed(() =>
  ['patch', 'time'].map((value) => ({ label: props.text(value as TrendCopyKey), value }))
)
const timeBucketOptions = computed(() =>
  ['day', 'week', 'month'].map((value) => ({ label: props.text(value as TrendCopyKey), value }))
)
const plotWidth = computed(() => chartWidth.value)
const x = (index: number) => {
  const points = visiblePoints.value
  if (points.length <= 1) return 128
  // Real chronological spacing, rather than compressing an unobserved week
  // into a single adjacent category. Exact labels remain available in the table.
  const first = points[0].bucketStartMs,
    last = points.at(-1)!.bucketStartMs
  const ratio =
    props.result?.axis === 'time' && first !== null && last !== null && last > first
      ? (points[index].bucketStartMs! - first) / (last - first)
      : index / (points.length - 1)
  return 128 + ratio * (plotWidth.value - 168)
}
const visibleLabels = computed(() => {
  const points = visiblePoints.value
  const visible = new Set<number>()
  let previous = -Infinity
  points.forEach((_, index) => {
    if (x(index) - previous >= 100) {
      visible.add(index)
      previous = x(index)
    }
  })
  return visible
})
const extent = computed(() => {
  if (props.result?.metric.key.endsWith(':winRate')) return { min: 0, max: 1 }
  const values =
    props.result?.points.flatMap((point) => (point.value === null ? [] : [point.value])) ?? []
  const min = Math.min(0, ...values),
    max = Math.max(0, ...values)
  const padding = (max - min) * 0.1 || 1
  return { min: min < 0 ? min - padding : 0, max: max + padding }
})
const ticks = computed(() =>
  Array.from(
    { length: 5 },
    (_, index) => extent.value.min + ((extent.value.max - extent.value.min) * index) / 4
  )
)
const y = (value: number) =>
  plotHeight.value -
  60 -
  ((value - extent.value.min) / (extent.value.max - extent.value.min)) * (plotHeight.value - 80)
const formatted = (value: number) =>
  formatMetric(value, props.result?.metric.format === 'int' ? 'num' : props.result?.metric.format)
const axisLabel = (value: number) => {
  const percent = props.result?.metric.format === 'pct' || props.result?.metric.format === 'pp'
  const scale = percent ? 100 : 1
  const step = ((extent.value.max - extent.value.min) * scale) / 4
  const digits = Math.min(10, Math.max(percent ? 1 : 0, Math.ceil(-Math.log10(step)) + 1))
  return `${(value * scale).toFixed(digits)}${props.result?.metric.format === 'pct' ? '%' : ''}`
}
const select = (patch: string) => {
  selectedBucket.value = selectedBucket.value === patch ? null : patch
}
watch(
  () => props.result,
  () => {
    page.value = 1
    if (
      !current.value ||
      !props.result?.points.some((point) => point.bucketKey === selectedBucket.value)
    )
      selectedBucket.value = null
  }
)
watch(page, () => {
  selectedBucket.value = null
})
watch(
  () => trendRequestKey(props.request),
  () => {
    selectedBucket.value = null
  }
)
</script>

<style scoped>
.version-trend.ma-workspace {
  /* Controls/headings already own their spacing; do not add shared panel gaps. */
  gap: 0;
  max-width: 1160px;
  margin-inline: auto;
  font-size: 14px;
  line-height: 1.5;
  color: var(--la-color-text-primary);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 8px 12px;
}
.controls label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 148px;
  max-width: 100%;
  color: var(--la-color-text-secondary);
  font-size: 12px;
}
.controls .metric-control {
  width: 260px;
}
.controls .role-control {
  width: 100px;
}
.controls .axis-control,
.controls .bucket-control {
  width: 116px;
}
.controls > .n-button {
  flex: none;
  align-self: end;
}
.trend-status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 12px 0;
  min-width: 0;
}
.trend-status-copy {
  min-width: 0;
  margin: 0;
  font-family: v-bind('statusTheme.fontFamily');
  font-size: 14px;
  font-weight: 400;
  line-height: 1.6;
  color: var(--la-color-text-primary);
  overflow-wrap: anywhere;
}
.trend-status-row > .trend-status-copy {
  flex: 1 1 22rem;
  max-width: 100%;
}
.trend-status-standalone {
  margin: 12px 0;
  color: var(--ma-muted);
}
.trend-status-action {
  flex: none;
}
.trend-status-action :deep(.n-button) {
  min-height: 32px;
}
.advanced {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--ma-grid);
}
.chart-heading,
.table-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 16px 0 8px;
}
.chart-heading {
  justify-content: flex-start;
  gap: 8px;
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.unit {
  font-size: 12px;
  color: var(--ma-muted);
}
.plot-scroll {
  overflow-x: auto;
  max-width: 100%;
}
.table-scroll {
  overflow: auto;
  max-width: 100%;
  min-height: 0;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
svg {
  display: block;
  min-width: 560px;
}
.grid line {
  stroke: var(--ma-grid);
}
.grid .zero {
  stroke: var(--ma-grid-strong);
}
.axis {
  fill: var(--ma-muted);
  font-size: 12px;
}
.series {
  stroke: var(--la-color-link);
  stroke-width: 2;
}
.point {
  fill: var(--la-color-link);
  stroke: var(--la-color-bg-primary);
  stroke-width: 2;
}
.point.selected {
  stroke: var(--la-color-text-primary);
  stroke-width: 3;
}
svg g[role='button'] {
  cursor: pointer;
}
svg g[role='button']:focus-visible {
  outline: none;
}
svg g[role='button']:focus-visible .point {
  stroke: var(--la-color-text-primary);
  stroke-width: 4;
}
svg g[role='button']:focus-visible text {
  text-decoration: underline;
}
table {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
}
th,
td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  white-space: nowrap;
}
thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--la-color-bg-primary);
  font-weight: 500;
}
th:first-child {
  text-align: left;
}
tr.selected {
  background: var(--ma-hover);
}
.bucket-patches {
  display: block;
  font-size: 12px;
  color: var(--ma-muted);
}
.plot-scroll:focus-visible,
.table-scroll:focus-visible,
td:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
@media (max-width: 640px) {
  .controls label {
    width: 160px;
  }
  .controls .metric-control {
    width: min(332px, 100%);
  }
}
</style>
