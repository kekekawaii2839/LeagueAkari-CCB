<template>
  <div ref="root">
    <NDataTable
      ref="table"
      :virtual-scroll="virtualRows"
      :row-props="rowAttributes"
      :flex-height="true"
      :theme-overrides="{ emptyPadding: '12px 0' }"
      :style="{ height: `${viewportHeight}px` }"
      :columns="displayColumns"
      :data="rows"
      :row-key="rowKey"
      :row-class-name="rowClassName"
      :pagination="rows.length > 25 ? { page, pageSize: 25 } : false"
      :scroll-x="displayScrollX"
      :bordered="false"
      size="small"
      class="scatter-exact-table"
      @update:page="page = $event"
    />
  </div>
</template>
<script setup lang="ts">
import { NButton, NDataTable, type DataTableColumns, type DataTableInst } from 'naive-ui'
import { computed, h, nextTick, ref, watch, type HTMLAttributes } from 'vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MemberProfileAvatar from './MemberProfileAvatar.vue'
import { revealScatterExactRow } from './scatter-exact-reveal'
import { uiText } from './ui-text'

const props = withDefaults(
  defineProps<{
    columns: DataTableColumns<Record<string, unknown>>
    rows: Record<string, unknown>[]
    rowKey: (row: Record<string, unknown>) => string
    rowClassName: (row: Record<string, unknown>) => string
    viewportHeight: number
    contextKey: string
    selectedRowKey?: string | null
    scrollX: number
    active?: boolean
  }>(),
  { active: true }
)
const store = useMemberAnalysisStore()
const league = useLeagueClientStore()
const championKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
const championIds = computed(() => {
  const ids = new Map<string, number>()
  for (const champion of Object.values(league.gameData.champions)) {
    for (const name of [champion.alias, champion.name, String(champion.id)])
      ids.set(championKey(name), champion.id)
  }
  return ids
})
const plainValue = (value: unknown) =>
  value === null || value === undefined || value === '' ? '—' : String(value)
const memberCell = (row: Record<string, unknown>) => {
  const player = plainValue(row.player)
  const separator = player.indexOf('#')
  const name = separator < 0 ? player : player.slice(0, separator)
  const tag = separator < 0 ? '' : player.slice(separator)
  return h('span', { class: 'exact-identity', title: player }, [
    h(MemberProfileAvatar, { iconId: store.memberProfileIcons[player] ?? null, size: 24 }),
    h('span', { class: 'exact-player-text' }, [
      h('span', { class: 'exact-player-name' }, name),
      tag ? h('span', { class: 'exact-player-tag' }, tag) : null
    ])
  ])
}
const championCell = (row: Record<string, unknown>) => {
  const value = plainValue(row.champion)
  const id = championIds.value.get(championKey(value))
  const name = id === undefined ? value : league.gameData.championName(id)
  return h('span', { class: 'exact-champion', title: name }, [
    id === undefined ? null : h(ChampionIcon, { championId: id, 'aria-hidden': 'true' }),
    h('span', { class: 'exact-champion-name' }, name)
  ])
}
const canonicalRoles = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
const roleCell = (row: Record<string, unknown>) => {
  const role = row.roleKey ?? row.role
  // PositionIcon defaults unknown values to ALL. Never invent a position for a
  // missing/mixed summary: only a genuine canonical row role gets an icon.
  const position = typeof role === 'string' && canonicalRoles.has(role) ? role : null
  return h('span', { class: 'exact-role' }, [
    position
      ? h(PositionIcon, { position, class: 'exact-role-icon', 'aria-hidden': 'true' })
      : null,
    h('span', plainValue(row.role))
  ])
}
const matchId = (row: Record<string, unknown>) =>
  typeof row.gameId === 'number' && Number.isSafeInteger(row.gameId) && row.gameId > 0
    ? row.gameId
    : null
