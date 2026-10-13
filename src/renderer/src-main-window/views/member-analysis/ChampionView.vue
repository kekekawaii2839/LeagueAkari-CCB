<template>
  <div ref="root" class="ma-panel champion-view">
    <div v-if="!champions.length" class="ma-empty champion-empty" role="status">
      <strong>{{ uiText('championEmptyTitle') }}</strong>
      <p>{{ uiText('championEmptyHelp') }}</p>
      <NButton secondary @click="store.resetFilters()">{{
        uiText('resetFilterConditions')
      }}</NButton>
    </div>
    <template v-else>
      <div class="pool-toolbar">
        <span>{{ uiText('poolTopHeroes') }}</span>
        <NButton v-if="sort" size="small" quaternary @click="restoreOrder">{{
          uiText('poolResetSort')
        }}</NButton>
        <span class="pool-legend">{{ uiText('poolLegend') }}</span>
      </div>
      <div class="pool-matrix-scroll" tabindex="0" role="region" :aria-label="uiText('poolMatrix')">
        <table class="pool-matrix">
          <colgroup>
            <col class="member-column" />
            <col v-for="role in championPoolRoles" :key="role" />
          </colgroup>
          <thead ref="matrixHeader" :style="{ transform: `translateY(${headerOffset}px)` }">
            <tr>
              <th scope="col" class="member-heading">{{ uiText('poolMember') }}</th>
              <th
                v-for="role in championPoolRoles"
                :key="role"
                scope="col"
                :aria-sort="sort?.role === role ? sort.direction : 'none'"
              >
                <NPopover
                  :show="sortMenuRole === role"
                  trigger="click"
                  placement="bottom-start"
                  :style="{ ...popoverTheme, background: 'var(--la-color-bg-primary)' }"
                  :disabled="excludedRole(role)"
                  @update:show="(value) => (sortMenuRole = value ? role : null)"
                >
                  <template #trigger
                    ><button
                      type="button"
                      class="pool-sort-trigger"
                      :data-sort-role="role"
                      :disabled="excludedRole(role)"
                      :aria-label="uiText('poolSort', { role: roleNames[role] })"
                      :aria-expanded="sortMenuRole === role"
                      @keydown.esc.stop.prevent="closeSortMenu(role)"
                    >
                      <span>{{ roleNames[role] }}</span
                      ><small v-if="sort?.role === role"
                        >{{ uiText(sort.metric === 'games' ? 'poolSortGames' : 'poolSortHeroes') }}
                        {{ sort.direction === 'descending' ? '↓' : '↑' }}</small
                      ><span v-else aria-hidden="true" class="pool-sort-mark">↕</span>
                    </button></template
                  >
                  <div class="pool-sort-menu" @keydown.esc.stop.prevent="closeSortMenu(role)">
                    <button
                      v-for="option in sortOptions"
                      :key="option.label"
                      type="button"
                      :aria-pressed="
                        sort?.role === role &&
                        sort.metric === option.metric &&
                        sort.direction === option.direction
                      "
                      @click="applySort(role, option.metric, option.direction)"
                    >
                      {{ uiText(option.label)
                      }}<span
                        v-if="
                          sort?.role === role &&
                          sort.metric === option.metric &&
                          sort.direction === option.direction
                        "
                        aria-hidden="true"
                      >
                        ✓</span
                      >
                    </button>
                  </div>
                </NPopover>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in sortedMembers" :key="member.player">
              <th scope="row" class="member-heading">{{ short(member.player) }}</th>
              <td
                v-for="role in championPoolRoles"
                :key="role"
                :class="{
                  'pool-active': !!activePool && activePool.key === member.pools[role]?.key,
                  'pool-unplayed': !member.pools[role]
                }"
              >
                <template v-if="member.pools[role]">
                  <div class="pool-cell-heading">
                    <span>{{
                      uiText(
                        member.pools[role]!.unidentifiedGames ? 'poolIdentified' : 'poolUsed',
                        { count: member.pools[role]!.heroCount }
                      )
                    }}</span>
                    <span class="pool-cell-games">{{
                      uiText('poolGames', { count: member.pools[role]!.games })
                    }}</span>
                    <button
                      type="button"
                      class="pool-more"
                      :aria-label="
                        uiText('poolOpen', { member: short(member.player), role: roleNames[role] })
                      "
                      aria-haspopup="dialog"
                      :aria-expanded="activePool?.key === member.pools[role]!.key"
                      @click="openPool(member.pools[role]!, null, $event)"
                    >
                      ···
                    </button>
                  </div>
                  <p v-if="member.pools[role]!.unidentifiedGames" class="pool-missing">
                    {{ uiText('poolMissing', { count: member.pools[role]!.unidentifiedGames }) }}
                  </p>
                  <div class="pool-heroes">
                    <ChampionPoolPortrait
                      v-for="row in member.pools[role]!.rows.slice(0, 3)"
                      :key="row.champion"
                      :row="row"
                      :name="championName(row.champion)"
                      :champion-id="championId(row.champion)"
                      @open="(event) => openPool(member.pools[role]!, row.champion, event)"
                    />
                  </div>
                </template>
                <span v-else class="pool-cell-empty">{{
                  uiText(excludedRole(role) ? 'poolExcludedRole' : 'poolEmptyRole')
                }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <NPopover
        :show="!!renderedPool"
        ref="poolPopover"
        trigger="manual"
        placement="bottom-start"
        :flip="false"
        :animated="false"
        :x="popoverPosition.x"
        :y="popoverPosition.y"
        :show-arrow="false"
        display-directive="if"
        :style="{
          ...popoverTheme,
          width: popoverWidth + 'px',
          maxWidth: popoverWidth + 'px',
          boxSizing: 'border-box',
          padding: '12px',
          margin: '0',
          pointerEvents: activePool ? undefined : 'none',
          maxHeight: popoverMaxHeight + 'px',
          '--pool-panel-max-height': popoverPanelMaxHeight + 'px',
          background: 'var(--la-color-bg-primary)'
        }"
        @clickoutside="onPoolClickOutside"
      >
        <ChampionPoolPopover
          ref="poolPanel"
          v-if="renderedPool"
          :key="renderedPool.key"
          :pool="renderedPool"
          :inert="!activePool || undefined"
          :aria-hidden="!activePool || undefined"
          :role-label="roleNames[renderedPool.role]"
          :champion-id="championId"
          :champion-name="championName"
          :initial-champion="initialChampion"
          @close="closePool()"
        />
      </NPopover>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from 'vue'
