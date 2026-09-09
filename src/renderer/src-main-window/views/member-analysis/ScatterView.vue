<template>
  <div ref="scatterRoot" class="ma-panel ma-workspace">
    <header class="ma-view-heading">
      <div>
        <h2>两个指标中的成员位置</h2>
      </div>
      <span
        >{{ points.length }} 个可比较成员分路<span v-if="omittedCount">
          · {{ omittedCount }} 个缺失</span
        ></span
      >
    </header>
    <div class="controls">
      <NSelect
        v-model:value="roleFilter"
        class="role-filter"
        :options="roleOptions"
        aria-label="分路范围"
      />
      <NSelect v-model:value="xMetric" :options="options" aria-label="横轴指标" /><span>对比</span
      ><NSelect v-model:value="yMetric" :options="options" aria-label="纵轴指标" />
      <div class="legend">
        <span v-for="role in roleLegend" :key="role.key" :class="`role-${role.key}`"
          >{{ role.symbol }} {{ role.label }}</span
        >
      </div>
    </div>
    <p v-if="!points.length" class="ma-empty">{{ uiText('noData') }}</p>
    <section v-else class="ma-chart scatter-wrap">
      <svg
        :viewBox="`0 0 900 ${plotHeight + 100}`"
        role="img"
        aria-labelledby="scatter-title scatter-desc"
      >
        <title id="scatter-title">成员二维指标散点图</title>
        <desc id="scatter-desc">
          所有点直接标注成员或重叠人数，点击或键盘选择后查看精确值；点内单字表示分路，横纵轴单位随所选指标更新。
        </desc>
        <g class="grid">
          <line
            v-for="tick in xTicks"
            :key="`x${tick.value}`"
            :x1="tick.pos"
            y1="35"
            :x2="tick.pos"
            :y2="35 + plotHeight"
          />
          <line
            v-for="tick in yTicks"
            :key="`y${tick.value}`"
            x1="82"
            :y1="tick.pos"
            x2="870"
            :y2="tick.pos"
          />
        </g>
        <g class="axes">
          <text
            v-for="tick in xTicks"
            :key="`xt${tick.value}`"
            :x="tick.pos"
            :y="60 + plotHeight"
            text-anchor="middle"
          >
            {{ axisFormat(tick.value, xMetric) }}
          </text>
          <text
            v-for="tick in yTicks"
            :key="`yt${tick.value}`"
            x="74"
            :y="tick.pos + 4"
            text-anchor="end"
          >
            {{ axisFormat(tick.value, yMetric) }}
          </text>
          <text x="480" :y="90 + plotHeight" text-anchor="middle">{{ label(xMetric) }}</text>
          <text
            x="18"
            :y="35 + plotHeight / 2"
            :transform="`rotate(-90 18 ${35 + plotHeight / 2})`"
            text-anchor="middle"
          >
            {{ label(yMetric) }}
          </text>
        </g>
        <g
          v-for="(group, index) in pointGroups"
          :key="index"
          class="point labelled"
          tabindex="0"
          role="button"
          :aria-label="uiText('pointDescription', { count: group.rows.length })"
          :aria-pressed="selectedIndex === index"
          @click="selectPoint(index)"
          @keydown.enter.prevent="selectPoint(index)"
          @keydown.space.prevent="selectPoint(index)"
        >
          <circle :cx="group.x" :cy="group.y" r="10" :class="`role-${group.rows[0].role}`" />
          <text class="point-symbol" :x="group.x" :y="group.y + 4" text-anchor="middle">
            {{ group.rows.length > 1 ? group.rows.length : roleSymbol[group.rows[0].role] }}
          </text>
          <text
            class="point-label"
            :x="labelX(group.x, index)"
            :y="group.y - 15"
            :text-anchor="labelAnchor(group.x, index)"
          >
            {{
              group.rows.length > 1
                ? uiText('overlap', { count: group.rows.length })
                : short(group.rows[0].player)
            }}
          </text>
        </g>
      </svg>
    </section>
    <section
      v-if="selectedGroup"
      ref="pointDetail"
      tabindex="-1"
      class="ma-selected-detail"
      aria-live="polite"
    >
      <header>
        <strong>{{ uiText('selectedPoints') }}</strong
        ><NButton size="small" quaternary @click="clearPoint">{{
          uiText('clearSelection')
        }}</NButton>
      </header>
      <ul>
        <li v-for="row in selectedGroup.rows" :key="`${row.player}|${row.role}`">
          {{ row.player }} · {{ roleName[row.role] }} · {{ label(xMetric) }}
          {{ formatMetric(row[xMetric], roleMetricMeta[xMetric].fmt) }} · {{ label(yMetric) }}
          {{ formatMetric(row[yMetric], roleMetricMeta[yMetric].fmt) }} · {{ row.games }} 场
        </li>
      </ul>
    </section>
    <div class="ma-section-title">
      <strong>{{ uiText('allValues') }}</strong>
    </div>
    <MemberAnalysisMetricTable :columns="columns" :rows="tableRows" :scroll-x="650" />
  </div>
