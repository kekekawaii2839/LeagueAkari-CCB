<template>
  <div class="evidence-match-action">
    <NButton
      class="evidence-match-button"
      size="small"
      secondary
      :theme-overrides="{ fontSizeSmall: '14px', heightSmall: '32px' }"
      :disabled="!evidence.available || !evidence.games.length"
      @click="action.open"
    >
      {{ uiText('evidenceOpenMatches') }}
    </NButton>
    <span v-if="!evidence.available || !evidence.games.length">{{
      uiText('evidenceMetricUnavailable')
    }}</span>
    <span v-if="error" role="status">{{ error }}</span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, useThemeVars } from 'naive-ui'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import type { MatchEvidenceSelection } from './evidence-selection'
import { uiText } from './ui-text'
const props = defineProps<{ evidence: MatchEvidenceSelection; compact?: boolean }>()
const store = useMemberAnalysisStore()
const themeVars = useThemeVars()
const error = ref('')
const action = computed(() => {
  const evidence = props.evidence
  return {
    open: () => {
      if (!evidence.available || !evidence.games.length) return
      if (
        !store.navigateToMatches(
          evidence.games.map((game) => game.gameId),
          evidence.source,
          evidence.publishedGeneration
        )
      ) {
        const keys = {
          empty: 'scopeErrorEmpty',
          invalid: 'scopeErrorInvalid',
          ambiguous: 'scopeErrorAmbiguous',
          missing: 'scopeErrorMissing',
          stale: 'scopeErrorStale'
        } as const
        error.value = uiText(keys[store.matchListScopeError ?? 'invalid'])
        return
      }
      error.value = ''
      if (evidence.games.length === 1)
        store.navigateToMatch(evidence.games[0].gameId, evidence.source)
    }
  }
})
watch(
  () => props.evidence,
  () => {
    error.value = ''
  }
)
</script>
<style scoped>
.evidence-match-action {
  font-family: v-bind('themeVars.fontFamily');
  line-height: 1.5;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  margin-top: 8px;
  font-size: 12px;
  color: var(--ma-muted);
}
.evidence-match-button {
  font-family: inherit;
  line-height: 1.5;
}
</style>
