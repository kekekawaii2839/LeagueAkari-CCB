<template>
  <button
    type="button"
    class="pool-hero"
    :aria-label="
      uiText('poolHeroLabel', {
        hero: name,
        pick: formatMetric(row.pickRate, 'pct'),
        rate: formatMetric(row.winRate, 'pct'),
        wins: row.wins,
        games: row.games
      })
    "
    aria-haspopup="dialog"
    @click="$emit('open', $event)"
  >
    <span class="pool-portrait">
      <ChampionIcon class="pool-icon" :champion-id="championId" round />
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <circle class="ring-track" cx="24" cy="24" r="22" />
        <circle class="ring-share" cx="24" cy="24" r="22" :stroke-dasharray="ringShare" />
      </svg>
    </span>
    <span class="pool-hero-name">{{ name }}</span>
    <strong class="pool-win-rate">{{ Math.round(row.winRate * 100) }}%</strong>
    <span class="pool-record"
      ><span>{{ uiText('poolWins', { count: row.wins }) }}/</span><wbr /><span>{{
        uiText('poolTotalGames', { count: row.games })
      }}</span></span
    >
  </button>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import type { ChampionAggregate } from './analytics'
import { formatMetric } from './metric-defs'
import { uiText } from './ui-text'
const props = defineProps<{ row: ChampionAggregate; name: string; championId: number }>()
defineEmits<{ open: [event: MouseEvent] }>()
const ringShare = computed(() => {
  const length = 2 * Math.PI * 22
  return Math.max(0, Math.min(1, props.row.pickRate)) * length + ' ' + length
})
</script>
<style scoped>
.pool-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  width: 100%;
  min-width: 0;
  padding: 4px 1px;
  color: inherit;
  background: transparent;
  font: inherit;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.pool-hero:hover {
  background: var(--ma-hover);
}
.pool-hero:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 1px;
}
.pool-portrait {
  position: relative;
  display: block;
  width: 48px;
  height: 48px;
  flex: none;
}
.pool-icon {
  position: absolute;
  top: 6px;
  left: 6px;
  width: 36px;
  height: 36px;
}
.pool-portrait svg {
  position: absolute;
  inset: 0;
  width: 48px;
  height: 48px;
  pointer-events: none;
}
.pool-portrait circle {
  fill: none;
  stroke-width: 2px;
  transform: rotate(-90deg);
  transform-origin: 24px 24px;
}
.ring-track {
  stroke: var(--ma-grid-strong);
}
.ring-share {
  stroke: var(--ma-series-1);
}
.pool-hero-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  min-height: 32px;
  overflow-wrap: anywhere;
}
.pool-win-rate {
  padding-top: 3px;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.25;
}
.pool-record {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ma-muted);
  overflow-wrap: anywhere;
}
.pool-record > span {
  white-space: nowrap;
}
</style>
