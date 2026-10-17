<template>
  <section
    class="rank-details"
    :class="{ 'rank-details-embedded': embedded }"
    aria-label="本场对手查询时段位"
  >
    <template v-if="embedded">
      <div class="rank-context">
        <span class="rank-context-kind">{{ uiText('matchEmbeddedRankSnapshot') }}</span>
        <span>{{ uiText('matchEmbeddedRankTiming') }}</span>
        <span v-if="ranks?.capture" class="rank-capture-time"
          >{{ uiText('matchEmbeddedRankCapture') }}
          {{ snapshotTime(ranks.capture.observedAt, uiText('matchObservedUnknown')) }}</span
        >
      </div>
      <p v-if="!ranks" role="status">{{ uiText('matchOpponentCaptureMissing') }}</p>
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
                  <div class="rank-identity">
                    <span class="rank-slot">对手 {{ opponent.slot }}</span
                    ><span class="rank-champion">{{ championLabel(opponent.champion) }}</span>
                  </div>
                  <span class="rank-role"
                    ><span class="rank-role-label"
                      ><PositionIcon
                        v-if="knownRole(opponent.role)"
                        class="rank-role-icon"
                        :position="opponent.role ?? undefined"
                        aria-hidden="true"
                      /><span>{{ roleLabel(opponent.role) }}</span></span
                    ></span
                  >
                </th>
                <td>
                  <span class="rank-entry">
                    <img
                      v-if="rankMedal(opponent.snapshot, 'solo')"
                      :src="rankMedal(opponent.snapshot, 'solo')"
                      :data-tier="
                        opponent.snapshot.solo.status === 'ranked'
                          ? opponent.snapshot.solo.rank.tier
                          : undefined
                      "
                      class="rank-medal"
                      width="24"
                      height="24"
                      alt=""
                    />
                    <span
                      class="rank-value"
                      :class="{ 'rank-value-missing': opponent.snapshot.solo.status === 'missing' }"
                      >{{ queueRankText(opponent.snapshot, 'solo') }}</span
                    >
                  </span>
                </td>
                <td>
                  <span class="rank-entry">
                    <img
                      v-if="rankMedal(opponent.snapshot, 'flex')"
                      :src="rankMedal(opponent.snapshot, 'flex')"
                      :data-tier="
                        opponent.snapshot.flex.status === 'ranked'
                          ? opponent.snapshot.flex.rank.tier
                          : undefined
                      "
                      class="rank-medal"
                      width="24"
                      height="24"
                      alt=""
                    />
                    <span
                      class="rank-value"
                      :class="{ 'rank-value-missing': opponent.snapshot.flex.status === 'missing' }"
                      >{{ queueRankText(opponent.snapshot, 'flex') }}</span
                    >
                  </span>
                </td>
                <td>
                  <span class="rank-query-time">{{
                    snapshotTime(opponent.snapshot.fetchedAt, uiText('matchFetchedMissing'))
                  }}</span>
                  <span v-if="opponent.capturedDuringGame" class="rank-state">{{
                    uiText('matchEmbeddedRankLive')
                  }}</span>
                  <span v-if="opponent.snapshot.reason" class="rank-state">{{
                    rankFailureText(opponent.snapshot)
                  }}</span>
                  <span v-if="opponent.snapshot.reason" class="rank-attempt"
                    >{{
                      opponent.snapshot.reason === 'budget-exhausted'
                        ? uiText('rankRecordedAt')
                        : '尝试'
                    }}
                    {{
                      snapshotTime(opponent.snapshot.attemptedAt, uiText('matchAttemptedUnknown'))
                    }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="rank-source">{{ uiText('rankSource') }} · {{ ranks.serverId }}</p>
      </template>
    </template>
    <template v-else>
      <h4>{{ uiText('matchOpponentRankTitle') }}</h4>
      <p v-if="ranks?.capture">
        {{
          uiText('matchOpponentCaptureHelp', {
            time: snapshotTime(ranks.capture.observedAt, uiText('matchObservedUnknown'))
          })
        }}
      </p>
      <p v-if="!ranks">{{ uiText('matchOpponentCaptureMissing') }}</p>
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
                  对手 {{ opponent.slot }} ·
                  <span class="rank-role-label"
                    ><PositionIcon
                      v-if="knownRole(opponent.role)"
                      class="rank-role-icon"
                      :position="opponent.role ?? undefined"
                      aria-hidden="true"
                    /><span>{{ roleLabel(opponent.role) }}</span></span
                  ><small>{{ championLabel(opponent.champion) }}</small>
                </th>
                <td>
                  <span class="rank-entry">
                    <img
                      v-if="rankMedal(opponent.snapshot, 'solo')"
                      :src="rankMedal(opponent.snapshot, 'solo')"
                      :data-tier="
                        opponent.snapshot.solo.status === 'ranked'
                          ? opponent.snapshot.solo.rank.tier
                          : undefined
                      "
                      class="rank-medal"
                      width="24"
                      height="24"
                      alt=""
                    />
                    <span>{{ queueRankText(opponent.snapshot, 'solo') }}</span>
                  </span>
                </td>
                <td>
                  <span class="rank-entry">
                    <img
                      v-if="rankMedal(opponent.snapshot, 'flex')"
                      :src="rankMedal(opponent.snapshot, 'flex')"
                      :data-tier="
                        opponent.snapshot.flex.status === 'ranked'
                          ? opponent.snapshot.flex.rank.tier
                          : undefined
                      "
                      class="rank-medal"
                      width="24"
                      height="24"
                      alt=""
                    />
                    <span>{{ queueRankText(opponent.snapshot, 'flex') }}</span>
                  </span>
                </td>
                <td>
                  <small>{{
                    opponent.capturedDuringGame
                      ? uiText('matchLegacyRankLiveMarked')
                      : opponent.snapshot.fetchedAt
                        ? uiText('matchLegacyRankSnapshot')
                        : uiText('matchFetchedMissing')
                  }}</small>
                  {{ snapshotTime(opponent.snapshot.fetchedAt, uiText('matchFetchedMissing'))
                  }}<small v-if="opponent.snapshot.reason"
                    >{{ rankFailureText(opponent.snapshot) }} ·
                    {{
                      opponent.snapshot.reason === 'budget-exhausted'
                        ? uiText('rankRecordedAt')
                        : '尝试'
                    }}
                    {{
                      snapshotTime(opponent.snapshot.attemptedAt, uiText('matchAttemptedUnknown'))
                    }}</small
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>{{ uiText('rankSource') }} · {{ ranks.serverId }}</p>
      </template>
    </template>
  </section>
</template>
<script setup lang="ts">
import type {
  OpponentRanks,
  PlayerRankSnapshot,
  RankQueue,
  RankValue
} from '@shared/shards/member-analysis/opponent-ranks'
import IronMedal from '@renderer-shared/assets/ranked-icons-large/iron.png'
import BronzeMedal from '@renderer-shared/assets/ranked-icons-large/bronze.png'
import SilverMedal from '@renderer-shared/assets/ranked-icons-large/silver.png'
import GoldMedal from '@renderer-shared/assets/ranked-icons-large/gold.png'
import PlatinumMedal from '@renderer-shared/assets/ranked-icons-large/platinum.png'
import EmeraldMedal from '@renderer-shared/assets/ranked-icons-large/emerald.png'
import DiamondMedal from '@renderer-shared/assets/ranked-icons-large/diamond.png'
import MasterMedal from '@renderer-shared/assets/ranked-icons-large/master.png'
import GrandmasterMedal from '@renderer-shared/assets/ranked-icons-large/grandmaster.png'
import ChallengerMedal from '@renderer-shared/assets/ranked-icons-large/challenger.png'
import { queueRankText, rankFailureText, snapshotTime } from './format'
import { uiText } from '../ui-text'
import { computed } from 'vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
defineProps<{ ranks?: OpponentRanks; embedded?: boolean }>()
const medals: Record<RankValue['tier'], string> = {
  IRON: IronMedal,
  BRONZE: BronzeMedal,
  SILVER: SilverMedal,
  GOLD: GoldMedal,
  PLATINUM: PlatinumMedal,
  EMERALD: EmeraldMedal,
  DIAMOND: DiamondMedal,
  MASTER: MasterMedal,
  GRANDMASTER: GrandmasterMedal,
  CHALLENGER: ChallengerMedal
}
const rankMedal = (snapshot: PlayerRankSnapshot, queue: RankQueue) => {
  const value = snapshot[queue]
  return value.status === 'ranked' ? medals[value.rank.tier] : undefined
}
const league = useLeagueClientStore()
const championKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
const championLabels = computed(() => {
  const labels = new Map<string, string>()
  for (const champion of Object.values(league.gameData.champions)) {
    if (!champion.name.trim()) continue
    labels.set(String(champion.id), champion.name)
    labels.set(championKey(champion.alias), champion.name)
    labels.set(championKey(champion.name), champion.name)
  }
  return labels
})
const championLabel = (value: string | null) =>
  value ? (championLabels.value.get(championKey(value)) ?? value) : '英雄未知'
const roleNames = { TOP: '上路', JUNGLE: '打野', MIDDLE: '中路', BOTTOM: '下路', UTILITY: '辅助' }
const knownRole = (value: string | null): value is keyof typeof roleNames =>
  value !== null && Object.prototype.hasOwnProperty.call(roleNames, value)
const roleLabel = (value: string | null) => (knownRole(value) ? roleNames[value] : '分路未知')
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
.rank-details-embedded {
  border-top: 0;
  padding-top: 0;
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
.rank-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.rank-entry > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.rank-medal {
  display: block;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  object-fit: contain;
  /* Align the artwork with the neighboring text, not just its line box. */
  transform: translateY(1px);
}
.rank-medal[data-tier='BRONZE'],
.rank-medal[data-tier='SILVER'] {
  /* These native emblems already have lower artwork within the same box. */
  transform: none;
}
.rank-medal[data-tier='IRON'] {
  /* The iron emblem's painted center sits lower than the other native tiers. */
  transform: translateY(-1.5px);
}
.rank-medal[data-tier='CHALLENGER'] {
  /* Preserve the crown's additional 2px correction; total shift is only 3px. */
  transform: translateY(3px);
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
.rank-details-embedded {
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
}
.rank-context {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
  margin-bottom: 8px;
  color: var(--ma-muted);
  font-size: 12px;
}
.rank-context-kind {
  color: var(--la-color-text-primary);
  font-weight: 500;
}
.rank-capture-time {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.rank-details-embedded .rank-detail-scroll {
  border: 1px solid var(--ma-grid);
  border-radius: 4px;
}
.rank-details-embedded table {
  table-layout: fixed;
  font-family: inherit;
  font-size: 13px;
}
.rank-details-embedded th,
.rank-details-embedded td {
  padding: 8px 10px;
  vertical-align: middle;
}
.rank-details-embedded thead th {
  background: rgb(var(--la-card-border-rgb) / 0.06);
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
}
.rank-details-embedded thead th:first-child {
  width: 22%;
}
.rank-details-embedded thead th:nth-child(2),
.rank-details-embedded thead th:nth-child(3) {
  width: 21%;
}
.rank-details-embedded tbody tr:last-child th,
.rank-details-embedded tbody tr:last-child td {
  border-bottom: 0;
}
.rank-identity {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
}
.rank-champion {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
}
.rank-slot {
  font-size: 12px;
  color: var(--ma-muted);
}
.rank-champion,
.rank-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--la-color-text-primary);
}
.rank-role,
.rank-state,
.rank-attempt {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 18px;
}
.rank-role {
  margin-top: 2px;
}
.rank-role-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  vertical-align: middle;
}
.rank-role-label > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.rank-role-icon {
  width: 14px;
  height: 14px;
  font-size: 14px;
  flex: 0 0 14px;
}
.rank-value-missing {
  color: var(--ma-muted);
  font-weight: 400;
}
.rank-query-time,
.rank-attempt {
  font-variant-numeric: tabular-nums;
}
.rank-query-time {
  display: block;
  font-size: 13px;
  color: var(--la-color-text-primary);
  line-height: 20px;
}
.rank-details-embedded .rank-source {
  font-size: 12px;
  line-height: 18px;
  margin-top: 6px;
}
</style>