import {
  useEventListener,
  useMediaQuery,
  useMutationObserver,
  useResizeObserver
} from '@vueuse/core'
import { NButton, NPopover } from 'naive-ui'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import {
  buildChampionPools,
  championPoolRoles,
  isIdentifiedChampion,
  sortChampionPools,
  type ChampionPool,
  type ChampionPoolRole,
  type ChampionPoolSort
} from './champion-pools'
import ChampionPoolPortrait from './ChampionPoolPortrait.vue'
import ChampionPoolPopover from './ChampionPoolPopover.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { uiText } from './ui-text'
import { resolveChampionPoolPosition } from './champion-pool-position'
import { createChampionPoolMotion } from './champion-pool-motion'
const store = useMemberAnalysisStore()
const { champions } = useMemberAnalysisData()
const league = useLeagueClientStore()
const extra = useExtraAssetsStore()
const resources = useAkariResourceProvider()
const root = ref<HTMLElement | null>(null)
const matrixHeader = ref<HTMLElement | null>(null)
const headerOffset = ref(0)
function positionHeader() {
  const scroll = root.value?.querySelector('.pool-matrix-scroll')
  const nav = root.value?.closest('.member-analysis-ready')?.querySelector('.n-tabs-nav')
  if (!scroll || !matrixHeader.value || !nav || !root.value?.getClientRects().length) {
    headerOffset.value = 0
    return
  }
  const bounds = scroll.getBoundingClientRect()
  // Horizontal overflow makes this wrapper the CSS sticky ancestor. Follow the
  // native page scroller without duplicating the semantic header or its controls.
  headerOffset.value = Math.max(
    0,
    Math.min(
      nav.getBoundingClientRect().bottom - bounds.top,
      bounds.height - matrixHeader.value.offsetHeight
    )
  )
}
const roleNames = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
} as const
const members = computed(() => buildChampionPools(champions.value, store.settings?.members ?? []))
const sort = computed(() => store.championViewState.sort)
const sortedMembers = computed(() => sortChampionPools(members.value, sort.value))
const sortMenuRole = ref<ChampionPoolRole | null>(null)
const sortOptions = [
  { metric: 'games', direction: 'descending', label: 'poolSortGamesDesc' },
  { metric: 'games', direction: 'ascending', label: 'poolSortGamesAsc' },
  { metric: 'heroes', direction: 'descending', label: 'poolSortHeroesDesc' },
  { metric: 'heroes', direction: 'ascending', label: 'poolSortHeroesAsc' }
] as const
const excludedRole = (role: ChampionPoolRole) =>
  store.filters.matchRole !== 'all' && store.filters.matchRole !== role
