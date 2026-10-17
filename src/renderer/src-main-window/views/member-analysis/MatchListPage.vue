<template>
  <div class="match-page">
    <article
      v-for="game in games"
      :key="game.gameId"
      :data-match-id="game.gameId"
      class="match-card"
      :class="game.win ? 'win' : 'loss'"
    >
      <MemberMatchOverview
        :game="game"
        :active="pageActive && active"
        :expanded="expanded.has(game.gameId)"
        :time-label="formatTime(game.timestamp, game.date)"
        :expand-label="`${expanded.has(game.gameId) ? '收起' : '展开'} ${formatTime(game.timestamp, game.date)} 的对局详情`"
        @toggle="$emit('toggle', game.gameId)"
      />
      <div
        v-if="pageActive && active && expanded.has(game.gameId)"
        class="details"
        :id="`match-detail-${game.gameId}`"
      >
        <MatchNativeDetails
          :key="game.gameId"
          :game-id="game.gameId"
          :opponent-ranks="game.opponentRanks"
          :active="pageActive && active"
        />
      </div>
    </article>
  </div>
</template>
<script setup lang="ts">
import { onActivated, onDeactivated, ref } from 'vue'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import MemberMatchOverview from './MemberMatchOverview.vue'
import MatchNativeDetails from './MatchNativeDetails.vue'

defineProps<{
  games: readonly MemberAnalysisGame[]
  active: boolean
  expanded: ReadonlySet<number>
  formatTime: (timestamp: number, fallback: string) => string
}>()
defineEmits<{ toggle: [gameId: number] }>()
// Retain only summary DOM in a deactivated page. Native details may contain
// large tables/timelines and must be destroyed, not kept in the page cache.
const pageActive = ref(true)
onActivated(() => {
  pageActive.value = true
})
onDeactivated(() => {
  pageActive.value = false
})
</script>
<style scoped>
.match-page {
  display: contents;
}
.match-card {
  /* Same rendering containment as upstream MatchCard; retain every row and
     its natural expanded height, but skip offscreen layout/paint work. */
  content-visibility: auto;
  contain-intrinsic-block-size: auto 116px;
  scroll-margin-top: 12px;
  min-width: 930px;
  margin-bottom: 8px;
}
.details {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  gap: 16px;
  padding: 12px;
  border-top: 1px solid var(--ma-grid);
  scroll-margin-top: 64px;
}
</style>
