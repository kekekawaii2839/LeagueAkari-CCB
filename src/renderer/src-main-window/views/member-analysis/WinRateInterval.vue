<template>
  <span
    v-if="valid"
    class="win-rate-interval"
    role="img"
    :aria-label="intervalLabel"
    :title="intervalLabel"
  >
    <i class="baseline" />
    <i class="balance" />
    <span v-if="interval" class="range" :style="rangeStyle" />
    <em :class="{ low }" :style="pointStyle" />
  </span>
  <span v-else class="no-rate">{{ uiText('noRate') }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { uiText } from './ui-text'
import { wilsonInterval } from './visualization'

const props = withDefaults(
  defineProps<{
    wins: number
    games: number
    low?: boolean
    label?: string
  }>(),
  { low: false }
)

const valid = computed(
  () =>
    Number.isFinite(props.wins) &&
    Number.isFinite(props.games) &&
    props.games > 0 &&
    props.wins >= 0 &&
    props.wins <= props.games
)
const rate = computed(() => (props.games > 0 ? props.wins / props.games : 0))
const interval = computed(() => wilsonInterval(props.wins, props.games))
const rangeStyle = computed(() =>
  interval.value
    ? {
        left: `${interval.value.low * 100}%`,
        width: `${(interval.value.high - interval.value.low) * 100}%`
      }
    : undefined
)
const pointStyle = computed(() => ({ left: `${rate.value * 100}%` }))
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const intervalLabel = computed(() =>
  interval.value
    ? uiText('rateDescription', {
        label: props.label ?? uiText('rate'),
        value: percent(rate.value),
        wins: props.wins,
        games: props.games,
        low: percent(interval.value.low),
        high: percent(interval.value.high)
      })
    : uiText('noRate')
)
</script>

<style scoped>
.win-rate-interval {
  position: relative;
  display: block;
  height: 14px;
}
.baseline {
  position: absolute;
  top: 7px;
  right: 0;
  left: 0;
  height: 1px;
  background: var(--ma-grid-strong);
}
.balance {
  position: absolute;
  top: 3px;
  bottom: 1px;
  left: 50%;
  width: 1px;
  background: var(--ma-muted);
  opacity: 0.5;
}
.range {
  position: absolute;
  top: 6px;
  height: 3px;
  border-radius: 2px;
  background: var(--ma-muted);
}
em {
  position: absolute;
  top: 3px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: var(--ma-positive);
}
em.low {
  box-sizing: border-box;
  border: 2px solid var(--ma-positive);
  background: var(--la-card-surface-95);
}
</style>
