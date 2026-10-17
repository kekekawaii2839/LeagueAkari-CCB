<template>
  <section class="native-match" aria-label="Akari 单局完整战绩" :aria-busy="loading">
    <div v-if="loading" role="status"><NSpin :size="16" /> 正在读取本地战绩详情</div>
    <div v-else-if="error" role="alert">
      {{ error }} <NButton size="small" @click="load">重试</NButton>
    </div>
    <p v-else-if="!match">{{ uiText('matchNativeUnavailable') }}</p>
    <template v-else>
      <p v-if="!match.details">{{ uiText('timelineUnavailable') }}</p>
      <div class="native-match-scroll" tabindex="0" role="region" aria-label="完整战绩，可横向滚动">
        <MatchCard
          :summary="match.summary"
          :details="match.details"
          :extra-details-tab-label="uiText('matchOpponentRankTab')"
          is-expanded
          :hide-privacy="appStore.settings.streamerMode"
          @load-details="load"
          @navigate-to-summoner-by-puuid="navigate"
        >
          <template #extra-details-tab
            ><OpponentRankDetails :ranks="opponentRanks" embedded
          /></template>
        </MatchCard>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { uiText } from './ui-text'
import OpponentRankDetails from './opponent-ranks/OpponentRankDetails.vue'
import type { OpponentRanks } from '@shared/shards/member-analysis/opponent-ranks'
import MatchCard from '@renderer-shared/components/match-card/MatchCard.vue'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { NButton, NSpin } from 'naive-ui'
import { computed } from 'vue'
import { PlayerTabsRenderer } from '@main-window/shards/player-tabs'
import { useMemberMatchDetails } from './useMemberMatchDetails'

const props = withDefaults(
  defineProps<{ gameId: number; active?: boolean; opponentRanks?: OpponentRanks }>(),
  { active: true }
)
const { navigateToTabByPuuidAndSgpServerId } = useInstance(PlayerTabsRenderer).useNavigateToTab()
const appStore = useAppCommonStore()
const {
  match,
  loading,
  error: readError,
  load
} = useMemberMatchDetails(
  () => props.gameId,
  () => props.active
)
const error = computed(() => (readError.value ? '无法读取本局战绩详情。' : ''))
function navigate(puuid: string) {
  if (match.value) void navigateToTabByPuuidAndSgpServerId(puuid, match.value.serverId)
}
</script>
<style scoped>
.native-match {
  min-width: 0;
  grid-column: 1 / -1;
}
.native-match p {
  color: var(--ma-muted);
  font-size: 12px;
}
.native-match-scroll {
  overflow-x: auto;
  min-width: 0;
}
.native-match-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
</style>
