<template>
  <section
    ref="panel"
    class="pool-popover"
    role="dialog"
    :aria-label="uiText('poolPopover', { member: short(pool.player), role: roleLabel })"
    @keydown.esc="onEscape"
    @keydown.tab="trapTab"
  >
    <NScrollbar
      ref="scrollbar"
      class="pool-scroll"
      trigger="none"
      :content-style="{ paddingRight: '20px' }"
    >
      <header class="popover-header">
        <div>
          <strong class="popover-member-role">
            <span>{{ short(pool.player) }} ·</span>
            <span class="popover-role-label">
              <PositionIcon
                v-if="championPoolRoles.includes(pool.role)"
                class="popover-role-icon"
                :position="pool.role"
                aria-hidden="true"
              />
              <span>{{ roleLabel }}</span>
            </span> </strong
          ><span>{{ uiText('poolGames', { count: pool.games }) }}</span>
        </div>
        <NButton
          ref="closeButton"
          size="small"
          quaternary
          :aria-label="uiText('poolClose')"
          @click="$emit('close')"
          >×</NButton
        >
      </header>
      <p v-if="pool.unidentifiedGames" class="pool-missing">
        {{ uiText('poolMissing', { count: pool.unidentifiedGames }) }}
      </p>
      <div class="popover-heroes">
        <button
          v-for="row in pool.rows"
          :key="row.champion"
          type="button"
          class="popover-hero"
          :class="{ selected: selected?.champion === row.champion }"
          :aria-pressed="selected?.champion === row.champion"
          :aria-expanded="selected?.champion === row.champion"
          :aria-controls="detailId"
          @click="select(row.champion)"
        >
          <ChampionIcon class="popover-portrait" :champion-id="championId(row.champion)" />
          <span class="popover-identity"
            ><strong>{{ championName(row.champion) }}</strong
            ><small>{{ uiText('poolRecord', { wins: row.wins, games: row.games }) }}</small></span
          >
          <span class="popover-rates"
            ><strong>{{ uiText('poolWinRate') }} {{ formatMetric(row.winRate, 'pct') }}</strong
            ><small
              >{{ uiText('poolPickRate') }} {{ formatMetric(row.pickRate, 'pct') }}</small
            ></span
          >
        </button>
      </div>
      <section v-if="selected" :id="detailId" ref="detail" class="popover-detail">
        <div class="detail-heading">
          <h3>{{ championName(selected.champion) }} · {{ uiText('poolHeroDetails') }}</h3>
          <NButton
            class="detail-collapse"
            size="small"
            tertiary
            :theme-overrides="{ heightSmall: '32px', fontSizeSmall: '14px' }"
            :aria-expanded="true"
            :aria-controls="detailId"
            @click="collapseDetail"
          >
            <template #icon>
              <NIcon :size="16" :component="ChevronUp20Regular" aria-hidden="true" />
            </template>
            {{ uiText('poolCancelHero') }}
          </NButton>
        </div>
        <p>{{ uiText('poolInterval') }} {{ intervalText(selected.wins, selected.games) }}</p>
        <div class="detail-sides">
          <span class="ma-blue">{{
            uiText('poolBlue', {
              rate: sideRate(selected.blueWins, selected.blueGames),
              count: selected.blueGames
            })
          }}</span
          ><span class="ma-red">{{
            uiText('poolRed', {
              rate: sideRate(selected.redWins, selected.redGames),
              count: selected.redGames
            })
          }}</span>
        </div>
        <dl class="detail-metrics">
          <div v-for="metric in displayedMetrics" :key="metric.key">
            <dt>
              <MetricHelp
                v-if="metric.description"
                :label="metric.label"
                :definition="metric.description"
              />
              <span v-else>{{ metric.label }}</span>
            </dt>
            <dd :class="metric.signed ? toneClass(selected.performance[metric.key]) : ''">
              <span class="metric-value">{{ metric.value }}</span>
              <span v-if="metric.unit" class="metric-unit"> {{ metric.unit }}</span>
            </dd>
          </div>
        </dl>
      </section>
    </NScrollbar>
  </section>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { NButton, NIcon, NScrollbar } from 'naive-ui'
