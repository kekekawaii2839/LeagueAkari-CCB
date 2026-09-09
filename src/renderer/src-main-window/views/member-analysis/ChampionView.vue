<template>
  <div class="ma-panel champion-view">
    <header class="ma-view-heading">
      <div><h2>英雄池</h2></div>
      <span>{{ scopeCount }} 个成员分路 · {{ champions.length }} 个英雄选择</span>
    </header>

    <section
      v-if="selected"
      ref="heroDetail"
      tabindex="-1"
      class="hero-detail"
      aria-label="当前英雄指标"
    >
      <header>
        <ChampionIcon class="detail-portrait" :champion-id="championId(selected.champion)" />
        <div>
          <h3>{{ championDisplayName(selected.champion) }}</h3>
          <p>
            {{ short(selected.player) }} · {{ roleName[selected.role] }} · {{ selected.games }} 场
          </p>
        </div>
      </header>
      <NButton class="close-detail" size="small" quaternary @click="clearHero">
        {{ uiText('clearSelection') }}
      </NButton>
      <div class="detail-result">
        <span class="result-label">胜率</span>
        <strong>{{ formatMetric(selected.winRate, 'pct') }}</strong>
        <span>{{ selected.wins }}胜 {{ selected.games - selected.wins }}负</span>
        <small>95% 区间 {{ intervalText(selected.wins, selected.games) }}</small>
      </div>
      <div class="detail-sides">
        <span class="ma-blue"
          >蓝 {{ sideRate(selected.blueWins, selected.blueGames) }} ·
          {{ selected.blueGames }} 场</span
        >
        <span class="ma-red"
          >红 {{ sideRate(selected.redWins, selected.redGames) }} · {{ selected.redGames }} 场</span
        >
      </div>
      <dl class="detail-metrics">
        <div v-for="metric in detailMetrics" :key="metric.key">
          <dt>
            <MetricHelp
              v-if="metric.description"
              :label="metric.label"
              :definition="metric.description"
            /><template v-else>{{ metric.label }}</template>
          </dt>
          <dd :class="metric.signed ? toneClass(selected.performance[metric.key]) : ''">
            {{
              metric.signed
                ? formatSigned(selected.performance[metric.key], 1)
                : formatMetric(selected.performance[metric.key], metric.fmt)
            }}
          </dd>
        </div>
      </dl>
    </section>
    <div class="role-grid">
      <section v-for="section in roleSections" :key="section.role" class="role-lane">
        <header class="role-heading">
          <span class="role-mark" aria-hidden="true">{{ roleAbbr[section.role] }}</span>
          <div>
            <h3>{{ roleName[section.role] }}</h3>
            <p>{{ section.scopes.length }} 名成员 · {{ section.games }} 场</p>
          </div>
        </header>

        <article v-for="scope in section.scopes" :key="scope.key" class="pool-member">
          <header>
            <div>
              <strong>{{ short(scope.player) }}</strong
              ><small
                >{{ scope.games }} 场 · {{ scope.rows.length }} 英雄 · 前三
                {{ formatMetric(scope.topThreeShare, 'pct') }}</small
              >
            </div>
          </header>
          <div class="pool-body">
            <svg
              class="pool-donut"
              viewBox="0 0 72 72"
              role="group"
              :aria-label="`${short(scope.player)}，${roleName[scope.role]}，英雄选用构成，共 ${scope.games} 场`"
            >
              <circle class="track" cx="36" cy="36" r="27" />
              <circle
                v-for="(segment, index) in segments(scope)"
                :key="segment.key"
                class="segment"
                :class="{
                  'segment-selected':
                    selectedKey === segment.key ||
                    (segment.key === 'other' &&
                      scope.rows.slice(visibleHeroes).some((row) => key(row) === selectedKey))
                }"
                :aria-pressed="
                  segment.key === 'other'
                    ? expandedScopes.has(scope.key)
                    : selectedKey === segment.key
                "
                cx="36"
                cy="36"
                r="27"
                :style="segmentStyle(scope, index)"
                role="button"
                tabindex="0"
                :aria-label="
                  segment.key === 'other'
                    ? `其他英雄，${formatMetric(segment.share, 'pct')}`
                    : `${championDisplayName(scope.rows[index].champion)}，${scope.rows[index].games} 场，${formatMetric(segment.share, 'pct')}`
                "
                @click="activateSegment(scope, index, $event)"
                @keydown.enter.prevent="activateSegment(scope, index, $event)"
                @keydown.space.prevent="activateSegment(scope, index, $event)"
              />
              <text x="36" y="41" text-anchor="middle">
                {{ scope.games }}
                <tspan class="unit">场</tspan>
              </text>
            </svg>
            <div class="pool-legend">
              <div class="hero-options" :class="{ expanded: expandedScopes.has(scope.key) }">
                <button
                  v-for="(row, index) in legendRows(scope)"
                  :key="key(row)"
                  type="button"
                  :class="{ selected: selectedKey === key(row) }"
                  :aria-pressed="selectedKey === key(row)"
                  @click="selectHero(key(row), $event)"
                >
                  <i class="legend-swatch" :style="{ background: palette[Math.min(index, 3)] }" />
                  <ChampionIcon class="legend-portrait" :champion-id="championId(row.champion)" />
                  <span>{{ championDisplayName(row.champion) }}</span>
                  <b :aria-label="`选用率 ${formatMetric(row.pickRate, 'pct')}`">{{
                    formatMetric(row.pickRate, 'pct')
                  }}</b>
                  <small class="hero-win-rate">胜率 {{ formatMetric(row.winRate, 'pct') }}</small>
                </button>
              </div>
              <button
                v-if="scope.rows.length > visibleHeroes"
                type="button"
                class="more"
                :aria-expanded="expandedScopes.has(scope.key)"
                @click="toggleScope(scope.key)"
              >
                {{
                  expandedScopes.has(scope.key)
                    ? '收起'
                    : `其他 ${scope.rows.length - visibleHeroes} 个`
                }}
              </button>
            </div>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NButton } from 'naive-ui'
