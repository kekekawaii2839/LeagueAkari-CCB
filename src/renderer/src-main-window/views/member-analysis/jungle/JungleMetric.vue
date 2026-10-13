<template>
  <div class="metric">
    <div class="metric-line">
      <span>{{ jungleMeta[metric]?.label }}</span
      ><b>{{ valueText }}</b>
    </div>
    <div
      v-if="graph !== 'none'"
      class="metric-scale"
      :class="{ missing: value === null }"
      role="img"
      :aria-label="`${jungleMeta[metric]?.label} ${valueText}`"
    >
      <i v-if="isSigned && value !== null" class="zero" />
      <i
        v-if="value !== null && isPoint"
        class="point"
        :class="{ filled: metric !== 'gd10' }"
        :style="{ left: `${50 + (value / maximum) * 48}%` }"
      />
      <i
        v-else-if="value !== null"
        class="fill"
        :style="{
          left: `${isSigned ? (value < 0 ? 50 - (Math.abs(value) / maximum) * 48 : 50) : 0}%`,
          width: `${isSigned ? (Math.abs(value) / maximum) * 48 : (value / maximum) * 100}%`
        }"
      />
    </div>
    <small v-if="zoneMetrics.includes(metric as (typeof zoneMetrics)[number])">{{
      jungleText('regionSamples', {
        weight: evidence.zoneWeight,
        valid: evidence.zoneGames,
        total: evidence.games
      })
    }}</small>
    <small v-else
      >{{
        jungleText('valid', {
          valid: metricPopulation(evidence, metric),
          total: evidence.games
        })
      }}<template v-if="metricPopulation(evidence, metric) < evidence.games">
        ·
        {{
          jungleText('missing', {
            count: evidence.games - metricPopulation(evidence, metric)
          })
        }}</template
      ><template v-if="efficiencyMetrics.includes(metric as (typeof efficiencyMetrics)[number])">
        ·
        {{
          jungleText('minutes', { minutes: (evidence.minutesByMetric[metric] ?? 0).toFixed(0) })
        }}</template
      ></small
    >
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { JungleAggregate } from '../analytics'
import { jungleMeta, formatMetric } from '../metric-defs'
import { finiteOrNull, formatSigned } from '../visualization'
import { efficiencyMetrics, zoneMetrics, metricPopulation, type JungleEvidence } from './analysis'
import { useJungleText } from './copy'
const jungleText = useJungleText()
const props = withDefaults(
  defineProps<{
    row?: JungleAggregate
    evidence: JungleEvidence
    metric: string
    graph?: 'none' | 'rate' | 'bar' | 'signed' | 'point'
    maximum?: number
  }>(),
  { graph: 'none', maximum: 1 }
)
const value = computed(() => finiteOrNull(props.row?.[props.metric]))
const isSigned = computed(() => props.graph === 'signed' || props.graph === 'point')
const isPoint = computed(() => props.graph === 'point')
const valueText = computed(() =>
  ['gd10', 'gd15', 'xpd15', 'dragon15', 'grub15', 'objectiveFight15'].includes(props.metric)
    ? formatSigned(value.value, ['gd10', 'gd15', 'xpd15'].includes(props.metric) ? 0 : 1)
    : formatMetric(value.value, jungleMeta[props.metric]?.fmt ?? 'num')
)
</script>
<style scoped>
.metric {
  min-width: 0;
  margin-bottom: 10px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.metric:last-child {
  margin-bottom: 0;
}
.metric-line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
}
.metric-line span {
  overflow-wrap: anywhere;
}
.metric-line b {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
}
.metric small {
  display: block;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ma-muted);
  margin-top: 3px;
}
.metric-scale {
  position: relative;
  height: 6px;
  background: var(--ma-grid);
  margin: 7px 0 3px;
}
.metric-scale.missing {
  background: transparent;
}
.fill {
  position: absolute;
  top: 0;
  height: 6px;
  background: var(--ma-blue);
}
.zero {
  position: absolute;
  left: 50%;
  width: 1px;
  height: 12px;
  top: -3px;
  background: var(--ma-muted);
}
.point {
  position: absolute;
  top: -2px;
  width: 10px;
  height: 10px;
  margin-left: -5px;
  border: 2px solid var(--ma-blue);
  border-radius: 50%;
  background: var(--la-color-bg-primary);
}
.point.filled {
  background: var(--ma-blue);
}
</style>
