<template>
  <div ref="scatterRoot" class="ma-panel ma-workspace scatter-workspace">
    <div class="controls ma-view-toolbar">
      <div class="mode-toggle">
        <NSwitch v-model:value="matchMode" aria-label="每场散点模式" />
        <span>{{ matchMode ? '每场散点' : '成员汇总' }}</span>
      </div>
      <NSelect
        v-model:value="roleFilter"
        class="role-filter"
        :options="matchMode ? roleOptions.filter((r) => r.value !== 'ALL') : roleOptions"
        aria-label="分路范围"
      />
      <NSelect v-model:value="xMetric" :options="options" filterable aria-label="横轴指标" /><span
        >对比</span
      ><NSelect v-model:value="yMetric" :options="options" filterable aria-label="纵轴指标" />
      <span class="ma-view-meta"
        >{{ points.length }} {{ matchMode ? '条有效记录' : '个成员分路'
        }}<template v-if="matchMode"> / {{ matchCount }} 场</template
        ><template v-if="omittedCount"> · 缺失 {{ omittedCount }} 条</template></span
      >
      <div class="legend">
        <span v-for="role in roleLegend" :key="role.key" :class="`role-${role.key}`"
          >{{ role.symbol }} {{ role.label }}</span
        >
      </div>
    </div>
    <div v-if="matchMode" class="member-controls">
      <NCheckbox v-model:checked="perMember">每位成员单独拟合</NCheckbox>
      <div class="member-visibility" role="group" aria-label="当前分路显示成员">
        <span>显示成员：</span>
        <NCheckbox
          v-for="player in roleMembers"
          :key="player"
          :checked="!hiddenMembers.includes(player)"
          @update:checked="setMemberVisible(player, $event)"
        >
          <span
            class="member-swatch"
            :style="{ background: memberColor(player) }"
            aria-hidden="true"
          />{{ memberStyle(player).number }}. {{ player }}
        </NCheckbox>
      </div>
    </div>
    <p v-if="!points.length" class="ma-empty">{{ uiText('noData') }}</p>
    <section v-else class="ma-chart scatter-wrap">
      <svg
        :viewBox="`0 0 900 ${plotHeight + 100}`"
        role="img"
        aria-labelledby="scatter-title scatter-desc"
      >
        <title id="scatter-title">
          {{
            matchMode
              ? binaryOutcome
                ? '逐场散点与 Logistic 二元结果概率曲线'
                : '逐场散点与线性拟合'
              : '成员二维指标散点图'
          }}
        </title>
        <desc id="scatter-desc">
          点击或键盘选择点查看成员、精确值及逐场模式下的对局；相同坐标合并并显示记录数量，不移动数据点。连续指标使用线性拟合，0/1
          指标使用 Logistic 概率曲线。
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
            {{ binaryOutcome ? `${label(yMetric)} / 概率（%）` : label(yMetric) }}
          </text>
        </g>
        <path
          v-for="model in modelPaths"
          :key="model.player"
          :d="model.path"
          :class="binaryOutcome ? 'logistic-curve' : 'fit-line'"
          :style="{
            stroke: model.color,
            strokeDasharray: model.dash || (binaryOutcome ? 'none' : '8 5')
          }"
          clip-path="url(#scatter-plot-clip)"
        />
        <defs>
          <clipPath id="scatter-plot-clip">
            <rect x="82" y="35" width="788" :height="plotHeight" />
          </clipPath>
        </defs>
        <g
          v-for="(group, index) in pointGroups"
          :key="index"
          :class="[
            'point',
            { labelled: !matchMode || selectedIndex === index, 'match-point': matchMode }
          ]"
          tabindex="0"
          role="button"
          :aria-label="`${group.rows.length} 条记录，${group.rows[0].player}，${label(xMetric)} ${formatMetric(group.rows[0][xMetric], roleMetricMeta[xMetric].fmt)}，${label(yMetric)} ${formatMetric(group.rows[0][yMetric], roleMetricMeta[yMetric].fmt)}，选择查看详情`"
          :aria-pressed="selectedIndex === index"
          @click="selectPoint(index, $event)"
          @keydown.enter.prevent="selectPoint(index, $event)"
          @keydown.space.prevent="selectPoint(index, $event)"
        >
          <circle
            v-for="(player, colorIndex) in pointMembers(group.rows)"
            v-if="matchMode"
            :key="player"
            :cx="group.x"
            :cy="group.y"
            r="8"
            :style="{ stroke: memberColor(player) }"
            :stroke-dasharray="`${50.265 / pointMembers(group.rows).length} ${50.265 - 50.265 / pointMembers(group.rows).length}`"
            :stroke-dashoffset="(-50.265 * colorIndex) / pointMembers(group.rows).length"
          />
          <circle
            v-else
            :cx="group.x"
            :cy="group.y"
            :r="matchMode ? 6 : 10"
            :class="`role-${group.rows[0].role}`"
          />
          <text
            v-if="!matchMode || group.rows.length > 1"
            class="point-symbol"
            :x="group.x"
            :y="group.y + 4"
            text-anchor="middle"
          >
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
                ? matchMode
                  ? `${group.rows.length} 条重叠`
                  : uiText('overlap', { count: group.rows.length })
                : short(group.rows[0].player)
            }}
          </text>
        </g>
      </svg>
    </section>
    <ul
      v-if="matchMode && models.length"
      class="model-summary"
      aria-label="回归结果"
      aria-live="polite"
    >
      <li v-for="model in models" :key="model.player">
        <span class="member-swatch" :style="{ background: model.color }" aria-hidden="true" />
        <strong>{{ model.player }}</strong> · 有效 {{ model.n }} 条 / 缺失 {{ model.missing }} 条
        <template v-if="model.logistic?.status === 'available'">
          · {{ model.logistic.wins }} {{ yMetric === 'winRate' ? '胜' : '是' }} /
          {{ model.logistic.losses }} {{ yMetric === 'winRate' ? '负' : '否' }} · McFadden 伪 R² =
          {{ model.logistic.pseudoRSquared.toFixed(3) }}</template
        >
        <template v-else-if="model.logistic?.status === 'unavailable'">
          · 无法拟合：{{ model.logistic.reason }}</template
        >
        <template v-else-if="model.linear">
          · Pearson r =
          {{ model.linear.r === null ? '—（纵轴恒定）' : model.linear.r.toFixed(3) }} · R² =
          {{ model.linear.rSquared === null ? '—' : model.linear.rSquared.toFixed(3) }}</template
        >
        <template v-else> · 无法拟合：至少需要 2 个有效观测且横轴不能恒定</template>
        <span v-if="model.n < 10"> · 样本较少</span>
      </li>
    </ul>
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
        <li
          v-for="row in selectedGroup.rows"
          :key="`${row.player}|${row.role}|${row.gameId ?? 'aggregate'}`"
        >
          {{ row.player }} · {{ roleName[row.role] }}
          <template v-if="matchMode"
            >· {{ row.date }} · 对局 {{ row.gameId }} · {{ row.champion }} ·
            {{ row.result }}</template
          >
          · {{ label(xMetric) }} {{ displayValue(row[xMetric], xMetric) }} · {{ label(yMetric) }}
          {{ displayValue(row[yMetric], yMetric) }}
          <NButton
            v-if="row.gameId !== null"
            size="small"
            quaternary
            :aria-expanded="selectedGameId === row.gameId"
            :aria-controls="matchDetailId"
            @click="toggleMatch(row.gameId, $event)"
            >{{ selectedGameId === row.gameId ? '收起对局' : '查看对局' }}</NButton
          >
        </li>
      </ul>
    </section>
    <section
      v-if="selectedGameId !== null"
      :id="matchDetailId"
      ref="matchDetail"
      tabindex="-1"
      class="ma-selected-detail"
      :aria-label="`对局 ${selectedGameId} 详情`"
      @keydown.esc.prevent.stop="closeMatch"
    >
      <header>
        <strong>对局 #{{ selectedGameId }}</strong>
        <NButton size="small" quaternary @click="closeMatch">收起对局</NButton>
      </header>
      <MatchNativeDetails :key="selectedGameId" :game-id="selectedGameId" />
    </section>
    <details class="scatter-values">
      <summary>查看全部精确值（{{ tableRows.length }} 条）</summary>
      <MemberAnalysisMetricTable
        :columns="columns"
        :rows="tableRows"
        :row-key="tableRowKey"
        :row-class-name="
          (row: Record<string, unknown>) => (isSelectedRow(row) ? 'scatter-selected-row' : '')
        "
        :scroll-x="650"
      />
    </details>
  </div>