import MetricHelp from './MetricHelp.vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { uiText } from './ui-text'
import { memberOrder } from './visualization'
import { computed, nextTick, ref, watch } from 'vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric, roleMetricMeta } from './metric-defs'
import { finiteOrNull, formatSigned, wilsonInterval } from './visualization'

const { champions } = useMemberAnalysisData()
const store = useMemberAnalysisStore()
const lcs = useLeagueClientStore()
const roleOrder = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
type Role = (typeof roleOrder)[number]
type ChampionRow = (typeof champions.value)[number]
type PoolScope = {
  key: string
  role: Role
  player: string
  games: number
  rows: ChampionRow[]
  topThreeShare: number
}

const visibleHeroes = 3
const palette = [
  'var(--ma-series-1)',
  'var(--ma-series-2)',
  'var(--ma-series-3)',
  'var(--ma-series-5)'
]
const segments = (scope: PoolScope) => {
  const result = scope.rows
    .slice(0, visibleHeroes)
    .map((row) => ({ key: key(row), share: row.pickRate }))
  const rest = scope.rows.slice(visibleHeroes)
  if (rest.length)
    result.push({ key: 'other', share: rest.reduce((sum, row) => sum + row.pickRate, 0) })
  return result
}
const activateSegment = (scope: PoolScope, index: number, event: Event) => {
  if (index < visibleHeroes) void selectHero(key(scope.rows[index]), event)
  else toggleScope(scope.key)
}
const segmentStyle = (scope: PoolScope, index: number) => {
  const parts = segments(scope)
  const circumference = Math.PI * 54
  const length = parts[index].share * circumference
  const gap = parts.length > 1 ? Math.min(1.5, length * 0.2) : 0
  return {
    stroke: palette[index],
    strokeDasharray: `${Math.max(0, length - gap)} ${circumference}`,
    strokeDashoffset: `${-parts.slice(0, index).reduce((sum, part) => sum + part.share, 0) * circumference - gap / 2}`
  }
}
const roleName: Record<Role, string> = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
}
const roleAbbr: Record<Role, string> = {
  TOP: '上',
  JUNGLE: '野',
  MIDDLE: '中',
  BOTTOM: '下',
  UTILITY: '辅'
}
const short = (value: string) => value.split('#')[0]
const key = (row: ChampionRow) => `${row.player}|${row.role}|${row.champion}`
const roleSections = computed(() =>
  roleOrder
    .map((role) => {
      const roleRows = champions.value.filter((row) => row.role === role)
      const players = [...new Set(roleRows.map((row) => row.player))]
      const scopes: PoolScope[] = players
        .map((player) => {
          const rows = roleRows
            .filter((row) => row.player === player)
            .sort((a, b) => b.games - a.games || b.winRate - a.winRate)
          const games = rows.reduce((sum, row) => sum + row.games, 0)
          return {
            key: `${role}|${player}`,
            role,
            player,
            games,
            rows,
            topThreeShare: rows.slice(0, 3).reduce((sum, row) => sum + row.pickRate, 0)
          }
        })
        .sort(
          (a, b) =>
            memberOrder(players, store.settings?.members ?? []).indexOf(a.player) -
            memberOrder(players, store.settings?.members ?? []).indexOf(b.player)
        )
      return { role, scopes, games: scopes.reduce((sum, scope) => sum + scope.games, 0) }
    })
    .filter((section) => section.scopes.length)
)
const scopeCount = computed(() =>
  roleSections.value.reduce((sum, section) => sum + section.scopes.length, 0)
)
const selectedKey = ref('')
const heroDetail = ref<HTMLElement | null>(null)
let heroTrigger: HTMLElement | SVGElement | null = null
async function selectHero(value: string, event: Event) {
  heroTrigger = event.currentTarget as HTMLElement | SVGElement
  if (selectedKey.value === value) return clearHero()
  selectedKey.value = value
  await nextTick()
  heroDetail.value?.scrollIntoView({ block: 'nearest' })
  heroDetail.value?.focus({ preventScroll: true })
}
async function clearHero() {
  selectedKey.value = ''
  await nextTick()
  if (heroTrigger?.isConnected) heroTrigger.focus()
}
watch(
  champions,
  (rows) => {
    if (!rows.some((row) => key(row) === selectedKey.value)) {
      selectedKey.value = ''
    }
  },
  { immediate: true }
)
const selected = computed(() => champions.value.find((row) => key(row) === selectedKey.value))
const expandedScopes = ref(new Set<string>())
const toggleScope = (scopeKey: string) => {
  const next = new Set(expandedScopes.value)
  if (next.has(scopeKey)) next.delete(scopeKey)
  else next.add(scopeKey)
  expandedScopes.value = next
}
const legendRows = (scope: PoolScope) =>
  expandedScopes.value.has(scope.key) ? scope.rows : scope.rows.slice(0, visibleHeroes)
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
const championDisplayName = (value: string) => championInfo(value)?.name ?? value
const sideRate = (wins: number, games: number) => (games ? formatMetric(wins / games, 'pct') : '—')
const intervalText = (wins: number, games: number) => {
  const interval = wilsonInterval(wins, games)
  return interval
    ? `${formatMetric(interval.low, 'pct')}–${formatMetric(interval.high, 'pct')}`
    : '—'
}
const toneClass = (value: unknown) => {
  const number = finiteOrNull(value)
  return number === null || number === 0 ? '' : number > 0 ? 'ma-positive' : 'ma-negative'
}
const detailMetrics = [
  {
    key: 'kda',
    label: 'KDA',
    fmt: 'num',
    signed: false,
    description: roleMetricMeta.kda.description
  },
  {
    key: 'dpm',
    label: '每分钟伤害',
    fmt: 'num',
    signed: false,
    description: roleMetricMeta.dpm.description
  },
  {
    key: 'gpm',
    label: '每分钟金币',
    fmt: 'num',
    signed: false,
    description: roleMetricMeta.gpm.description
  },
  {
    key: 'kp',
    label: '参团率',
    fmt: 'pct',
    signed: false,
    description: roleMetricMeta.kp.description
  },
  {
    key: 'damageConversion',
    label: '伤害转化率',
    fmt: 'pct',
    signed: false,
    description: roleMetricMeta.damageConversion.description
  },
  {
    key: 'gd15',
    label: '15 分钟经济差',
    fmt: 'num',
    signed: true,
    description: roleMetricMeta.gd15.description
  }
] as const
</script>

