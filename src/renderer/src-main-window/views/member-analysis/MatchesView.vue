<template>
  <div class="ma-panel ma-workspace match-list">
    <header class="ma-view-heading">
      <div>
        <h2>逐场复盘</h2>
      </div>
      <div class="match-list-tools">
        <span>{{ games.length }} 场 · 最近对局在前</span>
        <NButton size="small" secondary @click="openMatches">打开对局查询</NButton>
      </div>
    </header>
    <article
      v-for="game in games"
      :key="game.gameId"
      class="match-card"
      :class="game.win ? 'win' : 'loss'"
    >
      <div class="result">
        <strong>{{ game.win ? '胜利' : '失败' }}</strong
        ><span :class="game.side === 'Blue' ? 'ma-blue' : 'ma-red'">{{
          game.side === 'Red' ? '红方' : '蓝方'
        }}</span>
      </div>
      <div class="meta">
        <strong>{{ formatTime(game.timestamp, game.date) }}</strong
        ><span>#{{ game.gameId }} · {{ formatDuration(game.duration) }} · {{ game.patch }}</span>
      </div>
      <div class="roster">
        <span v-for="player in fixedPlayers(game.players)" :key="player.role"
          ><span class="roster-portrait"
            ><ChampionIcon :champion-id="championId(player.champion)" /></span
          ><span class="roster-copy"
            ><b>{{ roleNames[player.role] }}</b
            ><em>{{ player.player.split('#')[0] }}</em
            ><small>{{ championName(player.champion) }}</small></span
          ></span
        >
      </div>
      <div class="actions">
        <NButton
          size="small"
          quaternary
          :aria-expanded="expanded.has(game.gameId)"
          :aria-controls="`match-detail-${game.gameId}`"
          :aria-label="`${expanded.has(game.gameId) ? '收起' : '展开'} ${formatTime(game.timestamp, game.date)} 的对局详情`"
          @click="toggle(game.gameId)"
          >{{ expanded.has(game.gameId) ? '收起' : '展开' }}</NButton
        >
      </div>
      <div v-if="expanded.has(game.gameId)" class="details" :id="`match-detail-${game.gameId}`">
        <span
          ><b>20 分钟经济差（金币）</b
          ><em :class="toneClass(game.gold20Diff)">{{ formatSigned(game.gold20Diff) }}</em></span
        ><span
          ><b>20 分钟防御塔差（座）</b><em>{{ formatSigned(game.tower20Diff) }}</em></span
        ><span
          ><b>15 分钟资源团净击杀（次）</b
          ><em>{{ formatSigned(game.objectiveFight15Diff) }}</em></span
        ><span
          ><b>击杀兑现</b><em>{{ conversion(game) }}</em></span
        ><span
          ><b>死亡代价</b><em>{{ formatMetric(game.eventDecision.deathCostPoints) }}</em></span
        >
      </div>
    </article>
    <div v-if="!games.length" class="ma-empty">当前筛选条件下没有固定五人对局。</div>
  </div>
</template>
<script setup lang="ts">
import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import { NButton } from 'naive-ui'
import { reactive, watch } from 'vue'
import { useRouter } from 'vue-router'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric } from './metric-defs'
import { finiteOrNull, fixedFiveRoster, formatSigned } from './visualization'
const { games } = useMemberAnalysisData()
const lcs = useLeagueClientStore()
const router = useRouter()
const expanded = reactive(new Set<number>())
watch(games, (value) => {
  const ids = new Set(value.map((game) => game.gameId))
  for (const id of expanded) if (!ids.has(id)) expanded.delete(id)
})
const toggle = (id: number) => (expanded.has(id) ? expanded.delete(id) : expanded.add(id))
const openMatches = () => router.push({ name: 'player-tabs' })
const fixedPlayers = (players: MemberAnalysisPlayerGame[]) => fixedFiveRoster(players)
const normalizeChampion = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
const championInfo = (value: string) => {
  const normalized = normalizeChampion(value)
  return Object.values(lcs.gameData.champions).find(
    (champion) =>
      normalizeChampion(champion.alias) === normalized ||
      normalizeChampion(champion.name) === normalized
  )
}
const championId = (value: string) => championInfo(value)?.id ?? -1
const championName = (value: string) => championInfo(value)?.name ?? value
const roleNames = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
} as const
const formatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})
const formatTime = (timestamp: number, fallback: string) =>
  timestamp > 0 ? formatter.format(new Date(timestamp)).replaceAll('/', '-') : fallback