</template>
<script setup lang="ts">
import { uiText } from './ui-text'
import { groupScatterPoints } from './visualization'
import type { DataTableColumns } from 'naive-ui'
import { NButton, NSelect } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { roleMetricMeta, formatMetric } from './metric-defs'
import MemberAnalysisMetricTable from './MemberAnalysisMetricTable.vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { finiteOrNull, scatterDomain, scatterPosition } from './visualization'
const compactHeight = useMediaQuery('(max-height: 680px)')
const plotHeight = computed(() => (compactHeight.value ? 140 : 240))
const { roles } = useMemberAnalysisData()
const metricKeys = [
  'damageConversion',
  'dpm',
  'gpm',
  'kp',
  'winRate',
  'gd15',
  'cspm',
  'vspm'
] as const
type Metric = (typeof metricKeys)[number]
const xMetric = ref<Metric>('damageConversion')
const yMetric = ref<Metric>('winRate')
const roleFilter = ref('MIDDLE')
const label = (key: Metric) => roleMetricMeta[key].label
const options = metricKeys.map((value) => ({ label: label(value), value }))
watch(xMetric, (value) => {
  if (yMetric.value === value)
    yMetric.value = metricKeys.find((candidate) => candidate !== value) ?? 'winRate'
})
watch(yMetric, (value) => {
  if (xMetric.value === value)
    xMetric.value = metricKeys.find((candidate) => candidate !== value) ?? 'damageConversion'
})
const roleOptions = [
  { label: '全部分路（探索）', value: 'ALL' },
  { label: '上路', value: 'TOP' },
  { label: '打野', value: 'JUNGLE' },
  { label: '中路', value: 'MIDDLE' },
  { label: '下路', value: 'BOTTOM' },
  { label: '辅助', value: 'UTILITY' }
]
const filteredRoles = computed(() =>
  roleFilter.value === 'ALL'
    ? roles.value
    : roles.value.filter((row) => row.role === roleFilter.value)
)
const comparableRoles = computed(() =>
  filteredRoles.value.filter(
    (row) => finiteOrNull(row[xMetric.value]) !== null && finiteOrNull(row[yMetric.value]) !== null
  )
)
const omittedCount = computed(() => filteredRoles.value.length - comparableRoles.value.length)
const xDomain = computed(() => scatterDomain(comparableRoles.value.map((x) => x[xMetric.value])))
const yDomain = computed(() => scatterDomain(comparableRoles.value.map((x) => x[yMetric.value])))
const points = computed(() => {
  const positioned = comparableRoles.value.map((row) => ({
    ...row,
    x: scatterPosition(row[xMetric.value], xDomain.value, 82, 788),
    y: scatterPosition(row[yMetric.value], yDomain.value, 35, plotHeight.value, true)
  }))
  return positioned
})
const pointGroups = computed(() => groupScatterPoints(points.value))
const selectedIndex = ref<number | null>(null)
const scatterRoot = ref<HTMLElement | null>(null)
const pointDetail = ref<HTMLElement | null>(null)
async function selectPoint(index: number) {
  if (selectedIndex.value === index) return clearPoint()
  selectedIndex.value = index
  await nextTick()
  pointDetail.value?.scrollIntoView({ block: 'nearest' })
  pointDetail.value?.focus({ preventScroll: true })
}
async function clearPoint() {
  const index = selectedIndex.value
  selectedIndex.value = null
  await nextTick()
  if (index !== null) scatterRoot.value?.querySelectorAll<SVGGElement>('.point')[index]?.focus()
}
const selectedGroup = computed(() =>
  selectedIndex.value === null ? null : pointGroups.value[selectedIndex.value]
)
watch(pointGroups, () => {
  selectedIndex.value = null
})
const labelAnchor = (x: number, index: number) =>
  x > 690 ? 'end' : x < 250 ? 'start' : index % 2 ? 'start' : 'end'
const labelX = (x: number, index: number) => x + (labelAnchor(x, index) === 'start' ? 12 : -12)
const ticks = (domain: { min: number; max: number }, start: number, size: number, invert = false) =>
  Array.from({ length: 5 }, (_, i) => {
    const value = domain.min + ((domain.max - domain.min) * i) / 4
    return { value, pos: start + ((invert ? 4 - i : i) * size) / 4 }
  })
