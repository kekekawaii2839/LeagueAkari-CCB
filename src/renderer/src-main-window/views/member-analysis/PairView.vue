<template>
  <div class="ma-panel ma-workspace">
    <header class="ma-view-heading">
      <h2>双人组合表现</h2>
      <span>{{ rows.length }} 组 · 按场数排序，少量样本保留</span>
    </header>
    <div class="pair-controls">
      <NRadioGroup v-model:value="pairType"
        ><NRadioButton v-for="(name, value) in names" :key="value" :value="value">{{
          name
        }}</NRadioButton></NRadioGroup
      >
      <NSelect v-model:value="metric" :options="[...metricOptions]" aria-label="组合比较指标" />
    </div>
    <p class="ma-chart-note">{{ uiText('rateLegend') }}</p>
    <div v-if="!rows.length" class="ma-empty">{{ uiText('noData') }}</div>
    <div v-else class="pair-table-wrap">
      <table class="pair-table">
        <thead>
          <tr>
            <th>成员组合</th>
            <th>场数</th>
            <th>胜率 · 胜 / 负</th>
            <th>
              {{ metricLabel
              }}<small class="pair-scale"
                >−{{ formatMetric(domain) }} · 0 · +{{ formatMetric(domain) }}</small
              >
            </th>
            <th>详情</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in rows" :key="row.pair"
            ><tr>
              <th scope="row">{{ cleanPair(row.pair) }}</th>
              <td>{{ row.games }}</td>
              <td>
                <div>
                  {{ formatMetric(row.winRate, 'pct') }} · {{ row.wins }} /
                  {{ row.games - row.wins }}
                </div>
                <WinRateInterval :wins="row.wins" :games="row.games" />
              </td>
              <td>
                <div class="pair-value">
                  <strong :class="toneClass(row[metric])">{{ formatSigned(row[metric], 1) }}</strong
                  ><span class="pair-track" aria-hidden="true"
                    ><i
                      v-if="finiteOrNull(row[metric]) !== null"
                      :class="toneClass(row[metric])"
                      :style="barStyle(row[metric])"
                  /></span>
                </div>
              </td>
              <td>
                <NButton
                  size="small"
                  :aria-expanded="selected === row.pair"
                  @click="selected = selected === row.pair ? '' : row.pair"
                  >{{ selected === row.pair ? '收起' : '展开' }}</NButton
                >
              </td>
            </tr>
            <tr v-if="selected === row.pair">
              <td colspan="5" class="pair-detail">
                <dl>
                  <div v-for="option in metricOptions" :key="option.value">
                    <dt>{{ option.label }}</dt>
                    <dd>{{ formatSigned(row[option.value], 1) }}</dd>
                  </div>
                </dl>
                <p>
                  OP.GG 线杀率参考差值：{{
                    row.counterMean === null
                      ? '— 无参考数据'
                      : uiText('percentagePoints', {
                          value: formatSigned(row.counterMean * 100, 1)
                        })
                  }}
                </p>
                <p v-for="side in sideRows(row)" :key="side.sideLabel">
                  {{ side.sideLabel }} · {{ side.games }} 场 ·
                  {{ formatMetric(side.winRate, 'pct') }}
                </p>
              </td>
            </tr></template
          >
        </tbody>
      </table>
    </div>
  </div>
