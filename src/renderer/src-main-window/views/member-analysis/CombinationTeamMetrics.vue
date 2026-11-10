<template>
  <section class="combination-team-metrics">
    <h4>{{ uiText('combinationTeamMetrics') }}</h4>
    <p class="ma-chart-note">{{ uiText('combinationTeamMetricScope') }}</p>
    <dl>
      <template v-for="key in combinationNativeMetricKeys" :key="key">
        <dt>
          <MetricHelp
            :label="nativeMetricDefinitions[key].label"
            :definition="`${nativeMetricDefinitions[key].description}（${nativeMetricDefinitions[key].unit}）`"
          />
        </dt>
        <dd>
          {{ formatMetric(metrics.values[key], nativeMetricDefinitions[key].fmt) }}
          <span>{{
            nativeMetricDefinitions[key].fmt === 'time'
              ? uiText('nativeClockUnit')
              : nativeMetricDefinitions[key].unit
          }}</span
          ><small>{{
            uiText('nativeValidGames', { valid: metrics.samples[key], total: games.length })
          }}</small>
        </dd>
      </template>
    </dl>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { nativeMetricDefinitions } from '@shared/shards/member-analysis/native-metrics'
import {
  aggregateCombinationNativeMetrics,
  combinationNativeMetricKeys
} from './combination-native-metrics'
import { formatMetric } from './metric-defs'
import MetricHelp from './MetricHelp.vue'
import { uiText } from './ui-text'
const props = defineProps<{ games: MemberAnalysisGame[] }>()
const metrics = computed(() => aggregateCombinationNativeMetrics(props.games))
</script>
<style scoped>
.combination-team-metrics {
  min-width: 0;
}
h4 {
  font-size: 14px;
  margin: 16px 0 8px;
}
dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 12px;
  margin: 0;
}
dt {
  color: var(--ma-muted);
}
dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
dd span,
dd small {
  color: var(--ma-muted);
  font-size: 12px;
}
dd small {
  display: block;
}
</style>
