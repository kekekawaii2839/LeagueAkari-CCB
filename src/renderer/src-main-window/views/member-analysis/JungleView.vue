<template>
  <div ref="root" class="ma-panel ma-workspace jungle-view">
    <div class="jungle-toolbar ma-view-toolbar">
      <NRadioGroup v-model:value="state.group" size="small"
        ><NRadioButton v-for="(value, key) in jungleGroups" :key="key" :value="key">{{
          value.label
        }}</NRadioButton></NRadioGroup
      >
      <span class="ma-view-meta">{{
        jungleText('members', { members: totals.length, games: totalGames })
      }}</span>
      <label v-if="store.analysisSide === 'all'" class="side-toggle"
        >{{ jungleText('sideToggle') }}<NSwitch v-model:value="store.sideBreakdown" size="small"
      /></label>
    </div>
    <div class="group-note">
      <span>{{ jungleText(`${state.group}Note`) }}</span>
      <NButton
        secondary
        :aria-expanded="state.method"
        aria-controls="jungle-method"
        @click="state.method = !state.method"
        >{{ jungleText(state.method ? 'hideHelp' : 'help') }}</NButton
      >
    </div>
    <div v-if="state.group === 'opening'" class="jungle-legend">
      <span v-for="(_, i) in campIds" :key="i"
        ><i :style="{ background: campColors[i] }" />{{ jungleText(`camp${i}` as 'camp0') }}</span
      >
    </div>
    <p v-else-if="state.group === 'development'" class="scale-note">
      {{
        jungleText('goldScale', {
          gold: scales.gold.toFixed(0),
          xp: scales.xp.toFixed(0)
        })
      }}
    </p>
    <p v-else-if="state.group === 'gank'" class="scale-note">
      {{ jungleText('gankScale', { maximum: scales.gank.toFixed(1) }) }}
    </p>
    <p v-else class="scale-note">
      {{
        jungleText('objectiveScale', {
          dragon: scales.dragon15.toFixed(2),
          grub: scales.grub15.toFixed(2),
          fight: scales.objectiveFight15.toFixed(2)
        })
      }}
    </p>
    <p v-if="selectionGone" role="status" class="scale-note">
      {{ jungleText('selectionGone') }}
    </p>
    <div
      v-if="totals.length"
      ref="comparison"
      class="jungle-scroll"
      role="region"
      tabindex="0"
      :aria-label="jungleText('scroll')"
    >
      <table class="jungle-comparison" :class="`is-${state.group}`">
        <colgroup>
          <col class="identity-column" />
          <col v-for="(_, i) in headers" :key="i" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" class="identity">
              {{ jungleText('memberHeader') }}
            </th>
            <th v-for="header in headers" :key="header" scope="col">
              {{ header }}
            </th>
          </tr>
        </thead>
        <tbody>
          <template v-for="row in totals" :key="row.player">
            <tr class="member-row">
              <th scope="row" class="identity">
                <div class="member-name">
                  <span class="member-badge">{{ memberNumber(row.player) }}</span
                  ><button
                    :ref="(el) => setTrigger(row.player, el)"
                    type="button"
                    class="member-trigger"
                    :aria-expanded="state.selected === row.player"
                    aria-controls="jungle-details"
                    @click="toggle(row.player, $event)"
                  >
                    {{ short(row.player) }}
                  </button>
                </div>
                <small>{{
                  jungleText('sample', {
                    games: row.games,
                    wins: row.wins,
                    losses: row.games - row.wins
                  })
                }}</small>
                <small v-if="row.games < 5">{{ jungleText('lowSample') }}</small>
                <small>{{
                  jungleText('winRate', {
                    rate: formatMetric(row.winRate, 'pct')
                  })
                }}</small>
                <WinRateInterval :wins="row.wins" :games="row.games" class="member-interval" />
                <button
                  type="button"
                  class="member-expand"
                  :aria-expanded="state.selected === row.player"
                  aria-controls="jungle-details"
                  @click="toggle(row.player, $event)"
                >
                  {{ jungleText(state.selected === row.player ? 'close' : 'open') }}
                </button>
              </th>
              <JungleCells
                :row="row"
                :evidence="evidence(row)"
                :group="state.group"
                :scales="scales"
              />
            </tr>
            <template v-if="showSides"
              ><tr v-for="side in sides" :key="side" class="side-row">
                <th scope="row" class="identity">
                  <small class="side-member">{{ short(row.player) }}</small
                  ><strong :class="side === '蓝方' ? 'ma-blue' : 'ma-red'">{{
                    jungleText(side === '蓝方' ? 'blue' : 'red')
                  }}</strong>
                  <small>{{
                    jungleText('sample', {
                      games: sideRow(row, side)?.games ?? 0,
                      wins: sideRow(row, side)?.wins ?? 0,
                      losses: (sideRow(row, side)?.games ?? 0) - (sideRow(row, side)?.wins ?? 0)
                    })
                  }}</small>
                </th>
                <JungleCells
                  :row="sideRow(row, side)"
                  :evidence="evidenceFor(row.player, side)"
                  :group="state.group"
                  :scales="scales"
                /></tr
            ></template>
          </template>
        </tbody>
      </table>
    </div>
    <div v-else class="ma-empty">{{ jungleText('empty') }}</div>
    <section
      v-if="selected"
      id="jungle-details"
      ref="details"
      class="jungle-details"
      aria-labelledby="jungle-details-heading"
      tabindex="-1"
      @keydown.esc.prevent.stop="closeDetails"
    >
      <header>
        <h3 id="jungle-details-heading">
          {{ jungleText('details', { member: selected.player }) }}
        </h3>
        <NButton secondary @click="closeDetails">{{ jungleText('closeButton') }}</NButton>
      </header>
      <p>
        {{
          jungleText('sample', {
            games: selected.games,
            wins: selected.wins,
            losses: selected.games - selected.wins
          })
        }}
        ·
        {{ jungleText('winRate', { rate: formatMetric(selected.winRate, 'pct') }) }}
        ·
        {{
          jungleText('interval', {
            low: formatMetric(selectedInterval?.low, 'pct'),
            high: formatMetric(selectedInterval?.high, 'pct')
          })
        }}
      </p>
      <h4>{{ jungleText('campDetails') }}</h4>
      <div
        class="detail-camp-scroll"
        role="region"
        tabindex="0"
        :aria-label="jungleText('campDetails')"
      >
        <JungleCampTable :evidence="evidence(selected)" complete />
      </div>
      <template v-if="showSides"
        ><template v-for="side in sides" :key="side"
          ><h4>
            {{
              jungleText('sideDetails', {
                side: jungleText(side === '蓝方' ? 'blue' : 'red')
              })
            }}
          </h4>
          <div
            class="detail-camp-scroll"
            role="region"
            tabindex="0"
            :aria-label="
              jungleText('sideDetails', {
                side: jungleText(side === '蓝方' ? 'blue' : 'red')
              })
            "
          >
            <JungleCampTable
              :evidence="evidenceFor(selected.player, side)"
              complete
            /></div></template
      ></template>
      <div class="full-metrics">
        <div v-for="metric in detailMetrics" :key="metric" class="full-metric">
          <JungleMetric :row="selected" :evidence="evidence(selected)" :metric="metric" /><template
            v-if="showSides"
            ><div v-for="side in sides" :key="side" class="full-side">
              <span :class="side === '蓝方' ? 'ma-blue' : 'ma-red'">{{
                jungleText(side === '蓝方' ? 'blue' : 'red')
              }}</span
              ><JungleMetric
                :row="sideRow(selected, side)"
                :evidence="evidenceFor(selected.player, side)"
                :metric="metric"
              /></div
          ></template>
        </div>
      </div>
      <p class="scale-note">{{ jungleText('source') }}</p>
    </section>
    <section v-if="state.method" id="jungle-method" class="jungle-method">
      <h3>{{ jungleText('definitions') }}</h3>
      <p
        v-for="key in [
          'methodOpening',
          'methodGank',
          'methodResources',
          'methodDevelopment',
          'uncertainty'
        ] as const"
        :key="key"
      >
        {{ jungleText(key) }}
      </p>
    </section>
  </div>
