<template>
  <section class="rank-summary" :aria-label="uiText('rankTabTitle')">
    <header class="rank-heading">
      <div>
        <h2>{{ uiText('rankTabTitle') }}</h2>
        <p>{{ uiText('rankSnapshotTitle') }}</p>
      </div>
      <NRadioGroup v-model:value="queue" size="small" :aria-label="uiText('rankQueue')">
        <NRadioButton value="flex">{{ uiText('rankFlex') }}</NRadioButton>
        <NRadioButton value="solo">{{ uiText('rankSolo') }}</NRadioButton>
      </NRadioGroup>
    </header>
    <p v-if="!stats.totalGames" class="rank-recovery">
      {{ uiText('rankEmptyMatches') }}
    </p>
    <p v-else-if="!stats.lastFetchedAt" class="rank-recovery">
      {{ uiText('rankRecovery') }}
    </p>
    <div class="rank-columns">
      <div class="rank-comparison">
        <div
          class="rank-table-wrap"
          tabindex="0"
          role="region"
          :aria-label="uiText('rankTableTitle')"
        >
          <table>
            <caption class="sr-only">
              {{
                uiText('rankTableTitle')
              }}
            </caption>
            <colgroup>
              <col class="identity-col" />
              <col />
              <col />
              <col class="sample-col" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{{ uiText('rankTier') }}</th>
                <th scope="col">
                  {{ uiText('rankAppearances') }}
                  <div class="rank-axis distribution-axis" aria-hidden="true">
                    <span>0</span><span>{{ scaleMax }}</span>
                  </div>
                </th>
                <th scope="col">
                  {{ uiText('rankGroupedRate') }}
                  <div class="rank-axis rate-axis" aria-hidden="true">
                    <span>0%</span><span>50%</span><span>100%</span>
                  </div>
                </th>
                <th scope="col" class="rank-sample">
                  {{ uiText('rankGroupedGames') }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in stats.rows"
                :key="row.tier"
                :class="{ selected: selected?.tier === row.tier }"
                @click="selectedTier = row.tier"
              >
                <th scope="row">
                  <button
                    class="rank-identity"
                    type="button"
                    :aria-pressed="selected?.tier === row.tier"
                    :aria-label="rowLabel(row)"
                    @click.stop="selectedTier = row.tier"
                  >
                    <img :src="medals[row.tier]" alt="" />
                    <span>{{ tierName(row.tier) }}</span>
                  </button>
                </th>
                <td>
                  <div class="rank-distribution">
                    <span class="rank-track" aria-hidden="true"
                      ><i
                        :style="{
                          width: `${(row.appearances / scaleMax) * 100}%`
                        }"
                    /></span>
                    <b>{{ row.appearances }}</b>
                  </div>
                </td>
                <td>
                  <div class="rank-rate">
                    <WinRateInterval
                      :wins="row.wins"
                      :games="row.games"
                      :low="row.games > 0 && row.games < 10"
                      :label="uiText('rankGroupedRate')"
                    />
                    <b>{{ percent(row.winRate) }}</b>
                  </div>
                </td>
                <td class="rank-sample">
                  {{ uiText('rankGamesValue', { count: row.games }) }}
                  <small v-if="row.games > 0 && row.games < 10">{{
                    uiText('rankLowSample')
                  }}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="rank-legend">
          <span><i class="legend-dot" />{{ uiText('rankGroupedRate') }}</span>
          <span><i class="legend-line" />{{ uiText('rankWilson') }}</span>
          <span>{{ uiText('rankLowSampleLegend') }}</span>
        </div>
      </div>
      <aside class="rank-aside">
        <section class="rank-coverage" :aria-label="uiText('rankCoverage')">
          <h3>{{ uiText('rankCoverage') }}</h3>
          <div
            class="rank-coverage-number"
            :aria-label="
              uiText('rankAppearanceCoverage', {
                count: stats.ranked,
                total: stats.appearances
              })
            "
          >
            {{ stats.ranked
            }}<small>{{ uiText('rankAppearanceTotal', { total: stats.appearances }) }}</small>
          </div>
          <div class="rank-coverbar" aria-hidden="true">
            <i :style="{ width: `${coverage === null ? 0 : coverage * 100}%` }" />
          </div>
          <dl>
            <div>
              <dt>{{ uiText('rankCoverageShare') }}</dt>
              <dd>{{ percent(coverage) }}</dd>
            </div>
            <div>
              <dt>{{ uiText('rankGamesIncluded') }}</dt>
              <dd>
                {{
                  uiText('rankGameFraction', {
                    count: stats.ratedGames,
                    total: stats.totalGames
                  })
                }}
              </dd>
            </div>
            <div>
              <dt>{{ uiText('rankPartialGames') }}</dt>
              <dd>
                {{ uiText('rankGamesValue', { count: stats.partialGames }) }}
              </dd>
            </div>
            <div v-for="item in unavailableStatuses" :key="item.key">
              <dt>{{ uiText(item.key) }}</dt>
              <dd>
                {{ uiText('rankAppearancesValue', { count: item.count }) }}
              </dd>
            </div>
          </dl>
        </section>
        <section class="rank-selection" :aria-label="uiText('rankSelected')" aria-live="polite">
          <template v-if="selected">
            <div class="rank-selection-heading">
              <img :src="medals[selected.tier]" alt="" />
              <div>
                <strong>{{ tierName(selected.tier) }}</strong
                ><small>{{ uiText('rankSelected') }}</small>
              </div>
            </div>
            <div class="rank-selected-rate">
              {{ percent(selected.winRate) }}<small>{{ uiText('rankGroupedRate') }}</small>
            </div>
            <dl>
              <div>
                <dt>{{ uiText('rankWinsLosses') }}</dt>
                <dd>
                  {{
                    selected.games
                      ? uiText('rankWinsLossesValue', {
                          wins: selected.wins,
                          losses: selected.games - selected.wins
                        })
                      : '—'
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ uiText('rankWilson') }}</dt>
                <dd>{{ intervalText(selected) }}</dd>
              </div>
              <div>
                <dt>{{ uiText('rankAppearances') }}</dt>
                <dd>
                  {{
                    uiText('rankAppearancesValue', {
                      count: selected.appearances
                    })
                  }}
                </dd>
              </div>
              <div>
                <dt>{{ uiText('rankRankedShare') }}</dt>
                <dd>
                  {{ percent(stats.ranked ? selected.appearances / stats.ranked : null) }}
                </dd>
              </div>
            </dl>
          </template>
          <p v-else>{{ uiText('rankSelectPrompt') }}</p>
        </section>
      </aside>
    </div>
    <details class="rank-method">
      <summary>{{ uiText('rankMethodTitle') }}</summary>
      <div class="rank-method-body">
        <div class="rank-provenance">
          <span>{{ uiText('rankSource') }}</span>
          <span v-if="stats.lastFetchedAt">{{
            uiText(
              stats.firstFetchedAt === stats.lastFetchedAt
                ? 'rankQueryTimeSingle'
                : 'rankQueryTime',
              {
                from: snapshotTime(stats.firstFetchedAt),
                to: snapshotTime(stats.lastFetchedAt)
              }
            )
          }}</span>
        </div>
        <p>{{ uiText('rankHistoricalLimit') }}</p>
        <p>{{ uiText('rankEligibility') }}</p>
        <p>{{ uiText('rankGroupingMethod') }}</p>
        <dl class="rank-all-statuses" :aria-label="uiText('rankAllStatusCounts')">
          <div v-for="item in allStatuses" :key="item.key">
            <dt>{{ uiText(item.key) }}</dt>
            <dd>{{ item.count }}</dd>
          </div>
        </dl>
        <p>{{ uiText('rankComparisonLimit') }}</p>
        <p>{{ uiText('rankIntervalLimit') }}</p>
      </div>
    </details>
  </section>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import {
  RANK_TIER_NAMES,
  type RankQueue,
  type RankValue
} from '@shared/shards/member-analysis/opponent-ranks'
import { i18next } from '@renderer-shared/i18n'
import IronMedal from '@renderer-shared/assets/ranked-icons/iron.png'
import BronzeMedal from '@renderer-shared/assets/ranked-icons/bronze.png'
import SilverMedal from '@renderer-shared/assets/ranked-icons/silver.png'
import GoldMedal from '@renderer-shared/assets/ranked-icons/gold.png'
import PlatinumMedal from '@renderer-shared/assets/ranked-icons/platinum.png'
import EmeraldMedal from '@renderer-shared/assets/ranked-icons/emerald.png'
import DiamondMedal from '@renderer-shared/assets/ranked-icons/diamond.png'
import MasterMedal from '@renderer-shared/assets/ranked-icons/master.png'
import GrandmasterMedal from '@renderer-shared/assets/ranked-icons/grandmaster.png'
import ChallengerMedal from '@renderer-shared/assets/ranked-icons/challenger.png'
import { NRadioButton, NRadioGroup } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import WinRateInterval from '../WinRateInterval.vue'
import { uiText } from '../ui-text'
import { summarizeOpponentRanks } from './analysis'
import { snapshotTime } from './format'

