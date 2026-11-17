<template>
  <div
    class="mb-1 rounded border border-black/10 p-2 last:mb-0 dark:border-[#37373c]"
    v-if="
      matchupChampionId === null &&
      champion &&
      thatPosition &&
      (thatPosition.counters.length || champion.data.counters?.length)
    "
  >
    <!-- title line (title + expand) -->
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] font-bold">
      {{ isCountersExpanded ? t('opgg.champion.allCounters') : t('opgg.champion.counter') }}
      <div class="mr-2 flex flex-wrap items-center gap-2">
        <NSwitch
          v-if="poolRole"
          size="small"
          v-model:value="onlyPool"
          :disabled="isLoading || !poolChampionIds.size"
          :theme-overrides="{
            railColor: 'var(--la-card-muted-surface)',
            railColorActive: 'var(--la-card-muted-surface)',
            textColor: 'var(--la-color-text-primary)'
          }"
          :round="false"
          :aria-label="t('opgg.champion.onlyPool')"
        >
          <template #checked>{{ t('opgg.champion.onlyPool') }}</template>
          <template #unchecked>{{ t('opgg.champion.onlyPool') }}</template>
        </NSwitch>
        <NSwitch
          size="small"
          v-model:value="isLaneKillRate"
          :disabled="isLoading"
          :theme-overrides="{
            railColor: 'var(--la-card-muted-surface)',
            railColorActive: 'var(--la-card-muted-surface)',
            textColor: 'var(--la-color-text-primary)'
          }"
          :round="false"
          :aria-label="t('opgg.champion.counterMetric')"
        >
          <template #checked>{{ t('opgg.champion.laneKillRate') }}</template>
          <template #unchecked>{{ t('opgg.champion.winRate') }}</template>
        </NSwitch>
        <NSwitch
          size="small"
          v-model:value="isCountersExpanded"
          :disabled="isLoading"
          :round="false"
          :aria-label="t('opgg.champion.counterScope')"
          :rail-style="
            ({ checked }) => ({
              backgroundColor: checked ? '#2a947d' : '#dc2626'
            })
          "
        >
          <template #checked>{{ t('opgg.champion.allC') }}</template>
          <template #unchecked>{{ t('opgg.champion.counterC') }}</template>
        </NSwitch>
      </div>
    </div>

    <div
      v-if="
        poolRole && !poolChampionIds.size && (poolStatus === 'error' || poolStatus === 'loading')
      "
      class="mb-2 flex items-center gap-2 text-xs font-normal"
    >
      <span>{{
        t(`opgg.champion.${poolStatus === 'error' ? 'poolUnavailable' : 'poolLoading'}`)
      }}</span>
      <NButton v-if="poolStatus === 'error'" size="tiny" @click="refreshPool">
        {{ t('opgg.filters.refresh') }}
      </NButton>
    </div>

    <div
      v-if="laneKillsLoading"
      class="flex min-h-16 items-center justify-center text-xs"
      role="status"
      aria-live="polite"
    >
      {{ t('opgg.champion.laneKillLoading') }}
    </div>
    <div
      v-if="isLaneKillRate && laneKillsFailed"
      class="mb-2 flex items-center gap-2 text-xs"
      role="status"
    >
      <span>{{ t('opgg.champion.laneKillPartial') }}</span>
      <NButton size="tiny" :disabled="laneKillsLoading" @click="retryLaneKills">{{
        t('opgg.filters.refresh')
      }}</NButton>
    </div>
    <!-- expanded (注意展开和没有展开，用的数据不同。但一般来说既然后 thatPosition 数据，那么 champion.data.counters 数据也应该存在) -->
    <div class="counters flex flex-wrap gap-2" v-if="!laneKillsLoading && isCountersExpanded">
      <div
        class="counter flex w-11.5 cursor-pointer flex-col items-center transition-[filter] duration-200 hover:brightness-[1.2]"
        v-if="displayedCounters.length"
        @click="setTab('champion', c.champion_id)"
        v-for="c of displayedCounters"
        :key="c.champion_id"
      >
        <LcuImage
          class="image mb-1 h-8 w-8"
          :style="poolChampionIds.has(c.champion_id) ? poolOutline : undefined"
          :src="championIconUri(c.champion_id)"
        />
        <div
          class="win-rate text-[11px] font-bold"
          :style="isLaneKillRate ? { color: laneKillRateColor(c.champion_id) } : undefined"
          :title="
            isLaneKillRate ? t('opgg.champion.laneKillRateDescription') : t('opgg.champion.winRate')
          "
          :class="
            isLaneKillRate
              ? 'text-[#666666] dark:text-[#a4a4a4]'
              : c.win / (c.play || 1) > 0.5
                ? 'text-[#2563eb] dark:text-[#a0c6f8]'
                : 'text-[#dc2626] dark:text-[#d75a5a]'
          "
        >
          {{
            isLaneKillRate
              ? laneKillRateText(c.champion_id)
              : `${((c.win / (c.play || 1)) * 100).toFixed(2)}%`
          }}
        </div>
        <div class="play text-center text-[10px] text-[#666666] dark:text-[#a4a4a4]">
          {{
            t('opgg.champion.times', {
              times: c.play.toLocaleString()
            })
          }}
        </div>
      </div>

      <div
        class="flex h-16 w-full items-center justify-center text-sm text-black/50 dark:text-white/50"
        v-else
      >
        {{ emptyText }}
      </div>
    </div>

    <!-- not expanded -->
    <div class="counters flex flex-wrap gap-2" v-else-if="!laneKillsLoading">
      <div
        class="counter flex w-11.5 cursor-pointer flex-col items-center transition-[filter] duration-200 hover:brightness-[1.2]"
        v-if="displayedCounters.length"
        v-for="c of displayedCounters"
        :key="c.champion_id"
        @click="setTab('champion', c.champion_id)"
      >
        <LcuImage
          class="image mb-1 h-8 w-8"
          :style="poolChampionIds.has(c.champion_id) ? poolOutline : undefined"
          :src="championIconUri(c.champion_id)"
        />
        <div
          class="win-rate text-[11px] font-bold"
          :style="isLaneKillRate ? { color: laneKillRateColor(c.champion_id) } : undefined"
          :class="
            isLaneKillRate
              ? 'text-[#666666] dark:text-[#a4a4a4]'
              : 'text-[#dc2626] dark:text-[#d75a5a]'
          "
          :title="
            isLaneKillRate ? t('opgg.champion.laneKillRateDescription') : t('opgg.champion.winRate')
          "
        >
          {{
            isLaneKillRate
              ? laneKillRateText(c.champion_id)
              : `${((c.win / (c.play || 1)) * 100).toFixed(2)}%`
          }}
        </div>
        <div class="play text-center text-[10px] text-[#666666] dark:text-[#a4a4a4]">
          {{
            t('opgg.champion.times', {
              times: c.play.toLocaleString()
            })
          }}
        </div>
      </div>

      <!-- empty -->
      <div
        class="flex h-16 w-full items-center justify-center text-sm text-black/50 dark:text-white/50"
        v-else
      >
        {{ emptyText }}
      </div>
    </div>
    <div v-if="onlyPool && missingPoolChampions.length" class="mt-2 flex flex-wrap gap-2">
      <div
        v-for="id in missingPoolChampions"
        :key="id"
        class="flex w-11.5 flex-col items-center gap-1"
      >
        <LcuImage class="h-8 w-8" :style="poolOutline" :src="championIconUri(id)" />
        <span class="text-center text-xs">{{ t('opgg.champion.poolMatchupMissing') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import LcuImage from '@renderer-shared/components/LcuImage.vue'
import { championIconUri } from '@renderer-shared/shards/league-client/game-data-assets'
import { useTranslation } from 'i18next-vue'
import { NButton, NSwitch, useThemeVars } from 'naive-ui'
import { computed, ref, watchEffect } from 'vue'
import { prepareCounterViews } from './counter-views'
import { useChampionPool } from './champion-pool-controller'
import { useCounterLaneKills } from './counter-lane-kills-controller'
import type { ChampionDataPosition } from '@shared/data-adapter/champion-data'
import type { OpggChampionCounter } from '@shared/types/opgg'

import { useOpgg } from '../context'

const {
  champion,
  matchupChampionId,
  position,
  setTab,
  effectiveSource,
  mode,
  isLoading,
  region,
  tier
} = useOpgg()
const { t } = useTranslation()
const themeVars = useThemeVars()
const {
  championIds: poolChampionIds,
  status: poolStatus,
  role: poolRole,
  refresh: refreshPool
} = useChampionPool(position, mode)
const onlyPool = ref(false)
const poolOutline = computed(() => ({
  outline: `2px solid ${themeVars.value.primaryColor}`,
  outlineOffset: '2px'
}))
const missingPoolChampions = computed(() => {
  const known = new Set(
    [...(champion.value?.data.counters ?? []), ...(thatPosition.value?.counters ?? [])].map(
      (c) => c.champion_id
    )
  )
  return [...poolChampionIds.value].filter(
    (id) => id !== champion.value?.data.summary.id && !known.has(id)
  )
})
watchEffect(() => {
  if (!poolChampionIds.value.size) onlyPool.value = false
})

const thatPosition = computed(() => {
  if (!champion.value) {
    return null
  }

  return champion.value.data.summary.positions?.find(
    (p) => p.name.toUpperCase() === position.value?.toUpperCase()
  )
})

const isCountersExpanded = ref(false)
const isLaneKillRate = ref(false)
const canLoadLaneKills = computed(
  () =>
    effectiveSource.value === 'opgg' &&
    mode.value === 'ranked' &&
    ['top', 'mid', 'adc', 'support'].includes(position.value)
)
const lanePositions: Record<string, ChampionDataPosition> = {
  top: 'top',
  mid: 'middle',
  adc: 'bottom',
  support: 'utility'
}
const {
  rates: loadedLaneKills,
  loading: laneKillsLoading,
  failed: laneKillsFailed,
  retry: retryLaneKills
} = useCounterLaneKills(() => {
  const snapshot = champion.value
  if (!snapshot || !canLoadLaneKills.value || matchupChampionId.value !== null) return null
  return {
    enabled: isLaneKillRate.value && !isLoading.value,
    snapshot,
    championId: snapshot.data.summary.id,
    query: {
      source: 'opgg',
      mode: 'ranked',
      patch: snapshot.meta.version,
      region: region.value,
      tier: tier.value,
      position: lanePositions[position.value]
    },
    counters: [...(snapshot.data.counters ?? []), ...(thatPosition.value?.counters ?? [])].map(
      (c) => ({ ...c })
    )
  }
})
const enrichLaneKills = (counters: readonly OpggChampionCounter[]) =>
  counters.map((counter) =>
    Object.hasOwn(loadedLaneKills.value, counter.champion_id)
      ? { ...counter, lane_kill_rate: loadedLaneKills.value[counter.champion_id] }
      : counter
  )
const preparedViews = computed(() =>
  prepareCounterViews(
    enrichLaneKills(champion.value?.data.counters ?? []),
    enrichLaneKills(thatPosition.value?.counters ?? [])
  )
)
const laneKillRates = computed(() => preparedViews.value.laneKillRates)
const displayedCounters = computed(() => {
  const views = isLaneKillRate.value ? preparedViews.value.laneKill : preparedViews.value.win
  const counters = isCountersExpanded.value ? views.all : views.unfavorable
  return onlyPool.value
    ? counters.filter((c) => poolChampionIds.value.has(c.champion_id))
    : counters
})

const emptyText = computed(() => {
  if (onlyPool.value && !displayedCounters.value.length) return t('opgg.champion.poolNoMatches')
  if (isLaneKillRate.value && !isCountersExpanded.value) {
    const hasKnownRates = preparedViews.value.laneKill.all.some(
      (counter) => counter.lane_kill_rate != null
    )
    return t(
      hasKnownRates ? 'opgg.champion.noLaneKillDisadvantages' : 'opgg.champion.laneKillUnavailable'
    )
  }
  return t('opgg.champion.empty')
})

function laneKillRateColor(id: number) {
  const rate = canLoadLaneKills.value ? laneKillRates.value[id] : null
  if (rate === null || rate === undefined || rate === 0.5) return undefined
  if (rate > 0.5) return themeVars.value.successColorPressed
  // Naive's neutral base is black for dark themes and white for light themes.
  // Brighten red on dark surfaces, but use the darker token on light surfaces.
  return themeVars.value.baseColor === '#000'
    ? themeVars.value.errorColor
    : themeVars.value.errorColorPressed
}
function laneKillRateText(id: number) {
  if (!canLoadLaneKills.value) return '—'
  const rate = laneKillRates.value[id]
  return rate == null ? '—' : `${(rate * 100).toFixed(2)}%`
}

watchEffect(() => {
  if (!champion.value) {
    isCountersExpanded.value = false
  }
})
</script>
