<template>
  <div class="ma-panel ma-workspace">
    <header class="ma-view-heading">
      <div>
        <h2>同队样本比较</h2>
      </div>
      <span v-if="!identicalRosters(games)"
        >{{ visibleEdges.length }} 条关系 · 按差值绝对值排序</span
      ><span v-else>相同出场范围 · 不作排名</span>
    </header>
    <div v-if="identicalRosters(games)" class="synergy-unavailable">
      <strong>{{ uiText('sameRoster') }}</strong>
      <p>{{ uiText('sameRosterDetail') }}</p>
    </div>
    <div v-else-if="!synergy.length" class="ma-empty">{{ uiText('noData') }}</div>
    <template v-else>
      <div class="synergy-toolbar">
        <NSelect v-model:value="focus" :options="memberOptions" clearable placeholder="聚焦成员" />
      </div>
      <div class="network-layout">
        <section class="relationship-plot" aria-label="同队胜率相对个人基线的描述性偏差排序">
          <div class="relationship-scale" aria-hidden="true">
            <span>低于基线</span><span>个人基线</span><span>高于基线</span>
          </div>
          <button
            v-for="edge in rankedEdges"
            :key="edge.key"
            class="relationship-row"
            :class="{ selected: selected?.key === edge.key }"
            :aria-pressed="selected?.key === edge.key"
            :aria-label="`${short(edge.playerA)} 与 ${short(edge.playerB)}，收缩后偏差 ${formatSigned(edge.adjustedDifference * 100, 1)} 个百分点，共同 ${edge.games} 场`"
            @click="selectEdge(edge.key, $event)"
          >
            <span class="relationship-pair">
              <b>{{ short(edge.playerA) }}</b
              ><span>×</span><b>{{ short(edge.playerB) }}</b>
              <small>{{ edge.games }} 场 · {{ reliabilityLabel(edge.games, minimum) }}</small>
            </span>
            <span class="relationship-track" aria-hidden="true">
              <i
                :class="edge.adjustedDifference < 0 ? 'negative' : 'positive'"
                :style="relationshipStyle(edge.adjustedDifference)"
              />
            </span>
            <strong :class="edge.adjustedDifference >= 0 ? 'ma-positive' : 'ma-negative'">
              {{ formatSigned(edge.adjustedDifference * 100, 1) }} 个百分点
            </strong>
          </button>
        </section>
        <aside v-if="selected" ref="edgeDetail" tabindex="-1" class="ma-card detail">
          <span class="ma-card__head"
            ><b>关系详情</b
            ><span class="ma-tag">{{ reliabilityLabel(selected.games, minimum) }}</span></span
          ><strong>{{ short(selected.playerA) }}<br />× {{ short(selected.playerB) }}</strong>
          <div
            class="score"
            :class="selected.adjustedDifference >= 0 ? 'ma-positive' : 'ma-negative'"
          >
            {{ formatSigned(selected.adjustedDifference * 100, 1) }} 个百分点
          </div>
          <dl>
            <dt>共同场次</dt>
            <dd>{{ selected.games }}</dd>
            <dt>共同胜率</dt>
            <dd>{{ formatMetric(selected.winRate, 'pct') }}</dd>
            <dt>个人基线</dt>
            <dd>{{ formatMetric(selected.baseline, 'pct') }}</dd>
            <dt>观测偏差</dt>
            <dd>{{ formatSigned(selected.observedDifference * 100, 1) }} 个百分点</dd>
            <dt>样本收缩权重</dt>
            <dd>{{ formatMetric(selected.shrinkageWeight, 'pct') }}</dd>
          </dl>
          <NButton size="small" secondary @click="clearEdge">取消选择</NButton>
        </aside>
      </div>
      <details class="method-note">
        <summary>计算口径与低样本处理</summary>
        <p>
          收缩后偏差 =（共同胜率 − 两人个人胜率均值）× 共同场次 ÷（共同场次 + 8）。这是描述性差异，
          不代表两人的配合导致胜率变化；位置、英雄、版本、边色、队友和对手都可能影响结果。少量样本参考线为
          {{ minimum }} 场。
        </p>
      </details>
      <details>
        <summary>全部组合精确值</summary>
        <MemberAnalysisMetricTable :columns="columns" :rows="visibleEdges" :scroll-x="980" />
      </details>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import { NButton, NSelect } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MemberAnalysisMetricTable from './MemberAnalysisMetricTable.vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric } from './metric-defs'