const props = defineProps<{ games: MemberAnalysisGame[] }>()
type Tier = RankValue['tier']
type Row = ReturnType<typeof summarizeOpponentRanks>['rows'][number]
const medals: Record<Tier, string> = {
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
const queue = ref<RankQueue>('flex')
const stats = computed(() => summarizeOpponentRanks(props.games, queue.value))
const scaleMax = computed(() => {
  const max = Math.max(1, ...stats.value.rows.map((row) => row.appearances))
  const step = 10 ** Math.floor(Math.log10(max))
  return Math.ceil(max / step) * step
})
const coverage = computed(() =>
  stats.value.appearances ? stats.value.ranked / stats.value.appearances : null
)
const selectedTier = ref<Tier | null>(null)
let initializedSelection = false
watch(
  stats,
  (value) => {
    if (!initializedSelection && value.rows.some((row) => row.appearances || row.games)) {
      selectedTier.value = value.rows.find((row) => row.appearances || row.games)!.tier
      initializedSelection = true
    } else if (
      selectedTier.value &&
      !value.rows.some((row) => row.tier === selectedTier.value && (row.appearances || row.games))
    ) {
      selectedTier.value = null
    }
  },
  { immediate: true }
)
const selected = computed(
  () => stats.value.rows.find((row) => row.tier === selectedTier.value) ?? null
)
const allStatuses = computed(
  () =>
    [
      { key: 'rankRankedCount', count: stats.value.ranked },
      { key: 'rankUnrankedCount', count: stats.value.unranked },
      { key: 'rankProvisionalCount', count: stats.value.provisional },
      { key: 'rankMissingCount', count: stats.value.missing },
      { key: 'rankPausedCount', count: stats.value.paused },
      { key: 'rankStaleCount', count: stats.value.stale },
      { key: 'rankNotLoadedCount', count: stats.value.notLoaded }
    ] as const
)
const unavailableStatuses = computed(() =>
  allStatuses.value.slice(1).filter((item) => item.count > 0)
)
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)
const intervalText = (row: Row) =>
  row.interval ? `${percent(row.interval.low)}–${percent(row.interval.high)}` : '—'
