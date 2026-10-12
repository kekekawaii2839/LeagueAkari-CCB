<template>
  <section class="synergy-heroes" :aria-label="uiText('synergyHeroHeading')">
    <header class="hero-heading">
      <h3>{{ uiText('synergyHeroHeading') }}</h3>
      <p>{{ uiText('synergyHeroScope', { count: stats.total }) }}</p>
    </header>
    <div class="hero-member-grid">
      <section v-for="(member, index) in stats.members" :key="member.player" class="hero-member">
        <header class="hero-heading">
          <h4>{{ short(member.player) }}</h4>
          <p>
            {{ uiText('synergyHeroCoverage', { valid: member.available, total: stats.total }) }}
          </p>
        </header>
        <div
          class="hero-table-wrap"
          tabindex="0"
          role="region"
          :aria-label="uiText('synergyHeroMemberTable', { player: short(member.player) })"
        >
          <table class="hero-table">
            <thead>
              <tr>
                <th scope="col">{{ uiText('synergyHeroChampion') }}</th>
                <th scope="col">{{ uiText('synergyHeroUsage') }}</th>
                <th scope="col">{{ uiText('synergyHeroRecord') }}</th>
                <th scope="col">{{ uiText('synergyHeroWinRate') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in member.rows.slice((pages[index] - 1) * 5, pages[index] * 5)"
                :key="row.champion ?? 'unknown'"
              >
                <th scope="row">
                  <span class="hero-identity"
                    ><ChampionIcon
                      v-if="row.champion"
                      :champion-id="hero(row.champion)?.id ?? -1"
                    /><span v-else class="hero-missing" aria-hidden="true">—</span
                    ><span
                      ><b>{{ heroName(row.champion) }}</b
                      ><small>{{ roleCounts(row.roles) }}</small></span
                    ></span
                  >
                </th>
                <td>
                  {{ uiText('synergyGames', { count: row.games })
                  }}<small>{{ pct(row.share) }}</small>
                </td>
                <td>
                  {{ uiText('synergyRecord', { wins: row.wins, losses: row.games - row.wins })
                  }}<small v-if="row.games < minimum">{{ uiText('synergyHeroSmallSample') }}</small>
                </td>
                <td>
                  {{ pct(row.winRate) }}<small>{{ interval(row) }}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <NPagination
          v-if="member.rows.length > 5"
          v-model:page="pages[index]"
          :page-size="5"
          :item-count="member.rows.length"
          :aria-label="uiText('synergyHeroPages', { player: short(member.player) })"
        />
      </section>
    </div>
    <section class="hero-combinations">
      <header class="hero-heading">
        <h4>{{ uiText('synergyHeroPairs', { count: stats.pairs.length }) }}</h4>
        <p>
          {{ short(stats.members[0].player) }} × {{ short(stats.members[1].player) }} ·
          {{
            uiText('synergyHeroPairCoverage', { valid: stats.pairsAvailable, total: stats.total })
          }}
        </p>
      </header>
      <div
        class="hero-table-wrap"
        tabindex="0"
        role="region"
        :aria-label="uiText('synergyHeroPairTable')"
      >
        <table class="hero-table hero-pair-table">
          <thead>
            <tr>
              <th scope="col">{{ short(stats.members[0].player) }}</th>
              <th scope="col">{{ short(stats.members[1].player) }}</th>
              <th scope="col">{{ uiText('synergyHeroUsage') }}</th>
              <th scope="col">{{ uiText('synergyHeroRecord') }}</th>
              <th scope="col">{{ uiText('synergyHeroWinRate') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in stats.pairs.slice((pages[2] - 1) * 5, pages[2] * 5)" :key="row.key">
              <th
                v-for="(champion, index) in [row.championA, row.championB]"
                :key="index"
                scope="row"
              >
                <span class="hero-identity"
                  ><ChampionIcon v-if="champion" :champion-id="hero(champion)?.id ?? -1" /><span
                    v-else
                    class="hero-missing"
                    aria-hidden="true"
                    >—</span
                  ><span
                    ><b>{{ heroName(champion) }}</b
                    ><small>{{ pairRoles(row.rolePairs, index) }}</small></span
                  ></span
                >
              </th>
              <td>
                {{ uiText('synergyGames', { count: row.games })
                }}<small>{{ pct(row.share) }}</small>
              </td>
              <td>
                {{ uiText('synergyRecord', { wins: row.wins, losses: row.games - row.wins })
                }}<small v-if="row.games < minimum">{{ uiText('synergyHeroSmallSample') }}</small>
              </td>
              <td>
                {{ pct(row.winRate) }}<small>{{ interval(row) }}</small>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <NPagination
        v-if="stats.pairs.length > 5"
        v-model:page="pages[2]"
        :page-size="5"
        :item-count="stats.pairs.length"
        :aria-label="uiText('synergyHeroPairPages')"
      />
    </section>
    <p class="hero-note">{{ uiText('synergyHeroNote') }}</p>
  </section>
</template>
<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { NPagination } from 'naive-ui'
import { ref, watch } from 'vue'
import { formatMetric } from './metric-defs'
import type { SharedHeroStats, SharedHeroRow, SharedHeroPairRow } from './synergy-analysis'
import { uiText } from './ui-text'
const props = defineProps<{ stats: SharedHeroStats; minimum: number }>()
const pages = ref([1, 1, 1]),
  lcs = useLeagueClientStore()
const short = (s: string) => s.split('#')[0]
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const hero = (value: string) =>
  Object.values(lcs.gameData.champions).find(
    (c) => normalize(c.alias) === normalize(value) || normalize(c.name) === normalize(value)
  )
const heroName = (value: string | null) =>
  value ? (hero(value)?.name ?? value) : uiText('synergyHeroUnavailable')
const pct = (value: number) => formatMetric(value, 'pct')
const interval = (row: SharedHeroRow | SharedHeroPairRow) =>
  row.interval ? `${pct(row.interval.low)}–${pct(row.interval.high)}` : '—'
const roleKeys = {
  TOP: 'synergyRoleTop',
  JUNGLE: 'synergyRoleJungle',
  MIDDLE: 'synergyRoleMiddle',
  BOTTOM: 'synergyRoleBottom',
  UTILITY: 'synergyRoleUtility'
} as const
const roleLabel = (role: string | null) =>
  uiText(roleKeys[role as keyof typeof roleKeys] ?? 'synergyUnknownRole')
const roleCounts = (roles: SharedHeroRow['roles']) =>
  roles.map((r) => `${roleLabel(r.role)} ${uiText('synergyGames', { count: r.games })}`).join(' · ')
const pairRoles = (roles: SharedHeroPairRow['rolePairs'], index: number) => {
  const counts = new Map<string | null, number>()
  for (const r of roles) {
    const key = index === 0 ? r.roleA : r.roleB
    counts.set(key, (counts.get(key) ?? 0) + r.games)
  }
  return roleCounts([...counts].map(([role, games]) => ({ role, games })))
}
watch(
  () => props.stats,
  (stats) => {
    const sizes = [...stats.members.map((m) => m.rows.length), stats.pairs.length]
    pages.value = pages.value.map((page, i) => Math.min(page, Math.max(1, Math.ceil(sizes[i] / 5))))
  }
)
</script>
<style scoped>
.synergy-heroes {
  min-width: 0;
  border-top: 1px solid var(--ma-grid-strong);
  padding-top: 16px;
}
.hero-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 12px;
}
.hero-heading h3,
.hero-heading h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.hero-heading p,
.hero-note {
  font-size: 12px;
  color: var(--ma-muted);
  line-height: 1.6;
  margin: 0;
}
.hero-member-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
}
.hero-table-wrap {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}
.hero-table-wrap:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.hero-table {
  border-collapse: collapse;
  width: 100%;
  min-width: 470px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.hero-table th,
.hero-table td {
  text-align: right;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ma-grid);
  vertical-align: middle;
}
.hero-table thead th {
  font-size: 13px;
  color: var(--ma-muted);
  font-weight: 500;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.hero-table th:first-child,
.hero-table tbody th {
  text-align: left;
}
.hero-table tbody th {
  font-weight: 400;
}
.hero-table small {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
  line-height: 1.5;
  margin-top: 2px;
}
.hero-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 140px;
}
.hero-identity b {
  font-weight: 500;
  overflow-wrap: anywhere;
}
.hero-identity :deep(.champion-icon-container),
.hero-missing {
  width: 28px;
  height: 28px;
  flex: none;
}
.hero-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--ma-grid);
  color: var(--ma-muted);
}
.hero-combinations {
  margin-top: 20px;
}
.hero-pair-table {
  min-width: 680px;
}
.hero-pair-table thead th:nth-child(2) {
  text-align: left;
}
.hero-note {
  margin-top: 12px;
}
.synergy-heroes :deep(.n-pagination) {
  margin-top: 12px;
}
@media (max-width: 1200px) {
  .hero-member-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
}
</style>
