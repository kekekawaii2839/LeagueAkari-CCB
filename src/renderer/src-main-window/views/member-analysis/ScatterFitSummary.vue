<template>
  <section :aria-label="uiText('statFitSummary')" class="fit-tables">
    <table v-for="group in groups" :key="group.key" class="fit-table">
      <caption>
        {{
          uiText(group.labelKey)
        }}
      </caption>
      <colgroup>
        <col :style="{ width: group.binary ? '44%' : '36%' }" />
        <col :style="{ width: group.binary ? '24%' : '20%' }" />
        <col :style="{ width: group.binary ? '32%' : '22%' }" />
        <col v-if="!group.binary" style="width: 22%" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{{ uiText('synergyMember') }}</th>
          <th scope="col">{{ uiText('statFitSample') }}</th>
          <th scope="col">
            <span class="fit-metric-heading">
              <abbr :title="uiText(group.binary ? 'statMcFadden' : 'statPearson')">{{
                group.binary ? 'McF.' : 'r'
              }}</abbr>
              <MetricHelp
                :label="uiText(group.binary ? 'statMcFadden' : 'statPearson')"
                :definition="uiText(group.binary ? 'statMcFaddenHelp' : 'statPearsonHelp')"
                icon-only
              />
            </span>
          </th>
          <th v-if="!group.binary" scope="col">
            <span class="fit-metric-heading">
              <abbr :title="uiText('statRSquared')">R²</abbr>
              <MetricHelp
                :label="uiText('statRSquared')"
                :definition="uiText('statRSquaredHelp')"
                icon-only
              />
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-for="model in group.models" :key="model.player">
          <tr class="fit-member-row">
            <th scope="row">
              <span class="fit-identity">
                <span class="fit-swatch" :style="{ background: model.color }" aria-hidden="true" />
                <span
                  class="fit-member-name"
                  :title="model.player"
                  :aria-label="model.player"
                  tabindex="0"
                >
                  <span class="fit-name-parts" aria-hidden="true">
                    <span class="fit-name-main">{{ identity(model.player).name }}</span>
                    <span v-if="identity(model.player).tag" class="fit-name-tag">{{
                      identity(model.player).tag
                    }}</span>
                  </span>
                  <span class="fit-full-name" aria-hidden="true">{{ model.player }}</span>
                </span>
              </span>
            </th>
            <td :title="coverage(model)" :aria-label="coverage(model)">
              {{ uiText('statScatterObservationCount', { count: model.n }) }}
            </td>
            <td v-if="group.binary">
              {{
                model.logistic?.status === 'available'
                  ? model.logistic.pseudoRSquared.toFixed(3)
                  : '—'
              }}
            </td>
            <template v-else>
              <td>
                {{ model.linear?.r === null || !model.linear ? '—' : model.linear.r.toFixed(3) }}
              </td>
              <td>
                {{
                  model.linear?.rSquared === null || !model.linear
                    ? '—'
                    : model.linear.rSquared.toFixed(3)
                }}
              </td>
            </template>
          </tr>
          <tr v-if="notes(model).length" class="fit-state-row">
            <td :colspan="group.binary ? 3 : 4">
              <ul>
                <li v-for="note in notes(model)" :key="note.label">
                  <span>{{ note.label }}</span>
                  <MetricHelp
                    v-if="note.detail"
                    :label="`${model.player} · ${note.label}`"
                    :definition="note.detail"
                    icon-only
                  />
                </li>
              </ul>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import MetricHelp from './MetricHelp.vue'
import type { regressScatterGroups } from './scatter-analysis'
import { uiText } from './ui-text'

