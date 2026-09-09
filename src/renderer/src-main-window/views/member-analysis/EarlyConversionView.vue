<template>
  <div class="ma-panel ma-workspace">
    <header class="ma-view-heading">
      <div>
        <h2>经济差与比赛结果</h2>
      </div>
      <span>{{ rows.length }} 场含 {{ timing }} 分钟完整经济数据</span>
    </header>
    <NRadioGroup v-model:value="timing" size="small"
      ><NRadioButton value="15">15 分钟</NRadioButton
      ><NRadioButton value="20">20 分钟</NRadioButton></NRadioGroup
    >
    <dl class="conversion-summary">
      <div v-for="card in summary" :key="card.label">
        <dt>
          {{ card.label }} <small>{{ card.note }}</small>
        </dt>
        <dd :class="card.tone">{{ card.value }}</dd>
      </div>
    </dl>
    <p class="ma-chart-note">{{ uiText('rateLegend') }} 经济区间含下限、不含上限，单位为金币。</p>
    <section class="early-table-wrap" aria-label="经济差分档与胜率">
      <table class="early-table">
        <thead>
          <tr>
            <th>经济差（金币）</th>
            <th>场数</th>
            <th>胜 / 负</th>
            <th>胜率</th>
            <th>0% — 50% — 100%</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="bucket in buckets"
            :key="bucket.label"
            :class="{ 'is-selected': selectedBucket === bucket.label }"
          >
            <th scope="row">
              <button
                type="button"
                :aria-pressed="selectedBucket === bucket.label"
                @click="selectedBucket = selectedBucket === bucket.label ? '' : bucket.label"
              >
                {{ bucket.label }}
              </button>
            </th>
            <td>{{ bucket.games }}</td>
            <td>{{ bucket.wins }} / {{ bucket.games - bucket.wins }}</td>
            <td>{{ formatMetric(bucket.winRate, 'pct') }}</td>
            <td><WinRateInterval :wins="bucket.wins" :games="bucket.games" /></td>
          </tr>
        </tbody>
      </table>
    </section>
    <div class="ma-section-title">
      <strong
        >逐场精确证据 <template v-if="selectedBucket">· {{ selectedBucket }}</template></strong
      ><NButton v-if="selectedBucket" size="small" quaternary @click="selectedBucket = ''">
        {{ uiText('clearSelection') }}
      </NButton>
    </div>
    <MemberAnalysisMetricTable
      :columns="gameColumns"
      :rows="gameRows"
      :page-size="20"
      :scroll-x="760"
    />
  </div>
</template>
<script setup lang="ts">
import type { DataTableColumns } from 'naive-ui'
import { NButton, NRadioButton, NRadioGroup } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { aggregateEarlyBuckets, earlyGoldDiff } from './analytics'
import { formatMetric } from './metric-defs'
import MemberAnalysisMetricTable from './MemberAnalysisMetricTable.vue'
import WinRateInterval from './WinRateInterval.vue'
import { uiText } from './ui-text'
import { formatSigned } from './visualization'
import { useMemberAnalysisData } from './useMemberAnalysisData'
const { games } = useMemberAnalysisData()
const selectedBucket = ref('')
const timing = ref<'15' | '20'>('15')
const rows = computed(() =>
  games.value
    .map((game) => ({ game, diff: earlyGoldDiff(game, timing.value) }))
    .filter((x): x is { game: (typeof games.value)[number]; diff: number } => x.diff !== null)
)
watch(timing, () => {
  selectedBucket.value = ''
})
const buckets = computed(() => aggregateEarlyBuckets(rows.value))
const ahead = computed(() => rows.value.filter((x) => x.diff >= 500))
const behind = computed(() => rows.value.filter((x) => x.diff < -500))
const neutral = computed(() => rows.value.filter((x) => x.diff >= -500 && x.diff < 500))
const rate = (a: typeof rows.value) =>
  a.length ? a.filter((x) => x.game.win).length / a.length : null
