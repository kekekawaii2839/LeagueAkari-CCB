<template>
  <div class="ma-native-data-view ban-statistics">
    <div class="ban-side-switch" role="group" :aria-label="uiText('banSideLabel')">
      <NButton
        v-for="option in options"
        :key="option.value"
        :quaternary="side !== option.value"
        :secondary="side === option.value"
        :aria-pressed="side === option.value"
        @click="side = option.value"
        >{{ option.label }}</NButton
      >
    </div>
    <div class="ban-lookup">
      <span class="ma-data-context" role="status">{{
        uiText('banCoverage', {
          valid: result.validGames,
          total: games.length,
          missing: result.missingGames
        })
      }}</span>
      <NInput
        v-model:value="query"
        clearable
        :input-props="{ 'aria-label': uiText('banSearch') }"
        :placeholder="uiText('banSearch')"
      />
      <div class="ban-table-scroll" tabindex="0" role="region" :aria-label="uiText('tierBanTitle')">
        <NEmpty
          v-if="!result.rows.length"
          class="ban-empty"
          :description="uiText(result.validGames ? 'banEmpty' : 'banUnavailable')"
        />
        <NEmpty
          v-else-if="!filteredRows.length"
          class="ban-empty"
          :description="uiText('banNoMatch')"
        >
          <template #extra>
            <NButton secondary @click="query = ''">{{ uiText('banClearSearch') }}</NButton>
          </template>
        </NEmpty>
        <table v-else class="ban-table" :aria-label="uiText('tierBanTitle')">
          <colgroup>
            <col class="ban-hero-column" />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th
                v-for="column in columns"
                :key="column.key"
                scope="col"
                :aria-sort="sort.key === column.key ? sort.direction : 'none'"
              >
                <button
                  type="button"
                  class="ban-sort-trigger"
                  :aria-label="
                    uiText('tierSortHeader', {
                      column: uiText(column.label),
                      order: uiText(
                        sort.key === column.key
                          ? sort.direction === 'descending'
                            ? 'tierDescending'
                            : 'tierAscending'
                          : 'tierDefault'
                      )
                    })
                  "
                  @click="toggleSort(column.key)"
                >
                  <span>{{ uiText(column.label) }}</span
                  ><span class="ban-sort-mark" aria-hidden="true">{{
                    sort.key === column.key ? (sort.direction === 'descending' ? '↓' : '↑') : '↕'
                  }}</span>
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in visibleRows" :key="row.championId">
              <th scope="row">
                <span class="ban-champion"
                  ><ChampionIcon
                    :champion-id="row.championId"
                    class="ban-icon"
                    aria-hidden="true"
                  /><span>{{ championName(row.championId) }}</span></span
                >
              </th>
              <td>{{ uiText('banGameCount', { count: row.games }) }}</td>
              <td>
                <span class="ban-rate"
                  ><span>{{ (row.rate * 100).toFixed(1) }}%</span
                  ><span class="ban-denominator">{{
                    uiText('banRateSample', { count: row.games, total: result.validGames })
                  }}</span></span
                >
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <NPagination
        v-if="filteredRows.length > pageSize"
        v-model:page="page"
        :page-size="pageSize"
        :item-count="filteredRows.length"
        :page-slot="5"
        :aria-label="uiText('banPagination')"
      />
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NEmpty, NInput, NPagination } from 'naive-ui'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { aggregateBans, type BanSide } from './ban-statistics'
import { uiText } from './ui-text'

const { games } = useMemberAnalysisData()
const resources = useAkariResourceProvider()
const side = ref<BanSide>('both')
const query = ref('')
const page = ref(1)
const pageSize = 15
const options: { label: string; value: BanSide }[] = [
  { label: uiText('banBoth'), value: 'both' },
  { label: uiText('banOwn'), value: 'own' },
  { label: uiText('banEnemy'), value: 'enemy' }
]
const columns = [
  { key: 'championId', label: 'banChampion' },
  { key: 'games', label: 'banGames' },
  { key: 'rate', label: 'banRate' }
] as const
type SortKey = (typeof columns)[number]['key']
const sort = ref<{ key: SortKey; direction: 'ascending' | 'descending' }>({
  key: 'games',
  direction: 'descending'
})
function toggleSort(key: SortKey) {
  sort.value = {
    key,
    direction:
      sort.value.key === key && sort.value.direction === 'descending' ? 'ascending' : 'descending'
  }
  page.value = 1
}
const result = computed(() => aggregateBans(games.value, side.value))
const championName = (id: number) =>
  resources.champions.name(id) || `${uiText('banChampion')} ${id}`
const filteredRows = computed(() => {
  const search = query.value.trim().toLocaleLowerCase()
  const { key, direction } = sort.value
  return result.value.rows
    .filter((row) => !search || championName(row.championId).toLocaleLowerCase().includes(search))
    .sort((a, b) => {
      const comparison =
        key === 'championId'
          ? championName(a.championId).localeCompare(championName(b.championId))
          : a[key] - b[key]
      return (direction === 'ascending' ? comparison : -comparison) || a.championId - b.championId
    })
})
const visibleRows = computed(() =>
  filteredRows.value.slice((page.value - 1) * pageSize, page.value * pageSize)
)
watch([query, side], () => {
  page.value = 1
})
watch(
  () => filteredRows.value.length,
  (count) => {
    page.value = Math.min(page.value, Math.max(1, Math.ceil(count / pageSize)))
  }
)
</script>
<style scoped>
.member-analysis-page .ban-statistics {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  gap: 4px;
  box-sizing: border-box;
  width: 100%;
  max-width: 1112px;
  margin-inline: auto;
  padding-inline: 24px;
}
.ban-side-switch {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: none;
}
.ban-side-switch :deep([aria-pressed='true']) {
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.ban-lookup {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 0;
  min-height: 0;
  min-width: 0;
}
.ban-table-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow: auto;
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
}
.ban-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 14px;
  text-align: left;
  background: var(--la-color-bg-primary);
}
.ban-hero-column {
  width: 44%;
}
.ban-table th,
.ban-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--ma-grid);
  font-weight: 400;
  vertical-align: middle;
}
.ban-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background:
    linear-gradient(var(--la-card-muted-surface), var(--la-card-muted-surface)),
    var(--la-color-bg-primary);
  font-weight: 500;
}
.ban-table td {
  text-align: right;
  padding-right: 26px;
}
.ban-table tbody tr:hover {
  background: var(--la-card-muted-surface);
}
.ban-sort-trigger {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: right;
  cursor: pointer;
}
.ban-table th:first-child .ban-sort-trigger {
  text-align: left;
  padding-left: 40px;
  box-sizing: border-box;
}
.ban-sort-mark {
  font-size: 12px;
  color: var(--ma-muted);
  text-align: center;
}
.ban-sort-trigger:hover {
  color: var(--la-color-link);
}
.ban-sort-trigger:focus-visible,
.ban-table-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
.ban-champion {
  display: flex;
  gap: 8px;
  align-items: center;
  overflow-wrap: anywhere;
}
.ban-icon {
  width: 32px;
  height: 32px;
  flex: none;
}
.ban-rate {
  display: inline-flex;
  flex-direction: column;
}
.ban-denominator {
  color: var(--ma-muted);
  font-size: 12px;
}
.ban-empty {
  padding: 24px 12px;
}
@media (max-width: 640px) {
  .member-analysis-page .ban-statistics {
    padding-inline: 12px;
  }
  .ban-hero-column {
    width: 40%;
  }
}
</style>
