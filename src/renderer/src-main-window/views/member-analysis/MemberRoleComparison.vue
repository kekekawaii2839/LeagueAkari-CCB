<template>
  <div class="role-comparison-chart">
    <section class="comparison-surface" :aria-label="`${roleName} · ${metricInfo.label}`">
      <div class="comparison-toolbar">
        <div class="role-switch" role="group" aria-label="比较分路">
          <NButton
            v-for="(label, key) in roles"
            :key="key"
            :quaternary="role !== key"
            :secondary="role === key"
            :aria-pressed="role === key"
            @click="role = key"
            ><template #icon><PositionIcon :position="key" /></template>{{ label }}</NButton
          >
        </div>
        <span class="comparison-member-count">{{
          uiText('roleMembers', { count: rows.length })
        }}</span>
        <div class="comparison-metric-controls">
          <NSelect
            v-model:value="metric"
            aria-label="比较指标"
            :options="metricOptions"
            class="metric-select"
          />
          <div class="comparison-series-legend" aria-label="柱形分组">
            <span v-for="label in seriesLabels" :key="label" :data-series="label">{{ label }}</span>
          </div>
          <MetricHelp :label="uiText('roleMetricHelp')" :definition="metricDefinition" icon-only />
        </div>
      </div>
      <div
        v-if="rows.length"
        class="comparison-scroll"
        tabindex="0"
        aria-label="成员比较，可横向滚动查看更多成员"
      >
        <div class="comparison-chart" :style="{ '--member-count': rows.length }">
          <div class="plot">
            <div class="plot-axis" aria-hidden="true">
              <div
                v-for="tick in ticks"
                :key="tick"
                class="axis-tick"
                :class="{ 'zero-tick': tick === 0 }"
                :style="{ top: `${position(tick)}%` }"
              >
                <span>{{ tickLabel(tick) }}</span>
              </div>
            </div>
            <div class="plot-columns">
              <div v-for="row in rows" :key="row.player" class="plot-member-group">
                <div
                  v-for="series in seriesFor(row)"
                  :key="series.label"
                  class="plot-column"
                  :data-series="series.label"
                  role="img"
                  :aria-label="`${shortName(row.player)}，${series.label}，${metricInfo.label} ${displayValue(series.value)}，${series.count} 场`"
                >
                  <div
                    v-if="series.value !== null"
                    class="plot-bar"
                    :class="{ negative: series.value < 0 }"
                    :style="barStyle(series.value)"
                    aria-hidden="true"
                  />
                  <div
                    class="plot-number"
                    :class="{
                      missing: series.value === null,
                      below: series.value !== null && series.value < 0
                    }"
                    :style="{
                      top: `${series.value === null ? position(0) : position(series.value)}%`
                    }"
                  >
                    <span class="compact-member-name">{{ shortName(row.player) }}</span>
                    <strong>{{ displayValue(series.value) }}</strong>
                    <span>{{ series.count }} 场</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="member-columns">
            <article v-for="row in rows" :key="row.player" class="member-column">
              <div class="member-identity">
                <MemberProfileAvatar :icon-id="store.memberProfileIcons[row.player] ?? null" />
                <span
                  ><strong>{{ shortName(row.player) }}</strong
                  ><small>{{ row.games }} 场</small></span
                >
              </div>
              <div class="member-result">
                <span>胜率</span><strong>{{ formatMetric(row.winRate, 'pct') }}</strong>
              </div>
              <WinRateInterval :wins="row.wins" :games="row.games" />
              <div class="result-scale" aria-hidden="true"><span>0%</span><span>100%</span></div>
              <p class="win-loss">{{ row.wins }} 胜 <span>/</span> {{ row.games - row.wins }} 负</p>
            </article>
          </div>
        </div>
      </div>
      <div v-else class="comparison-empty">
        <PositionIcon :position="role" />
        <h3>暂无{{ roleName }}样本</h3>
        <p>试试切换分路，或清除当前筛选。</p>
        <NButton @click="store.resetFilters()">清除筛选</NButton>
      </div>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { aggregateRolesBySide, type RoleAggregate } from './analytics'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric, roleMetricMeta } from './metric-defs'