function sortTrigger(role: ChampionPoolRole) {
  return root.value?.querySelector<HTMLButtonElement>('[data-sort-role="' + role + '"]')
}
async function closeSortMenu(role: ChampionPoolRole) {
  sortMenuRole.value = null
  await nextTick()
  sortTrigger(role)?.focus()
}
async function applySort(
  role: ChampionPoolRole,
  metric: ChampionPoolSort['metric'],
  direction: ChampionPoolSort['direction']
) {
  await closePool(false)
  store.championViewState.sort = { role, metric, direction }
  await closeSortMenu(role)
}
async function restoreOrder() {
  await closePool(false)
  store.championViewState.sort = null
}
watch(
  () => store.filters.matchRole,
  () => {
    if (sort.value && excludedRole(sort.value.role)) store.championViewState.sort = null
  }
)
const poolKey = ref<string | null>(null)
const initialChampion = ref<string | null>(null)
const activePool = computed(() =>
  members.value
    .flatMap((member) => Object.values(member.pools))
    .find((pool) => pool.key === poolKey.value)
)
const renderedPool = shallowRef<ChampionPool | null>(null)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const poolMotion = createChampionPoolMotion(() => reducedMotion.value)
let interactionSequence = 0
watch(reducedMotion, () => poolMotion.finish())
watch(activePool, (pool) => {
  if (pool) renderedPool.value = pool
})
const popoverWidth = ref(560)
const popoverMaxHeight = ref(544)
const popoverPanelMaxHeight = ref(520)
const poolPanel = ref<InstanceType<typeof ChampionPoolPopover> | null>(null)
const poolPopover = ref<InstanceType<typeof NPopover> | null>(null)
const popoverTheme = ref<Record<string, string>>({})
const popoverPosition = ref({ x: 0, y: 0 })
let poolTrigger: HTMLElement | null = null
function positionPool() {
  if (!root.value) return
  const theme = getComputedStyle(root.value)
  popoverTheme.value = Object.fromEntries(
    [
      '--ma-blue',
      '--ma-red',
      '--ma-positive',
      '--ma-negative',
      '--ma-grid',
      '--ma-grid-strong',
      '--ma-muted',
      '--ma-hover',
      '--ma-series-1'
    ].map((name) => [name, theme.getPropertyValue(name)])
  )
  if (!activePool.value) return
  if (!poolTrigger?.isConnected) {
    void closePool(false)
    return
  }
  const page =
    root.value.closest('.member-analysis-page')?.getBoundingClientRect() ??
    root.value.getBoundingClientRect()
  const trigger = poolTrigger.getBoundingClientRect()
  const scroller = root.value.closest('.member-analysis-scroll')?.getBoundingClientRect()
  const nav = root.value.closest('.member-analysis-ready')?.querySelector('.n-tabs-nav')
  const bounds = {
    left: Math.max(0, page.left) + 8,
    right: Math.min(window.innerWidth, page.right) - 8,
    top:
      Math.max(
        scroller?.top ?? 0,
        nav?.getBoundingClientRect().bottom ?? 0,
        matrixHeader.value?.getBoundingClientRect().bottom ?? 0
      ) + 8,
    bottom: Math.min(window.innerHeight, scroller?.bottom ?? window.innerHeight) - 8
  }
  const body = (poolPanel.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>('.n-popover')
  const position = resolveChampionPoolPosition(bounds, trigger, body?.offsetHeight || undefined)
  if (!position) {
    void closePool(false)
    return
  }
  popoverWidth.value = position.width
  popoverMaxHeight.value = position.maxHeight
  popoverPanelMaxHeight.value = position.panelMaxHeight
  // Akari offsets vueuc's measured viewport below the native titlebar. Manual
  // point coordinates are relative to that viewport, unlike client rects.
  const measuredView = document.getElementById('v-binder-view-measurer')?.getBoundingClientRect()
  const titlebarHeight =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--la-titlebar-height')
    ) || 0
  popoverPosition.value = {
    x: position.x - (measuredView?.left ?? 0),
    y: position.y - (measuredView?.top ?? titlebarHeight)
  }
  void nextTick(() => poolPopover.value?.syncPosition())
}
async function openPool(pool: ChampionPool, champion: string | null, event: MouseEvent) {
  const sequence = ++interactionSequence
  poolMotion.cancel()
  sortMenuRole.value = null
  poolTrigger = event.currentTarget as HTMLElement
  initialChampion.value = champion
  poolKey.value = pool.key
  renderedPool.value = pool
  positionPool()
  await nextTick()
  if (sequence !== interactionSequence || !activePool.value) return
  positionPool()
  poolMotion.enter(
    (poolPanel.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>('.n-popover')
  )
}
async function closePool(restoreFocus = true) {
  const sequence = ++interactionSequence
  const wasOpen = !!poolKey.value
  poolKey.value = null
  const clear = () => {
    renderedPool.value = null
    initialChampion.value = null
  }
  if (!restoreFocus || !wasOpen) {
    poolMotion.cancel()
    clear()
  }
  await nextTick()
  if (sequence !== interactionSequence) return
  if (wasOpen && restoreFocus && poolTrigger?.isConnected)
    poolTrigger.focus({ preventScroll: true })
  if (wasOpen && restoreFocus)
    poolMotion.leave(
      (poolPanel.value?.$el as HTMLElement | undefined)?.closest<HTMLElement>('.n-popover'),
      clear
    )
}
function onPoolClickOutside(event: MouseEvent) {
  // The manual popover remains mounted during exit. A new pool entrance is
  // outside that surface but must win over its document click-outside handler.
  if (
    event.target instanceof Element &&
    root.value?.contains(event.target) &&
    event.target.closest('.pool-hero, .pool-more')
  )
    return
  void closePool(false)
}
watch(champions, () => {
  if (renderedPool.value && !activePool.value) void closePool(false)
  else if (activePool.value) {
    if (!activePool.value.rows.some((row) => row.champion === initialChampion.value))
      initialChampion.value = null
    void nextTick(positionPool)
  }
})
useEventListener(typeof window === 'undefined' ? undefined : window, 'resize', positionPool)
useEventListener(typeof window === 'undefined' ? undefined : window, 'resize', positionHeader)
useEventListener(root, 'scroll', positionPool, { capture: true })
useResizeObserver(
  computed(() => poolPanel.value?.$el as HTMLElement | undefined),
  positionPool
)
useResizeObserver(root, () => {
  if (!root.value?.getClientRects().length) {
    sortMenuRole.value = null
    void closePool(false)
  } else {
    positionHeader()
    positionPool()
  }
})
useEventListener(
  computed(() => root.value?.closest('.member-analysis-scroll')),
  'scroll',
  () => {
    positionHeader()
    positionPool()
  },
  { passive: true }
)
useMutationObserver(
  typeof document === 'undefined' ? undefined : document.documentElement,
  positionPool,
  { attributes: true, attributeFilter: ['data-theme', 'data-theme-id'] }
)
function disposePool() {
  interactionSequence++
  poolMotion.cancel()
  poolKey.value = null
  renderedPool.value = null
  initialChampion.value = null
  sortMenuRole.value = null
  poolTrigger = null
}
onDeactivated(disposePool)
onBeforeUnmount(disposePool)
const short = (value: string) => value.split('#')[0]
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
const championInfos = computed(() => {
  const index = new Map<string, { id: number; name: string }>()
  for (const hero of Object.values(extra.heroListMap)) {
    const info = { id: Number(hero.heroId), name: hero.name }
    index.set(normalize(hero.alias), info)
    index.set(normalize(hero.name), info)
    if (hero.title) index.set(normalize(hero.title), info)
  }
  for (const hero of Object.values(league.gameData.champions)) {
    const info = { id: hero.id, name: hero.name }
    index.set(normalize(hero.alias), info)
    index.set(normalize(hero.name), info)
  }
  return index
})
const championId = (name: string) => championInfos.value.get(normalize(name))?.id ?? -1
const championName = (name: string) => {
  if (!isIdentifiedChampion(name)) return uiText('poolUnknown')
  const info = championInfos.value.get(normalize(name))
  return info ? resources.champions.name(info.id) : name
}
</script>
<style scoped>
.champion-view {
  min-width: 0;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.pool-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 16px;
  color: var(--ma-muted);
  font-size: 12px;
}
.pool-legend {
  margin-left: auto;
}
.pool-matrix-scroll {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}
.pool-matrix-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.pool-matrix {
  width: 100%;
  min-width: 1040px;
  table-layout: fixed;
  border-collapse: collapse;
  text-align: left;
}
.pool-matrix .member-column {
  width: 100px;
}
.pool-matrix th,
.pool-matrix td {
  border-bottom: 1px solid var(--ma-grid);
  padding: 10px 8px;
}
.pool-matrix tr > :nth-child(n + 3) {
  box-shadow: inset 1px 0 0 var(--ma-grid);
}
.pool-matrix th {
  font-weight: 600;
}
.pool-matrix td {
  padding: 12px;
  vertical-align: top;
}
.pool-matrix td.pool-unplayed {
  vertical-align: middle;
}
.pool-matrix thead th {
  padding-block: 8px;
  background: var(--la-color-bg-primary);
}
.pool-matrix thead th:not(.member-heading) {
  padding-inline: 12px;
}
.pool-matrix thead {
  position: relative;
  z-index: 3;
  background: var(--la-color-bg-primary);
  box-shadow: 0 1px 0 var(--ma-grid-strong);
}
.pool-matrix .member-heading {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--la-color-bg-primary);
  overflow-wrap: anywhere;
  font-size: 14px;
}
.pool-matrix thead .member-heading {
  color: var(--ma-muted);
  font-size: 12px;
  font-weight: 400;
}
.pool-sort-trigger {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-height: 32px;
  color: inherit;
  font: inherit;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: left;
}
.pool-sort-trigger small,
.pool-sort-mark {
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}
.pool-sort-trigger:disabled {
  cursor: default;
}
.pool-sort-trigger:focus-visible,
.pool-more:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.pool-sort-menu {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pool-sort-menu button {
  font: inherit;
  color: inherit;
  background: transparent;
  text-align: left;
  border: 0;
  border-radius: 4px;
  padding: 8px 10px;
  cursor: pointer;
}
.pool-sort-menu button:hover,
.pool-sort-menu button[aria-pressed='true'] {
  background: var(--ma-hover);
}
.pool-sort-menu button:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -1px;
}
.pool-cell-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  align-items: center;
  font-size: 12px;
  line-height: 1.5;
}
.pool-cell-games {
  margin-left: auto;
  color: var(--ma-muted);
}
.pool-more {
  font: inherit;
  color: var(--ma-muted);
  background: transparent;
  border: 0;
  border-radius: 4px;
  min-width: 24px;
  min-height: 24px;
  padding: 0 2px;
  cursor: pointer;
}
.pool-more:hover {
  background: var(--ma-hover);
}
.pool-heroes {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  align-items: stretch;
  margin-top: 4px;
}
.pool-cell-empty {
  display: block;
  text-align: center;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 1.5;
}
.pool-missing {
  margin: 4px 0;
  font-size: 12px;
  color: var(--ma-muted);
}
.pool-active {
  background: var(--ma-hover);
}
.champion-empty strong {
  color: var(--la-color-text-primary);
}
.champion-empty p {
  color: var(--ma-muted);
}
</style>
