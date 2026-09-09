<template>
  <div ref="comparisonRoot" class="role-comparison-chart">
    <section class="comparison-surface" :aria-labelledby="`${id}-comparison-title`">
      <div class="comparison-heading">
        <div>
          <h2 :id="`${id}-comparison-title`">{{ roleName }}表现</h2>
          <p>同分路比较 <span class="heading-separator">/</span> {{ rows.length }} 位成员</p>
        </div>
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
      </div>
      <div class="metric-heading">
        <div>
          <h3>{{ metricInfo.label }}</h3>
          <span>{{ metricInfo.description }}</span>
        </div>
        <NSelect
          v-model:value="metric"
          aria-label="比较指标"
          :options="metricOptions"
          class="metric-select"
        />
      </div>
      <div
        v-if="rows.length"
        class="comparison-scroll"
        tabindex="0"
        aria-label="五人成员比较，可横向滚动"
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
              <div
                v-for="row in rows"
                :key="row.player"
                class="plot-column"
                role="img"
                :aria-label="`${shortName(row.player)}，${metricInfo.label} ${displayValue(valueOf(row))}，${metric === 'gd15' ? '金币，' : ''}有效 ${validCount(row)}/${row.games} 场`"
              >
                <div
                  v-if="valueOf(row) !== null"
                  class="plot-bar"
                  :class="{ negative: valueOf(row)! < 0 }"
                  :style="barStyle(valueOf(row)!)"
                  aria-hidden="true"
                />
                <div
                  class="plot-number"
                  :class="{
                    missing: valueOf(row) === null,
                    below: valueOf(row) !== null && valueOf(row)! < 0
                  }"
                  :style="{
                    top: `${valueOf(row) === null ? 50 : position(valueOf(row)!)}%`
                  }"
                >
                  <span class="compact-member-name">{{ shortName(row.player) }}</span>
                  <strong>{{ displayValue(valueOf(row)) }}</strong
                  ><span
                    >{{ validCount(row) === 0 ? '未采集 · ' : '' }}{{ validCount(row) }}/{{
                      row.games
                    }}
                    场有效</span
                  >
                </div>
              </div>
            </div>
          </div>
          <div class="member-columns">
            <article v-for="row in rows" :key="row.player" class="member-column">
              <button
                class="member-identity"
                :aria-expanded="selected === row.player"
                :aria-controls="`${id}-member-detail`"
                @click="selected = selected === row.player ? null : row.player"
              >
                <span class="member-avatar" aria-hidden="true">{{
                  memberSlots.get(row.player) ?? '—'
                }}</span
                ><span
                  ><strong>{{ shortName(row.player) }}</strong
                  ><small
                    >{{ row.games }} 场{{ roleName }} <span aria-hidden="true">↗</span></small
                  ></span
                >
              </button>
              <div class="member-result">
                <span>胜率</span><strong>{{ formatMetric(row.winRate, 'pct') }}</strong>
              </div>
              <WinRateInterval :wins="row.wins" :games="row.games" />
              <div class="result-scale" aria-hidden="true"><span>0%</span><span>100%</span></div>
              <p class="win-loss">{{ row.wins }} 胜 <span>/</span> {{ row.games - row.wins }} 负</p>
              <dl class="member-secondary">
                <div>
                  <dt>KDA</dt>
                  <dd>{{ formatMetric(row.kda, 'num') }}</dd>
                </div>
                <div>
                  <dt>参团率</dt>
                  <dd>{{ formatMetric(row.kp, 'pct') }}</dd>
                </div>
              </dl>
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
      <footer class="chart-caption">
        <span>{{ metricInfo.note }}</span
        ><span>胜率短线为 95% 区间，小样本只作参考。</span>
      </footer>
    </section>
    <section
      v-if="selectedRow"
      :id="`${id}-member-detail`"
      class="member-detail"
      :aria-labelledby="`${id}-detail-title`"
    >
      <header>
        <h3 :id="`${id}-detail-title`">{{ shortName(selectedRow.player) }} · {{ roleName }}明细</h3>
        <NButton quaternary @click="closeDetail">收起</NButton>
      </header>
      <dl>
        <div>
          <dt>15 分钟经济差</dt>
          <dd>{{ formatSigned(selectedRow.gd15, 0) }} 金币</dd>
        </div>
        <div>
          <dt>场均击杀 / 死亡 / 助攻</dt>
          <dd>
            {{ formatMetric(selectedRow.killsPG, 'num') }} /
            {{ formatMetric(selectedRow.deathsPG, 'num') }} /
            {{ formatMetric(selectedRow.assistsPG, 'num') }}
          </dd>
        </div>
        <div>
          <dt>每分钟伤害</dt>
          <dd>{{ formatMetric(selectedRow.dpm, 'num') }}</dd>
        </div>
      </dl>
    </section>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch, useId } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { aggregateRolesBySide, type RoleAggregate } from './analytics'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric } from './metric-defs'
