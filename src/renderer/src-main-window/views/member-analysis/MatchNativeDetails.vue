<template>
  <section class="native-match" aria-label="Akari 单局完整战绩" :aria-busy="loading">
    <div v-if="loading" role="status"><NSpin :size="16" /> 正在读取本地战绩详情</div>
    <div v-else-if="error" role="alert">
      {{ error }} <NButton size="small" @click="load">重试</NButton>
    </div>
    <p v-else-if="!match">本局原始战绩缓存不可用，可能已清理。请刷新分析重新获取。</p>
    <template v-else>
      <p v-if="!match.details">{{ uiText('timelineUnavailable') }}</p>
      <div class="native-match-scroll" tabindex="0" role="region" aria-label="完整战绩，可横向滚动">
        <MatchCard
          :summary="match.summary"
          :details="match.details"
          is-expanded
          :hide-privacy="appStore.settings.streamerMode"
          @load-details="load"
          @navigate-to-summoner-by-puuid="navigate"
        />
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { uiText } from './ui-text'
import MatchCard from '@renderer-shared/components/match-card/MatchCard.vue'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import type { MemberAnalysisMatchDetails } from '@shared/shards/member-analysis'
import { NButton, NSpin } from 'naive-ui'
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { PlayerTabsRenderer } from '@main-window/shards/player-tabs'

const props = defineProps<{ gameId: number }>()
const memberAnalysis = useInstance(MemberAnalysisRenderer)
const { navigateToTabByPuuidAndSgpServerId } = useInstance(PlayerTabsRenderer).useNavigateToTab()
const appStore = useAppCommonStore()
const match = shallowRef<MemberAnalysisMatchDetails | null>(null)
const loading = ref(false)
const error = ref('')
let generation = 0
async function load() {
  const current = ++generation
  match.value = null
  error.value = ''
  loading.value = true
  try {
    const result = await memberAnalysis.getMatchDetails(props.gameId)
    if (current !== generation) return
    if (result.ok) match.value = result.value
    else error.value = '无法读取本局战绩详情。'
  } catch {
    if (current === generation) error.value = '无法读取本局战绩详情。'
  } finally {
    if (current === generation) loading.value = false
  }
}
function navigate(puuid: string) {
  if (match.value) void navigateToTabByPuuidAndSgpServerId(puuid, match.value.serverId)
}
watch(() => props.gameId, load, { immediate: true })
onBeforeUnmount(() => {
  generation++
})
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