</template>
<script lang="ts">
import { reactive } from 'vue'
import type { JungleGroup } from './jungle'
// Session-only: retain valid group/selection across native page tabs without persisting settings.
const sessions = new WeakMap<object, { group: JungleGroup; selected: string; method: boolean }>()
</script>
<script setup lang="ts">
import { NButton, NRadioGroup, NRadioButton, NSwitch } from 'naive-ui'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type ComponentPublicInstance
} from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import type { JungleAggregate, SideLabel } from './analytics'
import { formatMetric, jungleGroups } from './metric-defs'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { memberOrder, wilsonInterval } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import {
  campIds,
  commonExtent,
  emptyEvidence,
  evidenceKey,
  jungleEvidence,
  useJungleText,
  JungleCells,
  JungleCampTable,
  JungleMetric
} from './jungle'
const jungleText = useJungleText()
const store = useMemberAnalysisStore()
const { jungle, games } = useMemberAnalysisData()
const state =
  sessions.get(store) ?? reactive({ group: 'opening' as JungleGroup, selected: '', method: false })
sessions.set(store, state)
const root = ref<HTMLElement | null>(null)
const comparison = ref<HTMLElement | null>(null)
const details = ref<HTMLElement | null>(null)
const selectionGone = ref(false)
const triggers = new Map<string, HTMLElement>()
let detailTrigger: HTMLElement | null = null
const setTrigger = (player: string, el: Element | ComponentPublicInstance | null) => {
  if (el instanceof HTMLElement) triggers.set(player, el)
  else triggers.delete(player)
}
const short = (player: string) => player.split('#')[0]
const totals = computed(() => {
  const rows = jungle.value.filter(
    (row) =>
      row.sideLabel === '总计' ||
      !jungle.value.some((r) => r.player === row.player && r.sideLabel === '总计')
  )
  const order = memberOrder(
    rows.map((r) => r.player),
    store.settings?.members ?? []
  )
  return [...rows].sort((a, b) => order.indexOf(a.player) - order.indexOf(b.player))
})
const totalGames = computed(() => totals.value.reduce((s, row) => s + row.games, 0))
const showSides = computed(() => store.analysisSide === 'all' && store.sideBreakdown)
const sides = ['蓝方', '红方'] as const
const sideMap = computed(
  () => new Map(jungle.value.map((row) => [evidenceKey(row.player, row.sideLabel), row]))
)
const sideRow = (row: JungleAggregate, side: SideLabel) =>
  sideMap.value.get(evidenceKey(row.player, side))
