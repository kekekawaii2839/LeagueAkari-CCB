<template>
  <div ref="root" class="ma-panel ma-workspace ma-results">
    <div class="ma-view-toolbar">
      <NRadioGroup v-model:value="timing" size="small" aria-label="前期经济时刻"
        ><NRadioButton value="15">15 分钟</NRadioButton
        ><NRadioButton value="20">20 分钟</NRadioButton></NRadioGroup
      >
      <NSelect
        v-if="compact"
        v-model:value="group"
        class="early-group-select"
        :options="groupOptions"
        :render-label="renderGroupLabel"
        aria-label="经济差分组"
        :consistent-menu-width="false"
      />
      <span v-if="!compact" class="ma-view-meta"
        >完整经济 {{ rows.length }} / {{ games.length }} 场 · 其余不计入分档</span
      >
    </div>
    <div v-if="!compact" class="early-groups" role="group" aria-label="经济差分组">
      <NButton
        v-for="item in earlyGroups"
        :key="item.key"
        size="small"
        class="early-group-button"
        :secondary="group === item.key"
        :type="group === item.key ? 'primary' : 'default'"
        :aria-pressed="group === item.key"
        @click="group = item.key"
      >
        {{ item.label }} · {{ groupCount(item.key) }} 场
        <span v-if="item.boundary" class="ma-view-meta">{{ item.boundary }} 金币</span>
      </NButton>
    </div>
    <p v-if="!rows.length" class="ma-chart-note">{{ uiText('noEarlyGames') }}</p>
    <section class="ma-result-table-wrap" aria-label="经济差分档与胜率">
      <table class="ma-result-table early-table">
        <colgroup>
          <col />
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">五路经济差（金币）</th>
            <th scope="col">场数</th>
            <th scope="col">胜 / 负</th>
            <th scope="col">胜率与 95% 区间<small class="rate-scale">0% — 50% — 100%</small></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="bucket in visibleBuckets"
            :key="bucket.label"
            :class="{ 'is-selected': selectedBucket === bucket.label }"
          >
            <th scope="row">
              <button
                type="button"
                class="early-bucket-button"
                :aria-pressed="selectedBucket === bucket.label"
                @click="selectBucket(bucket.label, $event)"
              >
                {{ earlyBucketLabel(bucket.label)
                }}<small v-if="selectedBucket === bucket.label" class="ma-result-selected"
                  >已选</small
                >
              </button>
            </th>
            <td>{{ bucket.games }}</td>
            <td>{{ bucket.wins }} / {{ bucket.games - bucket.wins }}</td>
            <td>
              <div class="early-rate">
                <span
                  ><MetricHelp
                    :label="formatMetric(bucket.winRate, 'pct')"
                    :definition="bucket.intervalNote"
                  /><small v-if="bucket.games === 1">1 场样本</small></span
                ><WinRateInterval
                  :wins="bucket.wins"
                  :games="bucket.games"
                  :low="bucket.games === 1"
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p class="ma-chart-note">{{ uiText('earlyResultNote') }}</p>
    <div class="ma-section-title">
      <strong
        >{{ uiText('matchingGames')
        }}<template v-if="selectedBucket">
          · {{ earlyBucketLabel(selectedBucket) }} 金币</template
        ></strong
      >
      <NButton v-if="selectedBucket" size="small" quaternary @click="clearSelection">{{
        uiText('clearSelection')
      }}</NButton>
      <span v-else class="ma-view-meta"
        >{{ earlyGroups.find((item) => item.key === group)?.label }} ·
        {{ evidenceGames.length }} 场</span
      >
    </div>
    <p v-if="notice" class="ma-chart-note" role="status">{{ notice }}</p>
    <MemberAnalysisEvidenceTable
      :games="evidenceGames"
      :columns="gameColumns"
      :context-key="`${timing}|${group}|${selectedBucket}`"
      :scroll-x="650"
    >
      <template #detail="{ game }"
        ><p class="ma-chart-note">
          {{ timing }} 分钟五路经济差：{{ formatSigned(earlyGoldDiff(game, timing)) }} 金币
        </p></template
      >
    </MemberAnalysisEvidenceTable>
  </div>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  NButton,
  NRadioButton,
  NRadioGroup,
  NSelect,
  type SelectOption,
  type DataTableColumns
} from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { aggregateEarlyBuckets, earlyGoldDiff } from './analytics'
import {
  earlyBucketLabel,
  earlyBucketMatches,
  earlyGroupMatches,
  earlyGroups,
  earlyResultRows,
  type EarlyGroup
} from './early-results'
import MemberAnalysisEvidenceTable from './MemberAnalysisEvidenceTable.vue'
import WinRateInterval from './WinRateInterval.vue'
import MetricHelp from './MetricHelp.vue'
import { formatMetric } from './metric-defs'
import { uiText } from './ui-text'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatSigned, wilsonInterval } from './visualization'
const { games } = useMemberAnalysisData()
const root = ref<HTMLElement | null>(null)
const compact = ref(false)
let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    compact.value = entry.contentRect.width > 0 && entry.contentRect.width < 560
  })
  if (root.value) resizeObserver.observe(root.value)
})
onUnmounted(() => resizeObserver?.disconnect())
const timing = ref<'15' | '20'>('15')
const group = ref<EarlyGroup>('all')
const selectedBucket = ref('')
const notice = ref('')
let trigger: HTMLElement | null = null
const rows = computed(() => earlyResultRows(games.value, timing.value))
const buckets = computed(() =>
  aggregateEarlyBuckets(rows.value).map((bucket) => {
    const interval = wilsonInterval(bucket.wins, bucket.games)
    return {
      ...bucket,
      intervalNote: interval
        ? uiText('rateDescription', {
            label: uiText('rate'),
            value: formatMetric(bucket.winRate, 'pct'),
            wins: bucket.wins,
            games: bucket.games,
            low: formatMetric(interval.low, 'pct'),
            high: formatMetric(interval.high, 'pct')
          })
        : uiText('noRate')
    }
  })
)
const visibleBuckets = computed(() =>
  buckets.value.filter(
    (_, index) =>
      group.value === 'all' ||
      (group.value === 'behind' ? index < 3 : group.value === 'neutral' ? index === 3 : index > 3)
  )
)
const groupCount = (key: EarlyGroup) =>
  rows.value.filter((row) => earlyGroupMatches(row.diff, key)).length
