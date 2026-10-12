<template>
  <template v-if="group === 'opening'">
    <td class="analysis-cell ownership-cell">
      <div
        class="composition-bar"
        :class="{ missing: !evidence.ownership }"
        role="img"
        :aria-label="`${jungleText('own')} ${formatMetric(row?.ownStartRate, 'pct')} · ${jungleText('invade')} ${formatMetric(row?.invadeStartRate, 'pct')}`"
      >
        <i
          v-if="evidence.ownership"
          :style="{
            width: `${Number(row?.ownStartRate ?? 0) * 100}%`,
            background: 'var(--ma-blue)'
          }"
        /><i
          v-if="evidence.ownership"
          :style="{
            width: `${Number(row?.invadeStartRate ?? 0) * 100}%`,
            background: 'var(--ma-red)'
          }"
        />
      </div>
      <div class="own-values">
        <span
          >{{ jungleText('own') }} <b>{{ formatMetric(row?.ownStartRate, 'pct') }}</b></span
        ><span
          >{{ jungleText('invade') }} <b>{{ formatMetric(row?.invadeStartRate, 'pct') }}</b></span
        >
      </div>
      <small>{{
        jungleText('campValid', {
          valid: evidence.camps,
          total: evidence.games
        })
      }}</small>
      <small>{{
        evidence.camps
          ? jungleText('ownerValid', {
              valid: evidence.ownership,
              total: evidence.camps
            })
          : jungleText('noOwner')
      }}</small>
      <small
        >{{
          evidence.camps
            ? jungleText('unknownCount', { count: evidence.unknownOwnership })
            : jungleText('noCamp')
        }}<template v-if="evidence.unknownOwnership">
          · {{ jungleText('unknownDetail') }}</template
        ></small
      >
    </td>
    <td class="analysis-cell"><JungleCampTable :evidence="evidence" /></td>
  </template>
  <template v-else-if="group === 'gank'">
    <td class="analysis-cell">
      <JungleMetric
        v-for="key in ['level3GankRate', 'level4GankRate']"
        :key="key"
        :row="row"
        :evidence="evidence"
        :metric="key"
        graph="rate"
      />
    </td>
    <td class="analysis-cell">
      <div
        class="composition-bar"
        :class="{ missing: !evidence.zoneWeight }"
        role="img"
        :aria-label="zonesDescription"
      >
        <i
          v-for="(key, i) in zoneMetrics"
          :key="key"
          :style="{
            width: `${Number(row?.[key] ?? 0) * 100}%`,
            background: zoneColors[i]
          }"
        />
      </div>
      <div class="zone-values">
        <span v-for="(key, i) in zoneMetrics" :key="key"
          >{{ jungleText(i === 0 ? 'top' : i === 1 ? 'mid' : 'bot') }}
          <b>{{ formatMetric(row?.[key], 'pct') }}</b></span
        >
      </div>
      <small>{{
        jungleText('regionSamples', {
          weight: evidence.zoneWeight,
          valid: evidence.zoneGames,
          total: evidence.games
        })
      }}</small>
    </td>
    <td class="analysis-cell">
      <JungleMetric
        v-for="key in ['topGanksPG', 'midGanksPG', 'botGanksPG']"
        :key="key"
        :row="row"
        :evidence="evidence"
        :metric="key"
        graph="bar"
        :maximum="scales.gank"
      />
    </td>
  </template>
  <template v-else-if="group === 'objectives'">
    <td class="analysis-cell">
      <JungleMetric
        :row="row"
        :evidence="evidence"
        metric="firstDragonRate"
        graph="rate"
      /><JungleMetric :row="row" :evidence="evidence" metric="firstDragonTime" />
    </td>
    <td class="analysis-cell">
      <div class="resource-grid">
        <JungleMetric
          v-for="key in ['dragonsPG', 'soloDragonsPG', 'voidgrubsPG', 'heraldsPG', 'baronsPG']"
          :key="key"
          :row="row"
          :evidence="evidence"
          :metric="key"
        />
      </div>
    </td>
    <td class="analysis-cell">
      <JungleMetric
        v-for="key in ['dragon15', 'grub15', 'objectiveFight15']"
        :key="key"
        :row="row"
        :evidence="evidence"
        :metric="key"
        graph="signed"
        :maximum="scales[key as 'dragon15']"
      />
    </td>
  </template>
  <template v-else>
    <td class="analysis-cell">
      <JungleMetric
        v-for="key in ['gd10', 'gd15']"
        :key="key"
        :row="row"
        :evidence="evidence"
        :metric="key"
        graph="point"
        :maximum="scales.gold"
      />
    </td>
    <td class="analysis-cell">
      <JungleMetric
        :row="row"
        :evidence="evidence"
        metric="xpd15"
        graph="signed"
        :maximum="scales.xp"
      />
    </td>
    <td class="analysis-cell">
      <JungleMetric
        v-for="key in efficiencyMetrics"
        :key="key"
        :row="row"
        :evidence="evidence"
        :metric="key"
      />
    </td>
  </template>
</template>
<script setup lang="ts">
import { computed } from 'vue'
import type { JungleAggregate } from '../analytics'
import { formatMetric } from '../metric-defs'
import { efficiencyMetrics, zoneMetrics, type JungleEvidence, type JungleGroup } from './analysis'
import { useJungleText } from './copy'
import JungleMetric from './JungleMetric.vue'
import JungleCampTable from './JungleCampTable.vue'
const jungleText = useJungleText()
const props = defineProps<{
  row?: JungleAggregate
  evidence: JungleEvidence
  group: JungleGroup
  scales: {
    gank: number
    gold: number
    xp: number
    dragon15: number
    grub15: number
    objectiveFight15: number
  }
}>()
const zoneColors = ['var(--ma-series-3)', 'var(--ma-series-6)', 'var(--ma-blue)']
const zonesDescription = computed(() =>
  zoneMetrics
    .map(
      (key, i) =>
        `${jungleText(i === 0 ? 'top' : i === 1 ? 'mid' : 'bot')} ${formatMetric(props.row?.[key], 'pct')}`
    )
    .join(' · ')
)
</script>
<style scoped>
.analysis-cell {
  min-width: 0;
  vertical-align: top;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ma-grid);
  font-size: 14px;
}
.analysis-cell small {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 5px;
}
.composition-bar {
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  height: 12px;
  margin: 4px 0 12px;
  background: var(--ma-grid);
}
.composition-bar.missing {
  background: transparent;
}
.composition-bar i {
  height: 100%;
  box-shadow: 1px 0 0 var(--la-color-bg-primary);
}
.own-values,
.zone-values {
  display: flex;
  gap: 12px;
  justify-content: space-between;
  flex-wrap: wrap;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.own-values b,
.zone-values b {
  margin-left: 8px;
  font-weight: 600;
}
.resource-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 16px;
}
</style>