import ChevronUp20Regular from '@vicons/fluent/es/ChevronUp20Regular'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { championPoolRoles, type ChampionPool } from './champion-pools'
import MetricHelp from './MetricHelp.vue'
import { formatMetric, roleMetricMeta, roleMetricName, roleMetricDetail } from './metric-defs'
import { finiteOrNull, formatSigned, wilsonInterval } from './visualization'
import { uiText } from './ui-text'
import { createChampionPoolMotion } from './champion-pool-motion'
const props = defineProps<{
  pool: ChampionPool
  roleLabel: string
  championId: (name: string) => number
  championName: (name: string) => string
  initialChampion: string | null
}>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement | null>(null)
const detail = ref<HTMLElement | null>(null)
const scrollbar = ref<InstanceType<typeof NScrollbar> | null>(null)
const closeButton = ref<InstanceType<typeof NButton> | null>(null)
const detailId = useId()
const selectedChampion = ref(props.initialChampion)
const selected = computed(() =>
  props.pool.rows.find((row) => row.champion === selectedChampion.value)
)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const detailMotion = createChampionPoolMotion(() => reducedMotion.value)
watch(reducedMotion, () => detailMotion.finish())
watch(selected, (row) => {
  detailMotion.cancel()
  if (!row) return
  void nextTick(() => {
    if (selected.value === row) detailMotion.enter(detail.value)
  })
})
onBeforeUnmount(() => detailMotion.cancel())
watch(
  () => [props.pool.key, props.initialChampion],
  async () => {
    selectedChampion.value = props.initialChampion
    await nextTick()
    if (selected.value && detail.value) {
      scrollToDetail()
    } else scrollbar.value?.scrollTo({ top: 0 })
  }
)
async function select(champion: string) {
  selectedChampion.value = selectedChampion.value === champion ? null : champion
  await nextTick()
  if (detail.value) {
    scrollToDetail()
  }
}
async function collapseDetail() {
  const trigger = panel.value?.querySelector<HTMLElement>('.popover-hero[aria-expanded="true"]')
  selectedChampion.value = null
  await nextTick()
  // Focus without scrolling the parent page (which could dismiss the anchored pool).
  trigger?.focus({ preventScroll: true })
  const scroller = scrollbar.value?.scrollbarInstRef?.containerRef
  if (trigger && panel.value && scroller) {
    const headerBottom = panel.value.querySelector('header')?.getBoundingClientRect().bottom ?? 0
    const bounds = trigger.getBoundingClientRect()
    if (bounds.top < headerBottom + 8) scroller.scrollTop += bounds.top - headerBottom - 8
    else if (bounds.bottom > panel.value.getBoundingClientRect().bottom)
      scroller.scrollTop += bounds.bottom - panel.value.getBoundingClientRect().bottom
  }
}
function scrollToDetail() {
  const scroller = scrollbar.value?.scrollbarInstRef?.containerRef
  if (!panel.value || !detail.value || !scroller) return
  const headerHeight = panel.value.querySelector('header')?.getBoundingClientRect().height ?? 0
  scroller.scrollTop +=
    detail.value.getBoundingClientRect().top -
    panel.value.getBoundingClientRect().top -
    headerHeight -
    8
}
onMounted(async () => {
  await nextTick()
  if (selected.value) scrollToDetail()
  if (selected.value) detailMotion.enter(detail.value)
  closeButton.value?.$el?.focus({ preventScroll: true })
})
function onEscape(event: KeyboardEvent) {
  if (panel.value?.querySelector('.metric-help[aria-expanded="true"]')) return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}
function trapTab(event: KeyboardEvent) {
  const controls = [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input, select, summary, [tabindex="0"]'
    ) ?? [])
  ].filter((el) => el.getClientRects().length > 0)
  const first = controls[0],
    last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
