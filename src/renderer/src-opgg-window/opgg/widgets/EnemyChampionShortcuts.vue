<template>
  <section
    v-if="isVisible"
    class="mb-2 flex shrink-0 flex-wrap items-center gap-2"
    :aria-label="t('opgg.enemyChampions.title')"
    :aria-busy="isLoading"
  >
    <span class="text-xs font-bold">{{ t('opgg.enemyChampions.title') }}</span>
    <NButton
      v-for="id of enemyChampionIds"
      :key="id"
      size="small"
      secondary
      :disabled="isLoading"
      :aria-label="t('opgg.enemyChampions.open', { champion: resources.champions.name(id) })"
      @click="openEnemyChampion(id)"
    >
      <span class="flex items-center gap-1.5">
        <ChampionIcon round class="size-6 shrink-0" :champion-id="id" />
        <span class="text-xs">{{ resources.champions.name(id) }}</span>
      </span>
    </NButton>
  </section>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import {
  type ChampionDataMode,
  supportsChampionDataFeature
} from '@shared/data-adapter/champion-data'
import { useTranslation } from 'i18next-vue'
import { NButton } from 'naive-ui'
import { computed } from 'vue'

import { useOpgg } from '../context'

const { t } = useTranslation()
const resources = useAkariResourceProvider()
const lcs = useLeagueClientStore()
const { currentTab, enemyChampionIds, preferredSource, mode, isLoading, openEnemyChampion } =
  useOpgg()
const isVisible = computed(
  () =>
    currentTab.value === 'champions' &&
    lcs.gameflow.phase === 'ChampSelect' &&
    enemyChampionIds.value.length > 0 &&
    supportsChampionDataFeature(
      preferredSource.value,
      mode.value as ChampionDataMode,
      'champion-summary'
    )
)
</script>
