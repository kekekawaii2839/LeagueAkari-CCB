<template>
  <section :style="legendStyle" class="heatmap">
    <div class="heatmap-legend">
      <span>{{ t('championPool.heatmap.delta') }}</span>
      <span>−10</span><span class="color-ramp" aria-hidden="true">0</span><span>+10</span>
    </div>

    <div
      ref="scroll"
      class="heatmap-scroll"
      @scroll="closeDetails(false)"
      tabindex="0"
      :aria-label="t('championPool.tableLabel')"
    >
      <table>
        <caption class="sr-only">
          {{
            t('championPool.heatmap.caption')
          }}
        </caption>
        <thead>
          <tr>
            <th class="own-champion" scope="col" :title="t('championPool.top3Help')">Top-3 z</th>
            <th
              v-for="target in targets"
              :key="target.championId"
              scope="col"
              :title="columnDescription(target)"
              :aria-label="columnDescription(target)"
            >
              <span class="target-identity"
                ><ChampionIcon
                  :champion-id="target.championId"
                  class="target-icon"
                  aria-hidden="true"
                /><span class="top3-value">{{ score(target.top3?.score) }}</span
                ><span class="sr-only">{{ targetName(target) }}</span></span
              >
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(champion, row) in champions" :key="champion.id">
            <th
              class="own-champion"
              scope="row"
              :title="championName(champion.id)"
              :aria-label="championName(champion.id)"
            >
              <ChampionIcon
                :champion-id="champion.id"
                class="target-icon"
                aria-hidden="true"
              /><span class="sr-only">{{ championName(champion.id) }}</span>
            </th>
            <td v-for="(target, column) in targets" :key="target.championId">
              <button
                type="button"
                class="heat-cell"
                :class="`cell-${cell(target, champion.id).state}`"
                :style="cellStyle(cell(target, champion.id))"
                :aria-label="
                  t('championPool.cellDetails.open', {
                    champion: championName(champion.id),
                    target: targetName(target)
                  })
                "
                aria-haspopup="dialog"
                :aria-expanded="
                  selection?.targetId === target.championId && selection?.championId === champion.id
                "
                :aria-controls="
                  selection?.targetId === target.championId && selection?.championId === champion.id
                    ? 'pool-cell-details'
                    : undefined
                "
                :aria-pressed="
                  selection?.targetId === target.championId && selection?.championId === champion.id
                "
                :tabindex="focus.row === row && focus.column === column ? 0 : -1"
                :data-row="row"
                :data-column="column"
                @focus="focus = { row, column }"
                @click="openDetails($event, target, champion)"
                @keydown="move($event, row, column)"
              >
                {{ display(cell(target, champion.id)) }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <NPopover
      ref="popover"
      :show="!!selectedDetails"
      :flip="false"
      trigger="manual"
      placement="bottom-start"
      :x="popoverPosition.x"
      :y="popoverPosition.y"
      :show-arrow="false"
      :animated="false"
      display-directive="if"
      :style="{
        width: popoverWidth + 'px',
        margin: '0',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: popoverMaxHeight + 'px',
        overflow: 'auto',
        padding: '12px',
        boxSizing: 'border-box',
        background: 'var(--la-color-bg-primary)'
      }"
      @clickoutside="onClickOutside"
    >
      <div
        v-if="selectedDetails"
        id="pool-cell-details"
        ref="details"
        role="dialog"
        tabindex="-1"
        :aria-label="
          t('championPool.cellDetails.open', {
            champion: championName(selectedDetails.champion.id),
            target: targetName(selectedDetails.target)
          })
        "
        @keydown.esc.stop.prevent="closeDetails()"
        @focusout="onDetailsFocusOut"
      >
        <CoverageCellDetails
          :champion="selectedDetails.champion"
          :target="selectedDetails.target"
          :cell="selectedDetails.cell"
          :own-role="ownRole"
          :patch="patch"
          :fetched-at="fetchedAt"
          @close="closeDetails()"
        />
      </div>
    </NPopover>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onDeactivated } from 'vue'
