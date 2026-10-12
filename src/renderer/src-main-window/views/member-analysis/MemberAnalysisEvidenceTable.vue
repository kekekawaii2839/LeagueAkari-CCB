<template>
  <div class="ma-evidence">
    <NDataTable
      :columns="tableColumns"
      :data="games"
      :row-key="(game: MemberAnalysisGame) => game.gameId"
      :pagination="games.length > 10 ? { page, pageSize: 10 } : false"
      :scroll-x="scrollX"
      :bordered="false"
      size="small"
      class="member-analysis-metric-table"
      @update:page="changePage"
    />
    <section
      v-if="selectedGame"
      ref="detailPanel"
      class="evidence-detail"
      tabindex="-1"
      :aria-labelledby="detailTitleId"
      @keydown.esc.prevent.stop="closeDetail"
    >
      <div class="ma-section-title">
        <strong :id="detailTitleId"
          >对局 #{{ selectedGame.gameId }} · {{ selectedGame.date }}</strong
        >
        <NButton size="small" quaternary @click="closeDetail">收起对局</NButton>
      </div>
      <p class="ma-chart-note">
        {{ selectedGame.win ? '胜利' : '失败' }} ·
        {{ selectedGame.side === 'Blue' ? '蓝方' : '红方' }} ·
        {{ formatDuration(selectedGame.duration) }} · {{ selectedGame.patch }}
      </p>
      <div class="evidence-roster">
        <div v-for="player in fixedFiveRoster(selectedGame.players)" :key="player.role">
          <span class="ma-view-meta">{{ roleNames[player.role] }}</span>
          <strong>{{ player.player.split('#')[0] }}</strong>
          <span>{{ player.champion }}</span>
          <span class="ma-view-meta"
            >{{ player.kills }} / {{ player.deaths }} / {{ player.assists }}</span
          >
        </div>
      </div>
      <slot name="detail" :game="selectedGame" />
    </section>
  </div>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { NButton, NDataTable, type DataTableColumns } from 'naive-ui'
import { computed, h, nextTick, ref, useId, watch } from 'vue'
import { fixedFiveRoster } from './visualization'

const props = withDefaults(
  defineProps<{
    games: MemberAnalysisGame[]
    columns: DataTableColumns<MemberAnalysisGame>
    contextKey: string
    scrollX?: number
    navigateToMatch?: (game: MemberAnalysisGame) => void
  }>(),
  { scrollX: 720 }
)
const selectedId = ref<number | null>(null)
const page = ref(1)
const detailTitleId = useId()
const detailPanel = ref<HTMLElement | null>(null)
let trigger: HTMLElement | null = null
function changePage(value: number) {
  page.value = value
  selectedId.value = null
}
const selectedGame = computed(() => props.games.find((game) => game.gameId === selectedId.value))
const roleNames = { TOP: '上路', JUNGLE: '打野', MIDDLE: '中路', BOTTOM: '下路', UTILITY: '辅助' }
const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
async function openDetail(game: MemberAnalysisGame, event: MouseEvent) {
  trigger = event.currentTarget as HTMLElement
  selectedId.value = game.gameId
  await nextTick()
  detailPanel.value?.scrollIntoView({ block: 'nearest' })
  detailPanel.value?.focus({ preventScroll: true })
}
async function closeDetail() {
  selectedId.value = null
  await nextTick()
  if (trigger?.isConnected) {
    trigger.scrollIntoView({ block: 'nearest' })
    trigger.focus({ preventScroll: true })
  }
}
watch(
  () => props.contextKey,
  () => {
    selectedId.value = null
    page.value = 1
  }
)
watch(
  () => props.games.length,
  (count) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(count / 10)))
  }
)
watch(selectedGame, (game) => {
  if (!game) selectedId.value = null
})
const tableColumns = computed<DataTableColumns<MemberAnalysisGame>>(() => [
  { title: '对局', key: 'gameId', width: 120 },
  { title: '日期', key: 'date', width: 125 },
  {
    title: '结果 / 阵营',
    key: 'result',
    width: 130,
    render: (game) => `${game.win ? '胜利' : '失败'} · ${game.side === 'Blue' ? '蓝方' : '红方'}`
  },
  ...props.columns,
  {
    title: '',
    key: 'detail',
    width: 115,
    render: (game) =>
      h(
        NButton,
        {
          size: 'small',
          quaternary: true,
          'aria-label': `查看对局 ${game.gameId}`,
          'aria-expanded': selectedId.value === game.gameId,
          onClick: (event: MouseEvent) =>
            props.navigateToMatch
              ? props.navigateToMatch(game)
              : selectedId.value === game.gameId
                ? closeDetail()
                : openDetail(game, event)
        },
        { default: () => (selectedId.value === game.gameId ? '收起对局' : '查看对局') }
      )
  }
])
</script>
<style scoped>
.ma-evidence {
  min-width: 0;
}
.member-analysis-metric-table {
  border-top: 1px solid var(--ma-grid-strong);
  --n-td-color: transparent !important;
  --n-th-color: transparent !important;
  --n-td-color-hover: var(--ma-hover) !important;
}
.member-analysis-metric-table :deep(.n-data-table-th),
.member-analysis-metric-table :deep(.n-data-table-td) {
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.member-analysis-metric-table :deep(.n-data-table-th) {
  color: var(--ma-muted);
  font-weight: 500;
}
.evidence-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
  padding: 12px 0;
  border-top: 1px solid var(--ma-grid-strong);
  scroll-margin: 12px;
}
.evidence-detail:focus-visible {
  outline: 2px solid var(--la-color-text-primary);
  outline-offset: 3px;
}
.evidence-roster {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.evidence-roster > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-wrap: anywhere;
}
.evidence-roster strong {
  font-size: 14px;
  font-weight: 500;
}
</style>

<style scoped>
.evidence-detail > .ma-section-title {
  margin: 0;
  padding: 0;
  border: 0;
}
.evidence-detail > .ma-chart-note {
  margin: 0;
}
</style>
