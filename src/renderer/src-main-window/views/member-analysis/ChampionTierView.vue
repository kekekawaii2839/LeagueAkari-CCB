<template>
  <div class="ma-native-data-view champion-tier" @keydown.esc="closeDetail">
    <div class="tier-workspace" :class="{ 'has-selection': selectedRow }">
      <div class="tier-list">
        <div class="tier-role-switch" role="group" :aria-label="uiText('tierRole')">
          <NButton
            v-for="option in roleOptions"
            :key="option.value"
            :quaternary="role !== option.value"
            :secondary="role === option.value"
            :aria-pressed="role === option.value"
            :aria-label="option.label"
            @click="role = option.value"
          >
            <template #icon><PositionIcon :position="option.value" aria-hidden="true" /></template
            >{{ option.label }}
          </NButton>
        </div>
        <div class="tier-lookup">
          <div class="tier-context">
            <span class="ma-data-context">{{
              uiText('tierCoverage', {
                games: result.games
              })
            }}</span>
          </div>
          <NInput
            :value="filterInput"
            :placeholder="uiText('tierSearch')"
            :input-props="{ 'aria-label': uiText('tierSearch') }"
            clearable
            @update:value="handleFilterUpdate"
            @compositionstart="handleFilterCompositionStart"
            @compositionend="handleFilterCompositionEnd"
          />
          <p v-if="selectionNotice" class="ma-data-context" role="status">{{ selectionNotice }}</p>
          <p v-if="result.unknownGames" role="status">
            {{ uiText('tierUnknown', { count: result.unknownGames }) }}
          </p>

          <div
            class="tier-table-scroll"
            tabindex="0"
            role="region"
            :aria-label="uiText('tierTable')"
          >
            <NEmpty
              v-if="!sortedRows.length"
              class="tier-empty"
              :description="uiText(eligibleRows.length ? 'tierSearchEmpty' : 'tierMinimumEmpty')"
            />
            <table v-if="sortedRows.length" class="tier-table" :aria-label="uiText('tierTable')">
              <colgroup>
                <col v-for="column in columns" :key="column.key" :style="{ width: column.width }" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    v-for="column in columns"
                    :key="column.key"
                    scope="col"
                    :aria-sort="sort?.key === column.key ? sort.direction : 'none'"
                  >
                    <button
                      type="button"
                      class="tier-sort-trigger"
                      :aria-label="sortLabel(column)"
                      @click="cycleSort(column.key)"
                    >
                      <span class="tier-heading-label">{{ uiText(column.label) }}</span
                      ><span class="tier-sort-mark" aria-hidden="true">{{
                        sort?.key === column.key
                          ? sort.direction === 'descending'
                            ? '↓'
                            : '↑'
                          : '↕'
                      }}</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in sortedRows"
                  :key="row.key"
                  :class="{ 'tier-selected': selectedChampion === row.key }"
                  :aria-selected="selectedChampion === row.key"
                  @click="selectChampion(row.key)"
                >
                  <th scope="row">
                    <button
                      type="button"
                      :ref="(el) => setHeroButton(row.key, el)"
                      class="tier-champion tier-champion-button"
                      :aria-label="
                        uiText(role === 'all' ? 'tierOpenRoleMembers' : 'tierOpenMembers', {
                          champion: championName(row),
                          role: roleLabel(row.role)
                        })
                      "
                      :aria-pressed="selectedChampion === row.key"
                      :aria-expanded="selectedChampion === row.key"
                      aria-controls="tier-member-detail"
                      @click.stop="selectChampion(row.key)"
                    >
                      <ChampionIcon :champion-id="row.championId ?? -1" class="tier-icon" /><span
                        class="tier-champion-name"
                        >{{ championName(row)
                        }}<small v-if="role === 'all'" class="tier-role-label"
                          ><PositionIcon :position="row.role" aria-hidden="true" />{{
                            roleLabel(row.role)
                          }}</small
                        ></span
                      >
                    </button>
                  </th>
                  <td class="tier-level">
                    <span class="tier-statistic"
                      ><span
                        :class="row.tier === null ? 'tier-unrated' : 'tier-value'"
                        :data-tier="row.tier"
                        >{{
                          row.tier === null
                            ? uiText('tierUnrated')
                            : row.tier === 0
                              ? 'OP'
                              : row.tier
                        }}</span
                      ><span v-if="row.tier === null" class="tier-cell-note">{{
                        unratedReason(row)
                      }}</span></span
                    >
                  </td>
                  <td>
                    {{ percent(row.winRate) }}
                  </td>
                  <td>
                    {{ percent(row.pickRate) }}
                  </td>
                  <td
                    :aria-label="
                      row.banRate === null
                        ? uiText(
                            row.championId === null
                              ? 'tierUnknownChampionReason'
                              : 'tierMissingBanReason'
                          )
                        : undefined
                    "
                  >
                    <span v-if="row.banRate === null" class="tier-cell-note">{{
                      uiText(row.championId === null ? 'tierBanUnmatched' : 'tierBanUnavailable')
                    }}</span
                    ><span v-else>{{ percent(row.banRate) }}</span>
                  </td>
                  <td>{{ row.games }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <aside
        id="tier-member-detail"
        ref="detailElement"
        tabindex="-1"
        class="tier-detail"
        :aria-label="uiText('tierDetailTitle')"
      >
        <header class="tier-detail-heading">
          <h3>{{ uiText('tierDetailTitle') }}</h3>
          <NButton
            v-if="selectedRow"
            quaternary
            size="small"
            :aria-label="uiText('tierCloseMembers')"
            @click="closeDetail"
            >{{ uiText('tierCloseMembers') }}</NButton
          >
        </header>
        <template v-if="selectedRow">
          <div class="tier-detail-hero">
            <ChampionIcon :champion-id="selectedRow.championId ?? -1" class="tier-icon" /><strong>{{
              championName(selectedRow)
            }}</strong
            ><span
              :class="selectedRow.tier === null ? 'tier-unrated' : 'tier-value'"
              :data-tier="selectedRow.tier"
              >{{
                selectedRow.tier === null
                  ? uiText('tierUnrated')
                  : selectedRow.tier === 0
                    ? 'OP'
                    : uiText('tierLevel', { tier: selectedRow.tier })
              }}</span
            >
          </div>
          <p class="tier-detail-context">
            {{
              uiText('tierMemberRange', {
                role: roleLabel(selectedRow.role),
                games: selectedRow.games,
                members: selectedMembers.length
              })
            }}
          </p>
          <p v-if="!selectedMembers.length" class="tier-detail-context">
            {{ uiText('tierMembersUnavailable') }}
          </p>
          <h4 class="tier-section-title">{{ uiText('tierMemberTitle') }}</h4>
          <table
            v-if="selectedMembers.length"
            class="tier-member-table"
            :aria-label="uiText('tierMemberTable', { champion: championName(selectedRow) })"
          >
            <colgroup>
              <col style="width: 40%" />
              <col style="width: 15%" />
              <col style="width: 25%" />
              <col style="width: 20%" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{{ uiText('tierMemberPlayer') }}</th>
                <th scope="col">{{ uiText('tierGames') }}</th>
                <th scope="col">{{ uiText('tierMemberRecord') }}</th>
                <th scope="col">{{ uiText('tierWinRate') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="member in selectedMembers" :key="member.player">
                <th scope="row" class="tier-player-id">{{ member.player }}</th>
                <td>{{ member.games }}</td>
                <td>
                  {{ uiText('tierMemberResult', { wins: member.wins, losses: member.losses }) }}
                </td>
                <td>{{ percent(member.winRate) }}</td>
              </tr>
            </tbody>
          </table>
          <section class="tier-ban-detail" :aria-label="uiText('tierBanTitle')">
            <h4>{{ uiText('tierBanTitle') }}</h4>
            <p v-if="selectedRow.championId === null" class="tier-detail-context">
              {{ uiText('tierUnknownChampionReason') }}
            </p>
            <table
              class="tier-member-table"
              :aria-label="uiText('tierBanTable', { champion: championName(selectedRow) })"
            >
              <colgroup>
                <col style="width: 46%" />
                <col style="width: 24%" />
                <col style="width: 30%" />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">{{ uiText('banSideLabel') }}</th>
                  <th scope="col">{{ uiText('tierGames') }}</th>
                  <th scope="col">{{ uiText('tierBanRate') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in selectedBans" :key="row.side">
                  <th
                    scope="row"
                    :aria-description="
                      uiText('tierBanCoverage', { valid: row.validGames, total: row.scopeGames })
                    "
                  >
                    {{
                      uiText(
                        row.side === 'own'
                          ? 'banOwn'
                          : row.side === 'enemy'
                            ? 'banEnemy'
                            : 'banBoth'
                      )
                    }}
                  </th>
                  <td>{{ row.games === null ? '—' : row.games }}</td>
                  <td>{{ percent(row.rate) }}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </template>
        <p v-else class="tier-detail-empty">{{ uiText('tierMemberEmpty') }}</p>
      </aside>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue'
import { NButton, NEmpty, NInput } from 'naive-ui'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useCompositionAwareInput } from '@renderer-shared/composables/useCompositionAwareInput'
import { useChampionNameMatch } from '@main-window/composables/useChampionNameMatch'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import {
  aggregateChampionMembers,
  aggregateChampionBanDetails,
  aggregateChampionTiers,
  LOCAL_TIER_MIN_GAMES,
  type LocalTierRow
} from './champion-tier'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { uiText } from './ui-text'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import './champion-tier-colors.css'
const { games } = useMemberAnalysisData()
const store = useMemberAnalysisStore()
const selectedChampion = ref<string | null>(null)
const selectionNotice = ref('')
const heroButtons = new Map<string, HTMLButtonElement>()
const detailElement = ref<HTMLElement | null>(null)
function setHeroButton(name: string, element: Element | ComponentPublicInstance | null) {
  if (element) heroButtons.set(name, element as HTMLButtonElement)
  else heroButtons.delete(name)
}
function closeDetail() {
  const previous = selectedChampion.value
  if (!previous) return
  selectedChampion.value = null
  selectionNotice.value = ''
  nextTick(() => {
    const button = heroButtons.get(previous)
    button?.focus?.({ preventScroll: true })
    const scroller = button?.closest?.('.tier-table-scroll') as HTMLElement | null
    if (!button || !scroller) return
    const row = button.getBoundingClientRect()
    const frame = scroller.getBoundingClientRect()
    const header = scroller.querySelector('thead th')?.getBoundingClientRect().height ?? 0
    const top = frame.top + header + 4
    const bottom = frame.top + scroller.clientHeight - 4
    if (row.top < top) scroller.scrollTop -= top - row.top
    else if (row.bottom > bottom) scroller.scrollTop += row.bottom - bottom
  })
}
function selectChampion(name: string) {
  if (selectedChampion.value === name) closeDetail()
  else {
    selectedChampion.value = name
    selectionNotice.value = ''
    nextTick(() => {
      const detail = detailElement.value
      const workspace = detail?.parentElement
      if (!detail || !workspace || typeof getComputedStyle === 'undefined') return
      detail.scrollTop = 0
      if (getComputedStyle(workspace).gridTemplateColumns.trim().split(/\s+/).length === 1) {
        detail.focus({ preventScroll: true })
      }
    })
  }
}
const league = useLeagueClientStore(),
  extra = useExtraAssetsStore(),
  resources = useAkariResourceProvider()
const role = ref('all')
type SortKey = 'champion' | 'tier' | 'winRate' | 'pickRate' | 'banRate' | 'games'
const sort = ref<{ key: SortKey; direction: 'ascending' | 'descending' } | null>({
  key: 'tier',
  direction: 'ascending'
})
const { match } = useChampionNameMatch()
const {
  inputValue: filterInput,
  committedValue: filterText,
  handleUpdateValue: handleFilterUpdate,
  handleCompositionStart: handleFilterCompositionStart,
  handleCompositionEnd: handleFilterCompositionEnd
} = useCompositionAwareInput()
const championName = (row: LocalTierRow) =>
  row.championId ? resources.champions.name(row.championId) || row.champion : row.champion
const columns = [
  { key: 'champion', label: 'tierChampion', width: '196px' },
  { key: 'tier', label: 'tierLocalColumn', width: '112px' },
  { key: 'winRate', label: 'tierWinRate', width: '100px' },
  { key: 'pickRate', label: 'tierPickRate', width: '100px' },
  { key: 'banRate', label: 'tierBanRate', width: '114px' },
  { key: 'games', label: 'tierGames', width: '68px' }
] as const
function cycleSort(key: SortKey) {
  const first = key === 'champion' || key === 'tier' ? 'ascending' : 'descending'
  sort.value =
    sort.value?.key !== key
      ? { key, direction: first }
      : sort.value.direction === first
        ? { key, direction: first === 'ascending' ? 'descending' : 'ascending' }
        : null
}
const sortLabel = (column: (typeof columns)[number]) =>
  uiText('tierSortHeader', {
    column: uiText(column.label),
    order: uiText(
      sort.value?.key === column.key
        ? sort.value.direction === 'ascending'
          ? 'tierAscending'
          : 'tierDescending'
        : 'tierDefault'
    )
  })
const roleOptions = computed(() => [
  { value: 'all', label: uiText('versionTrendAllRoles') },
  ...['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].map((value, index) => ({
    value,
    label: uiText(
      (['tierTop', 'tierJungle', 'tierMiddle', 'tierBottom', 'tierSupport'] as const)[index]
    )
  }))
])
const roleLabel = (value: string) =>
  roleOptions.value.find((option) => option.value === value)?.label ?? value
const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
const championIds = computed(() => {
  const index = new Map<string, number>()
  for (const hero of Object.values(extra.heroListMap)) {
    for (const name of [hero.alias, hero.name, hero.title])
      if (name) index.set(normalize(name), Number(hero.heroId))
  }
  for (const hero of Object.values(league.gameData.champions)) {
    for (const name of [hero.alias, hero.name]) if (name) index.set(normalize(name), hero.id)
  }
  return index
})
const result = computed(() =>
  aggregateChampionTiers(
    games.value,
    role.value,
    (name) => championIds.value.get(normalize(name)) ?? null
  )
)
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)

const eligibleRows = computed(() =>
  result.value.rows.filter((row) => row.games >= LOCAL_TIER_MIN_GAMES)
)
const sortedRows = computed(() => {
  const query = filterText.value.trim()
  // Stable ties retain domain order; unavailable values remain last in either direction.
  return eligibleRows.value
    .filter(
      (row) =>
        !query ||
        match(query, championName(row), row.championId ?? undefined) ||
        (normalize(row.champion).includes(normalize(query)) && normalize(query).length > 0)
    )
    .toSorted((a, b) => {
      if (!sort.value) return 0
      const { key, direction } = sort.value,
        sign = direction === 'ascending' ? 1 : -1
      if (key === 'champion') return sign * championName(a).localeCompare(championName(b))
      if (a[key] === null) return b[key] === null ? 0 : 1
      if (b[key] === null) return -1
      return sign * (a[key]! - b[key]!)
    })
})
const selectedRow = computed(
  () => sortedRows.value.find((row) => row.key === selectedChampion.value) ?? null
)
const selectedMembers = computed(() =>
  selectedRow.value
    ? aggregateChampionMembers(
        games.value,
        selectedRow.value.champion,
        selectedRow.value.role,
        store.settings?.members ?? []
      )
    : []
)
const selectedBans = computed(() =>
  selectedRow.value
    ? aggregateChampionBanDetails(games.value, selectedRow.value.championId, selectedRow.value.role)
    : []
)
watch(sortedRows, (rows) => {
  if (selectedChampion.value && !rows.some((row) => row.key === selectedChampion.value)) {
    selectedChampion.value = null
    selectionNotice.value = uiText('tierSelectionCleared')
  }
})
const unratedReason = (row: LocalTierRow) =>
  uiText(
    row.unratedReason === 'low-sample'
      ? 'tierLowSampleReason'
      : row.unratedReason === 'unknown-champion'
        ? 'tierUnknownChampionReason'
        : row.unratedReason === 'no-variation'
          ? 'tierNoVariationReason'
          : 'tierMissingBanReason',
    { minimum: LOCAL_TIER_MIN_GAMES }
  )
</script>
<style scoped>
.member-analysis-page .champion-tier {
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
  gap: 4px;
  container-type: inline-size;
  box-sizing: border-box;
  width: 100%;
  max-width: 1112px;
  margin-inline: auto;
  padding-inline: 24px;
}
.tier-context {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  align-items: baseline;
}
.tier-role-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}
.tier-role-label :deep(.n-icon) {
  flex: none;
  font-size: 14px;
}
.tier-role-switch {
  flex: none;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.tier-role-switch :deep([aria-pressed='true']) {
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 5px;
}
.tier-lookup {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.tier-table-scroll {
  min-width: 0;
  max-width: 100%;
  overflow: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  flex: 1 1 0;
  min-height: 0;
  overscroll-behavior: contain;
}
.tier-table {
  width: 690px;
  min-width: 690px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 14px;
  text-align: left;
  background: var(--la-color-bg-primary);
}
.tier-table th,
.tier-table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--ma-grid);
  font-weight: 400;
  vertical-align: middle;
}
.tier-table thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background:
    linear-gradient(var(--la-card-muted-surface), var(--la-card-muted-surface)),
    var(--la-color-bg-primary);
  font-weight: 500;
}
.tier-table td {
  text-align: right;
  padding-right: 26px;
}
.tier-table .tier-level {
  text-align: center;
  padding-inline: 8px;
}
.tier-table tbody tr:hover {
  background: var(--la-card-muted-surface);
}
.tier-table tr > :first-child {
  position: sticky;
  left: 0;
  background: var(--la-color-bg-primary);
  z-index: 1;
}
.tier-table thead tr > :first-child {
  background:
    linear-gradient(var(--la-card-muted-surface), var(--la-card-muted-surface)),
    var(--la-color-bg-primary);
  z-index: 3;
}
/* Match hero-pool header buttons: native semantics, ↕/↑/↓, inherited type and theme focus. */
.tier-sort-trigger {
  box-sizing: border-box;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12px;
  align-items: center;
  align-content: center;
  column-gap: 6px;
  min-height: 32px;
  color: inherit;
  font: inherit;
  line-height: 1.5;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  text-align: right;
  width: 100%;
  white-space: nowrap;
}
.tier-table th:first-child .tier-sort-trigger {
  grid-template-columns: max-content 12px;
  justify-content: flex-start;
  text-align: left;
  padding-left: 40px;
}
.tier-table th:nth-child(2) .tier-sort-trigger {
  grid-template-columns: 12px minmax(0, 1fr) 12px;
  text-align: center;
}
.tier-table th:nth-child(2) .tier-sort-trigger::before {
  content: '';
}
.tier-sort-mark {
  flex: none;
  width: 12px;
  text-align: center;
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}
.tier-sort-trigger:focus-visible,
.tier-table-scroll:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.tier-champion {
  display: flex;
  align-items: center;
  gap: 8px;
}
.tier-icon {
  width: 32px;
  height: 32px;
  flex: none;
}
.tier-champion-name {
  overflow-wrap: anywhere;
}
.tier-statistic {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.tier-value {
  font-weight: 600;
}
.tier-cell-note {
  font-size: 13px;
  color: var(--ma-muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.tier-empty {
  padding: 24px 12px;
}

.tier-workspace {
  flex: 1 1 0;
  min-height: 0;
  height: 100%;
  display: grid;
  /* Reserve 8px for the native vertical scrollbar beside the table. */
  grid-template-columns: 698px minmax(0, 1fr);
  align-items: stretch;
  gap: 24px;
  min-width: 0;
}
.tier-list {
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
}
.tier-detail {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  padding-right: 8px;
  background: var(--la-color-bg-primary);
  min-width: 0;
  padding-left: 16px;
  border-left: 1px solid var(--ma-grid);
}
.tier-detail:focus-visible {
  outline: 2px solid var(--la-color-text-primary);
  outline-offset: 4px;
}
.tier-detail > * {
  flex-shrink: 0;
}
.tier-detail-heading {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--la-color-bg-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 34px;
}
.tier-detail-heading h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.tier-section-title {
  margin: 16px 0 0;
  font-size: 14px;
  font-weight: 500;
}
.tier-ban-detail {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--ma-grid);
}
.tier-ban-detail h4 {
  margin: 12px 0 0;
  font-size: 14px;
  font-weight: 500;
}
.tier-ban-detail h4:first-child {
  margin-top: 0;
}
.tier-detail-hero {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.tier-detail-hero strong {
  overflow-wrap: anywhere;
  font-size: 14px;
  font-weight: 500;
}
.tier-detail-context,
.tier-detail-empty {
  color: var(--ma-muted);
  font-size: 13px;
  line-height: 1.5;
  margin-top: 12px;
}
.tier-member-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 14px;
}
.tier-member-table th,
.tier-member-table td {
  padding: 8px 4px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  font-weight: 400;
  vertical-align: middle;
  overflow-wrap: anywhere;
}
.tier-member-table th:first-child {
  text-align: left;
}
.tier-member-table .tier-player-id {
  font-weight: 600;
}
.tier-member-table thead {
  color: var(--ma-muted);
}
.tier-table tbody tr {
  cursor: pointer;
}
.tier-table .tier-selected,
.tier-table .tier-selected > th {
  background: var(--la-card-muted-surface);
}
.tier-champion-button {
  width: 100%;
  box-sizing: border-box;
  border: 0;
  padding: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tier-champion-button:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
@container (max-width:1058px) {
  .tier-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .tier-list,
  .tier-detail {
    width: 100%;
    max-width: 698px;
  }
  .tier-detail {
    display: none;
    padding-left: 0;
    border-left: 0;
  }
  .tier-table-scroll {
    overflow-x: auto;
  }
  .tier-workspace.has-selection .tier-list {
    display: none;
  }
  .tier-workspace.has-selection .tier-detail {
    display: flex;
  }
}
</style>