const groupOptions = computed(() =>
  earlyGroups.map((item) => ({
    value: item.key,
    label: `${item.label} · ${groupCount(item.key)} 场${item.boundary ? ` · ${item.boundary} 金币` : ''}`
  }))
)
const renderGroupLabel = (option: SelectOption, selected: boolean) => {
  if (!selected) return String(option.label)
  const item = earlyGroups.find((item) => item.key === option.value)
  return `${item?.label ?? ''}${item?.key === 'all' ? '' : ` ${groupCount(item?.key ?? 'all')} 场`} · 完整 ${rows.value.length}/${games.value.length} 场`
}
function selectBucket(label: string, event: MouseEvent) {
  trigger = event.currentTarget as HTMLElement
  selectedBucket.value = selectedBucket.value === label ? '' : label
  notice.value = ''
}
async function clearSelection() {
  selectedBucket.value = ''
  await nextTick()
  if (trigger?.isConnected) {
    trigger.scrollIntoView({ block: 'nearest' })
    trigger.focus({ preventScroll: true })
  }
}
watch([timing, group], () => {
  selectedBucket.value = ''
  notice.value = ''
})
watch(buckets, (next, previous) => {
  const label = selectedBucket.value
  if (
    label &&
    previous?.find((bucket) => bucket.label === label)?.games &&
    !next.find((bucket) => bucket.label === label)?.games
  ) {
    selectedBucket.value = ''
    notice.value = uiText('selectionUnavailable')
  }
})
const evidenceRows = computed(() =>
  rows.value
    .filter(
      (row) =>
        earlyGroupMatches(row.diff, group.value) &&
        (!selectedBucket.value || earlyBucketMatches(row, selectedBucket.value))
    )
    .sort((a, b) => b.game.timestamp - a.game.timestamp)
)
const evidenceGames = computed(() => evidenceRows.value.map((row) => row.game))
const diffsByGame = computed(
  () => new Map(evidenceRows.value.map((row) => [row.game.gameId, row.diff]))
)
const gameColumns = computed<DataTableColumns<MemberAnalysisGame>>(() => [
  {
    title: `${timing.value} 分钟经济差（金币）`,
    key: 'diff',
    width: 175,
    sorter: (a, b) =>
      (diffsByGame.value.get(a.gameId) ?? 0) - (diffsByGame.value.get(b.gameId) ?? 0),
    render: (game) => formatSigned(diffsByGame.value.get(game.gameId))
  }
])
</script>
<style scoped>
.early-group-select {
  flex: 1 1 180px;
  min-width: 120px;
  max-width: 100%;
}
.early-groups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.early-group-button {
  height: auto;
  min-height: 32px;
  max-width: 100%;
  padding: 6px 12px;
}
.early-group-button :deep(.n-button__content) {
  white-space: normal;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.early-group-button[aria-pressed='true'] :deep(.n-button__content) {
  color: var(--la-color-text-primary);
  font-weight: 500;
}
.early-table {
  width: 100%;
  table-layout: fixed;
}
.early-table col:first-child {
  width: 34%;
}
.early-table col:nth-child(2) {
  width: 8%;
}
.early-table col:nth-child(3) {
  width: 14%;
}
.early-table col:last-child {
  width: 44%;
}
.rate-scale {
  display: block;
  margin-top: 4px;
}
.early-bucket-button {
  max-width: 100%;
  font: inherit;
  color: inherit;
  text-align: left;
  border: 0;
  border-radius: 4px;
  background: transparent;
  padding: 4px 0;
  min-height: 32px;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.early-bucket-button:focus-visible {
  outline: 2px solid var(--la-color-text-primary);
  outline-offset: 3px;
}
.early-bucket-button small {
  display: block;
}
.early-rate {
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr);
  gap: 12px;
  align-items: center;
}
.early-rate :deep(.metric-help) {
  white-space: nowrap;
}
.early-rate small {
  display: block;
}
@container ma-results (max-width: 560px) {
  .early-table col:nth-child(2) {
    width: 12%;
  }
  .early-table col:nth-child(3) {
    width: 16%;
  }
  .early-table col:last-child {
    width: 38%;
  }
}
@container ma-results (max-width: 760px) {
  .early-rate {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  .early-table th,
  .early-table td {
    padding: 8px;
  }
}
</style>