import { uiText } from './ui-text'
import { identicalRosters, formatSigned, reliabilityLabel } from './visualization'
const store = useMemberAnalysisStore()
const { synergy, games } = useMemberAnalysisData()
const focus = ref<string | null>(null)
const selectedKey = ref('')
const edgeDetail = ref<HTMLElement | null>(null)
let edgeTrigger: HTMLButtonElement | null = null
async function selectEdge(key: string, event: Event) {
  edgeTrigger = event.currentTarget as HTMLButtonElement
  if (selectedKey.value === key) return clearEdge()
  selectedKey.value = key
  await nextTick()
  edgeDetail.value?.scrollIntoView({ block: 'nearest' })
  edgeDetail.value?.focus({ preventScroll: true })
}
async function clearEdge() {
  selectedKey.value = ''
  await nextTick()
  if (edgeTrigger?.isConnected) edgeTrigger.focus()
}
const minimum = computed(() => (store.sampleSize === 20 ? 2 : store.sampleSize === 50 ? 3 : 5))
const members = computed(() => [...new Set(synergy.value.flatMap((x) => [x.playerA, x.playerB]))])
const memberOptions = computed(() =>
  members.value.map((value) => ({ label: value.split('#')[0], value }))
)
const visibleEdges = computed(() =>
  focus.value
    ? synergy.value.filter((x) => x.playerA === focus.value || x.playerB === focus.value)
    : synergy.value
)
const rankedEdges = computed(() =>
  [...visibleEdges.value].sort(
    (a, b) => Math.abs(b.adjustedDifference) - Math.abs(a.adjustedDifference)
  )
)
const scoreDomain = computed(() =>
  Math.max(0.01, ...rankedEdges.value.map((edge) => Math.abs(edge.adjustedDifference)))
)
const relationshipStyle = (score: number) => ({
  width: `${(Math.abs(score) / scoreDomain.value) * 50}%`,
  [score < 0 ? 'right' : 'left']: '50%'
})
const selected = computed(() => visibleEdges.value.find((x) => x.key === selectedKey.value))
watch(focus, () => (selectedKey.value = ''))
const short = (s: string) => s.split('#')[0]
const columns: DataTableColumns<Record<string, unknown>> = [
  { title: '成员 A', key: 'playerA', width: 160 },
  { title: '成员 B', key: 'playerB', width: 160 },
  { title: '共同场次', key: 'games', sorter: 'default' },
  { title: '共同胜率', key: 'winRate', render: (r) => formatMetric(r.winRate, 'pct') },
  { title: '个人基线', key: 'baseline', render: (r) => formatMetric(r.baseline, 'pct') },
  {
    title: '观测偏差',
    key: 'observedDifference',
    render: (r) => formatSigned(Number(r.observedDifference) * 100, 1) + ' 个百分点'
  },
  {
    title: '收缩权重',
    key: 'shrinkageWeight',
    render: (r) => formatMetric(r.shrinkageWeight, 'pct')
  },
  {
    title: '收缩后偏差',
    key: 'adjustedDifference',
    sorter: 'default',
    render: (r) => formatSigned(Number(r.adjustedDifference) * 100, 1) + ' 个百分点'
  }
]
</script>
<style scoped>
.synergy-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.synergy-toolbar :deep(.n-select) {
  width: 180px;
}
.network-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
}
.relationship-plot {
  min-width: 0;
  border-top: 1px solid var(--ma-grid);
}
.relationship-scale {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  padding: 7px 96px 7px min(31%, 230px);
  color: var(--ma-muted);
  font-size: 12px;
}
.relationship-scale span:nth-child(2) {
  text-align: center;
}
.relationship-scale span:last-child {
  text-align: right;
}
.relationship-row {
  display: grid;
  grid-template-columns: minmax(190px, 31%) minmax(100px, 1fr) 140px;
  align-items: center;
  width: 100%;
  min-height: 48px;
  padding: 6px 8px 6px 0;
  border: 0;
  border-bottom: 1px solid var(--ma-grid);
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.relationship-row:hover,
.relationship-row.selected {
  background: color-mix(in srgb, var(--la-color-link) 7%, transparent);
}
.relationship-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 6px;
  align-items: center;
  padding-right: 16px;
}
.relationship-pair b {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.relationship-pair small {
  grid-column: 1 / -1;
  color: var(--ma-muted);
  font-size: 12px;
}
.relationship-track {
  position: relative;
  display: block;
  height: 10px;
  background: linear-gradient(
    to right,
    transparent 49.7%,
    var(--ma-grid-strong) 49.7% 50.3%,
    transparent 50.3%
  );
}
.relationship-track i {
  position: absolute;
  top: 2px;
  height: 6px;
  background: var(--ma-positive);
}
.relationship-track i.negative {
  background: var(--ma-negative);
}
.relationship-row > strong {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.detail > strong {
  display: block;
  margin: 15px 0;
}
.score {
  font-size: 20px;
  font-weight: 700;
}
.detail dl {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  margin: 16px 0;
  font-size: 12px;
}
.detail dt {
  color: var(--ma-muted);
}
.detail dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
.method-note {
  border-top: 1px solid var(--ma-grid);
  border-bottom: 1px solid var(--ma-grid);
  color: var(--ma-muted);
  font-size: 12px;
}
.method-note summary {
  padding: 9px 0;
  color: var(--la-color-text-primary);
  cursor: pointer;
}
.method-note p {
  margin: 0;
  padding: 0 0 10px;
  line-height: 1.6;
}
@media (max-width: 900px) {
  .network-layout {
    grid-template-columns: 1fr;
  }
  .detail {
    display: block;
  }
  .relationship-row {
    grid-template-columns: minmax(155px, 42%) minmax(80px, 1fr) 120px;
  }
  .relationship-scale {
    padding-left: 42%;
    padding-right: 78px;
  }
}
.synergy-unavailable {
  padding: 40px 0;
  max-width: 620px;
}
.synergy-unavailable strong {
  display: block;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.5;
}
.synergy-unavailable p {
  color: var(--ma-muted);
  line-height: 1.8;
  margin: 12px 0 0;
}
.relationship-row {
  padding-top: 18px;
  padding-bottom: 18px;
}
.detail {
  padding: 20px;
  background: var(--ma-hover);
  border-radius: 8px;
  border: 0;
}
</style>