<style scoped>
.champion-view {
  container-type: inline-size;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
.role-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16px;
  align-items: start;
}
.role-lane {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.role-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.role-heading h3,
.hero-detail h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.role-heading p,
.hero-detail p {
  margin: 4px 0 0;
  color: var(--ma-muted);
  font-size: 12px;
}
.role-mark {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  color: var(--ma-muted);
  font-size: 16px;
}
.pool-member {
  min-width: 0;
  padding: 12px 0;
  border-bottom: 1px solid var(--ma-grid);
}
.pool-member > header {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 6px;
}
.pool-member > header div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.pool-member > header strong {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 600;
}
.pool-member > header small,
.pool-member > header > span {
  color: var(--ma-muted);
  font-size: 12px;
}
.pool-body {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
}
.pool-donut {
  align-self: center;
  margin: 0;
  width: 64px;
  height: 64px;
  overflow: visible;
}
.pool-donut circle {
  fill: none;
  transform: rotate(-90deg);
  transform-origin: 36px 36px;
  stroke-width: 5.5px;
}
.pool-donut .segment {
  cursor: pointer;
}
.pool-donut .segment:focus-visible,
.pool-donut .segment:hover {
  stroke-width: 7px;
}
.pool-donut .track {
  stroke: var(--ma-grid);
}
.pool-donut .segment-selected {
  stroke-width: 8px;
}
.pool-donut text {
  pointer-events: none;
  fill: currentColor;
  font-family: system-ui, sans-serif;
  font-weight: 400;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.pool-donut .unit {
  fill: var(--ma-muted);
  font-weight: 400;
  font-size: 14px;
}
.pool-legend {
  display: contents;
}
.hero-options {
  align-self: center;
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
}
.pool-legend button.more {
  grid-column: 2;
}
.hero-options {
  display: grid;
  gap: 0;
}
.hero-options.expanded {
  max-height: 168px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.pool-legend button {
  display: grid;
  grid-template-columns: 3px 20px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 1px 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  line-height: 1.4;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}
.pool-legend button:hover {
  background: var(--ma-hover);
}
.pool-legend button.selected {
  background: var(--ma-hover);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.pool-legend button > span {
  overflow-wrap: anywhere;
}
.pool-legend button b {
  text-align: right;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.pool-legend button.more {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
}
.hero-options button {
  row-gap: 0;
  padding-block: 3px;
}
.hero-options .legend-swatch,
.hero-options .legend-portrait {
  grid-row: 1 / 3;
}
.hero-options button > span {
  grid-column: 3;
  grid-row: 1;
}
.hero-options button > b {
  grid-column: 4;
  grid-row: 1;
}
.hero-win-rate {
  grid-column: 3 / 5;
  grid-row: 2;
  color: var(--ma-muted);
  font-size: 12px;
  line-height: 1.5;
  font-weight: 400;
  font-variant-numeric: tabular-nums;
}
.legend-portrait {
  width: 20px;
  height: 20px;
  border-radius: 3px;
}
.legend-swatch {
  width: 4px;
  height: 12px;
  border-radius: 1px;
}
.hero-detail {
  margin: 16px 0 8px;
  padding: 20px;
  background: var(--ma-hover);
  border-radius: 8px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 20px 32px;
  align-items: center;
  outline: none;
}
.hero-detail:focus-visible {
  box-shadow: inset 0 0 0 1px var(--la-color-link);
}
.hero-detail header {
  grid-column: 1 / 3;
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.detail-portrait {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 6px;
}
.close-detail {
  grid-column: 3;
  grid-row: 1;
  justify-self: end;
}
.detail-result {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 12px;
  font-variant-numeric: tabular-nums;
}
.result-label,
.detail-result small {
  font-size: 12px;
  color: var(--ma-muted);
}
.detail-result strong {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 24px;
  font-weight: 600;
}
.detail-result small {
  flex-basis: 100%;
}
.detail-sides {
  grid-column: 2 / 4;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 24px;
  font-size: 12px;
}
.detail-metrics {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 16px;
  margin: 0;
  padding-top: 16px;
  border-top: 1px solid var(--ma-grid-strong);
}
.detail-metrics dt {
  font-size: 12px;
  color: var(--ma-muted);
}
.detail-metrics dd {
  margin: 6px 0 0;
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}
@container (max-width: 1080px) {
  .role-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px 24px;
  }
  .detail-metrics {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
@container (max-width: 720px) {
  .role-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .hero-detail {
    gap: 16px;
    padding: 16px;
  }
  .detail-result {
    grid-column: 1 / -1;
  }
  .detail-sides {
    grid-column: 1 / -1;
  }
}
@container (max-width: 440px) {
  .role-grid {
    grid-template-columns: 1fr;
  }
  .detail-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
