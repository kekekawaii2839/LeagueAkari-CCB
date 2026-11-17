<template>
  <section
    class="cell-details"
    :style="{ '--pair-own-color': theme.successColor, '--pair-opponent-color': theme.errorColor }"
  >
    <header class="details-header">
      <h3>{{ t('championPool.cellDetails.' + target.mode) }}</h3>
      <NButton
        size="small"
        quaternary
        :aria-label="t('championPool.cellDetails.close')"
        @click="$emit('close')"
        >×</NButton
      >
    </header>
    <div class="pair-identities">
      <div class="pair-hero">
        <ChampionIcon :champion-id="champion.id" class="hero-icon" aria-hidden="true" />
        <div class="hero-copy">
          <strong>{{ championName }}</strong>
          <span class="hero-role">
            {{ t('championPool.cellDetails.own') }}
            <PositionIcon :position="position(ownRole)" class="role-icon" aria-hidden="true" />
            {{ t('championPool.roles.' + ownRole) }}
          </span>
        </div>
      </div>
      <div class="pair-hero">
        <ChampionIcon :champion-id="target.championId" class="hero-icon" aria-hidden="true" />
        <div class="hero-copy">
          <strong>{{ targetName }}</strong>
          <span class="hero-role">
            {{
              t('championPool.cellDetails.' + (target.mode === 'matchup' ? 'opponent' : 'teammate'))
            }}
            <PositionIcon :position="position(target.role)" class="role-icon" aria-hidden="true" />
            {{ t('championPool.roles.' + target.role) }}
          </span>
        </div>
      </div>
    </div>
    <table class="win-rate-table">
      <thead>
        <tr>
          <th scope="col">{{ t('championPool.cellDetails.winRate') }}</th>
          <th scope="col">{{ championName }}</th>
          <th scope="col">{{ targetName }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">{{ t('championPool.cellDetails.overall') }}</th>
          <td>
            {{ rate(cell.ownWinRate)
            }}<span v-if="cell.ownGames != null" class="rate-sample">{{
              t('championPool.cellDetails.games', { count: cell.ownGames })
            }}</span>
          </td>
          <td>
            {{ rate(cell.targetWinRate)
            }}<span v-if="cell.targetGames != null" class="rate-sample">{{
              t('championPool.cellDetails.games', { count: cell.targetGames })
            }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <section
      class="pair-win-rate"
      :aria-label="
        t('championPool.cellDetails.' + (target.mode === 'matchup' ? 'versus' : 'together'))
      "
    >
      <h4>
        {{ t('championPool.cellDetails.' + (target.mode === 'matchup' ? 'versus' : 'together')) }}
      </h4>
      <template v-if="target.mode === 'matchup' && pairRate !== null">
        <div
          class="versus-bar"
          role="img"
          :aria-label="
            t('championPool.cellDetails.split', {
              champion: championName,
              own: rate(pairRate),
              target: targetName,
              other: rate(1 - pairRate)
            })
          "
        >
          <span class="own-share" :style="{ width: pairRate * 100 + '%' }"></span>
          <span class="opponent-share" :style="{ width: (1 - pairRate) * 100 + '%' }"></span>
        </div>
        <div class="versus-values">
          <span
            >{{ championName }} <strong>{{ rate(pairRate) }}</strong></span
          >
          <span
            >{{ targetName }} <strong>{{ rate(1 - pairRate) }}</strong></span
          >
        </div>
      </template>
      <p v-else class="shared-win-rate">
        {{ pairRate === null ? unavailableRate : rate(pairRate) }}
      </p>
    </section>
    <dl class="pair-metrics">
      <div>
        <dt>{{ t('championPool.cellDetails.delta') }}</dt>
        <dd>{{ delta }}</dd>
      </div>
      <div>
        <dt>{{ t('championPool.cellDetails.sample') }}</dt>
        <dd>
          {{
            cell.games === null
              ? t('championPool.cellDetails.unknownSample')
              : t('championPool.cellDetails.games', { count: cell.games })
          }}
        </dd>
      </div>
    </dl>
    <p v-if="cell.state === 'unavailable'" class="details-note">
      {{ t('championPool.cellDetails.unavailableHelp') }}
    </p>
    <p v-else-if="cell.state === 'missing' || cell.deltaPp === null" class="details-note">
      {{ t('championPool.cellDetails.missingHelp') }}
    </p>
    <footer class="details-source">
      <p>{{ t('championPool.source', { patch }) }}</p>
    </footer>
  </section>
</template>

<script setup lang="ts">
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import type { PoolCell, PoolChampion, PoolTarget } from '@shared/shards/champion-pool/coverage'
import type { DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import { useTranslation } from 'i18next-vue'
import { NButton, useThemeVars } from 'naive-ui'
import { computed } from 'vue'

const props = defineProps<{
  champion: PoolChampion
  target: PoolTarget
  cell: PoolCell
  ownRole: DraftRole
  patch: string
  fetchedAt: string
}>()
defineEmits<{ close: [] }>()
const { t } = useTranslation()
const resources = useAkariResourceProvider()
const theme = useThemeVars()
const championName = computed(
  () => resources.champions.name(props.champion.id) || props.champion.name
)
const targetName = computed(
  () => resources.champions.name(props.target.championId) || props.target.name
)
const position = (role: DraftRole) => (role === 'SUP' ? 'SUPPORT' : role)
const delta = computed(() => {
  if (props.cell.state === 'unavailable') return t('championPool.cellDetails.unavailable')
  if (props.cell.state === 'missing' || props.cell.deltaPp === null)
    return t('championPool.cellDetails.missing')
  const value = props.cell.deltaPp
  return t('championPool.cellDetails.deltaValue', {
    value: `${value > 0 ? '+' : ''}${value.toFixed(2)}`
  })
})
const rate = (value: number | null | undefined) =>
  value == null ? t('championPool.cellDetails.notCollected') : (value * 100).toFixed(2) + '%'
const pairRate = computed(() =>
  props.cell.state === 'unavailable' || props.cell.games === null || props.cell.games <= 0
    ? null
    : (props.cell.pairWinRate ?? null)
)
const unavailableRate = computed(() =>
  t(
    props.cell.state === 'unavailable'
      ? 'championPool.cellDetails.notApplicable'
      : 'championPool.cellDetails.notCollected'
  )
)
</script>

<style scoped>
.cell-details {
  width: 360px;
  max-width: min(100%, calc(100vw - 48px));
  min-width: 0;
  color: var(--la-color-text-primary);
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.details-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.details-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.pair-identities {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.pair-hero {
  display: flex;
  align-items: center;
  min-width: 0;
  gap: 8px;
}
.hero-icon {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  border-radius: 4px;
}
.hero-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.hero-copy strong {
  font-weight: 600;
}
.hero-role {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
.role-icon {
  font-size: 16px;
  flex-shrink: 0;
}
.win-rate-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin-bottom: 16px;
}
.win-rate-table th,
.win-rate-table td {
  padding: 8px 4px;
  text-align: right;
  vertical-align: top;
  font-variant-numeric: tabular-nums;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.18);
}
.win-rate-table th:first-child {
  text-align: left;
  font-weight: 400;
  width: 25%;
}
.win-rate-table thead th {
  font-size: 12px;
  font-weight: 600;
}
.rate-sample {
  display: block;
  font-size: 12px;
  font-weight: 400;
}
.pair-win-rate {
  margin-bottom: 16px;
}
.pair-win-rate h4 {
  margin: 0 0 8px;
  font-size: 13px;
  font-weight: 400;
}
.versus-bar {
  display: flex;
  height: 12px;
  overflow: hidden;
  border-radius: 4px;
}
.own-share {
  background: var(--pair-own-color);
}
.opponent-share {
  background: var(--pair-opponent-color);
}
.versus-values {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.versus-values > span {
  min-width: 0;
  flex: 1;
}
.versus-values > span:last-child {
  text-align: right;
}
.versus-values strong {
  display: block;
  font-size: 14px;
}
.shared-win-rate {
  text-align: center;
  margin: 8px 0;
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.pair-metrics {
  display: grid;
  gap: 8px;
  margin: 0 0 12px;
}
.pair-metrics > div {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
}
.pair-metrics dt,
.pair-metrics dd {
  margin: 0;
}
.pair-metrics dd {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.details-note {
  font-size: 13px;
  margin: 8px 0 0;
}
.details-source {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.25);
  font-size: 12px;
}
.details-source p {
  margin: 0;
}
@media (max-width: 420px) {
  .pair-identities {
    grid-template-columns: 1fr;
  }
}
</style>