const hasMatchActions = computed(
  () =>
    props.columns.some((column) => 'key' in column && column.key === 'gameId') &&
    props.rows.some((row) => matchId(row) !== null)
)
const actionWidth = 108
const displayScrollX = computed(() => props.scrollX + (hasMatchActions.value ? actionWidth : 0))
const matchAction = (row: Record<string, unknown>) => {
  const gameId = matchId(row)
  if (gameId === null) return null
  return h(
    NButton,
    {
      size: 'tiny',
      quaternary: true,
      class: 'exact-match-action',
      'aria-label': `${uiText('synergyOpenMatch')} ${gameId}`,
      onKeydown: (event: KeyboardEvent) => event.stopPropagation(),
      onClick: (event: MouseEvent) => {
        event.stopPropagation()
        store.navigateToMatch(gameId, uiText('allValues'))
      }
    },
    { default: () => uiText('synergyOpenMatch') }
  )
}
// Retain the upstream metric renderers, widths and missing-value semantics.
// Only identity/context cells adopt the joint-game row presentation.
const displayColumns = computed<DataTableColumns<Record<string, unknown>>>(() => [
  ...props.columns.map((column) => {
    if (!('key' in column)) return column
    const key = column.key
    if (key === 'player') return { ...column, render: memberCell }
    if (key === 'champion') return { ...column, render: championCell }
    if (key === 'role') return { ...column, render: roleCell }
    if (key === 'gameId' || key === 'date')
      return {
        ...column,
        render: (row: Record<string, unknown>) =>
          h('span', { class: 'exact-context', title: plainValue(row[key]) }, plainValue(row[key]))
      }
    if (key === 'result')
      return {
        ...column,
        render: (row: Record<string, unknown>) =>
          h(
            'span',
            {
              class: [
                'exact-result',
                { 'is-win': row.result === '胜', 'is-loss': row.result === '负' }
              ]
            },
            plainValue(row.result)
          )
      }
    return column
  }),
  ...(hasMatchActions.value
    ? [
        {
          key: 'match-action',
          title: uiText('synergyOpenMatch'),
          width: actionWidth,
          render: matchAction
        }
      ]
    : [])
])
const page = ref(1)
const root = ref<HTMLElement | null>(null)
const table = ref<DataTableInst | null>(null)
const fullPageFallback = ref(false)
const virtualRows = computed(() => props.rows.length > 25 && !fullPageFallback.value)
const rowAttributes = (
  row: Record<string, unknown>
): HTMLAttributes & { 'data-scatter-row-key': string } => ({
  'data-scatter-row-key': props.rowKey(row)
})
watch(
  () => props.contextKey,
  () => {
    page.value = 1
    fullPageFallback.value = false
  }
)
watch(
  () => props.rows,
  () => {
    fullPageFallback.value = false
  }
)
watch(
  () => [props.selectedRowKey, props.rows, props.active] as const,
  async ([key, , active], _previous, onCleanup) => {
    let live = true
    let frame = 0
    let finishFrame: (() => void) | undefined
    onCleanup(() => {
      live = false
      if (frame) cancelAnimationFrame(frame)
      finishFrame?.()
    })
    if (!active || !key) return
    const index = props.rows.findIndex((row) => props.rowKey(row) === key)
    if (index < 0) return
    page.value = Math.floor(index / 25) + 1
    const current = () => live && props.active && props.selectedRowKey === key
    const settled = async () => {
      await nextTick()
      if (!current() || typeof requestAnimationFrame === 'undefined') return
      await new Promise<void>((resolve) => {
        finishFrame = resolve
        frame = requestAnimationFrame(() => {
          frame = 0
          finishFrame = undefined
          resolve()
        })
      })
    }
    await nextTick()
    if (!current() || !root.value?.getClientRects().length) return
    const mountedRows = () => [
      ...(root.value?.querySelectorAll<HTMLElement>('[data-scatter-row-key]') ?? [])
    ]
    const findTarget = () =>
      mountedRows().find((row) => row.getAttribute('data-scatter-row-key') === key) ?? null
    if (virtualRows.value) {
      await revealScatterExactRow({
        indexOnPage: index % 25,
        heights: () => mountedRows().map((row) => row.getBoundingClientRect().height),
        scrollTo: (top) => table.value?.scrollTo({ top, behavior: 'auto' }),
        findTarget,
        revealAll: () => {
          fullPageFallback.value = true
        },
        settled,
        current
      })
    } else findTarget()?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
  { flush: 'post', immediate: true }
)
watch(
  () => props.rows.length,
  (count) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(count / 25)))
  }
)
</script>
<style scoped>
.scatter-exact-table {
  min-height: 0;
  border-top: 1px solid var(--ma-grid-strong);
  --n-td-color: transparent !important;
  --n-th-color: transparent !important;
  --n-td-color-hover: var(--ma-hover) !important;
}
.scatter-exact-table :deep(.n-data-table-th),
.scatter-exact-table :deep(.n-data-table-td) {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.scatter-exact-table :deep(.n-data-table-th) {
  color: var(--ma-muted);
  font-weight: 500;
  white-space: nowrap;
  padding: 6px 12px;
  line-height: 20px;
}
.scatter-exact-table :deep(.n-data-table-td) {
  padding: 6px 12px;
  line-height: 24px;
}
.scatter-exact-table :deep(.exact-identity),
.scatter-exact-table :deep(.exact-champion) {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 24px;
}
.scatter-exact-table :deep(.exact-role) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  white-space: nowrap;
}
.scatter-exact-table :deep(.exact-role-icon) {
  flex: none;
  width: 14px;
  height: 14px;
  font-size: 14px;
}
.scatter-exact-table :deep(.exact-player-text) {
  display: inline-flex;
  flex: 1 1 auto;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
  font-weight: 600;
}
.scatter-exact-table :deep(.exact-player-name),
.scatter-exact-table :deep(.exact-player-tag),
.scatter-exact-table :deep(.exact-champion-name),
.scatter-exact-table :deep(.exact-context) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.scatter-exact-table :deep(.exact-player-tag) {
  flex: 0 1 auto;
  color: var(--ma-muted);
  font-size: 12px;
}
.scatter-exact-table :deep(.exact-champion .champion-icon-container) {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 6px;
}
.scatter-exact-table :deep(.exact-context) {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.scatter-exact-table :deep(.exact-result) {
  font-size: 14px;
  font-weight: 500;
  color: var(--ma-muted);
}
.scatter-exact-table :deep(.exact-match-action) {
  height: 24px;
  min-height: 24px;
  font-size: 12px;
}
.scatter-exact-table :deep(.exact-result.is-win) {
  color: var(--ma-positive);
}
.scatter-exact-table :deep(.exact-result.is-loss) {
  color: var(--ma-negative);
}
</style>