</template>
<script setup lang="ts">
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import {
  regressScatterGroups,
  matchScatterRows,
  scatterMetricKeys,
  type ScatterMetric
} from './scatter-analysis'
import { binaryPerformanceMetrics } from '@shared/shards/member-analysis/performance-metrics'
import { scatterMemberStyle } from './scatter-member-style'
import { uiText } from './ui-text'
import { groupScatterPoints } from './visualization'
import type { DataTableColumns } from 'naive-ui'
import { NButton, NCheckbox, NSelect, NSwitch } from 'naive-ui'
import { computed, h, nextTick, ref, toRefs, useId, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { roleMetricMeta, formatMetric } from './metric-defs'
import MemberAnalysisMetricTable from './MemberAnalysisMetricTable.vue'
import MatchNativeDetails from './MatchNativeDetails.vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { finiteOrNull, scatterDomain, scatterPosition } from './visualization'
const compactHeight = useMediaQuery('(max-height: 680px)')
const plotHeight = computed(() => (compactHeight.value ? 140 : 240))
const { roles, games } = useMemberAnalysisData()
const store = useMemberAnalysisStore()
const { matchMode, perMember, xMetric, yMetric, roleFilter } = toRefs(store.scatterViewState)
const metricKeys = scatterMetricKeys
type Metric = ScatterMetric
const isBinary = (key: Metric) => binaryPerformanceMetrics.includes(key)
const label = (key: Metric) => {
  if (matchMode.value && key === 'winRate') return '单局胜负（胜 1 / 负 0）'
  if (matchMode.value && isBinary(key))
    return `${roleMetricMeta[key].label.replace('率', '')}（是 1 / 否 0）`
  return (
    (
      {
        dpm: '分均英雄伤害（伤害/分钟）',
        gpm: '分均经济（金币/分钟）',
        cspm: '分均补刀（刀/分钟）',
        vspm: '分均视野（分/分钟）'
      } as Partial<Record<Metric, string>>
    )[key] ?? roleMetricMeta[key].label
  )
}
const options = computed(() => metricKeys.map((value) => ({ label: label(value), value })))
watch(matchMode, (enabled) => {
  if (enabled && roleFilter.value === 'ALL') roleFilter.value = 'MIDDLE'
  if (enabled && isBinary(xMetric.value) && !isBinary(yMetric.value)) {
    const binary = xMetric.value
    xMetric.value = yMetric.value
    yMetric.value = binary
  }
})
watch(xMetric, (value) => {
  if (matchMode.value && isBinary(value) && !isBinary(yMetric.value)) {
    xMetric.value = yMetric.value
    yMetric.value = value
    return
  }
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
const roleObservations = computed(() =>
  matchMode.value
    ? matchScatterRows(
        games.value,
        roleFilter.value,
        store.filters.participant,
        store.filters.champion
      ).filter((row) => store.filters.matchRole === 'all' || row.role === store.filters.matchRole)
    : filteredRoles.value.map((row) => ({
        ...row,
        gameId: null,
        date: '',
        champion: '',
        result: ''
      }))
)
const hiddenMembers = computed(
  () => store.scatterViewState.hiddenMembersByRole[roleFilter.value] ?? []
)
const allMembers = computed(() => {
  const configured = store.settings?.members.map((m) => `${m.gameName}#${m.tagLine}`) ?? []
  const other = [
    ...new Set((store.overview?.games ?? []).flatMap((g) => g.players.map((p) => p.player)))
  ]
    .filter((p) => !configured.includes(p))
    .sort()
  return [...configured, ...other]
})
const roleMembers = computed(() =>
  allMembers.value.filter((player) => roleObservations.value.some((row) => row.player === player))
)
const memberStyle = (player: string) => scatterMemberStyle(allMembers.value.indexOf(player))
const memberColor = (player: string) => memberStyle(player).color
const pointMembers = (rows: { player: string }[]) =>
  [...new Set(rows.map((row) => row.player))].sort(
    (a, b) => allMembers.value.indexOf(a) - allMembers.value.indexOf(b)
  )
function setMemberVisible(player: string, visible: boolean) {
  store.scatterViewState.hiddenMembersByRole[roleFilter.value] = visible
    ? hiddenMembers.value.filter((p) => p !== player)
    : [...new Set([...hiddenMembers.value, player])]
}
const observations = computed(() =>
  matchMode.value
    ? roleObservations.value.filter((row) => !hiddenMembers.value.includes(row.player))
    : roleObservations.value
)
const comparableRoles = computed(() =>
  observations.value.filter(
    (row) => finiteOrNull(row[xMetric.value]) !== null && finiteOrNull(row[yMetric.value]) !== null
  )
)
const omittedCount = computed(() => observations.value.length - comparableRoles.value.length)
const xDomain = computed(() => scatterDomain(comparableRoles.value.map((x) => x[xMetric.value])))
const binaryOutcome = computed(() => matchMode.value && isBinary(yMetric.value))
const yDomain = computed(() =>
  binaryOutcome.value
    ? { min: 0, max: 1 }
    : scatterDomain(comparableRoles.value.map((x) => x[yMetric.value]))
)
const points = computed(() => {
  const positioned = comparableRoles.value.map((row) => ({
    ...row,
    x: scatterPosition(row[xMetric.value], xDomain.value, 82, 788),
    y: scatterPosition(row[yMetric.value], yDomain.value, 35, plotHeight.value, true)
  }))
  return positioned
})
const matchCount = computed(() => new Set(comparableRoles.value.map((row) => row.gameId)).size)
const models = computed(() =>
  matchMode.value
    ? regressScatterGroups(
        observations.value.map((row) => ({
          player: row.player,
          x: finiteOrNull(row[xMetric.value]) ?? NaN,
          y: finiteOrNull(row[yMetric.value]) ?? NaN
        })),
        perMember.value,
        binaryOutcome.value
      ).map((model) => ({
        ...model,
        color: perMember.value ? memberColor(model.player) : 'var(--la-color-link)',
        dash: perMember.value ? memberStyle(model.player).dash : ''
      }))
    : []
)
const modelPaths = computed(() =>
  models.value.flatMap((model) => {
    const f = model.logistic?.status === 'available' ? model.logistic : model.linear
    if (!f) return []
    const path = Array.from({ length: 81 }, (_, i) => {
      const x = f.minX + ((f.maxX - f.minX) * i) / 80
      const y = 'predict' in f ? f.predict(x) : f.intercept + f.slope * x
      return `${i === 0 ? 'M' : 'L'} ${scatterPosition(x, xDomain.value, 82, 788)} ${scatterPosition(y, yDomain.value, 35, plotHeight.value, true)}`
    }).join(' ')
    return [{ player: model.player, color: model.color, dash: model.dash, path }]
  })
)
const pointGroups = computed(() => groupScatterPoints(points.value))
const selectedIndex = ref<number | null>(null)
const scatterRoot = ref<HTMLElement | null>(null)
const pointDetail = ref<HTMLElement | null>(null)
let selectionTrigger: HTMLElement | SVGElement | null = null
const selectedGameId = ref<number | null>(null)
const matchDetail = ref<HTMLElement | null>(null)
const matchDetailId = useId()
let matchTrigger: HTMLElement | null = null
async function toggleMatch(gameId: number, event: MouseEvent) {
  if (selectedGameId.value === gameId) return closeMatch()
  matchTrigger = event.currentTarget as HTMLElement
  selectedGameId.value = gameId
  await nextTick()
  matchDetail.value?.scrollIntoView({ block: 'nearest' })
  matchDetail.value?.focus({ preventScroll: true })
}
async function closeMatch() {
  selectedGameId.value = null
  await nextTick()
  if (matchTrigger?.isConnected) matchTrigger.focus({ preventScroll: true })
}
async function selectPoint(index: number, event: Event) {
  if (selectedIndex.value === index) return clearPoint()
  selectionTrigger = event.currentTarget as SVGElement
  selectedGameId.value = null
  selectedIndex.value = index
  await nextTick()
  pointDetail.value?.scrollIntoView({ block: 'nearest' })
  pointDetail.value?.focus({ preventScroll: true })
}
async function clearPoint() {
  const index = selectedIndex.value
  selectedIndex.value = null
  selectedGameId.value = null
  await nextTick()
  const disclosure = selectionTrigger?.closest('details')
  if (disclosure && !disclosure.open)
    disclosure.querySelector('summary')?.focus({ preventScroll: true })
  else if (selectionTrigger?.isConnected) selectionTrigger.focus({ preventScroll: true })
  else if (index !== null)
    scatterRoot.value?.querySelectorAll<SVGGElement>('.point')[index]?.focus()
}
const selectedGroup = computed(() =>
  selectedIndex.value === null ? null : pointGroups.value[selectedIndex.value]
)
watch(pointGroups, () => {
  selectedIndex.value = null
  selectedGameId.value = null
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
  matchMode.value && isBinary(key)
    ? `${(v * 100).toFixed(0)}%`
    : roleMetricMeta[key].fmt === 'pct'
      ? `${(v * 100).toFixed(1)}%`
      : Math.abs(v) >= 100
        ? v.toFixed(0)
        : v.toFixed(2)
const displayValue = (value: unknown, key: Metric) =>
  formatMetric(value, matchMode.value && isBinary(key) ? 'int' : roleMetricMeta[key].fmt)
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
  observations.value.map((row) => ({
    roleKey: row.role,
    gameId: row.gameId,
    date: row.date,
    champion: row.champion,
    result: row.result,
    player: row.player,
    role: roleName[row.role],
    games: row.games,
    x: row[xMetric.value],
    y: row[yMetric.value]
  }))
)
const tableRowKey = (row: Record<string, unknown>) =>
  JSON.stringify([row.player, row.roleKey ?? row.role, row.gameId])
const isSelectedRow = (row: Record<string, unknown>) =>
  selectedGroup.value?.rows.some((point) => tableRowKey(point) === tableRowKey(row)) ?? false
function selectTableRow(row: Record<string, unknown>, event: MouseEvent) {
  const index = pointGroups.value.findIndex((group) =>
    group.rows.some((point) => tableRowKey(point) === tableRowKey(row))
  )
  if (index < 0) return
  selectionTrigger = event.currentTarget as HTMLElement
  selectedIndex.value = selectedIndex.value === index ? null : index
  selectedGameId.value = null
}
const columns = computed<DataTableColumns<Record<string, unknown>>>(() => [
  {
    title: '成员',
    key: 'player',
    render: (row) => {
      const available = finiteOrNull(row.x) !== null && finiteOrNull(row.y) !== null
      return available
        ? h(
            NButton,
            {
              size: 'small',
              quaternary: true,
              class: 'scatter-member-control',
              themeOverrides: {
                textColor: 'var(--la-color-text-primary)',
                textColorHover: 'var(--la-color-text-primary)',
                textColorPressed: 'var(--la-color-text-primary)',
                textColorFocus: 'var(--la-color-text-primary)'
              },
              'aria-pressed': isSelectedRow(row),
              'aria-label': `${row.player}，${row.role}${row.gameId === null ? '' : `，对局 ${row.gameId}`}，${isSelectedRow(row) ? '取消选择' : '选择对应散点'}`,
              onClick: (event: MouseEvent) => selectTableRow(row, event)
            },
            { default: () => `${row.player}${isSelectedRow(row) ? ' · 已选' : ''}` }
          )
        : String(row.player)
    }
  },
  { title: '分路', key: 'role' },
  ...(matchMode.value
    ? [
        { title: '对局', key: 'gameId' },
        { title: '日期', key: 'date' },
        { title: '英雄', key: 'champion' },
        { title: '结果', key: 'result' }
      ]
    : [{ title: '样本', key: 'games' }]),
  {
    title: label(xMetric.value),
    key: 'x',
    render: (r) => displayValue(r.x, xMetric.value)
  },
  {
    title: label(yMetric.value),
    key: 'y',
    render: (r) => displayValue(r.y, yMetric.value)
  }
])
</script>
<style scoped>
.ma-workspace {
  color-scheme: light;
}
.scatter-values summary {
  box-sizing: border-box;
  min-height: 32px;
  padding: 6px 0;
  font-family: inherit;
  font-size: 14px;
  line-height: 20px;
  color: var(--la-color-text-primary);
  background: transparent;
  border: 0;
  cursor: pointer;
}
.scatter-values summary:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
  border-radius: 4px;
}
.scatter-values :deep(.scatter-member-control) {
  color: var(--la-color-text-primary);
}
.scatter-values :deep(.scatter-selected-row .n-data-table-td) {
  background: var(--ma-hover);
  box-shadow:
    inset 0 1px var(--ma-grid-strong),
    inset 0 -1px var(--ma-grid-strong);
}
:global([data-theme='dark'] .scatter-workspace) {
  color-scheme: dark;
}
.member-controls,
.member-visibility {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  font-size: 14px;
}
.member-visibility {
  flex: 1 1 100%;
}
.member-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 6px;
  border: 1px solid currentColor;
}
.model-summary {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
}
.model-summary strong {
  font-weight: 500;
}
.match-point circle {
  fill: none;
}
.mode-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  flex: none;
  font-size: 14px;
}
.logistic-curve {
  fill: none;
  stroke: var(--la-color-link);
  stroke-width: 2.5;
}
.fit-line {
  fill: none;
  stroke: var(--la-color-link);
  stroke-width: 2;
  stroke-dasharray: 8 5;
}

.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.controls :deep(.n-select) {
  width: 280px;
  flex: none;
}
.controls :deep(.role-filter) {
  width: 130px;
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
    flex: 1 1 280px;
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