const tierName = (tier: Tier) =>
  i18next.language.startsWith('zh')
    ? RANK_TIER_NAMES[tier]
    : tier.charAt(0) + tier.slice(1).toLowerCase()
const rowLabel = (row: Row) =>
  uiText('rankRowDescription', {
    tier: tierName(row.tier),
    appearances: row.appearances,
    games: row.games,
    wins: row.wins,
    rate: percent(row.winRate),
    interval: intervalText(row)
  })
</script>
<style scoped>
.rank-summary {
  --rank-bar: color-mix(in srgb, var(--la-color-link) 70%, var(--la-color-text-primary));
  min-width: 0;
  container-type: inline-size;
  color: var(--la-color-text-primary);
  font-size: 14px;
  line-height: 1.5;
}
.rank-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px 20px;
  margin-bottom: 20px;
}
h2 {
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  margin: 0;
}
h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
p {
  margin: 0;
}
.rank-heading p {
  color: var(--ma-muted);
  font-size: 13px;
  margin-top: 4px;
}
.rank-recovery {
  margin-bottom: 20px;
  padding: 12px 0;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.rank-columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 245px;
  gap: 28px;
}
.rank-comparison {
  min-width: 0;
}
.rank-table-wrap {
  overflow-x: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 590px;
  table-layout: fixed;
  font-variant-numeric: tabular-nums;
}
.identity-col {
  width: 120px;
}
.sample-col {
  width: 92px;
}
th,
td {
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ma-grid);
  vertical-align: middle;
  font-weight: 400;
}
thead th {
  color: var(--ma-muted);
  font-weight: 500;
  font-size: 14px;
  padding-top: 0;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--ma-grid-strong);
}
thead th:first-child {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--la-color-bg-primary);
}
.rank-axis {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 400;
  margin-top: 8px;
}
.distribution-axis {
  padding-right: 46px;
}
.rate-axis {
  padding-right: 66px;
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover {
  background: var(--ma-grid);
}
tbody tr.selected {
  background: color-mix(in srgb, var(--la-color-link) 9%, transparent);
}
tbody th {
  padding: 0;
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--la-color-bg-primary);
}
tbody tr.selected th {
  background: color-mix(in srgb, var(--la-color-link) 9%, var(--la-color-bg-primary));
  box-shadow: inset 2px 0 var(--la-color-link);
}
.rank-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 48px;
  padding: 6px 12px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font: inherit;
  font-weight: 500;
}
.rank-identity img {
  width: 36px;
  height: 36px;
  object-fit: contain;
  flex: none;
}
.rank-distribution {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rank-track {
  position: relative;
  flex: 1;
  min-width: 0;
  height: 8px;
  border-radius: 2px;
  background: var(--ma-grid);
}
.rank-track i {
  display: block;
  height: 8px;
  border-radius: 2px;
  background: var(--rank-bar);
}
.rank-distribution b {
  width: 38px;
  font-weight: 500;
  text-align: right;
}
.rank-rate {
  display: flex;
  align-items: center;
  gap: 10px;
}
.rank-rate :deep(.win-rate-interval),
.rank-rate :deep(.no-rate) {
  flex: 1;
  min-width: 0;
}
.rank-rate :deep(.no-rate) {
  font-size: 13px;
  color: var(--ma-muted);
}
.rank-rate b {
  width: 56px;
  text-align: right;
  flex: none;
  font-weight: 600;
}
.rank-sample {
  text-align: right;
}
.rank-sample small {
  display: block;
  color: var(--ma-muted);
  font-size: 13px;
}
.rank-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 18px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--ma-muted);
}
.legend-dot {
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--ma-positive);
}
.legend-line {
  display: inline-block;
  width: 18px;
  height: 3px;
  margin-right: 6px;
  background: var(--ma-muted);
  vertical-align: middle;
}
.rank-aside {
  border-left: 1px solid var(--ma-grid-strong);
  padding-left: 24px;
}
.rank-coverage-number {
  font-size: 26px;
  font-weight: 600;
  line-height: 36px;
  margin: 14px 0 8px;
}
.rank-coverage-number small {
  font-size: 14px;
  color: var(--ma-muted);
  font-weight: 400;
  margin-left: 6px;
}
.rank-coverbar {
  height: 6px;
  background: var(--ma-grid);
  border-radius: 3px;
  margin: 8px 0 12px;
}
.rank-coverbar i {
  display: block;
  height: 6px;
  background: var(--rank-bar);
  border-radius: 3px;
}
dl {
  margin: 0;
}
dl > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 0;
  font-size: 13px;
}
dt {
  color: var(--ma-muted);
}
dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
  text-align: right;
  overflow-wrap: anywhere;
}
.rank-selection {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--ma-grid-strong);
}
.rank-selection-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.rank-selection-heading img {
  width: 48px;
  height: 48px;
  object-fit: contain;
}
.rank-selection-heading strong {
  font-size: 16px;
  font-weight: 600;
}
.rank-selection-heading small {
  display: block;
  font-size: 13px;
  color: var(--ma-muted);
}
.rank-selected-rate {
  font-size: 28px;
  font-weight: 600;
  margin: 14px 0 4px;
}
.rank-selected-rate small {
  font-size: 13px;
  font-weight: 400;
  color: var(--ma-muted);
  margin-left: 6px;
}
.rank-provenance {
  display: grid;
  gap: 6px;
}
.rank-method {
  margin-top: 16px;
  color: var(--ma-muted);
  font-size: 13px;
}
.rank-method summary {
  width: fit-content;
  min-height: 32px;
  padding: 6px 0;
  cursor: pointer;
  font: inherit;
  font-weight: 500;
}
.rank-method-body {
  display: grid;
  gap: 10px;
  margin-top: 10px;
}
.rank-all-statuses {
  display: flex;
  flex-wrap: wrap;
  gap: 0 20px;
}
.rank-identity:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
.rank-table-wrap:focus-visible,
.rank-method summary:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@container (max-width: 900px) {
  .rank-columns {
    grid-template-columns: 1fr;
  }
  .rank-aside {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 28px;
    border-left: 0;
    border-top: 1px solid var(--ma-grid-strong);
    padding: 18px 0 0;
  }
  .rank-selection {
    border: 0;
    padding: 0;
    margin: 0;
  }
}
@container (max-width: 620px) {
  .rank-aside {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .rank-selection {
    padding-top: 18px;
    border-top: 1px solid var(--ma-grid-strong);
  }
}
@container (min-width: 1500px) {
  .rank-columns {
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 36px;
  }
  .rank-aside {
    padding-left: 30px;
  }
  .identity-col {
    width: 155px;
  }
  .sample-col {
    width: 110px;
  }
  .rank-identity {
    min-height: 60px;
  }
  .rank-identity img {
    width: 44px;
    height: 44px;
  }
}
</style>