const populations = computed(() => jungleEvidence(games.value))
const evidenceFor = (player: string, side: SideLabel) =>
  populations.value.get(evidenceKey(player, side)) ?? emptyEvidence()
const evidence = (row: JungleAggregate) => evidenceFor(row.player, row.sideLabel)
const memberNumber = (player: string) => {
  const configured =
    store.settings?.members.findIndex((m) => `${m.gameName}#${m.tagLine}` === player) ?? -1
  return configured >= 0 ? configured + 1 : totals.value.findIndex((r) => r.player === player) + 1
}
const selected = computed(() => totals.value.find((row) => row.player === state.selected))
const selectedInterval = computed(() =>
  wilsonInterval(selected.value?.wins ?? 0, selected.value?.games ?? 0)
)
const scales = computed(() => ({
  gank: commonExtent(jungle.value, ['topGanksPG', 'midGanksPG', 'botGanksPG'], 1),
  gold: commonExtent(jungle.value, ['gd10', 'gd15'], 500),
  xp: commonExtent(jungle.value, ['xpd15'], 300),
  dragon15: commonExtent(jungle.value, ['dragon15'], 1),
  grub15: commonExtent(jungle.value, ['grub15'], 1),
  objectiveFight15: commonExtent(jungle.value, ['objectiveFight15'], 1)
}))
const headers = computed(
  () =>
    ({
      opening: [jungleText('ownership'), jungleText('campHeader')],
      gank: [jungleText('gankLevel'), jungleText('zones'), jungleText('lanes')],
      objectives: [jungleText('dragon'), jungleText('resources'), jungleText('early')],
      development: [jungleText('gold'), jungleText('xp'), jungleText('efficiency')]
    })[state.group]
)
const detailMetrics = [
  ...new Set(Object.values(jungleGroups).flatMap((g) => [...g.columns]))
].filter((k) => !['games', 'winRate', 'startDistribution'].includes(k))
const campColors = [
  'var(--ma-red)',
  'var(--ma-blue)',
  'var(--ma-series-1)',
  'var(--ma-series-3)',
  'var(--ma-series-6)',
  'var(--ma-series-5)'
]
async function toggle(player: string, event: MouseEvent) {
  selectionGone.value = false
  if (state.selected === player) {
    await closeDetails()
    return
  }
  detailTrigger = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  state.selected = player
  await nextTick()
  if (state.selected !== player) return
  if (event.detail === 0) details.value?.focus({ preventScroll: true })
  details.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
}
async function closeDetails() {
  const player = state.selected
  const trigger = detailTrigger?.isConnected ? detailTrigger : triggers.get(player)
  detailTrigger = null
  state.selected = ''
  await nextTick()
  if (state.selected || !root.value?.isConnected) return
  trigger?.focus({ preventScroll: true })
  trigger?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
  comparison.value?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  // Native nearest scrolling does not account for the table's sticky header.
  if (trigger && comparison.value) {
    const box = comparison.value.getBoundingClientRect()
    const headerHeight =
      comparison.value.querySelector('thead')?.getBoundingClientRect().height ?? 0
    const obscured = box.top + headerHeight + 8 - trigger.getBoundingClientRect().top
    if (obscured > 0) comparison.value.scrollTop -= obscured
  }
}
function escape(event: KeyboardEvent) {
  if (event.key === 'Escape' && state.selected && root.value?.contains(event.target as Node)) {
    event.preventDefault()
    void closeDetails()
  }
}
onMounted(() => document.addEventListener('keydown', escape))
onBeforeUnmount(() => document.removeEventListener('keydown', escape))
watch(
  () => totals.value.map((row) => row.player),
  (names) => {
    if (state.selected && !names.includes(state.selected)) {
      state.selected = ''
      detailTrigger = null
      selectionGone.value = true
    }
  },
  { immediate: true }
)
</script>
<style scoped>
.jungle-view {
  --jungle-sticky-width: 200px;
  gap: 12px;
}
.jungle-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.side-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.group-note {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  color: var(--ma-muted);
  font-size: 14px;
}
.group-note :deep(.n-button) {
  flex: none;
}
.jungle-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--ma-muted);
}
.jungle-legend i {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 5px;
}
.scale-note {
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}
.jungle-scroll {
  /* One local scroller for both axes; short lists retain their natural height. */
  max-height: 55dvh;
  overflow: auto;
  max-width: 100%;
  border-top: 1px solid var(--ma-grid-strong);
  border-bottom: 1px solid var(--ma-grid-strong);
}
.jungle-comparison {
  width: 100%;
  min-width: 1140px;
  table-layout: fixed;
  border-collapse: separate;
  border-spacing: 0;
  font-variant-numeric: tabular-nums;
}
.jungle-comparison.is-objectives {
  min-width: 1260px;
}
.identity-column {
  width: 200px;
}
.is-opening col:nth-child(2) {
  width: 250px;
}
.jungle-comparison thead th {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--la-color-bg-primary);
  font-size: 13px;
  color: var(--ma-muted);
  font-weight: 500;
  text-align: left;
  padding: 12px 16px;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.jungle-comparison thead .identity {
  z-index: 5;
}
.identity {
  position: sticky;
  left: 0;
  z-index: 3;
  background: var(--la-color-bg-primary);
  text-align: left;
  border-right: 1px solid var(--ma-grid-strong);
  font-weight: 400;
}
.jungle-comparison tbody .identity {
  vertical-align: top;
  padding: 14px 16px;
  border-bottom: 1px solid var(--ma-grid);
}
.member-name {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.member-badge {
  display: grid;
  place-items: center;
  flex: none;
  width: 24px;
  height: 24px;
  text-align: center;
  border: 1px solid var(--ma-grid-strong);
  border-radius: 50%;
  font-size: 13px;
}
.member-trigger {
  border: 0;
  background: none;
  padding: 0;
  text-align: left;
  overflow-wrap: anywhere;
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
  cursor: pointer;
}
.identity small {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 1.5;
  margin-top: 7px;
}
.member-expand {
  border: 0;
  background: none;
  color: var(--la-color-link);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  padding: 4px 0;
  margin-top: 5px;
}
.member-interval {
  width: 100px;
  margin-top: 6px;
}
.side-row .identity {
  padding-left: 32px !important;
}
.side-row {
  background: color-mix(in srgb, var(--la-color-bg-primary) 96%, var(--ma-blue));
}
.side-member {
  overflow-wrap: anywhere;
  margin: 0 0 5px !important;
}
.jungle-details,
.jungle-method {
  margin-top: 12px;
  padding-top: 20px;
  border-top: 1px solid var(--ma-grid-strong);
}
.jungle-details {
  scroll-margin-top: 12px;
  --jungle-sticky-width: 0px;
}
.jungle-details header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.jungle-view h3 {
  margin: 0 0 12px;
  font-size: 16px;
  font-weight: 600;
}
.jungle-view h4 {
  font-size: 14px;
  margin: 20px 0 12px;
}
.jungle-details p {
  font-size: 14px;
}
.detail-camp-scroll {
  max-width: 100%;
  overflow-x: auto;
}
.full-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px 24px;
  margin: 24px 0;
}
.full-metric {
  border-bottom: 1px solid var(--ma-grid);
  padding-bottom: 12px;
}
.full-side {
  margin-top: 12px;
}
.full-side > span {
  display: block;
  font-size: 12px;
  margin-bottom: 4px;
}
.jungle-method p {
  max-width: 1150px;
  color: var(--ma-muted);
  font-size: 14px;
  line-height: 1.6;
}
.jungle-scroll:focus-visible,
.detail-camp-scroll:focus-visible,
.member-trigger:focus-visible,
.member-expand:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
@media (max-width: 1500px) {
  .full-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 900px) {
  .group-note {
    gap: 10px;
  }
  .full-metrics {
    grid-template-columns: 1fr;
  }
}
</style>
