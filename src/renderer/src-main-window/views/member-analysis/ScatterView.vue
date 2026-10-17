<template>
  <div
    ref="scatterRoot"
    class="ma-panel ma-workspace scatter-workspace"
    :style="{ '--scatter-match-neutral': themeMemberNeutral }"
    :class="{ 'short-fallback': shortFallback }"
  >
    <div class="controls ma-view-toolbar">
      <div class="mode-toggle">
        <NSwitch v-model:value="matchMode" aria-label="每场散点模式" />
        <span>{{ matchMode ? '每场散点' : '成员汇总' }}</span>
      </div>
      <NSelect
        v-model:value="roleFilter"
        class="role-filter"
        :options="matchMode ? roleOptions.filter((r) => r.value !== 'ALL') : roleOptions"
        :render-label="renderRoleSelectLabel"
        aria-label="分路范围"
      />
      <NSelect v-model:value="xMetric" :options="options" filterable aria-label="横轴指标" /><span
        >对比</span
      ><NSelect v-model:value="yMetric" :options="options" filterable aria-label="纵轴指标" />
      <div v-if="!matchMode" class="summary-minimum-control">
        <label for="scatter-summary-minimum">成员分路最小场次</label>
        <NInputNumber
          :value="summaryMinimumGames"
          :min="0"
          :precision="0"
          :step="1"
          :input-props="{
            id: 'scatter-summary-minimum',
            'aria-describedby': 'scatter-summary-minimum-help'
          }"
          aria-label="成员分路最小场次"
          @update:value="summaryMinimumGames = normalizeSummaryMinimumGames($event)"
        />
        <span id="scatter-summary-minimum-help" class="scatter-zoom-help"
          >按当前样本中该成员该分路的实际场次筛选，不是指标非缺失观测数；不修改全局样本或原统计。</span
        >
        <span v-if="summaryMinimumGames > 0" class="summary-minimum-status" role="status"
          >已隐藏 {{ summarySample.hidden }} 个成员分路</span
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
          :aria-label="`${memberStyle(player).number}. ${player}`"
          @update:checked="setMemberVisible(player, $event)"
        >
          <span
            class="member-swatch"
            :style="{ background: memberColor(player) }"
            aria-hidden="true"
          /><span class="member-visible-name" :title="player"
            >{{ memberStyle(player).number }}. {{ short(player) }}</span
          >
        </NCheckbox>
      </div>
    </div>
    <p v-if="!points.length" class="ma-empty">
      {{ uiText('noData') }}<span v-if="omittedCount"> · 缺失 {{ omittedCount }} 条</span>
    </p>
    <div v-else class="scatter-visual-region" :style="{ height: `${canvasHeight}px` }">
      <section ref="chartRegion" class="ma-chart scatter-wrap">
        <div
          v-if="!matchMode"
          class="scatter-zoom-controls"
          role="group"
          aria-label="成员汇总视域缩放"
          @keydown="zoomKeydown"
        >
          <NButton
            size="tiny"
            quaternary
            :type="zoomSelecting ? 'primary' : 'default'"
            :aria-pressed="zoomSelecting"
            aria-describedby="scatter-zoom-help"
            @click="zoomSelecting = !zoomSelecting"
            >{{ zoomSelecting ? '取消框选' : '框选缩放' }}</NButton
          >
          <NButton size="tiny" quaternary aria-label="放大当前视域" @click="changeZoom(0.5)"
            >放大</NButton
          >
          <NButton size="tiny" quaternary :disabled="!zoomed" @click="changeZoom(2)">缩小</NButton>
          <NButton size="tiny" quaternary :disabled="!zoomed" @click="resetZoom">恢复全图</NButton>
          <span v-if="zoomed" class="scatter-zoom-status" role="status">已缩放</span>
          <span id="scatter-zoom-help" class="scatter-zoom-help"
            >开启后在图内空白处拖框。此组控件聚焦时可用加减号缩放、方向键平移，Escape取消框选。缩放不改变统计或精确表。</span
          >
        </div>
        <span v-if="matchMode || omittedCount" class="scatter-chart-meta ma-view-meta">
          <template v-if="matchMode"
            >共 <span class="scatter-meta-value">{{ matchCount }}</span> 场</template
          >
          <template v-if="omittedCount"
            ><template v-if="matchMode"> · </template>缺失 {{ omittedCount }} 条</template
          >
        </span>
        <svg
          v-if="geometryReady"
          v-memo="[
            pointGroups,
            pointLabels,
            activeMatchLabel,
            selectedIndex,
            modelPaths,
            canvasWidth,
            drawingHeight,
            xMetric,
            yMetric,
            matchMode,
            allMembers,
            zoomSelecting,
            zoomDrag,
            winRateReferenceY,
            zeroReferenceX,
            zeroReferenceY,
            zeroLabels,
            yAxisDisplay
          ]"
          :viewBox="`0 0 ${canvasWidth} ${plotHeight + 100}`"
          role="img"
          aria-labelledby="scatter-title scatter-desc"
          @pointerover="showPointerLabel"
          @pointerleave="hoveredPoint = null"
          @focusin="showFocusLabel"
          @focusout="focusedPoint = null"
          :class="{ 'zoom-selecting': !matchMode && zoomSelecting }"
          @pointerdown="startZoomDrag"
          @pointermove="moveZoomDrag"
          @pointerup="finishZoomDrag"
          @pointercancel="cancelZoomDrag"
          @lostpointercapture="cancelZoomDrag"
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
            点击或键盘选择点，高亮精确值表中的对应记录；相同坐标合并并显示记录数量，不移动数据点。连续指标使用线性拟合，0/1
            指标使用 Logistic 概率曲线。
            <template v-if="winRateReferenceY !== null">水平虚线表示50%胜率参考值。</template>
            <template v-if="zeroReferenceX !== null || zeroReferenceY !== null">
              差值指标的零参考虚线表示持平，不改变当前数据范围。
            </template>
            <template v-if="yAxisDisplay.status === 'compact'">
              纵轴刻度以共同倍率显示并适当舍入，未缩放刻度值见刻度提示，精确值表保持原单位与精度。
            </template>
          </desc>
          <g class="grid">
            <line
              v-for="tick in xGridTicks"
              :key="`x${tick.value}`"
              :x1="tick.pos"
              y1="35"
              :x2="tick.pos"
              :y2="35 + plotHeight"
            />
            <line
              v-for="tick in yGridTicks"
              :key="`y${tick.value}`"
              x1="82"
              :y1="tick.pos"
              :x2="82 + plotWidth"
              :y2="tick.pos"
            />
          </g>
          <g
            v-if="winRateReferenceY !== null"
            class="win-rate-reference"
            clip-path="url(#scatter-plot-clip)"
            aria-hidden="true"
            data-reference-value="0.5"
          >
            <line x1="82" :y1="winRateReferenceY" :x2="82 + plotWidth" :y2="winRateReferenceY" />
            <text
              :x="82 + plotWidth - 4"
              :y="Math.max(47, winRateReferenceY - 5)"
              text-anchor="end"
            >
              50%
            </text>
          </g>
          <g
            v-if="zeroReferenceX !== null || zeroReferenceY !== null"
            class="win-rate-reference"
            clip-path="url(#scatter-plot-clip)"
            aria-hidden="true"
          >
            <line
              v-if="zeroReferenceX !== null"
              data-reference-axis="x"
              data-reference-value="0"
              :x1="zeroReferenceX"
              y1="35"
              :x2="zeroReferenceX"
              :y2="35 + plotHeight"
            />
            <line
              v-if="zeroReferenceY !== null"
              data-reference-axis="y"
              data-reference-value="0"
              x1="82"
              :y1="zeroReferenceY"
              :x2="82 + plotWidth"
              :y2="zeroReferenceY"
            />
            <text
              v-for="item in zeroLabels"
              :key="item.axis"
              :x="item.x"
              :y="item.y"
              :text-anchor="item.anchor"
            >
              0
            </text>
          </g>
          <g class="axes">
            <text
              v-for="(tick, index) in xTicks"
              :key="`xt${tick.value}`"
              :x="tick.pos"
              :y="60 + plotHeight"
              :text-anchor="index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'"
              class="axis-tick axis-tick-x"
            >
              <title>{{ axisTickTitle(tick.value, xMetric) }}</title>
              {{ axisFormat(tick.value, xMetric, 'x') }}
            </text>
            <text
              v-for="tick in yTicks"
              :key="`yt${tick.value}`"
              x="66"
              :y="tick.pos + 4"
              text-anchor="end"
              class="axis-tick axis-tick-y"
            >
              <title>{{ axisTickTitle(tick.value, yMetric) }}</title>
              {{ axisFormat(tick.value, yMetric, 'y') }}
            </text>
            <text
              :x="82 + plotWidth / 2"
              :y="90 + plotHeight"
              text-anchor="middle"
              class="axis-title"
            >
              {{ label(xMetric) }}
            </text>
            <text
              x="18"
              :y="35 + plotHeight / 2"
              :transform="`rotate(-90 18 ${35 + plotHeight / 2})`"
              text-anchor="middle"
              class="axis-title"
            >
              {{ yAxisDisplay.status === 'compact' ? yAxisDisplay.title : yAxisTitle }}
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
              <rect x="82" y="35" :width="plotWidth" :height="plotHeight" />
            </clipPath>
          </defs>
          <component
            :is="singleMatchPoint(group) ? 'circle' : 'g'"
            v-for="(group, index) in pointGroups"
            :key="pointKeys[index]"
            v-memo="[
              group,
              selectedIndex === index,
              matchMode,
              xMetric,
              yMetric,
              allMembers,
              matchMode || groupVisible(group),
              matchMode ? null : pointLabels
            ]"
            :cx="singleMatchPoint(group) ? group.x : undefined"
            :cy="singleMatchPoint(group) ? group.y : undefined"
            :r="singleMatchPoint(group) ? 8 : undefined"
            :style="
              singleMatchPoint(group) ? { stroke: memberColor(group.rows[0].player) } : undefined
            "
            :data-scatter-point="index"
            :class="[
              'point',
              {
                labelled: !matchMode,
                'match-point': matchMode
              }
            ]"
            :display="matchMode || groupVisible(group) ? undefined : 'none'"
            :tabindex="matchMode || groupVisible(group) ? 0 : -1"
            :aria-hidden="matchMode || groupVisible(group) ? undefined : true"
            role="button"
            :aria-label="`${group.rows.length} 条记录，${pointCopies[group.rows[0].copyIndex].aria}，选择高亮对应精确值行`"
            :aria-pressed="selectedIndex === index"
            @click="selectPoint(index)"
            @keydown.enter.prevent="selectPoint(index)"
            @keydown.space.prevent="selectPoint(index)"
          >
            <title>{{ pointDescription(group.rows) }}</title>
            <circle
              v-for="(player, colorIndex) in pointMembers(group.rows)"
              v-if="matchMode && !singleMatchPoint(group)"
              :key="player"
              :cx="group.x"
              :cy="group.y"
              r="8"
              :style="{ stroke: memberColor(player) }"
              :stroke-dasharray="`${50.265 / pointMembers(group.rows).length} ${50.265 - 50.265 / pointMembers(group.rows).length}`"
              :stroke-dashoffset="(-50.265 * colorIndex) / pointMembers(group.rows).length"
            />
            <circle
              v-else-if="!matchMode"
              :cx="group.x"
              :cy="group.y"
              :r="matchMode ? 6 : 10"
              :class="`role-${group.rows[0].role}`"
            />
            <text
              v-if="group.rows.length > 1"
              class="point-symbol"
              :x="group.x"
              :y="group.y + 4"
              text-anchor="middle"
            >
              {{ group.rows.length }}
            </text>
            <svg
              v-else-if="!matchMode"
              class="point-role-icon"
              :x="group.x - 7"
              :y="group.y - 7"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              overflow="hidden"
              :style="{ width: '14px', height: '14px' }"
              aria-hidden="true"
              focusable="false"
            >
              <component
                :is="roleIcon[group.rows[0].role]"
                x="0"
                y="0"
                width="24"
                height="24"
                :style="{ width: '24px', height: '24px' }"
              />
            </svg>
            <line
              v-if="!matchMode && pointLabels[index].leader"
              class="point-label-leader"
              :x1="pointLabels[index].leader!.x1"
              :y1="pointLabels[index].leader!.y1"
              :x2="pointLabels[index].leader!.x2"
              :y2="pointLabels[index].leader!.y2"
              clip-path="url(#scatter-plot-clip)"
              aria-hidden="true"
            />
            <text
              v-if="!matchMode"
              clip-path="url(#scatter-plot-clip)"
              class="point-label"
              :x="pointLabels[index].x"
              :y="pointLabels[index].y"
              :text-anchor="pointLabels[index].anchor"
            >
              {{ pointLabels[index].text }}
            </text>
          </component>
          <text
            v-if="activeMatchLabel"
            class="point-label match-hover-label"
            :x="activeMatchLabel.x"
            :y="activeMatchLabel.y"
            :text-anchor="activeMatchLabel.anchor"
            aria-hidden="true"
          >
            {{ activeMatchLabel.text }}
          </text>
          <rect
            v-if="!matchMode && zoomDrag"
            class="scatter-zoom-rectangle"
            :x="82 + Math.min(zoomDrag.start.x, zoomDrag.end.x) * plotWidth"
            :y="35 + Math.min(zoomDrag.start.y, zoomDrag.end.y) * plotHeight"
            :width="Math.abs(zoomDrag.end.x - zoomDrag.start.x) * plotWidth"
            :height="Math.abs(zoomDrag.end.y - zoomDrag.start.y) * plotHeight"
            aria-hidden="true"
          />
        </svg>
      </section>
      <aside
        v-if="matchMode && models.length"
        ref="fitSidebar"
        class="scatter-fit-sidebar"
        :aria-label="uiText('statFitSummary')"
      >
        <h3 class="scatter-fit-heading">{{ uiText('statFitSummary') }}</h3>
        <div class="scatter-fit-body" :style="{ height: `${fitBodyHeight}px` }">
          <ScatterFitSummary :models="models" :win-outcome="yMetric === 'winRate'" />
        </div>
      </aside>
    </div>
    <div ref="bottomRegion" class="scatter-bottom">
      <section class="scatter-values" aria-label="全部精确值">
        <header class="scatter-values-heading">
          <h3>全部精确值（{{ tableRows.length }} 条）</h3>
          <p v-if="selectionFeedback" class="ma-chart-note" role="status">
            {{ selectionFeedback }}
          </p>
        </header>
        <ScatterExactTable
          :columns="columns"
          :rows="tableRows"
          :row-key="tableRowKey"
          :row-class-name="tableRowClassName"
          :active="props.active"
          :selected-row-key="selectedGroup ? tableRowKey(selectedGroup.rows[0]) : null"
          :scroll-x="tableScrollWidth"
          :viewport-height="exactHeight"
          :context-key="`${matchMode}|${roleFilter}|${xMetric}|${yMetric}|${matchMode ? '' : summaryMinimumGames}`"
        />
      </section>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import PositionTop from '@renderer-shared/components/icons/position-icons/PositionTop.vue'
