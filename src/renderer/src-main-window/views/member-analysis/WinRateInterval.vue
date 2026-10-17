<template>
  <span
    v-if="valid"
    class="win-rate-interval"
    role="img"
    :aria-label="intervalLabel"
    :title="intervalLabel"
  >
    <i v-if="scaleGrid" class="scale-grid" aria-hidden="true" />
    <i class="baseline" />
    <i v-if="!referenceValid" class="balance" />
    <span v-if="interval" class="range" :style="rangeStyle" />
    <i v-if="referenceValid" class="reference" :style="referenceStyle" />
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
    reference?: number
    scaleGrid?: boolean
    description?: string
  }>(),
  { low: false, scaleGrid: false }
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
const referenceValid = computed(
  () =>
    typeof props.reference === 'number' &&
    Number.isFinite(props.reference) &&
    props.reference >= 0 &&
    props.reference <= 1
)
const referenceStyle = computed(() => ({ left: `${props.reference! * 100}%` }))
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const intervalLabel = computed(() =>
  interval.value
    ? (props.description ??
      uiText('rateDescription', {
        label: props.label ?? uiText('rate'),
        value: percent(rate.value),
        wins: props.wins,
        games: props.games,
        low: percent(interval.value.low),
        high: percent(interval.value.high)
      }))
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
  top: 50%;
  right: 0;
  left: 0;
  height: 1px;
  transform: translateY(-50%);
  background: var(--ma-grid-strong);
}
.scale-grid {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 0;
  right: 0;
  box-sizing: border-box;
  border-right: 1px solid var(--ma-grid);
  background: linear-gradient(to right, var(--ma-grid) 1px, transparent 1px);
  background-size: 25% 100%;
}
.balance {
  position: absolute;
  top: 2px;
  bottom: 2px;
  left: 50%;
  width: 1px;
  background: var(--ma-muted);
  opacity: 0.5;
}
.range {
  position: absolute;
  top: 50%;
  height: 3px;
  transform: translateY(-50%);
  border-radius: 2px;
  background: var(--ma-muted);
}
.reference {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border: 1.5px solid var(--la-color-text-primary);
  background: var(--la-color-bg-primary);
  transform: translate(-50%, -50%) rotate(45deg);
}
em {
  position: absolute;
  top: 50%;
  width: 8px;
  height: 8px;
  transform: translateY(-50%);
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
