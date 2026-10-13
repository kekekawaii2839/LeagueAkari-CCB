<template>
  <section :aria-label="uiText('statFitSummary')">
    <ul class="fit-summary" aria-live="polite">
      <li v-for="model in models" :key="model.player">
        <span class="fit-swatch" :style="{ background: model.color }" aria-hidden="true" />
        <strong>{{ model.player }}</strong> ·
        {{ uiText('statCoverage', { valid: model.n, missing: model.missing }) }}
        <template v-if="model.logistic?.status === 'unavailable'">
          · {{ uiText('statFitUnavailable', { reason: model.logistic.reason }) }}
        </template>
        <template v-else-if="model.linear?.r === null">
          · {{ uiText('statConstantOutcome') }}
        </template>
        <template v-else-if="!model.linear && !model.logistic">
          · {{ uiText('statFitUnavailable', { reason: uiText('statLinearUnavailable') }) }}
        </template>
        <span v-if="model.n < 10"> · {{ uiText('statLowSample') }}</span>
      </li>
    </ul>
    <p class="ma-chart-note">{{ uiText('statFitLimit') }}</p>
    <details v-if="fittedModels.length" class="fit-details">
      <summary>{{ uiText('statFitDetails') }}</summary>
      <div v-for="model in fittedModels" :key="model.player" class="fit-member">
        <strong>
          {{ model.player }} · {{ uiText(model.linear ? 'statLinearFit' : 'statLogisticFit') }}
        </strong>
        <template v-if="model.logistic?.status === 'available'">
          <p class="ma-chart-note">
            {{ uiText(winOutcome ? 'statBinaryWins' : 'statBinaryEvents', model.logistic) }}
          </p>
          <div class="fit-values">
            <div>
              <MetricHelp
                :label="uiText('statMcFadden')"
                :definition="uiText('statMcFaddenHelp')"
              />
              <span>{{ model.logistic.pseudoRSquared.toFixed(3) }}</span>
            </div>
          </div>
        </template>
        <div v-else-if="model.linear" class="fit-values">
          <div>
            <MetricHelp :label="uiText('statPearson')" :definition="uiText('statPearsonHelp')" />
            <span>{{ model.linear.r === null ? '—' : model.linear.r.toFixed(3) }}</span>
          </div>
          <div>
            <MetricHelp :label="uiText('statRSquared')" :definition="uiText('statRSquaredHelp')" />
            <span>{{
              model.linear.rSquared === null ? '—' : model.linear.rSquared.toFixed(3)
            }}</span>
          </div>
        </div>
      </div>
    </details>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MetricHelp from './MetricHelp.vue'
import type { regressScatterGroups } from './scatter-analysis'
import { uiText } from './ui-text'

const props = defineProps<{
  models: (ReturnType<typeof regressScatterGroups>[number] & { color: string })[]
  winOutcome: boolean
}>()
const fittedModels = computed(() =>
  props.models.filter((model) => model.linear || model.logistic?.status === 'available')
)
</script>

<style scoped>
.fit-summary {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  overflow-wrap: anywhere;
}
.fit-summary strong {
  font-weight: 500;
}
.fit-swatch {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 6px;
  border: 1px solid currentColor;
}
.fit-details summary {
  box-sizing: border-box;
  min-height: 32px;
  padding: 6px 0;
  font: inherit;
  line-height: 20px;
  color: var(--la-color-text-primary);
  background: transparent;
  cursor: pointer;
}
.fit-details summary:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
  border-radius: 4px;
}
.fit-member {
  padding: 12px 0;
  border-bottom: 1px solid var(--ma-grid);
  overflow-wrap: anywhere;
}
.fit-values {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  margin-top: 4px;
  font-size: 14px;
}
.fit-values > div {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.fit-values span {
  font-variant-numeric: tabular-nums;
}
</style>