const short = (value: string) => value.split('#')[0]
const sideRate = (wins: number, games: number) => (games ? formatMetric(wins / games, 'pct') : '—')
const intervalText = (wins: number, games: number) => {
  const i = wilsonInterval(wins, games)
  return i ? formatMetric(i.low, 'pct') + '–' + formatMetric(i.high, 'pct') : '—'
}
const toneClass = (value: unknown) => {
  const n = finiteOrNull(value)
  return n === null || n === 0 ? '' : n > 0 ? 'ma-positive' : 'ma-negative'
}
const detailMetrics = [
  {
    key: 'kda',
    label: roleMetricName('kda'),
    fmt: 'num',
    signed: false,
    description: roleMetricMeta.kda.description
  },
  {
    key: 'dpm',
    label: roleMetricName('dpm'),
    fmt: 'num',
    signed: false,
    description: roleMetricMeta.dpm.description
  },
  {
    key: 'gpm',
    label: roleMetricName('gpm'),
    fmt: 'num',
    signed: false,
    description: roleMetricMeta.gpm.description
  },
  {
    key: 'kp',
    label: roleMetricName('kp'),
    fmt: 'pct',
    signed: false,
    description: roleMetricMeta.kp.description
  },
  {
    key: 'damageConversion',
    label: roleMetricName('damageConversion'),
    fmt: 'pct',
    signed: false,
    description: roleMetricMeta.damageConversion.description
  },
  {
    key: 'gd15',
    label: roleMetricName('gd15'),
    fmt: 'num',
    signed: true,
    description: roleMetricMeta.gd15.description
  }
] as const
const displayedMetrics = computed(() =>
  detailMetrics.map((metric) => {
    const raw = selected.value?.performance[metric.key]
    const formatted = roleMetricDetail(
      metric.key,
      raw,
      metric.signed ? formatSigned(raw, 1) : formatMetric(raw, metric.fmt)
    )
    const unit = formatted === '—' ? '' : (roleMetricMeta[metric.key].unit ?? '')
    return {
      ...metric,
      value: unit ? formatted.slice(0, -(unit.length + 1)) : formatted,
      unit
    }
  })
)
</script>
<style scoped>
.pool-popover {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  /* Move only the rail into 8px of the popover's existing right padding.
     Matching content padding preserves the text width and column positions. */
  width: calc(100% + 8px);
  max-height: min(520px, var(--pool-panel-max-height, calc(100vh - 56px)));
  overflow: hidden;
  font-size: 14px;
  color: var(--la-color-text-primary);
  font-variant-numeric: tabular-nums;
  container-type: inline-size;
}
.pool-popover :deep(.pool-scroll) {
  height: auto;
  max-height: inherit;
}
.pool-popover :deep(.n-scrollbar-container) {
  overflow-x: hidden;
  overscroll-behavior: contain;
}
.popover-header {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--la-color-bg-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
  padding-bottom: 4px;
}
.popover-header > div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px 12px;
  overflow-wrap: anywhere;
  min-width: 0;
  flex: 1;
}
.popover-header > :deep(.n-button) {
  flex: none;
}
.popover-member-role {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  line-height: 1.5;
}
.popover-role-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.popover-role-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex: none;
  font-size: 16px;
  line-height: 1;
}
.popover-role-icon :deep(svg) {
  display: block;
}
.popover-header strong {
  font-size: 14px;
}
.popover-header > div > span,
.pool-missing {
  font-size: 12px;
  color: var(--ma-muted);
}
.pool-missing {
  margin: 8px 0;
}
.popover-heroes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 16px;
}
.popover-hero {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) max-content;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font: inherit;
  color: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--ma-grid);
  border-radius: 4px;
  padding: 10px 2px;
  cursor: pointer;
}
.popover-hero:hover,
.popover-hero.selected {
  background: var(--ma-hover);
}
.popover-hero.selected .popover-identity strong {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.popover-hero:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -1px;
}
.popover-portrait {
  width: 34px;
  height: 34px;
  border-radius: 4px;
}
.popover-identity {
  min-width: 0;
  overflow-wrap: anywhere;
}
.popover-hero strong,
.popover-hero small {
  display: block;
  line-height: 1.5;
}
.popover-hero strong {
  font-size: 14px;
}
.popover-hero small {
  font-size: 12px;
  color: var(--ma-muted);
}
.popover-rates {
  text-align: right;
}
.popover-detail {
  margin-top: 12px;
  border-top: 1px solid var(--ma-grid);
  padding-top: 8px;
}
.detail-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
}
.detail-heading h3 {
  flex: 1 1 180px;
  min-width: 0;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.detail-collapse {
  flex: 0 0 auto;
}
.popover-detail p {
  font-size: 13px;
  line-height: 1.5;
  color: var(--ma-muted);
  margin: 8px 0;
}
.detail-sides {
  display: flex;
  gap: 8px 16px;
  flex-wrap: wrap;
  font-size: 13px;
  line-height: 1.5;
}
.detail-metrics {
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  margin: 12px 0;
}
.detail-metrics > div {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: baseline;
  gap: 16px;
  min-width: 0;
  padding: 4px 0;
  border-bottom: 1px solid var(--ma-grid);
}
.detail-metrics > div:last-child {
  border-bottom: 0;
}
.detail-metrics dt {
  min-width: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--la-color-text-primary);
  overflow-wrap: anywhere;
}
.detail-metrics dt :deep(.metric-help) {
  line-height: inherit;
}
.detail-metrics dt :deep(.metric-help:focus-visible) {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.detail-metrics dd {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  font-weight: 600;
  text-align: right;
  white-space: nowrap;
}
.metric-unit {
  margin-inline-start: 4px;
  font-size: 13px;
  font-weight: 400;
  color: var(--ma-muted);
}
@container (max-width: 438px) {
  .popover-heroes {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