</template>
<script setup lang="ts">
import { NButton, NRadioButton, NRadioGroup, NSelect } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric } from './metric-defs'
import { finiteOrNull, formatSigned } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import { uiText } from './ui-text'
const { pairs } = useMemberAnalysisData()
const names = { upper_pair: '上野', mid_jg_pair: '中野', bot_pair: '下辅' } as const
const pairType = ref<keyof typeof names>('upper_pair')
const metricOptions = [
  { value: 'upperGold15', label: '15 分钟上半区经济差（金币）' },
  { value: 'botGold15', label: '15 分钟下半区经济差（金币）' },
  { value: 'gold20Diff', label: '20 分钟经济差（金币）' },
  { value: 'tower20Diff', label: '20 分钟防御塔差（座）' },
  { value: 'objectiveFight15Diff', label: '15 分钟资源团净击杀（次）' },
  { value: 'dragon15Diff', label: '15 分钟小龙差（条）' },
  { value: 'grub15Diff', label: '15 分钟巢虫差（只）' }
] as const
const metric = ref<(typeof metricOptions)[number]['value']>('upperGold15')
const metricLabel = computed(
  () => metricOptions.find((option) => option.value === metric.value)?.label
)
const rows = computed(() =>
  pairs.value
    .filter((row) => row.pairType === pairType.value && row.sideLabel === '总计')
    .sort((a, b) => b.games - a.games)
)
const domain = computed(() =>
  Math.max(1, ...rows.value.map((row) => Math.abs(finiteOrNull(row[metric.value]) ?? 0)))
)
const barStyle = (value: unknown) => {
  const n = finiteOrNull(value) ?? 0
  return {
    width: `${(Math.abs(n) / domain.value) * 50}%`,
    left: `${n < 0 ? 50 - (Math.abs(n) / domain.value) * 50 : 50}%`
  }
}
const selected = ref('')
watch(rows, (value) => {
  if (!value.some((row) => row.pair === selected.value)) selected.value = ''
})
const cleanPair = (value: string) =>
  value
    .split(' + ')
    .map((name) => name.split('#')[0])
    .join(' × ')
const sideRows = (row: (typeof pairs.value)[number]) =>
  pairs.value.filter(
    (candidate) =>
      candidate.pair === row.pair &&
      candidate.pairType === row.pairType &&
      candidate.sideLabel !== '总计'
  )
const toneClass = (value: unknown) => {
  const n = finiteOrNull(value)
  return n === null || n === 0 ? '' : n > 0 ? 'ma-positive' : 'ma-negative'
}
</script>
<style scoped>
.pair-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
}
.pair-controls :deep(.n-select) {
  width: 280px;
}
.pair-table-wrap {
  overflow-x: auto;
}
.pair-table {
  border-collapse: collapse;
  width: 100%;
  min-width: 650px;
  font-variant-numeric: tabular-nums;
}
.pair-table th,
.pair-table td {
  padding: 12px 16px;
  text-align: right;
  border-bottom: 1px solid var(--ma-grid);
}
.pair-table th:first-child {
  text-align: left;
  max-width: 230px;
  overflow-wrap: anywhere;
  font-weight: 500;
}
.pair-table thead {
  background: var(--ma-grid);
  color: var(--ma-muted);
}
.pair-table thead th {
  font-size: 12px;
  font-weight: 500;
}
.pair-table td:nth-child(3) {
  min-width: 140px;
}
.pair-table td.pair-detail {
  text-align: left;
  padding: 16px;
  background: var(--ma-hover);
}
.pair-detail dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}
.pair-detail dt,
.pair-detail p {
  color: var(--ma-muted);
  font-size: 12px;
}
.pair-detail dd {
  margin: 4px 0 0;
}
.pair-scale {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  font-weight: 400;
}
.pair-value {
  display: grid;
  gap: 8px;
  min-width: 140px;
}
.pair-value strong {
  font-size: 18px;
  font-weight: 600;
}
.pair-track {
  position: relative;
  display: block;
  height: 10px;
  background: linear-gradient(var(--ma-grid), var(--ma-grid)) center/100% 1px no-repeat;
}
.pair-track::after {
  content: '';
  position: absolute;
  left: 50%;
  top: -3px;
  bottom: -3px;
  width: 1px;
  background: var(--ma-muted);
}
.pair-track i {
  position: absolute;
  height: 100%;
  background: currentColor;
  border-radius: 2px;
}
.pair-table thead {
  background: transparent;
}
.pair-table tbody tr:hover {
  background: var(--ma-hover);
}
</style>