const aheadWins = computed(() => rate(ahead.value))
const behindWins = computed(() => rate(behind.value))
const summary = computed(() => [
  {
    label: '领先局取胜',
    value: formatMetric(aheadWins.value, 'pct'),
    note: `${ahead.value.length} 场 · ≥ +500 金币`,
    tone: 'ma-positive'
  },
  {
    label: '接近持平时取胜',
    value: formatMetric(rate(neutral.value), 'pct'),
    note: `${neutral.value.length} 场 · −500 至 +500 金币`,
    tone: ''
  },
  {
    label: '落后翻盘率',
    value: formatMetric(behindWins.value, 'pct'),
    note: `${behind.value.length} 场 · < −500 金币`,
    tone: 'ma-positive'
  }
])
const gameRows = computed(() =>
  rows.value
    .filter(
      (x) =>
        !selectedBucket.value ||
        aggregateEarlyBuckets([x]).some(
          (bucket) => bucket.label === selectedBucket.value && bucket.games > 0
        )
    )
    .map((x) => ({
      gameId: x.game.gameId,
      date: x.game.date,
      side: x.game.side === 'Blue' ? '蓝方' : '红方',
      result: x.game.win ? '胜利' : '失败',
      diff: x.diff
    }))
)
const gameColumns: DataTableColumns<Record<string, unknown>> = [
  { title: '对局', key: 'gameId' },
  { title: '日期', key: 'date' },
  { title: '阵营', key: 'side' },
  { title: '结果', key: 'result' },
  {
    title: '五路经济差',
    key: 'diff',
    sorter: 'default',
    render: (r) => formatSigned(r.diff)
  }
]
</script>
<style scoped>
.conversion-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 0;
  border-top: 1px solid var(--ma-grid);
  border-bottom: 1px solid var(--ma-grid);
}
.conversion-summary > div {
  padding: 12px 14px;
  border-right: 1px solid var(--ma-grid);
}
.conversion-summary > div:last-child {
  border-right: 0;
}
.conversion-summary dt {
  color: var(--ma-muted);
  font-size: 12px;
}
.conversion-summary dt small {
  margin-left: 5px;
}
.conversion-summary dd {
  margin: 5px 0 0;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
}
.early-table-wrap {
  overflow-x: auto;
}
.early-table {
  width: 100%;
  min-width: 530px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.early-table th,
.early-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  font-size: 14px;
}
.early-table th:first-child {
  text-align: left;
  font-weight: 500;
}
.early-table thead th {
  color: var(--ma-muted);
  font-size: 12px;
  font-weight: 500;
  background: var(--ma-grid);
}
.early-table button {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  padding: 4px 6px;
  cursor: pointer;
}
.early-table button[aria-pressed='true'] {
  border-color: var(--la-color-link);
  background: var(--ma-hover);
}
.early-table td:last-child {
  width: 30%;
}
@media (max-width: 760px) {
  .conversion-summary > div {
    padding: 8px;
  }
  .conversion-summary dt small {
    display: block;
    margin: 4px 0 0;
  }
  .conversion-summary dd {
    font-size: 18px;
  }
}
.conversion-summary {
  border-top: 0;
  gap: 24px;
  padding: 8px 0 20px;
}
.conversion-summary > div {
  padding: 0;
  border: 0;
}
.conversion-summary dt small {
  display: block;
  margin: 5px 0 0;
  font-size: 12px;
}
.conversion-summary dd {
  margin-top: 12px;
  font-size: 30px;
  font-weight: 600;
  color: var(--la-color-text-primary);
}
.early-table thead th {
  background: transparent;
}
.early-table tbody tr:hover,
.early-table tr.is-selected {
  background: var(--ma-hover);
}
@media (max-height: 680px) {
  .conversion-summary {
    padding-bottom: 10px;
  }
  .conversion-summary dd {
    font-size: 24px;
    margin-top: 6px;
  }
}
</style>