import type { MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { formatSigned, memberOrder } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import MemberProfileAvatar from './MemberProfileAvatar.vue'
import MetricHelp from './MetricHelp.vue'
import { uiText } from './ui-text'
import { createComparisonAxisFormatter } from './comparison-axis-format'
import './member-analysis-visuals.css'

const store = useMemberAnalysisStore()
const { games: games } = useMemberAnalysisData()
const roles = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
} as const
const role = ref<keyof typeof roles>('TOP')
watch(
  () => store.filters.matchRole,
  (value) => {
    if (value !== 'all') role.value = value
  },
  { immediate: true }
)
const roleName = computed(() => roles[role.value])
const comparableMetrics = {
  gd15: { source: 'gd15', signed: true },
  kp: { source: 'kp' },
  winRate: { source: null },
  killsPG: { source: 'kills' },
  deathsPG: { source: 'deaths' },
  assistsPG: { source: 'assists' },
  dpm: { source: 'damage', perMinute: true },
  damageShare: { source: 'damageShare' },
  gpm: { source: 'gold', perMinute: true },
  goldShare: { source: 'goldShare' },
  cspm: { source: 'cs', perMinute: true },
  vspm: { source: 'vision', perMinute: true },
  takenShare: { source: 'takenShare' },
  damageTakenPM: { source: 'damageTaken', perMinute: true },
  mitigatedPM: { source: 'damageMitigated', perMinute: true },
  healPM: { source: 'healTeammates', perMinute: true },
  shieldPM: { source: 'shieldTeammates', perMinute: true },
  ccPM: { source: 'ccSeconds', perMinute: true },
  gd10: { source: 'gd10', signed: true },
  csd15: { source: 'csd15', signed: true },
  xpd15: { source: 'xpd15', signed: true },
  damageDiff15: { source: 'damageDiff15', signed: true },
  soloDiff15: { source: 'soloDiff15', signed: true }
} satisfies Record<
  string,
  { source: keyof MemberAnalysisPlayerGame | null; signed?: boolean; perMinute?: boolean }