import { useEventListener } from '@vueuse/core'
import { NPopover, useThemeVars } from 'naive-ui'
import CoverageCellDetails from './CoverageCellDetails.vue'
import type { DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import { useTranslation } from 'i18next-vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import type { PoolCell, PoolChampion, PoolTarget } from '@shared/shards/champion-pool/coverage'
import { heatmapColor } from './heatmap-palette'
import { positionCellPopover } from './cell-popover-position'
const props = defineProps<{
  targets: PoolTarget[]
  champions: PoolChampion[]
  resolveName: (id: number, fallback: string) => string
  ownRole: DraftRole
  patch: string
  fetchedAt: string
}>()
const { t } = useTranslation(),
  theme = useThemeVars()
const scroll = ref<HTMLElement | null>(null),
  focus = ref({ row: 0, column: 0 }),
  selection = ref<{ targetId: number; championId: number } | null>(null)
const palette = computed(() => ({
  positive: theme.value.successColor,
  negative: theme.value.errorColor,
  neutral: theme.value.bodyColor
}))
const legendStyle = computed(() => ({
  '--heat-negative': heatmapColor(-10, palette.value).backgroundColor,
  '--heat-zero': heatmapColor(0, palette.value).backgroundColor,
  '--heat-positive': heatmapColor(10, palette.value).backgroundColor
}))
const targetName = (target: PoolTarget) => props.resolveName(target.championId, target.name)
const championName = (id: number) =>
  props.resolveName(id, props.champions.find((c) => c.id === id)?.name || String(id))
const cell = (target: PoolTarget, id: number): PoolCell =>
  target.cells.find((c) => c.championId === id) || {
    championId: id,
    deltaPp: null,
    games: null,
    state: 'missing'
  }
const display = (value: PoolCell) =>
  value.state === 'available' && value.deltaPp !== null
    ? `${value.deltaPp > 0 ? '+' : ''}${value.deltaPp.toFixed(2)}`
    : value.state === 'unavailable'
      ? '×'
      : '—'
const cellStyle = (value: PoolCell) => {
  if (value.state !== 'available' || value.deltaPp === null) return undefined
  const color = heatmapColor(value.deltaPp, palette.value)
  return { backgroundColor: color.backgroundColor, color: color.color }
}
const score = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}`
const columnDescription = (target: PoolTarget) =>
  t(target.top3?.reason ? 'championPool.top3ColumnWithReason' : 'championPool.top3Column', {
    target: targetName(target),
    score: score(target.top3?.score),
    count: target.top3?.count ?? 0,
    reference: target.top3?.referenceCount ?? 0,
    total: target.top3?.referenceTotal ?? 0,
    reason: target.top3?.reason ? t('championPool.top3Reasons.' + target.top3.reason) : ''
  })
const details = ref<HTMLElement | null>(null)
const popover = ref<InstanceType<typeof NPopover> | null>(null)
const popoverWidth = ref(360)
const popoverMaxHeight = ref(480)
function positionDetails() {
  if (!selectedButton || typeof window === 'undefined') return
  const header = scroll.value?.closest('.pool-page')?.querySelector('.pool-header')
  const position = positionCellPopover(
    {
      left: 12,
      right: window.innerWidth - 12,
      top: Math.max(12, (header?.getBoundingClientRect().bottom ?? 0) + 8),
      bottom: window.innerHeight - 12
    },
    selectedButton.getBoundingClientRect(),
    details.value?.closest<HTMLElement>('.n-popover')?.scrollHeight
  )
  if (!position) {
    closeDetails(false)
    return
  }
  popoverWidth.value = position.width
  popoverMaxHeight.value = position.maxHeight
  const view = document.getElementById('v-binder-view-measurer')?.getBoundingClientRect()
  const titlebar =
    Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--la-titlebar-height')
    ) || 0
  popoverPosition.value = {
    x: position.x - (view?.left ?? 0),
    y: position.y - (view?.top ?? titlebar)
  }
}
const popoverPosition = ref({ x: 0, y: 0 })
let selectedButton: HTMLButtonElement | null = null
const selectedDetails = computed(() => {
  const target = props.targets.find((item) => item.championId === selection.value?.targetId)
  const champion = props.champions.find((item) => item.id === selection.value?.championId)
  return target && champion
    ? {
        target: { ...target, name: targetName(target) },
        champion: { ...champion, name: championName(champion.id) },
        cell: cell(target, champion.id)
      }
    : null
})
async function openDetails(event: MouseEvent, target: PoolTarget, champion: PoolChampion) {
  if (
    selection.value?.targetId === target.championId &&
    selection.value?.championId === champion.id
  ) {
    closeDetails()
    return
  }
  selectedButton = event.currentTarget as HTMLButtonElement
  const rect = selectedButton.getBoundingClientRect()
  popoverPosition.value = { x: rect.left, y: rect.bottom }
  positionDetails()
  selection.value = { targetId: target.championId, championId: champion.id }
  await nextTick()
  positionDetails()
  await nextTick()
  popover.value?.syncPosition()
  details.value?.focus({ preventScroll: true })
}
function closeDetails(restoreFocus = true) {
  selection.value = null
  if (restoreFocus && selectedButton?.isConnected) selectedButton.focus({ preventScroll: true })
}
function onClickOutside(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('.heat-cell')) return
  closeDetails(false)
}
function onDetailsFocusOut(event: FocusEvent) {
  if (event.relatedTarget === selectedButton) return
  if (!details.value?.contains(event.relatedTarget as Node | null)) closeDetails(false)
}
useEventListener('resize', () => closeDetails(false))
useEventListener(
  'scroll',
  (event) => {
    if (!details.value?.closest('.n-popover')?.contains(event.target as Node)) closeDetails(false)
  },
  true
)
onDeactivated(() => closeDetails(false))
watch(
  () => [props.targets, props.champions],
  () => {
    closeDetails(false)
    focus.value = { row: 0, column: 0 }
  }
)
function move(event: KeyboardEvent, row: number, column: number) {
  const offsets: Record<string, [number, number]> = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0]
  }
  if (!offsets[event.key]) return
  event.preventDefault()
  const [dr, dc] = offsets[event.key],
    r = Math.max(0, Math.min(props.champions.length - 1, row + dr)),
    c = Math.max(0, Math.min(props.targets.length - 1, column + dc))
  const button = scroll.value?.querySelector<HTMLButtonElement>(
    `[data-row="${r}"][data-column="${c}"]`
  )
  button?.focus()
  button?.scrollIntoView({ block: 'nearest', inline: 'center' })
}
</script>

<style scoped>
.heatmap-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  margin: 0 0 12px;
}
.color-ramp {
  display: inline-block;
  width: 144px;
  height: 18px;
  line-height: 16px;
  text-align: center;
  background: linear-gradient(
    to right,
    var(--heat-negative),
    var(--heat-zero),
    var(--heat-positive)
  );
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.3);
}
.heatmap-scroll {
  position: relative;
  max-width: 100%;
  overflow: auto;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.25);
  border-radius: 8px;
}
.heatmap-scroll:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
table {
  border-spacing: 2px;
  width: max-content;
}
th {
  font-weight: 500;
  font-size: 14px;
  vertical-align: middle;
  text-align: center;
  padding: 4px 0;
}
td {
  padding: 0;
  min-width: 56px;
  width: 56px;
}
.own-champion {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--la-card-surface-95);
  min-width: 66px;
  max-width: 66px;
  text-align: center;
  padding: 4px;
}
.target-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 56px;
  overflow-wrap: anywhere;
}
.top3-value {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.target-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
}
.heat-cell {
  display: block;
  width: 100%;
  min-height: 38px;
  padding: 6px 2px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.2);
  border-radius: 4px;
  font: inherit;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  background: var(--heat-zero);
  color: var(--la-color-text-primary);
}
.heat-cell:hover {
  outline: 1px solid currentColor;
  outline-offset: -2px;
}
.heat-cell:focus-visible,
.heat-cell[aria-pressed='true'] {
  outline: 2px solid currentColor;
  outline-offset: -3px;
}
.cell-missing {
  background: repeating-linear-gradient(
    135deg,
    transparent 0 5px,
    rgb(var(--la-card-border-rgb) / 0.1) 5px 6px
  );
}
.cell-unavailable {
  background: var(--la-card-muted-surface);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
</style>