type FitModel = ReturnType<typeof regressScatterGroups>[number] & { color: string }
const props = defineProps<{ models: FitModel[]; winOutcome: boolean }>()
const groups = computed(() =>
  [
    {
      key: 'linear',
      binary: false,
      labelKey: 'statLinearFit' as const,
      models: props.models.filter((model) => !model.logistic)
    },
    {
      key: 'logistic',
      binary: true,
      labelKey: 'statLogisticFit' as const,
      models: props.models.filter((model) => model.logistic)
    }
  ].filter((group) => group.models.length)
)
const identity = (player: string) => {
  const separator = player.indexOf('#')
  const tag = separator < 0 ? '' : player.slice(separator)
  return {
    name: separator < 0 ? player : player.slice(0, separator),
    tag: tag.length > 10 ? `…${tag.slice(-9)}` : tag
  }
}
const coverage = (model: FitModel) =>
  uiText('statCoverage', { valid: model.n, missing: model.missing })
function notes(model: FitModel) {
  const result: { label: string; detail?: string }[] = []
  if (model.missing > 0)
    result.push({
      label: uiText('statFitMissing', { count: model.missing }),
      detail: coverage(model)
    })
  // Match the existing OLS / binary Logistic minimums without changing the fits.
  const insufficient = model.logistic
    ? model.logistic.status === 'unavailable' && model.n < 3
    : !model.linear && model.n < 2
  if (insufficient)
    result.push({
      label: uiText('statInsufficientSample'),
      detail: uiText('statFitMinimum', { count: model.logistic ? 3 : 2 })
    })
  else if (model.logistic?.status === 'unavailable')
    result.push({ label: uiText('statFitUnavailableShort'), detail: model.logistic.reason })
  else if (model.linear?.r === null)
    result.push({
      label: uiText('statCorrelationUnavailable'),
      detail: uiText('statConstantOutcome')
    })
  else if (!model.linear && !model.logistic)
    result.push({
      label: uiText('statFitUnavailableShort'),
      detail: uiText('statConstantPredictor')
    })
  if (!insufficient && model.n < 10) result.push({ label: uiText('statLowSample') })
  if (model.logistic?.status === 'available')
    result.push({
      label: uiText(props.winOutcome ? 'statBinaryWins' : 'statBinaryEvents', model.logistic)
    })
  return result
}
</script>

<style scoped>
.fit-tables {
  min-width: 0;
}
.fit-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 18px;
  font-variant-numeric: tabular-nums;
}
.fit-table + .fit-table {
  margin-top: 12px;
}
.fit-table caption {
  text-align: left;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  padding: 0 2px 8px;
}
.fit-table th,
.fit-table td {
  padding: 6px 2px;
  text-align: right;
  vertical-align: top;
  border-bottom: 1px solid var(--ma-grid);
  overflow-wrap: anywhere;
}
.fit-table th {
  font-weight: 500;
}
.fit-table thead th {
  color: var(--ma-muted);
  vertical-align: middle;
  font-size: 12px;
  line-height: 18px;
}
.fit-member-row th,
.fit-member-row td {
  vertical-align: middle;
}
.fit-member-row td {
  font-weight: 500;
  white-space: nowrap;
}
.fit-table th:first-child {
  text-align: left;
}
.fit-metric-heading {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.fit-metric-heading abbr {
  text-decoration: none;
  white-space: nowrap;
}
.fit-identity {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  min-width: 0;
}
.fit-swatch {
  width: 9px;
  height: 9px;
  flex: none;
  margin-top: 4px;
  border-radius: 50%;
  border: 1px solid currentColor;
}
.fit-member-name {
  display: block;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
}
.fit-name-main {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  font-weight: 600;
}
.fit-name-tag {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.fit-full-name {
  display: none;
}
/* Preserve a compact default row and reveal the full identity to keyboard readers. */
.fit-member-name:focus {
  overflow: visible;
}
.fit-member-name:focus .fit-name-parts {
  display: none;
}
.fit-member-name:focus .fit-full-name {
  display: block;
}
.fit-member-name:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 1px;
  border-radius: 2px;
}
.fit-state-row td {
  padding-top: 8px;
  text-align: left;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 18px;
}
.fit-state-row ul {
  list-style: none;
  margin: 0;
  padding: 0;
}
.fit-state-row li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.fit-state-row :deep(.metric-help) {
  flex: 0 0 24px;
  width: 24px;
  min-height: 24px;
  height: 24px;
}
</style>