import { formatSigned, memberOrder } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import './member-analysis-visuals.css'

const store = useMemberAnalysisStore()
const { games: games } = useMemberAnalysisData()
const id = useId()
const comparisonRoot = ref<HTMLElement | null>(null)
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
const selected = ref<string | null>(null)
const metric = ref<'gd15' | 'kp'>('gd15')
const metricOptions = [
  { label: '15 分钟经济差', value: 'gd15' },
  { label: '参团率', value: 'kp' }
]
const metricInfo = computed(() =>
  metric.value === 'gd15'
    ? {
        label: '15 分钟经济差',
        description: '相对敌方同分路 · 金币',
        note: '零线上方为领先，下方为落后。'
      }
    : {
        label: '参团率',
        description: '逐场参团率的平均值 · %',
        note: '五位成员共用 0–100% 尺度。'
      }
)
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
const memberSlots = computed(
  () =>
    new Map(
      (store.settings?.members ?? []).map((member, index) => [
        `${member.gameName}#${member.tagLine}`,
        index + 1
      ])
    )
)
const selectedRow = computed(() => rows.value.find((row) => row.player === selected.value))
watch([role, games], () => {
  selected.value = null
})
const shortName = (name: string) => name.split('#')[0]
const valueOf = (row: RoleAggregate) => row[metric.value]
const validCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const game of games.value) {
    for (const player of game.players) {
      if (
        player.role !== role.value ||
        player[metric.value] === null ||
        !Number.isFinite(player[metric.value])
      )
        continue
      counts.set(player.player, (counts.get(player.player) ?? 0) + 1)
    }
  }
  return counts
})
const validCount = (row: RoleAggregate) => validCounts.value.get(row.player) ?? 0
const extent = computed(() =>
  Math.max(
    100,
    Math.ceil(Math.max(0, ...rows.value.map((row) => Math.abs(row.gd15 ?? 0))) / 100) * 100
  )
)
const ticks = computed(() =>
  metric.value === 'gd15'
    ? [extent.value, extent.value / 2, 0, -extent.value / 2, -extent.value]
    : [1, 0.75, 0.5, 0.25, 0]
)
const position = (value: number) =>
  metric.value === 'gd15' ? 50 - (value / extent.value) * 50 : 100 - value * 100
const tickLabel = (value: number) =>
  metric.value === 'gd15' ? formatSigned(value, 0) : `${Math.round(value * 100)}%`
const displayValue = (value: number | null) =>
  metric.value === 'gd15' ? formatSigned(value, 0) : formatMetric(value, 'pct')