const xTicks = computed(() => ticks(xDomain.value, 82, 788))
const yTicks = computed(() => ticks(yDomain.value, 35, plotHeight.value, true))
const axisFormat = (v: number, key: Metric) =>
  roleMetricMeta[key].fmt === 'pct'
    ? `${(v * 100).toFixed(1)}%`
    : Math.abs(v) >= 100
      ? v.toFixed(0)
      : v.toFixed(2)
const short = (s: string) => s.split('#')[0]
const roleName = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
} as const
const roleSymbol = { TOP: '上', JUNGLE: '野', MIDDLE: '中', BOTTOM: '下', UTILITY: '辅' } as const
const roleLegend = computed(() =>
  (Object.keys(roleName) as Array<keyof typeof roleName>)
    .map((key) => ({
      key,
      label: roleName[key],
      symbol: roleSymbol[key]
    }))
    .filter((role) => comparableRoles.value.some((row) => row.role === role.key))
)
const tableRows = computed(() =>
  filteredRoles.value.map((row) => ({
    player: row.player,
    role: roleName[row.role],
    games: row.games,
    x: row[xMetric.value],
    y: row[yMetric.value]
  }))
)
const columns = computed<DataTableColumns<Record<string, unknown>>>(() => [
  { title: '成员', key: 'player' },
  { title: '分路', key: 'role' },
  { title: '样本', key: 'games' },
  {
    title: label(xMetric.value),
    key: 'x',
    render: (r) => formatMetric(r.x, roleMetricMeta[xMetric.value].fmt)
  },
  {
    title: label(yMetric.value),
    key: 'y',
    render: (r) => formatMetric(r.y, roleMetricMeta[yMetric.value].fmt)
  }
])
</script>
<style scoped>
.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  overflow: auto;
}
.controls :deep(.n-select) {
  width: 180px;
  flex: none;
}
.legend {
  display: flex;
  gap: 9px;
  margin-left: auto;
  font-size: 12px;
}
.scatter-wrap {
  overflow-x: auto;
}
.scatter-wrap svg {
  min-width: 620px;
  width: 100%;
  max-width: 900px;
  height: auto;
  display: block;
  margin: 0 auto;
}
.grid line {
  stroke: var(--ma-grid);
}
.axes text,
.point text {
  fill: currentColor;
  font-size: 12px;
}
.point circle {
  fill: var(--la-card-surface-95);
  stroke: var(--ma-series-2);
  stroke-width: 2;
}
.point .point-symbol {
  fill: var(--la-color-text-primary);
  font-size: 12px;
  font-weight: 500;
  pointer-events: none;
}
.point-label {
  opacity: 0;
  paint-order: stroke;
  stroke: var(--la-card-surface-95);
  stroke-width: 3px;
  stroke-linejoin: round;
  transition: opacity 120ms ease;
}
.point.labelled .point-label,
.point:hover .point-label,
.point:focus .point-label {
  opacity: 1;
}
.point:focus {
  outline: none;
}
.point circle.role-JUNGLE,
.legend .role-JUNGLE {
  stroke: var(--ma-series-1);
  color: var(--ma-series-1);
}
.point circle.role-MIDDLE,
.legend .role-MIDDLE {
  stroke: var(--ma-series-3);
  color: var(--ma-series-3);
}
.point circle.role-BOTTOM,
.legend .role-BOTTOM {
  stroke: var(--ma-series-4);
  color: var(--ma-series-4);
}
.point circle.role-UTILITY,
.legend .role-UTILITY {
  stroke: var(--ma-series-6);
  color: var(--ma-series-6);
}
.legend .role-TOP {
  color: var(--ma-series-2);
}
.point:focus circle,
.point:hover circle {
  stroke: var(--la-color-link);
  stroke-width: 4;
}
@media (max-width: 940px) {
  .controls {
    display: grid;
    grid-template-columns: 1fr 1fr;
    overflow: visible;
  }
  .controls :deep(.n-select) {
    width: 100%;
  }
  .controls > span {
    display: flex;
  }
  .role-filter {
    grid-column: 1 / -1;
  }
  .legend {
    display: flex;
  }
  .scatter-wrap svg {
    min-width: 620px;
  }
}
.controls {
  flex-wrap: wrap;
  gap: 12px;
}
.scatter-wrap {
  padding: 12px 0;
}
@media (max-width: 940px) {
  .controls {
    display: flex;
  }
  .controls :deep(.n-select) {
    flex: 1 1 180px;
    width: auto;
  }
  .controls .role-filter {
    flex: 0 1 130px;
  }
  .legend {
    flex-basis: 100%;
  }
}
.axes text,
.point text {
  font-size: 15px;
}
@media (max-height: 680px) {
  .scatter-wrap {
    padding: 0;
  }
}
</style>
