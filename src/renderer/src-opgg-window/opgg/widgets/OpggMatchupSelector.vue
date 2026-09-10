<template>
  <section
    class="mb-2 rounded border border-black/10 p-2 dark:border-white/15"
    :aria-label="t('opgg.matchup.title')"
  >
    <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <div class="text-[13px] font-bold">{{ t('opgg.matchup.title') }}</div>
      <div class="text-xs text-black/65 dark:text-white/65" aria-live="polite">
        {{ statusText }}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-1.5">
      <NButton
        v-for="enemyChampionId of enemyChampionIds"
        :key="enemyChampionId"
        size="tiny"
        :type="matchupChampionId === enemyChampionId ? 'primary' : 'default'"
        :secondary="matchupChampionId !== enemyChampionId"
        :disabled="isLoading"
        :aria-pressed="matchupChampionId === enemyChampionId"
        :aria-label="
          t('opgg.matchup.selectChampion', {
            champion: resources.champions.name(enemyChampionId)
          })
        "
        class="h-auto! px-2! py-1!"
        @click="emit('select', enemyChampionId)"
      >
        <span class="flex items-center gap-1.5">
          <ChampionIcon round class="size-6 shrink-0" :champion-id="enemyChampionId" />
          <span class="max-w-20 truncate text-xs">
            {{ resources.champions.name(enemyChampionId) }}
          </span>
        </span>
      </NButton>

      <NButton
        v-if="matchupChampionId !== null"
        size="tiny"
        text
        :disabled="isLoading"
        @click="emit('select', null)"
      >
        {{ t('opgg.matchup.clear') }}
      </NButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useTranslation } from 'i18next-vue'
import { NButton } from 'naive-ui'
import { computed } from 'vue'

const { t } = useTranslation()
const resources = useAkariResourceProvider()
const {
  enemyChampionIds,
  matchupChampionId = null,
  isLoading = false
} = defineProps<{
  enemyChampionIds: number[]
  matchupChampionId?: number | null
  isLoading?: boolean
}>()
const emit = defineEmits<{
  select: [championId: number | null]
}>()

const statusText = computed(() => {
  if (matchupChampionId === null) {
    return t('opgg.matchup.prompt')
  }

  return t('opgg.matchup.selected', {
    champion: resources.champions.name(matchupChampionId)
  })
})
</script>
