<template>
  <div class="camp-composition">
    <div
      class="camp-stack"
      :class="{ missing: !evidence.camps }"
      role="img"
      :aria-label="chartDescription"
    >
      <i
        v-for="(camp, index) in campIds"
        :key="camp"
        :style="{
          width: `${evidence.camps ? (evidence.counts[index].reduce((sum, n) => sum + n, 0) / evidence.camps) * 100 : 0}%`,
          background: colors[index]
        }"
      />
    </div>
    <table class="camp-table">
      <thead>
        <tr>
          <th scope="col">{{ jungleText('campOwner') }}</th>
          <th v-for="(_, camp) in campIds" :key="camp" scope="col">
            {{ jungleText(`camp${camp}` as 'camp0') }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="owner in complete ? [0, 1, 2] : [0, 1]" :key="owner">
          <th scope="row">
            {{ jungleText(owner === 0 ? 'own' : owner === 1 ? 'enemy' : 'unknown') }}
          </th>
          <td v-for="(_, camp) in campIds" :key="camp">
            <b>{{
              evidence.camps ? jungleText('count', { count: evidence.counts[camp][owner] }) : '—'
            }}</b
            ><span>{{ formatMetric(jointRate(evidence, camp, owner), 'pct') }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <small
      >{{
        jungleText('denominator', {
          valid: evidence.camps,
          total: evidence.games
        })
      }}<template v-if="evidence.missingCamps">
        ·
        {{ jungleText('unknownCamps', { count: evidence.missingCamps }) }}</template
      ></small
    >
    <small v-if="evidence.camps"
      >{{ jungleText('ratio', { total: evidence.camps })
      }}<template v-if="!complete && evidence.unknownOwnership">
        {{ jungleText('incomplete') }}</template
      ></small
    >
    <small v-else>{{ jungleText('noRecords') }}</small>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import { formatMetric } from '../metric-defs'
import { campIds, jointRate, type JungleEvidence } from './analysis'
import { useJungleText } from './copy'
const jungleText = useJungleText()
const props = defineProps<{ evidence: JungleEvidence; complete?: boolean }>()
const colors = [
  'var(--ma-red)',
  'var(--ma-blue)',
  'var(--ma-series-1)',
  'var(--ma-series-3)',
  'var(--ma-series-6)',
  'var(--ma-series-5)'
]
const chartDescription = computed(() =>
  props.evidence.camps
    ? campIds
        .map(
          (_, i) =>
            `${jungleText(`camp${i}` as 'camp0')} ${formatMetric(props.evidence.counts[i].reduce((s, n) => s + n, 0) / props.evidence.camps, 'pct')}`
        )
        .join(' · ')
    : jungleText('noRecords')
)
</script>
<style scoped>
.camp-composition {
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.camp-stack {
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  height: 12px;
  background: var(--ma-grid);
  margin: 4px 0 12px;
}
.camp-stack.missing {
  background: transparent;
}
.camp-stack i {
  height: 12px;
  box-shadow: 1px 0 0 var(--la-color-bg-primary);
}
.camp-table {
  width: 100%;
  min-width: 590px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
}
.camp-table th,
.camp-table td {
  padding: 8px 4px;
  border-top: 1px solid var(--ma-grid);
  text-align: right;
  vertical-align: middle;
}
.camp-table thead th {
  font-size: 13px;
  color: var(--ma-muted);
  font-weight: 400;
  border-top: 0;
}
.camp-table th:first-child {
  width: 85px;
  text-align: left;
  position: sticky;
  left: var(--jungle-sticky-width, 200px);
  background: var(--la-color-bg-primary);
  z-index: 2;
  font-weight: 400;
}
.camp-table td b {
  font-size: 14px;
  white-space: nowrap;
  font-weight: 600;
  margin-right: 8px;
}
.camp-table td span {
  font-size: 14px;
  color: var(--ma-muted);
  white-space: nowrap;
}
.camp-composition small {
  display: block;
  font-size: 12px;
  color: var(--ma-muted);
  line-height: 1.5;
  margin-top: 6px;
}
</style>