const formatDuration = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const toneClass = (value: unknown) => {
  const number = finiteOrNull(value)
  return number === null || number === 0 ? '' : number > 0 ? 'ma-positive' : 'ma-negative'
}
const conversion = (game: MemberAnalysisGame) =>
  game.eventDecision.killEpisodes
    ? formatMetric(
        game.eventDecision.convertedKillEpisodes / game.eventDecision.killEpisodes,
        'pct'
      )
    : '—'
</script>
<style scoped>
.match-list-tools {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}
.match-card {
  display: grid;
  grid-template-columns: 72px 165px minmax(400px, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 8px 13px 12px;
  border: 0;
  border-bottom: 1px solid var(--ma-grid);
  border-left: 2px solid var(--ma-negative);
  background: transparent;
}
.match-card:hover {
  background: var(--ma-hover);
}
.match-card.win {
  border-left-color: var(--ma-positive);
}
.match-list {
  gap: 0;
}
.match-list > .ma-view-heading {
  margin-bottom: 14px;
}
.result,
.meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.result span,
.meta span {
  color: var(--ma-muted);
  font-size: 14px;
}
.roster {
  display: grid;
  grid-template-columns: repeat(5, minmax(75px, 1fr));
  gap: 5px;
}
.roster span {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}
.roster-copy {
  display: flex !important;
  min-width: 0;
  align-items: stretch !important;
  flex: 1;
  flex-direction: column;
  gap: 0 !important;
}
.roster-portrait {
  display: block !important;
  width: 28px;
  height: 28px;
  flex: 0 0 28px;
  overflow: hidden;
  border-radius: 5px;
}
.roster-portrait :deep(.champion-icon-container) {
  width: 28px !important;
  height: 28px !important;
}
.roster b {
  color: var(--ma-muted);
  font-size: 14px;
}
.roster em,
.roster small {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-style: normal;
}
.roster small {
  color: var(--ma-muted);
}
.actions {
  flex-wrap: wrap;
  display: flex;
  gap: 3px;
}
.details {
  display: grid;
  grid-column: 1/-1;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 7px;
  padding-top: 10px;
  border-top: 1px solid var(--ma-grid);
}
.details span {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 7px 0;
  border-bottom: 1px solid var(--ma-grid);
  font-size: 14px;
}
.details em {
  font-style: normal;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 1100px) {
  .match-card {
    grid-template-columns: 70px 1fr auto;
  }
  .roster {
    grid-column: 1/-1;
  }
  .details {
    grid-template-columns: repeat(3, 1fr);
  }
}
@media (max-width: 760px) {
  .match-card {
    grid-template-columns: 60px 1fr;
  }
  .actions {
    flex-wrap: wrap;
    grid-column: 1/-1;
  }
  .roster {
    grid-template-columns: repeat(2, 1fr);
  }
  .details {
    grid-template-columns: 1fr;
  }
}
.match-card {
  margin-bottom: 8px;
  padding: 16px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--la-color-bg-primary) 45%, transparent);
}
.roster small,
.meta span {
  font-size: 12px;
}
.result > b {
  font-size: 17px;
}
.details {
  padding: 16px 0 0;
  gap: 16px;
}
.details b {
  color: var(--ma-muted);
  font-size: 12px;
  font-weight: 400;
}
.details em {
  font-size: 20px;
  font-weight: 600;
}
</style>