>
const metric = ref<keyof typeof comparableMetrics>('gd15')
const metricOptions = Object.keys(comparableMetrics).map((value) => ({
  label: roleMetricMeta[value].label,
  value
}))
const metricInfo = computed(() => roleMetricMeta[metric.value])
const metricDefinition = computed(() =>
  [
    metricInfo.value.description ?? metricInfo.value.label,
    metricInfo.value.unit ? `（${metricInfo.value.unit}）` : ''
  ]
    .filter(Boolean)
    .join(' · ')
)
const metricSpec = computed<{
  source: keyof MemberAnalysisPlayerGame | null
  signed?: boolean
  perMinute?: boolean
}>(() => comparableMetrics[metric.value])
const seriesLabels = ['合计', '蓝方', '红方'] as const
const rows = computed(() => {
  const filtered = aggregateRolesBySide(
    games.value,
    'all',
    store.filters.matchRole,
    store.filters.participant,
    false
  ).filter((row) => row.role === role.value)
  const order = memberOrder(
    filtered.map((row) => row.player),
    store.settings?.members ?? []
  )
  return filtered.sort((a, b) => order.indexOf(a.player) - order.indexOf(b.player))
})
const shortName = (name: string) => name.split('#')[0]
const breakdownRows = computed(
  () =>
    new Map(
      aggregateRolesBySide(
        games.value,
        'all',
        store.filters.matchRole,
        store.filters.participant,
        true
      )
        .filter((row) => row.role === role.value)
        .map((row) => [`${row.player}|${row.sideLabel}`, row])
    )
)
const validCounts = computed(() => {
  const counts = new Map<string, number>()
  const spec = metricSpec.value
  for (const game of games.value)
    for (const player of game.players) {
      if (player.role !== role.value) continue
      const value = spec.source === null ? Number(game.win) : player[spec.source]
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (spec.perMinute &&
          (player.minutes === null || !Number.isFinite(player.minutes) || player.minutes <= 0))
      )
        continue
      for (const label of ['合计', game.side === 'Blue' ? '蓝方' : '红方']) {
        const key = `${player.player}|${label}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  return counts
})
function seriesFor(row: RoleAggregate) {
  return seriesLabels.map((label) => {
    const source = label === '合计' ? row : breakdownRows.value.get(`${row.player}|${label}`)
    const raw = source?.[metric.value]
    return {
      label,
      value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null,
      count: validCounts.value.get(`${row.player}|${label}`) ?? 0
    }
  })
}
const percentageAxis = computed(() => {
  const observedMax = Math.max(
    0,
    ...rows.value.flatMap((row) => seriesFor(row).map((series) => series.value ?? 0))
  )
  // Percentages other than win rate use one zero-based scale for every member
  // and side. Keep some headroom and readable steps, bounded by a true 100%.
  const paddedMax = Math.min(1, Math.max(0.1, observedMax * 1.1))
  const roughStep = paddedMax / 4
  const magnitude = 10 ** Math.floor(Math.log10(roughStep))
  const step = [1, 2, 2.5, 5, 10].find((value) => value >= roughStep / magnitude)! * magnitude
  const max = Math.min(1, Number((Math.ceil(paddedMax / step - 1e-9) * step).toPrecision(12)))
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, index) =>
    Number((index * step).toPrecision(12))
  ).reverse()
  return { max, ticks }
})
const extent = computed(() => {
  if (metric.value === 'winRate') return 1
  if (metricInfo.value.fmt === 'pct') return percentageAxis.value.max
  const max = Math.max(
    1,
    ...rows.value.flatMap((row) => seriesFor(row).map((s) => Math.abs(s.value ?? 0)))
  )
  const step = 10 ** Math.floor(Math.log10(max))
  return Math.ceil(max / step) * step
})
const ticks = computed(() => {
  if (metric.value === 'winRate') return [1, 0.75, 0.5, 0.25, 0]
  if (metricInfo.value.fmt === 'pct') return percentageAxis.value.ticks
  return metricSpec.value.signed
    ? [extent.value, extent.value / 2, 0, -extent.value / 2, -extent.value]
    : [extent.value, extent.value * 0.75, extent.value / 2, extent.value * 0.25, 0]
})
const position = (value: number) =>
  metricSpec.value.signed ? 50 - (value / extent.value) * 50 : 100 - (value / extent.value) * 100
const axisFormatter = computed(() =>
  createComparisonAxisFormatter(ticks.value, metricInfo.value.fmt === 'pct')
)
const tickLabel = (value: number) => axisFormatter.value(value)
const displayValue = (value: number | null) =>
  metricSpec.value.signed
    ? formatSigned(value, Math.abs(value ?? 0) >= 100 ? 0 : 2)
    : formatMetric(value, metricInfo.value.fmt)
const barStyle = (value: number) => ({
  top: `${Math.min(position(value), position(0))}%`,
  height: `${Math.abs(position(value) - position(0))}%`
})
</script>
<style scoped>
.role-comparison-chart {
  min-width: 0;
  font-variant-numeric: tabular-nums;
  --comparison-muted: var(--ma-muted);
  --comparison-total-color: var(--la-color-link);
}
.comparison-surface {
  background: var(--la-card-surface-95);
  border-radius: 8px;
  padding: 16px 28px 12px;
}
/* Graphite's cyan accent is too close to the blue-side series. Reuse the
   existing warm series token locally, without changing the theme or side colors. */
:global(:root[data-theme-id='graphite'] .role-comparison-chart) {
  --comparison-total-color: var(--ma-series-3);
}
:global(:root[data-theme='light'] .role-comparison-chart .comparison-surface) {
  background: var(--la-card-muted-surface);
}
.comparison-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.role-switch {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.role-switch :deep([aria-pressed='true']) {
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.comparison-member-count {
  border-left: 1px solid var(--ma-grid);
  padding-left: 12px;
  color: var(--comparison-muted);
  font-size: 12px;
}
.comparison-metric-controls {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
/* The small legend uses baseline-aligned text and swatches. Match its optical
   center without moving the shared help button's hit area or other page icons. */
.comparison-metric-controls :deep(.metric-help__icon) {
  transform: translateY(-1px);
}
.metric-select {
  width: 210px;
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
@media (max-width: 900px) {
  .comparison-metric-controls {
    margin-left: 0;
  }
}
.comparison-scroll {
  overflow-x: auto;
  padding-top: 38px;
  padding-bottom: 24px;
}
.comparison-chart {
  min-width: max(660px, calc(48px + var(--member-count) * 204px));
}
.plot {
  /* Keep the compact outer footprint, but reserve measured two-line label
     clearance inside it. Axis and bars must share this exact data rectangle. */
  --plot-label-top-inset: 14px;
  --plot-label-bottom-inset: 8px;
  position: relative;
  height: 144px;
  margin: 0 0 0 48px;
}
.plot-axis {
  position: absolute;
  inset: var(--plot-label-top-inset) 0 var(--plot-label-bottom-inset);
}
.axis-tick {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px solid var(--ma-grid);
}
.axis-tick span {
  position: absolute;
  width: 44px;
  right: calc(100% + 8px);
  top: -9px;
  text-align: right;
  font-size: 12px;
  color: var(--comparison-muted);
}
.axis-tick.zero-tick {
  border-top-color: var(--ma-muted);
}
.plot-columns {
  position: absolute;
  inset: var(--plot-label-top-inset) 0 var(--plot-label-bottom-inset);
  display: grid;
  grid-template-columns: repeat(var(--member-count), minmax(0, 1fr));
}
.plot-member-group {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  padding: 0 20px;
}
.plot-member-group:not(:last-child)::after {
  content: '';
  position: absolute;
  top: calc(12px - var(--plot-label-top-inset));
  bottom: calc(12px - var(--plot-label-bottom-inset));
  right: 0;
  width: 1px;
  background: var(--ma-grid);
  pointer-events: none;
}
.comparison-series-legend {
  display: flex;
  margin-left: 8px;
  gap: 10px;
  font-size: 12px;
}
.comparison-series-legend span::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 4px;
  background: var(--comparison-series-color);
}
/* Color identifies the series, never the sign. Legend swatches and both
   positive/negative bars consume this same local mapping. */
[data-series='合计'] {
  --comparison-series-color: var(--comparison-total-color);
}
[data-series='蓝方'] {
  --comparison-series-color: var(--ma-blue);
}
[data-series='红方'] {
  --comparison-series-color: var(--ma-red);
}
.plot-column {
  position: relative;
}
.plot-bar {
  position: absolute;
  width: 28px;
  left: calc(50% - 14px);
  background: var(--comparison-series-color);
  border-radius: 4px 4px 0 0;
}
.plot-bar.negative {
  border-radius: 0 0 4px 4px;
}
.plot-number {
  position: absolute;
  line-height: 1.5;
  left: 0;
  right: 0;
  transform: translateY(calc(-100% - 10px));
  text-align: center;
}
.member-column :deep(.win-rate-interval em) {
  background: color-mix(in srgb, var(--ma-positive) 75%, var(--la-color-text-primary));
}

.plot-number.below {
  transform: translateY(8px);
}
.plot-number .compact-member-name {
  display: none;
}
.plot-number strong {
  display: block;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.plot-number span {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  color: var(--comparison-muted);
}
.member-columns {
  display: grid;
  grid-template-columns: repeat(var(--member-count), minmax(0, 1fr));
  margin-left: 48px;
  padding-top: 44px;
}
.member-column {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  justify-self: center;
  display: grid;
  grid-template-rows: subgrid;
  grid-row: span 5;
  min-width: 0;
  padding: 0 18px;
}
.member-column:not(:last-child)::after {
  content: '';
  position: absolute;
  top: 12px;
  bottom: 12px;
  right: 0;
  width: 1px;
  background: var(--ma-grid);
  pointer-events: none;
}
.member-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 0;
  margin: 0 0 16px;
  cursor: default;
}
.member-identity strong {
  display: block;
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 600;
}
.member-identity > span:last-child {
  flex: 1;
  min-width: 0;
}
.member-identity small {
  display: block;
  color: var(--comparison-muted);
  font-size: 12px;
  margin-top: 3px;
}
.member-identity small span {
  margin-left: 6px;
}
.member-result {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
  gap: 4px;
}
.member-result > span {
  font-size: 12px;
  color: var(--comparison-muted);
}
.member-result strong {
  font-size: 16px;
  font-weight: 500;
}
.result-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 12px;
  color: var(--comparison-muted);
}
.win-loss {
  font-size: 12px;
  color: var(--comparison-muted);
  margin: 8px 0 0;
}
.win-loss span {
  margin: 0 5px;
}
.comparison-empty {
  padding: 56px 16px;
  text-align: center;
}
.comparison-empty .n-icon {
  font-size: 32px;
  margin-bottom: 16px;
  color: var(--comparison-muted);
}
.comparison-empty p {
  font-size: 13px;
  color: var(--comparison-muted);
}
button:focus-visible,
summary:focus-visible,
.comparison-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 3px;
}
@media (max-width: 950px) {
  .comparison-surface {
    padding: 20px 16px 16px;
  }

  .plot {
    height: 144px;
  }
  .member-column {
    padding: 0 18px;
  }
}

@media (max-height: 680px) {
  .comparison-surface {
    padding-top: 12px;
  }

  .comparison-scroll {
    padding-top: 54px;
  }
  .plot {
    /* Short windows add the compact member-name line above each value. */
    --plot-label-top-inset: 20px;
    --plot-label-bottom-inset: 28px;
    height: 96px;
  }
  .plot-number .compact-member-name {
    display: block;
    margin: 0 0 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
@media (prefers-reduced-motion: no-preference) {
  .member-identity {
    transition: background-color 140ms ease-out;
  }
}
</style>
