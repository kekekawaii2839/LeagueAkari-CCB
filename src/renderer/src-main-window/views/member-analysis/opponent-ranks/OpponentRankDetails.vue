<template>
  <section class="rank-details" aria-label="本场对手查询时段位">
    <h4>
      对手查询时段位 · {{ ranks?.capture ? '含本局自动采集快照' : '事后刷新快照（非比赛当时）' }}
    </h4>
    <p v-if="ranks?.capture">
      本局采集启动：{{
        snapshotTime(ranks.capture.observedAt)
      }}；各对手以来源标记和实际查询时间为准，不能保证与开局时刻完全一致。
    </p>
    <p v-if="!ranks">未采集。连接同区服客户端后，使用页面顶部“刷新”获取；无法回溯历史段位。</p>
    <template v-else>
      <div
        class="rank-detail-scroll"
        tabindex="0"
        role="region"
        aria-label="五名对手段位表，可横向滚动"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">对手 / 分路</th>
              <th scope="col">单双排</th>
              <th scope="col">灵活组排</th>
              <th scope="col">查询时间（本地）/ 状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="opponent in ranks.opponents" :key="opponent.slot">
              <th scope="row">
                对手 {{ opponent.slot }} · {{ opponent.role ? roleNames[opponent.role] : '分路未知'
                }}<small>{{ opponent.champion ?? '英雄未知' }}</small>
              </th>
              <td>{{ queueRankText(opponent.snapshot, 'solo') }}</td>
              <td>{{ queueRankText(opponent.snapshot, 'flex') }}</td>
              <td>
                <small>{{
                  opponent.capturedDuringGame
                    ? '本局期间自动获取'
                    : opponent.snapshot.fetchedAt
                      ? '事后补查 / 非本局获取'
                      : '尚未成功获取'
                }}</small>
                {{ snapshotTime(opponent.snapshot.fetchedAt)
                }}<small v-if="opponent.snapshot.reason"
                  >{{ rankFailureText(opponent.snapshot) }} · 尝试
                  {{ snapshotTime(opponent.snapshot.attemptedAt) }}</small
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>{{ uiText('rankSource') }} · {{ ranks.serverId }}</p>
    </template>
  </section>
</template>
<script setup lang="ts">
import type { OpponentRanks } from '@shared/shards/member-analysis/opponent-ranks'
import { queueRankText, rankFailureText, snapshotTime } from './format'
import { uiText } from '../ui-text'
defineProps<{ ranks?: OpponentRanks }>()
const roleNames = { TOP: '上路', JUNGLE: '打野', MIDDLE: '中路', BOTTOM: '下路', UTILITY: '辅助' }
</script>
<style scoped>
.rank-details {
  grid-column: 1 / -1;
  min-width: 0;
  border-top: 1px solid var(--ma-grid);
  padding-top: 16px;
  color: var(--la-color-text-primary);
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  line-height: 1.5;
}
h4 {
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  margin: 0 0 8px;
}
p {
  font-size: 13px;
  line-height: 1.6;
  color: var(--ma-muted);
  margin: 8px 0 0;
}
.rank-detail-scroll {
  overflow-x: auto;
}
.rank-detail-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
table {
  width: 100%;
  min-width: 660px;
  border-collapse: collapse;
  font-size: 14px;
}
th,
td {
  padding: 9px 12px;
  text-align: left;
  border-bottom: 1px solid var(--ma-grid);
  font-weight: 400;
}
thead th {
  color: var(--ma-muted);
  font-weight: 500;
}
small {
  display: block;
  font-size: 13px;
  line-height: 20px;
  color: var(--ma-muted);
  margin-top: 4px;
}
</style>