const barStyle = (value: number) => ({
  top: `${Math.min(position(value), position(0))}%`,
  height: `${Math.abs(position(value) - position(0))}%`
})
async function closeDetail() {
  const name = selected.value
  selected.value = null
  await nextTick()
  const buttons = comparisonRoot.value?.querySelectorAll<HTMLButtonElement>('.member-identity')
  buttons?.[rows.value.findIndex((row) => row.player === name)]?.focus()
}
</script>
<style scoped>
.role-comparison-chart {
  min-width: 0;
  font-variant-numeric: tabular-nums;
  --comparison-muted: var(--ma-muted);
}
.comparison-heading,
.metric-heading,
.role-switch {
  display: flex;
  align-items: center;
}
.comparison-surface {
  background: var(--la-card-surface-95);
  border-radius: 8px;
  padding: 16px 28px 12px;
}
.comparison-heading {
  justify-content: space-between;
  gap: 20px;
}
h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.comparison-heading p {
  margin: 6px 0 0;
  color: var(--comparison-muted);
  font-size: 12px;
}
.heading-separator {
  padding: 0 8px;
}
.role-switch {
  gap: 4px;
  flex-wrap: wrap;
}
.role-switch :deep([aria-pressed='true']) {
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.metric-heading {
  justify-content: space-between;
  gap: 20px;
  padding: 20px 0 8px;
}
h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0;
}
.metric-heading > div:first-child {
  display: flex;
  gap: 16px;
  align-items: baseline;
  flex-wrap: wrap;
}
.metric-heading span {
  font-size: 12px;
  color: var(--comparison-muted);
}
.metric-select {
  width: 180px;
  flex-shrink: 0;
}
.comparison-scroll {
  overflow-x: auto;
  padding-top: 56px;
}
.comparison-chart {
  min-width: 660px;
}
.plot {
  position: relative;
  height: 144px;
  margin: 0 0 0 48px;
}
.plot-axis {
  position: absolute;
  inset: 0;
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
  display: grid;
  grid-template-columns: repeat(var(--member-count), minmax(0, 1fr));
  height: 100%;
}
.plot-column {
  position: relative;
}
.plot-bar {
  position: absolute;
  width: 28px;
  left: calc(50% - 14px);
  background: color-mix(in srgb, var(--ma-positive) 75%, var(--la-color-text-primary));
  border-radius: 4px 4px 0 0;
}
.plot-bar.negative {
  background: color-mix(in srgb, var(--ma-negative) 75%, var(--la-color-text-primary));
  border-radius: 0 0 4px 4px;
}
.plot-number {
  position: absolute;
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
  font-size: 18px;
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
  padding-top: 56px;
}
.member-column {
  box-sizing: border-box;
  width: 100%;
  max-width: 280px;
  justify-self: center;
  display: grid;
  grid-template-rows: subgrid;
  grid-row: span 6;
  min-width: 0;
  padding: 0 20px;
}
.member-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  border-radius: 6px;
  padding: 4px;
  margin: -4px 0 16px -4px;
  cursor: pointer;
}
.member-identity:hover,
.member-identity[aria-expanded='true'] {
  background: var(--la-card-muted-surface);
}
.member-identity[aria-expanded='true'] {
  font-weight: 600;
}
.member-avatar {
  flex: 0 0 34px;
  height: 34px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--la-card-muted-surface);
  color: var(--la-color-text-primary);
  font-size: 14px;
  font-weight: 600;
}
.member-identity strong {
  display: block;
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 600;
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
  margin: 8px 0 16px;
}
.win-loss span {
  margin: 0 5px;
}
.member-secondary {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.member-secondary div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
dt {
  color: var(--comparison-muted);
  font-size: 12px;
}
dd {
  margin: 0;
  font-size: 14px;
}
.chart-caption {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
  padding-top: 12px;
  border-top: 1px solid var(--ma-grid);
  color: var(--comparison-muted);
  font-size: 12px;
}
.member-detail {
  margin-top: 16px;
  padding: 16px 24px;
  border-radius: 8px;
  background: var(--la-card-surface-95);
}
.member-detail header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.member-detail dl {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
  margin: 16px 0 0;
}
.member-detail dd {
  margin-top: 6px;
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
  .comparison-heading {
    flex-wrap: wrap;
    gap: 16px;
  }
  .metric-heading {
    padding-top: 20px;
  }
  .plot {
    height: 144px;
  }
  .member-column {
    padding: 0 12px;
  }
}
@media (max-width: 600px) {
  .comparison-heading {
    align-items: flex-start;
  }
  .metric-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
  .metric-heading > div:first-child {
    gap: 6px;
  }
}
@media (max-height: 680px) {
  .comparison-surface {
    padding-top: 12px;
  }
  .comparison-heading p {
    margin-top: 3px;
  }
  .metric-heading {
    padding-top: 12px;
  }
  .comparison-scroll {
    padding-top: 80px;
  }
  .plot {
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