import PositionJungle from '@renderer-shared/components/icons/position-icons/PositionJungle.vue'
import PositionMiddle from '@renderer-shared/components/icons/position-icons/PositionMiddle.vue'
import PositionBottom from '@renderer-shared/components/icons/position-icons/PositionBottom.vue'
import PositionSupport from '@renderer-shared/components/icons/position-icons/PositionSupport.vue'
import {
  regressScatterGroups,
  matchScatterRows,
  scatterMetricKeys,
  type ScatterMetric
} from './scatter-analysis'
import { binaryPerformanceMetrics } from '@shared/shards/member-analysis/performance-metrics'
import { scatterMemberStyle } from './scatter-member-style'
import { themeMemberColor, themeMemberNeutral } from './theme-member-color'
import { uiText } from './ui-text'
import { groupScatterPoints } from './visualization'
import type { DataTableColumns } from 'naive-ui'
import { NButton, NCheckbox, NInputNumber, NSelect, NSwitch } from 'naive-ui'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, toRefs, watch } from 'vue'
import { roleMetricMeta, formatMetric, type MetricFormat } from './metric-defs'
import ScatterExactTable from './ScatterExactTable.vue'
import { scatterLayoutBudget } from './scatter-layout'
import ScatterFitSummary from './ScatterFitSummary.vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { renderRoleSelectLabel } from './role-select-label'
import { finiteOrNull, scatterDomain, scatterPosition, scatterWinRateDomain } from './visualization'
import {
  boundedScatterRange,
  formatScatterViewportTick,
  groupExactScatterValues,
  panScatterViewport,
  scaleScatterViewport,
  selectedScatterViewport,
  type ScatterViewport
} from './scatter-viewport'
import { filterSummaryByMinimumGames, normalizeSummaryMinimumGames } from './scatter-summary-filter'
import { scatterZeroLabels, scatterZeroReferenceAxes } from './scatter-reference-lines'
import { layoutNearbyScatterLabels } from './scatter-label-layout'
import { scatterAxisTickPolicy, scatterAutomaticTickText } from './scatter-axis-ticks'
import { compactScatterYAxis } from './scatter-y-axis-display'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
// Native mounting waits for the real plot box; SSR retains its static chart evidence.
const geometryReady = ref(typeof window === 'undefined')
const canvasHeight = ref(340)
const canvasWidth = ref(900)
const drawingHeight = ref(340)
const fitSidebar = ref<HTMLElement | null>(null)
const fitBodyHeight = ref(200)
const plotHeight = computed(() => Math.max(80, drawingHeight.value - 100))
const plotWidth = computed(() => Math.max(248, canvasWidth.value - 112))
const workspaceHeight = ref<number | null>(null)
const chartRegion = ref<HTMLElement | null>(null)
const bottomRegion = ref<HTMLElement | null>(null)
const exactHeight = ref(160)
const shortFallback = ref(false)
let layoutObserver: ResizeObserver | undefined
let layoutMutations: MutationObserver | undefined
let layoutFrame = 0
let collapsedBudget: { key: string; available: number } | undefined
function measureLayout() {
  const root = scatterRoot.value
  if (!props.active || !root?.clientHeight) return
  // The active tab's flex chain supplies this height in the same layout pass
  // as the animated header. No JS height chasing or transient outer overflow.
  workspaceHeight.value = root.clientHeight
  const style = getComputedStyle(root)
  const gap = parseFloat(style.rowGap) || 12
  const toolbar = root.querySelector<HTMLElement>('.controls')
  const members = root.querySelector<HTMLElement>('.member-controls')
  const available =
    workspaceHeight.value -
    (parseFloat(style.paddingTop) || 0) -
    (parseFloat(style.paddingBottom) || 0) -
    (toolbar?.offsetHeight || 0) -
    (members?.offsetHeight || 0) -
    gap * (members ? 3 : 2)
  const heading = bottomRegion.value?.querySelector<HTMLElement>('.scatter-values-heading')
  const header = bottomRegion.value?.querySelector<HTMLElement>('.n-data-table-thead')
  const row = bottomRegion.value?.querySelector<HTMLElement>('.n-data-table-tbody > tr')
  const pager = bottomRegion.value?.querySelector<HTMLElement>('.n-data-table__pagination')
  const headerHeight = header?.offsetHeight || 0
  const rowHeight = row?.offsetHeight || 0
  const pagerHeight = pager?.offsetHeight || 0
  const hasMeasuredRows = headerHeight > 0 && rowHeight > 0
  const tableReady = hasMeasuredRows && (tableRows.value.length <= 25 || pagerHeight > 0)
  const minimum = hasMeasuredRows
    ? Math.ceil(
        headerHeight +
          rowHeight +
          (pager ? pager.offsetHeight + (parseFloat(getComputedStyle(pager).marginTop) || 0) : 0) +
          4
      )
    : 140
  const headingHeight = heading?.offsetHeight || 32
  const minimumVisual = window.innerWidth <= 760 ? 320 : 180
  const key = [
    window.innerWidth,
    window.innerHeight,
    toolbar?.offsetHeight,
    members?.offsetHeight
  ].join('|')
  const advanced = root
    .closest('.member-analysis-page')
    ?.querySelector<HTMLElement>('#member-analysis-advanced-filters')
  const advancedStyle = advanced ? getComputedStyle(advanced) : null
  const advancedVisible = advancedStyle && advancedStyle.display !== 'none'
  if (!collapsedBudget || collapsedBudget.key !== key) {
    // Also support entering this tab while the shared header is already open.
    const filter = advanced?.closest<HTMLElement>('.member-analysis-filters')
    const expansion = advancedVisible
      ? advanced!.getBoundingClientRect().height +
        (parseFloat(advancedStyle.marginTop) || 0) +
        (filter ? parseFloat(getComputedStyle(filter).rowGap) || 0 : 0)
      : 0
    collapsedBudget = { key, available: available + expansion }
  }
  if (!advancedVisible) collapsedBudget.available = available
  const budget = scatterLayoutBudget(
    available,
    collapsedBudget.available,
    minimum,
    headingHeight,
    minimumVisual
  )
  canvasHeight.value = budget.visual
  exactHeight.value = budget.table
  shortFallback.value = budget.fallback
  drawingHeight.value = chartRegion.value?.clientHeight || canvasHeight.value
  const sidebar = fitSidebar.value
  fitBodyHeight.value = Math.max(
    48,
    (sidebar?.clientHeight || canvasHeight.value) -
      (sidebar?.querySelector<HTMLElement>('.scatter-fit-heading')?.offsetHeight || 32)
  )
  canvasWidth.value = Math.max(360, Math.round(chartRegion.value?.clientWidth || root.clientWidth))
  if (!geometryReady.value && (!tableRows.value.length || tableReady)) {
    // Nonempty tables must supply their real header/row budget before the dense
    // SVG is first created. Observers retry when virtual rows mount; empty tables
    // cannot supply a row and must not wait for one. Warm plots stay mounted.
    void nextTick(() => {
      if (!props.active || !chartRegion.value?.clientHeight) return
      if (
        tableRows.value.length &&
        (!header?.isConnected ||
          !row?.isConnected ||
          header.offsetHeight !== headerHeight ||
          row.offsetHeight !== rowHeight ||
          (tableRows.value.length > 25 &&
            (!pager?.isConnected || pager.offsetHeight !== pagerHeight)))
      ) {
        queueLayout()
        return
      }
      drawingHeight.value = chartRegion.value.clientHeight
      canvasWidth.value = Math.max(360, Math.round(chartRegion.value.clientWidth))
      geometryReady.value = true
    })
  }
}
function queueLayout() {
  if (!props.active || typeof requestAnimationFrame === 'undefined' || layoutFrame) return
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = 0
    measureLayout()
  })
}
function connectLayout() {
  if (!props.active) return
  const root = scatterRoot.value
  const scroller = root?.closest<HTMLElement>('.member-analysis-scroll')
  if (!root || !scroller) return
  if (typeof ResizeObserver !== 'undefined') {
    layoutObserver = new ResizeObserver(queueLayout)
    if (chartRegion.value) layoutObserver.observe(chartRegion.value)
    for (let current: HTMLElement | null = root; current; current = current.parentElement) {
      layoutObserver.observe(current)
      if (current === scroller) break
    }
  }
  if (typeof MutationObserver !== 'undefined') {
    layoutMutations = new MutationObserver(queueLayout)
    layoutMutations.observe(root, { childList: true, subtree: true, characterData: true })
  }
  queueLayout()
}
function disconnectLayout() {
  layoutObserver?.disconnect()
  layoutMutations?.disconnect()
  if (layoutFrame) cancelAnimationFrame(layoutFrame)
  layoutFrame = 0
}
onMounted(connectLayout)
watch(
  () => props.active,
  (active) => {
    disconnectLayout()
    if (active) connectLayout()
  },
  { flush: 'post' }
)
onBeforeUnmount(disconnectLayout)
const { roles, games } = useMemberAnalysisData()
const store = useMemberAnalysisStore()
const league = useLeagueClientStore()
const championKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
const championIds = computed(() => {
  const ids = new Map<string, number>()
  for (const champion of Object.values(league.gameData.champions)) {
    ids.set(championKey(champion.alias), champion.id)
    ids.set(championKey(champion.name), champion.id)
    ids.set(String(champion.id), champion.id)
  }
  return ids
})
const championLabel = (value: string) => {
  const id = championIds.value.get(championKey(value))
  return id === undefined ? value : league.gameData.championName(id)
}
const { matchMode, perMember, xMetric, yMetric, roleFilter } = toRefs(store.scatterViewState)
const metricKeys = scatterMetricKeys
type Metric = ScatterMetric
const isBinary = (key: Metric) => binaryPerformanceMetrics.includes(key)
const label = (key: Metric) => {
  if (matchMode.value && key === 'winRate') return '单局胜负（胜 1 / 负 0）'
  if (matchMode.value && isBinary(key))
    return `${roleMetricMeta[key].label.replace('率', '')}（是 1 / 否 0）`
  return roleMetricMeta[key].label
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
  { label: '全部分路', value: 'ALL' },
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
const liveRoleObservations = computed(() =>
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
// A hidden, lazily retained pane keeps its last render, but does not evaluate new
// publications. Reactivation reads the latest live result in the same update.
let displayedObservations: typeof liveRoleObservations.value = []
const roleObservations = computed(() => {
  if (props.active) displayedObservations = liveRoleObservations.value
  return displayedObservations
})
const summaryMinimumGames = ref(0)
const summarySample = computed(() =>
  matchMode.value
    ? { visible: roleObservations.value, hidden: 0 }
    : filterSummaryByMinimumGames<(typeof roleObservations.value)[number]>(
        roleObservations.value,
        summaryMinimumGames.value
      )
)
const hiddenMembers = computed(
  () => store.scatterViewState.hiddenMembersByRole[roleFilter.value] ?? []
)
const liveMembers = computed(() => {
  const configured = store.settings?.members.map((m) => `${m.gameName}#${m.tagLine}`) ?? []
  const other = [
    ...new Set((store.overview?.games ?? []).flatMap((g) => g.players.map((p) => p.player)))
  ]
    .filter((p) => !configured.includes(p))
    .sort()
  return [...configured, ...other]
})
let displayedMembers: string[] = []
const allMembers = computed(() => {
  if (props.active) displayedMembers = liveMembers.value
  return displayedMembers
})
const roleMembers = computed(() =>
  allMembers.value.filter((player) => roleObservations.value.some((row) => row.player === player))
)
const matchColor = (color: string) => themeMemberColor(color, 'var(--scatter-match-neutral)')
const memberStyle = (player: string) => {
  const style = scatterMemberStyle(allMembers.value.indexOf(player))
  return matchMode.value ? { ...style, color: matchColor(style.color) } : style
}
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
    : summarySample.value.visible
)
const comparableRoles = computed(() =>
  observations.value.filter(
    (row) => finiteOrNull(row[xMetric.value]) !== null && finiteOrNull(row[yMetric.value]) !== null
  )
)
const omittedCount = computed(() => observations.value.length - comparableRoles.value.length)
const xDomain = computed(() =>
  xMetric.value === 'winRate'
    ? scatterWinRateDomain(comparableRoles.value.map((x) => x.winRate))
    : scatterDomain(comparableRoles.value.map((x) => x[xMetric.value]))
)
const binaryOutcome = computed(() => matchMode.value && isBinary(yMetric.value))
const yDomain = computed(() =>
  binaryOutcome.value
    ? { min: 0, max: 1 }
    : yMetric.value === 'winRate'
      ? scatterWinRateDomain(comparableRoles.value.map((x) => x.winRate))
      : scatterDomain(comparableRoles.value.map((x) => x[yMetric.value]))
)
const viewport = ref<ScatterViewport | null>(null)
const zoomSelecting = ref(false)
const zoomDrag = ref<{
  pointer: number
  start: { x: number; y: number }
  end: { x: number; y: number }
  clientX: number
  clientY: number
} | null>(null)
let zoomCapture: { svg: SVGSVGElement; pointer: number } | null = null
const fullViewport = computed(() => ({ x: xDomain.value, y: yDomain.value }))
const visibleViewport = computed(() =>
  !matchMode.value && viewport.value ? viewport.value : fullViewport.value
)
const zoomed = computed(() => !matchMode.value && viewport.value !== null)
const winRateReferenceY = computed(() => {
  if (matchMode.value || yMetric.value !== 'winRate') return null
  const domain = visibleViewport.value.y
  return domain.min <= 0.5 && domain.max >= 0.5
    ? scatterPosition(0.5, domain, 35, plotHeight.value, true)
    : null
})
const zeroReferenceAxes = computed(() =>
  scatterZeroReferenceAxes(xMetric.value, yMetric.value, visibleViewport.value)
)
const zeroReferenceX = computed(() =>
  zeroReferenceAxes.value.x
    ? scatterPosition(0, visibleViewport.value.x, 82, plotWidth.value)
    : null
)
const zeroReferenceY = computed(() =>
  zeroReferenceAxes.value.y
    ? scatterPosition(0, visibleViewport.value.y, 35, plotHeight.value, true)
    : null
)
const zeroLabels = computed(() =>
  scatterZeroLabels(zeroReferenceX.value, zeroReferenceY.value, winRateReferenceY.value, {
    left: 82,
    top: 35,
    width: plotWidth.value,
    height: plotHeight.value
  })
)
function cancelZoomDrag() {
  const capture = zoomCapture
  zoomCapture = null
  zoomDrag.value = null
  if (capture?.svg.hasPointerCapture(capture.pointer))
    capture.svg.releasePointerCapture(capture.pointer)
}
function resetZoom() {
  viewport.value = null
  zoomSelecting.value = false
  cancelZoomDrag()
}
function applyViewport(next: ScatterViewport) {
  if (matchMode.value) return
  if (!(next.x.max > next.x.min) || !(next.y.max > next.y.min)) return
  const full = fullViewport.value
  const bounded = { x: boundedScatterRange(next.x, full.x), y: boundedScatterRange(next.y, full.y) }
  viewport.value =
    bounded.x.min === full.x.min &&
    bounded.x.max === full.x.max &&
    bounded.y.min === full.y.min &&
    bounded.y.max === full.y.max
      ? null
      : bounded
}
function changeZoom(factor: number) {
  applyViewport(scaleScatterViewport(visibleViewport.value, fullViewport.value, factor))
}
function zoomKeydown(event: KeyboardEvent) {
  if (matchMode.value || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.key === 'Escape') {
    zoomSelecting.value = false
    cancelZoomDrag()
  } else if (event.key === '+' || event.key === '=') changeZoom(0.5)
  else if (event.key === '-') changeZoom(2)
  else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    applyViewport(
      panScatterViewport(
        visibleViewport.value,
        fullViewport.value,
        event.key === 'ArrowLeft' ? -0.2 : event.key === 'ArrowRight' ? 0.2 : 0,
        event.key === 'ArrowDown' ? -0.2 : event.key === 'ArrowUp' ? 0.2 : 0
      )
    )
  } else return
  event.preventDefault()
}
function zoomPosition(event: PointerEvent) {
  const svg = event.currentTarget as SVGSVGElement
  const matrix = svg.getScreenCTM()
  if (!matrix) return null
  const point = svg.createSVGPoint()
  point.x = event.clientX
  point.y = event.clientY
  const local = point.matrixTransform(matrix.inverse())
  return { x: (local.x - 82) / plotWidth.value, y: (local.y - 35) / plotHeight.value }
}
const boundZoomPoint = (point: { x: number; y: number }) => ({
  x: Math.max(0, Math.min(1, point.x)),
  y: Math.max(0, Math.min(1, point.y))
})
function startZoomDrag(event: PointerEvent) {
  if (
    matchMode.value ||
    !zoomSelecting.value ||
    !event.isPrimary ||
    event.button !== 0 ||
    (event.target as Element).closest('.point')
  )
    return
  const point = zoomPosition(event)
  if (!point || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return
  chartRegion.value
    ?.querySelector<HTMLButtonElement>('.scatter-zoom-controls button')
    ?.focus({ preventScroll: true })
  cancelZoomDrag()
  zoomDrag.value = {
    pointer: event.pointerId,
    start: point,
    end: point,
    clientX: event.clientX,
    clientY: event.clientY
  }
  const svg = event.currentTarget as SVGSVGElement
  zoomCapture = { svg, pointer: event.pointerId }
  svg.setPointerCapture(event.pointerId)
  event.preventDefault()
}
function moveZoomDrag(event: PointerEvent) {
  if (!zoomDrag.value || zoomDrag.value.pointer !== event.pointerId) return
  const point = zoomPosition(event)
  if (point) zoomDrag.value = { ...zoomDrag.value, end: boundZoomPoint(point) }
}
function finishZoomDrag(event: PointerEvent) {
  const drag = zoomDrag.value
  if (!drag || drag.pointer !== event.pointerId) return
  const point = zoomPosition(event)
  if (
    point &&
    Math.abs(event.clientX - drag.clientX) >= 8 &&
    Math.abs(event.clientY - drag.clientY) >= 8
  ) {
    applyViewport(selectedScatterViewport(visibleViewport.value, drag.start, boundZoomPoint(point)))
    zoomSelecting.value = false
  }
  cancelZoomDrag()
}
watch([observations, xMetric, yMetric, roleFilter, matchMode, summaryMinimumGames], resetZoom)
watch(zoomSelecting, (active) => {
  if (!active) cancelZoomDrag()
})
watch(
  () => props.active,
  (active) => {
    if (!active) {
      zoomSelecting.value = false
      cancelZoomDrag()
    }
  }
)
onMounted(() => window.addEventListener('blur', cancelZoomDrag))
onBeforeUnmount(() => {
  window.removeEventListener('blur', cancelZoomDrag)
  cancelZoomDrag()
})
const points = computed(() => {
  const positioned = comparableRoles.value.map((row, copyIndex) => ({
    ...row,
    copyIndex,
    x: scatterPosition(row[xMetric.value], xDomain.value, 82, plotWidth.value),
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
        color: perMember.value ? memberColor(model.player) : matchColor('var(--la-color-link)'),
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
      return `${i === 0 ? 'M' : 'L'} ${scatterPosition(x, xDomain.value, 82, plotWidth.value)} ${scatterPosition(y, yDomain.value, 35, plotHeight.value, true)}`
    }).join(' ')
    return [{ player: model.player, color: model.color, dash: model.dash, path }]
  })
)
const pointGroups = computed(() =>
  matchMode.value
    ? groupScatterPoints(points.value)
    : groupExactScatterValues(
        points.value,
        (row) => Number(row[xMetric.value]),
        (row) => Number(row[yMetric.value])
      ).map((group) => ({
        x: scatterPosition(group.valueX, visibleViewport.value.x, 82, plotWidth.value),
        y: scatterPosition(group.valueY, visibleViewport.value.y, 35, plotHeight.value, true),
        rows: group.rows
      }))
)
const groupVisible = (group: { x: number; y: number }) =>
  matchMode.value ||
  (group.x >= 82 - 1e-6 &&
    group.x <= 82 + plotWidth.value + 1e-6 &&
    group.y >= 35 - 1e-6 &&
    group.y <= 35 + plotHeight.value + 1e-6)
const singleMatchPoint = (group: { rows: unknown[] }) => matchMode.value && group.rows.length === 1
const selectedIndex = ref<number | null>(null)
const hoveredPoint = ref<number | null>(null)
const focusedPoint = ref<number | null>(null)
function eventPoint(event: Event) {
  const target = event.target as Element | null
  const value = target?.closest?.('[data-scatter-point]')?.getAttribute('data-scatter-point')
  return value === null || value === undefined ? null : Number(value)
}
function showPointerLabel(event: Event) {
  if (matchMode.value) hoveredPoint.value = eventPoint(event)
}
function showFocusLabel(event: Event) {
  if (matchMode.value) focusedPoint.value = eventPoint(event)
}
const selectionFeedback = ref('')
const scatterRoot = ref<HTMLElement | null>(null)
function selectPoint(index: number) {
  selectionFeedback.value = ''
  selectedIndex.value = selectedIndex.value === index ? null : index
}
const selectedGroup = computed(() =>
  selectedIndex.value === null ? null : pointGroups.value[selectedIndex.value]
)
const readyPointGroups = computed(() => (geometryReady.value ? pointGroups.value : null))
const pointKeys = computed(() => {
  const groups = readyPointGroups.value ?? []
  const identities = groups.map((group) => {
    const row = group.rows[0]
    return matchMode.value &&
      group.rows.length === 1 &&
      Number.isSafeInteger(row.gameId) &&
      row.gameId! > 0 &&
      row.player &&
      row.role
      ? `match:${JSON.stringify([row.gameId, row.player, row.role])}`
      : null
  })
  const counts = new Map<string, number>()
  for (const identity of identities)
    if (identity !== null) counts.set(identity, (counts.get(identity) ?? 0) + 1)
  // Ambiguous/invalid identities and aggregate points retain their original
  // positional keys. A real match identity is never shared by two VNodes.
  return identities.map((identity, index) =>
    identity !== null && counts.get(identity) === 1 ? identity : index
  )
})
watch(readyPointGroups, (groups, previous) => {
  if (!groups || selectedIndex.value === null) return
  const oldGroup = previous?.[selectedIndex.value]
  const identity = (row: (typeof points.value)[number]) =>
    JSON.stringify([row.player, row.role, row.gameId])
  const keys = oldGroup?.rows.map(identity) ?? []
  const counts = new Map<string, number>()
  for (const group of groups)
    for (const row of group.rows) {
      const key = identity(row)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  const candidates = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => {
      const current = new Set(group.rows.map(identity))
      return keys.length > 0 && keys.every((key) => counts.get(key) === 1 && current.has(key))
    })
  if (candidates.length === 1) {
    selectedIndex.value = candidates[0].index
    return
  }
  selectedIndex.value = null
  selectionFeedback.value = uiText('scatterSelectionChanged')
})
const labelAnchor = (x: number, index: number) =>
  x > canvasWidth.value * 0.77
    ? 'end'
    : x < canvasWidth.value * 0.28
      ? 'start'
      : index % 2
        ? 'start'
        : 'end'
const labelX = (x: number, index: number) => x + (labelAnchor(x, index) === 'start' ? 12 : -12)
// Copy depends on records/metrics, not pixel positions. Its value cache is rebuilt
// per publication/filter/metric evaluation, never retained across datasets.
const pointCopies = computed(() => {
  const values = new Map<MetricFormat, Map<unknown, string>>()
  const negativeZero = Symbol()
  const formatted = (value: unknown, format: MetricFormat) => {
    let cache = values.get(format)
    if (!cache) values.set(format, (cache = new Map()))
    const key = Object.is(value, -0) ? negativeZero : value
    if (!cache.has(key)) cache.set(key, formatMetric(value, format))
    return cache.get(key)!
  }
  const x = xMetric.value
  const y = yMetric.value
  const xLabel = label(x)
  const yLabel = label(y)
  const xFormat = roleMetricMeta[x].fmt
  const yFormat = roleMetricMeta[y].fmt
  const titleXFormat = matchMode.value && isBinary(x) ? 'int' : xFormat
  const titleYFormat = matchMode.value && isBinary(y) ? 'int' : yFormat
  return comparableRoles.value.map((row) => ({
    title: `${row.player} · ${roleName[row.role]} · ${xLabel} ${formatted(row[x], titleXFormat)} · ${yLabel} ${formatted(row[y], titleYFormat)}`,
    aria: `${row.player}，${xLabel} ${formatted(row[x], xFormat)}，${yLabel} ${formatted(row[y], yFormat)}`
  }))
})
const pointDescription = (rows: typeof points.value) =>
  rows.map((row) => pointCopies.value[row.copyIndex].title).join('\n')
const pointLabels = computed(() => {
  const identitiesByName = new Map<string, Set<string>>()
  for (const row of observations.value) {
    const name = short(row.player)
    if (!identitiesByName.has(name)) identitiesByName.set(name, new Set())
    identitiesByName.get(name)!.add(row.player)
  }
  if (!matchMode.value) {
    return layoutNearbyScatterLabels(
      pointGroups.value.map((group) => {
        const name = group.rows[0].player
        const duplicate = (identitiesByName.get(short(name))?.size ?? 0) > 1
        return {
          x: group.x,
          y: group.y,
          visible: groupVisible(group),
          text:
            group.rows.length > 1
              ? uiText('overlap', { count: group.rows.length })
              : duplicate
                ? name
                : short(name),
          suffix:
            duplicate && group.rows.length === 1 && name.includes('#')
              ? name.slice(name.indexOf('#'))
              : undefined
        }
      }),
      { left: 82, top: 35, width: plotWidth.value, height: plotHeight.value }
    )
  }
  const placed: {
    x: number
    y: number
    anchor: string
    text: string
    left: number
    right: number
    leader: null
  }[] = []
  for (const [index, group] of pointGroups.value.entries()) {
    if (!groupVisible(group)) {
      placed.push({
        x: group.x,
        y: group.y,
        anchor: 'start',
        text: '',
        left: Infinity,
        right: Infinity,
        leader: null
      })
      continue
    }
    const anchor = labelAnchor(group.x, index)
    const x = labelX(group.x, index)
    const name = group.rows[0].player
    const duplicateName = (identitiesByName.get(short(name))?.size ?? 0) > 1
    const full =
      group.rows.length > 1
        ? matchMode.value
          ? `${group.rows.length} 条重叠`
          : uiText('overlap', { count: group.rows.length })
        : duplicateName
          ? name
          : short(name)
    const limit = Math.max(
      4,
      Math.floor(Math.min(220, anchor === 'start' ? canvasWidth.value - 16 - x : x - 30) / 15) - 4
    )
    const characters = Array.from(full)
    const tag =
      duplicateName && group.rows.length === 1 ? Array.from(name.slice(name.indexOf('#'))) : []
    const suffix = tag.slice(0, Math.min(6, Math.floor(limit / 2))).join('')
    const text =
      characters.length > limit
        ? `${characters.slice(0, limit - Array.from(suffix).length - 1).join('')}…${suffix}`
        : full
    const width = Array.from(text).length * 15
    const left = anchor === 'start' ? x : x - width
    const right = anchor === 'start' ? x + width : x
    const baseline = Math.max(20, Math.min(35 + plotHeight.value - 5, group.y - 15))
    let y = baseline
    // Match labels are hidden except on hover/focus; avoid solving collisions
    // for hundreds of invisible labels on every geometry change.
    for (const offset of matchMode.value ? [] : [0, -20, 20, -40, 40, -60, 60, -80, 80]) {
      const candidate = Math.max(20, Math.min(35 + plotHeight.value - 5, baseline + offset))
      if (
        !placed.some(
          (other) => left < other.right && right > other.left && Math.abs(candidate - other.y) < 18
        )
      ) {
        y = candidate
        break
      }
    }
    placed.push({ x, y, anchor, text, left, right, leader: null })
  }
  return placed
})
const activeMatchLabel = computed(() => {
  if (!matchMode.value) return null
  const index = hoveredPoint.value ?? focusedPoint.value
  return index === null ? null : (pointLabels.value[index] ?? null)
})
watch(pointKeys, (keys, previous) => {
  hoveredPoint.value = null
  if (focusedPoint.value === null) return
  const oldKey = previous?.[focusedPoint.value]
  const index = typeof oldKey === 'string' ? keys.indexOf(oldKey) : focusedPoint.value
  // Stable keyed circles keep native focus when records are filtered/reordered;
  // move the shared keyboard label with that same record, not its old index.
  focusedPoint.value = index >= 0 && index < keys.length ? index : null
})
const axisTickPolicy = (axis: 'x' | 'y') => {
  const metric = axis === 'x' ? xMetric.value : yMetric.value
  return scatterAxisTickPolicy(
    metric,
    visibleViewport.value[axis],
    comparableRoles.value.map((row) => row[metric]),
    axis === 'x' ? plotWidth.value : plotHeight.value,
    axis === 'x' ? 40 : 20,
    zoomed.value
  )
}
const xTickPolicy = computed(() => axisTickPolicy('x'))
const yTickPolicy = computed(() => axisTickPolicy('y'))
const xTicks = computed(() =>
  xTickPolicy.value.values.map((value) => ({
    value,
    pos: scatterPosition(value, visibleViewport.value.x, 82, plotWidth.value)
  }))
)
const yTicks = computed(() =>
  yTickPolicy.value.values.map((value) => ({
    value,
    pos: scatterPosition(value, visibleViewport.value.y, 35, plotHeight.value, true)
  }))
)
// Retain the original padded grid, including the breathing room below zero;
// only numeric labels are suppressed. The inserted zero gets its own grid line.
const xGridTicks = computed(() =>
  xTickPolicy.value.gridValues.map((value) => ({
    value,
    pos: scatterPosition(value, visibleViewport.value.x, 82, plotWidth.value)
  }))
)
const yGridTicks = computed(() =>
  yTickPolicy.value.gridValues.map((value) => ({
    value,
    pos: scatterPosition(value, visibleViewport.value.y, 35, plotHeight.value, true)
  }))
)
const unscaledAxisFormat = (v: number, key: Metric, axis: 'x' | 'y') => {
  const range = visibleViewport.value[axis]
  if (zoomed.value) return formatScatterViewportTick(v, range, roleMetricMeta[key].fmt === 'pct')
  const original = (value: number) =>
    matchMode.value && isBinary(key)
      ? `${(value * 100).toFixed(0)}%`
      : roleMetricMeta[key].fmt === 'pct'
        ? `${(value * 100).toFixed(1)}%`
        : Math.abs(value) >= 100
          ? value.toFixed(0)
          : value.toFixed(2)
  const policy = axis === 'x' ? xTickPolicy.value : yTickPolicy.value
  return policy.automaticNonnegative
    ? scatterAutomaticTickText(v, policy.values, range, roleMetricMeta[key].fmt === 'pct', original)
    : original(v)
}
const yAxisTitle = computed(() =>
  binaryOutcome.value
    ? `${yMetric.value === 'winRate' ? '胜负' : roleMetricMeta[yMetric.value].label.replace('率', '')}概率（%）`
    : label(yMetric.value)
)
const yAxisDisplay = computed(() =>
  compactScatterYAxis({
    metric: yMetric.value,
    binary: isBinary(yMetric.value),
    values: yTicks.value.map((tick) => tick.value),
    original: (value) => unscaledAxisFormat(value, yMetric.value, 'y'),
    percent: roleMetricMeta[yMetric.value].fmt === 'pct',
    unit: roleMetricMeta[yMetric.value].unit,
    title: yAxisTitle.value,
    height: plotHeight.value
  })
)
const axisFormat = (value: number, metric: Metric, axis: 'x' | 'y') =>
  axis === 'y' && yAxisDisplay.value.status === 'compact'
    ? (yAxisDisplay.value.labels.get(value) ?? unscaledAxisFormat(value, metric, axis))
    : unscaledAxisFormat(value, metric, axis)
const axisTickTitle = (value: number, metric: Metric) =>
  roleMetricMeta[metric].fmt === 'pct'
    ? `${value * 100}%`
    : `${value}${roleMetricMeta[metric].unit ? ` ${roleMetricMeta[metric].unit}` : ''}`
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
const roleIcon = {
  TOP: PositionTop,
  JUNGLE: PositionJungle,
  MIDDLE: PositionMiddle,
  BOTTOM: PositionBottom,
  UTILITY: PositionSupport
} as const
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
const tableRowClassName = (row: Record<string, unknown>) =>
  isSelectedRow(row) ? 'scatter-selected-row' : ''
const columns = computed<DataTableColumns<Record<string, unknown>>>(() => [
  {
    title: '成员',
    key: 'player',
    width: 200,
    render: (row) => String(row.player)
  },
  { title: '分路', key: 'role', width: 70 },
  ...(matchMode.value
    ? [
        { title: '对局', key: 'gameId', width: 100 },
        { title: '日期', key: 'date', width: 120 },
        {
          title: '英雄',
          key: 'champion',
          width: 120,
          render: (row: Record<string, unknown>) => championLabel(String(row.champion ?? ''))
        },
        { title: '结果', key: 'result', width: 70 }
      ]
    : [{ title: '样本', key: 'games', width: 80 }]),
  {
    title: label(xMetric.value),
    key: 'x',
    width: 180,
    render: (r) => displayValue(r.x, xMetric.value)
  },
  {
    title: label(yMetric.value),
    key: 'y',
    width: 230,
    render: (r) => displayValue(r.y, yMetric.value)
  }
])
const tableScrollWidth = computed(() =>
  columns.value.reduce(
    (sum, column) => sum + (typeof column.width === 'number' ? column.width : 0),
    0
  )
)
</script>
<style scoped>
.win-rate-reference {
  pointer-events: none;
}
.win-rate-reference line {
  stroke: var(--ma-muted);
  stroke-width: 1;
  stroke-dasharray: 5 4;
  opacity: 0.75;
}
.win-rate-reference text {
  fill: var(--ma-muted);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.summary-minimum-control {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.summary-minimum-control label {
  white-space: nowrap;
}
.summary-minimum-control :deep(.n-input-number) {
  width: 104px;
}
.summary-minimum-status {
  position: relative;
  top: 0.5px;
  color: var(--ma-muted);
  font-size: 12px;
}
.scatter-zoom-controls {
  position: absolute;
  z-index: 1;
  top: 0;
  left: 82px;
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: calc(100% - 190px);
  height: 30px;
  overflow-x: auto;
  white-space: nowrap;
}
.scatter-zoom-controls > * {
  flex-shrink: 0;
}
.scatter-zoom-status {
  color: var(--ma-muted);
  font-size: 12px;
}
.scatter-zoom-help {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.zoom-selecting {
  cursor: crosshair;
  touch-action: none;
}
.scatter-zoom-rectangle {
  fill: color-mix(in srgb, var(--la-color-text-primary) 8%, transparent);
  stroke: var(--la-color-text-primary);
  stroke-width: 1;
  stroke-dasharray: 4 3;
  pointer-events: none;
}
.ma-workspace {
  color-scheme: light;
}
.member-analysis-page .scatter-workspace {
  box-sizing: border-box;
  width: 75%;
  height: 100%;
  margin-inline: auto;
  min-height: 0;
  gap: 8px;
  padding: 12px 20px;
  overflow: hidden;
  scrollbar-gutter: stable;
}
.scatter-workspace > .controls,
.scatter-workspace > .member-controls {
  flex: none;
}
.scatter-workspace.short-fallback {
  overflow-y: auto;
}
.scatter-bottom {
  flex: none;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.scatter-values-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
}
.scatter-values-heading h3 {
  flex: none;
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.scatter-values-heading .ma-chart-note {
  margin: 0;
  font-size: 12px;
}
.scatter-visual-region {
  display: flex;
  flex: none;
  min-height: 0;
  min-width: 0;
  gap: 12px;
}
.scatter-fit-sidebar {
  flex: 0 0 276px;
  max-width: 30%;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--ma-grid);
  padding-left: 8px;
  box-sizing: border-box;
}
.scatter-fit-heading {
  box-sizing: border-box;
  flex: none;
  min-height: 32px;
  margin: 0;
  padding: 6px 0;
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  color: var(--la-color-text-primary);
}
@media (min-width: 1361px) {
  .scatter-fit-sidebar {
    flex-basis: 308px;
    max-width: 32%;
  }
}
.scatter-fit-body {
  min-height: 0;
  overflow: auto;
  padding-right: 8px;
  overscroll-behavior: contain;
}
@media (max-width: 760px) {
  .scatter-visual-region {
    flex-direction: column;
  }
  .scatter-fit-sidebar {
    flex: 0 0 40%;
    max-width: none;
  }
  .scatter-fit-sidebar {
    border-left: 0;
    border-top: 1px solid var(--ma-grid);
    padding-left: 0;
  }
}
@media (max-width: 1360px) {
  .member-analysis-page .scatter-workspace {
    width: 100%;
  }
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
.member-controls {
  box-sizing: border-box;
  transform: translateY(7px);
  max-height: 64px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.member-visibility {
  flex: 1 1 0;
  min-width: 0;
  gap: 8px;
  line-height: 1.6;
}
.member-visibility > span {
  display: inline-flex;
  align-items: center;
  line-height: 1.6;
}
.member-visibility :deep(.n-checkbox) {
  display: inline-flex;
  align-items: center;
}
.member-visibility :deep(.n-checkbox__label) {
  display: inline-flex;
  align-items: center;
  line-height: 1.6;
}
.member-visible-name {
  display: inline-block;
  max-width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.6;
}
.member-swatch {
  display: inline-block;
  flex: none;
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
.match-point circle,
circle.match-point {
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
.scatter-wrap {
  position: relative;
  /* The header moves this unchanged dense plot without changing its data.
     Cache its paint separately rather than replaying SVG strokes each frame. */
  contain: paint;
  will-change: transform;
  overflow: hidden;
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  padding: 0;
}
.scatter-chart-meta {
  position: absolute;
  right: 0;
  top: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ma-muted);
}
.scatter-meta-value {
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.scatter-wrap > svg {
  min-width: 360px;
  width: 100%;
  height: 100%;
  display: block;
  margin: 0 auto;
}
/* Chromium can focus the SVG image after a pointer click and draw a native
   full-chart outline. Keyboard indicators remain on individual data points. */
.scatter-wrap > svg:focus {
  outline: none;
}
.grid line {
  stroke: var(--ma-grid);
}
.axes text,
.point text,
.match-hover-label {
  fill: var(--la-color-text-primary);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
}
.axes .axis-title {
  font-size: 14px;
  font-weight: 500;
}
.axes .axis-tick {
  fill: var(--ma-muted);
  font-size: 13px;
  font-weight: 400;
}
.point .point-label {
  font-size: 13px;
  font-weight: 500;
}
.match-hover-label {
  font-size: 14px;
  font-weight: 600;
}
.point circle,
circle.point {
  fill: var(--la-card-surface-95);
  stroke: var(--ma-series-2);
  stroke-width: 2;
}
.point .point-symbol {
  fill: var(--la-color-text-primary);
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
}
.point-role-icon {
  color: var(--la-color-text-primary);
  pointer-events: none;
}
.point-label-leader {
  pointer-events: none;
  stroke: var(--ma-muted);
  stroke-width: 1;
  opacity: 0.7;
}
.point-label {
  opacity: 0;
  pointer-events: none;
  paint-order: stroke;
  stroke: var(--la-card-surface-95);
  stroke-width: 3px;
  stroke-linejoin: round;
  transition: opacity 120ms ease;
}
.match-hover-label,
.point.labelled .point-label,
.point:hover .point-label,
.point:focus .point-label {
  opacity: 1;
}
.point:focus {
  outline: none;
}
.point circle.role-JUNGLE {
  stroke: var(--ma-series-1);
  color: var(--ma-series-1);
}
.point circle.role-MIDDLE {
  stroke: var(--ma-series-3);
  color: var(--ma-series-3);
}
.point circle.role-BOTTOM {
  stroke: var(--ma-series-4);
  color: var(--ma-series-4);
}
.point circle.role-UTILITY {
  stroke: var(--ma-series-6);
  color: var(--ma-series-6);
}
.point:focus-visible circle,
.point:hover circle,
circle.point:focus-visible,
circle.point:hover {
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
  .scatter-wrap > svg {
    min-width: 360px;
  }
}
.controls {
  flex-wrap: wrap;
  gap: 12px;
}
.scatter-wrap {
  padding: 0;
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
}
@media (max-height: 680px) {
  .scatter-wrap {
    padding: 0;
  }
}
</style>
