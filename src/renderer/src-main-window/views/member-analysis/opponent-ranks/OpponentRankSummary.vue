<template>
  <section class="rank-summary" aria-label="对手段位快照统计">
    <div class="rank-body">
      <NSelect
        v-model:value="queue"
        :options="queueOptions"
        aria-label="对手段位排位队列"
        class="queue-select"
      />
      <p>
        沿用顶部筛选并排除不足 15 分钟对局；{{ stats.totalGames }} 场、{{
          stats.appearances
        }}
        个对手出场记录。已定级 {{ stats.ranked }}，未定级 {{ stats.unranked }}，定级中
        {{ stats.provisional }}，缺失/失败 {{ stats.missing }}，暂未查询 {{ stats.paused }}，旧快照
        {{ stats.stale }}，未采集 {{ stats.notLoaded }}。
      </p>
      <p v-if="stats.lastFetchedAt">
        快照查询时间（本地）：{{ snapshotTime(stats.firstFetchedAt) }} 至
        {{ snapshotTime(stats.lastFetchedAt) }}
      </p>
      <p v-else>
        尚无成功段位快照。请连接对应区服客户端后使用页面顶部“刷新”；旧数据不会自动补成段位。
      </p>
      <p>
        段位分布按对手出场次数计数（同一人可重复）。分组胜率每场只计一次，按可用已定级对手的平均段位归入大段；
        纳入 {{ stats.ratedGames }}/{{ stats.totalGames }} 场，其中
        {{ stats.partialGames }} 场不足五人可用。
        未定级、定级中、缺失或旧快照不参与平均；无人可用时不计算。
      </p>
      <div
        class="rank-table-wrap"
        tabindex="0"
        role="region"
        aria-label="段位分布与分组历史胜率表，可横向滚动"
      >
        <table>
          <caption>
            对手查询时段位分布 / 按对手平均段位分组的历史胜率
          </caption>
          <thead>
            <tr>
              <th scope="col">大段</th>
              <th scope="col">对手出场次数</th>
              <th scope="col">分组对局</th>
              <th scope="col">胜场</th>
              <th scope="col">历史胜率</th>
              <th scope="col">95% 区间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stats.rows" :key="row.tier">
              <th scope="row">{{ RANK_TIER_NAMES[row.tier] }}</th>
              <td>{{ row.appearances }}</td>
              <td>{{ row.games }}<span v-if="row.games > 0 && row.games < 10"> · 样本少</span></td>
              <td>{{ row.games ? row.wins : '—' }}</td>
              <td>{{ percent(row.winRate) }}</td>
              <td>
                {{
                  row.interval ? `${percent(row.interval.low)}–${percent(row.interval.high)}` : '—'
                }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>{{ uiText('rankSource') }}</p>
      <p>{{ uiText('rankComparisonLimit') }}</p>
    </div>
  </section>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { RANK_TIER_NAMES, type RankQueue } from '@shared/shards/member-analysis/opponent-ranks'
import { NSelect } from 'naive-ui'
import { computed, ref } from 'vue'
import { summarizeOpponentRanks } from './analysis'
import { snapshotTime } from './format'
import { uiText } from '../ui-text'
const props = defineProps<{ games: MemberAnalysisGame[] }>()
const queue = ref<RankQueue>('flex')
const queueOptions = [
  { label: '灵活组排段位', value: 'flex' },
  { label: '单双排段位', value: 'solo' }
]
const stats = computed(() => summarizeOpponentRanks(props.games, queue.value))
const percent = (value: number | null) => (value === null ? '—' : `${(100 * value).toFixed(1)}%`)
</script>
<style scoped>
.rank-summary {
  border-block: 1px solid var(--ma-grid);
  padding-block: 16px;
  margin-block: 12px;
  min-width: 0;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
h2,
h3 {
  font-size: 14px;
  margin: 0 0 4px;
}
header span {
  color: var(--ma-muted);
  font-size: 12px;
}
.rank-body {
  display: grid;
  gap: 12px;
  margin-top: 16px;
  min-width: 0;
}
p {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.queue-select {
  width: 200px;
  max-width: 100%;
}
.rank-table-wrap {
  overflow-x: auto;
  border-radius: 4px;
}
.rank-table-wrap:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 630px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
caption {
  text-align: left;
  padding-bottom: 8px;
}
th,
td {
  text-align: right;
  padding: 9px 12px;
  border-bottom: 1px solid var(--ma-grid);
}
th:first-child {
  text-align: left;
}
thead th {
  color: var(--ma-muted);
  font-weight: 500;
}
tbody th {
  font-weight: 500;
}
td span {
  color: var(--ma-muted);
  font-size: 12px;
}
</style>
