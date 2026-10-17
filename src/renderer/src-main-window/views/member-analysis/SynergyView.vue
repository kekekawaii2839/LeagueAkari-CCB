<template>
  <div ref="root" class="ma-panel ma-workspace synergy-view">
    <section v-if="sameRoster" class="synergy-unavailable" role="status" tabindex="-1">
      <h3>{{ uiText('sameRoster') }}</h3>
      <p>{{ uiText('sameRosterDetail') }}</p>
      <div
        class="synergy-table-wrap"
        tabindex="0"
        role="region"
        :aria-label="uiText('synergyPopulation')"
      >
        <table class="population-table">
          <thead>
            <tr>
              <th scope="col">{{ uiText('synergyMember') }}</th>
              <th scope="col">{{ uiText('synergyPersonalGames') }}</th>
              <th scope="col">{{ uiText('synergyPersonalRate') }}</th>
              <th scope="col">{{ uiText('synergyIdenticalGames') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="member in appearances" :key="member.player">
              <th scope="row">{{ short(member.player) }}</th>
              <td>{{ uiText('synergyGames', { count: member.games }) }}</td>
              <td>{{ pct(member.winRate) }}</td>
              <td>{{ uiText('synergyGames', { count: member.games }) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
    <p v-else-if="!synergy.length" class="ma-empty" role="status">{{ uiText('noData') }}</p>
    <template v-else>
      <div class="ma-view-toolbar synergy-toolbar">
        <strong>{{ uiText('synergyComparison', { count: rows.length }) }}</strong>
        <NSelect
          v-model:value="focus"
          :options="memberOptions"
          clearable
          :placeholder="uiText('synergyAllMembers')"
          :aria-label="uiText('synergyFocus')"
        />
        <NSelect
          :value="sort"
          :options="sortOptions"
          :aria-label="uiText('synergySort')"
          @update:value="selectSort"
        />
      </div>
      <div class="synergy-legend combination-legend">
        <span>{{ uiText('synergyLegendRate') }}</span
        ><span>{{ uiText('synergyLegendBaseline') }}</span
        ><span>{{ uiText('synergyLegendInterval') }}</span>
      </div>
      <p v-if="selectionUnavailable" class="synergy-note" role="status">
        {{ uiText('synergySelectionUnavailable') }}
      </p>
      <div class="combination-comparison-grid">
        <div
          class="synergy-table-wrap combination-comparison-list"
          tabindex="0"
          role="region"
          :aria-label="uiText('synergyComparisonTable')"
        >
          <table class="synergy-comparison">
            <colgroup>
              <col style="width: 150px" />
              <col style="width: 150px" />
              <col style="width: 130px" />
              <col style="width: calc(100% - 746px)" />
              <col style="width: 144px" />
              <col style="width: 172px" />
            </colgroup>
            <thead>
              <tr>
                <th
                  v-for="column in memberColumns"
                  :key="column.key"
                  scope="col"
                  class="combination-member-column"
                  :aria-sort="memberSort?.key === column.key ? memberSort.direction : 'none'"
                >
                  <div class="combination-column-heading combination-column-heading--single">
                    <div class="combination-heading-primary">
                      <button
                        type="button"
                        class="ma-table-sort"
                        :aria-label="memberSortLabel(column.key, column.label)"
                        @click="toggleMemberSort(column.key)"
                      >
                        {{ column.label }}
                        <span aria-hidden="true">{{
                          memberSort?.key === column.key
                            ? memberSort.direction === 'descending'
                              ? '↓'
                              : '↑'
                            : '↕'
                        }}</span>
                      </button>
                    </div>
                  </div>
                </th>
                <th
                  scope="col"
                  class="combination-sample-column"
                  :aria-sort="memberSort?.key === 'games' ? memberSort.direction : 'none'"
                >
                  <div class="combination-column-heading combination-column-heading--single">
                    <div class="combination-heading-primary">
                      <button
                        type="button"
                        class="ma-table-sort"
                        :aria-label="memberSortLabel('games', uiText('synergyJointGames'))"
                        @click="toggleMemberSort('games')"
                      >
                        {{ uiText('synergyJointGames')
                        }}<span aria-hidden="true">{{ sortMark('games') }}</span>
                      </button>
                    </div>
                  </div>
                </th>
                <th scope="col" class="rate-heading">
                  <div class="combination-column-heading">
                    <div class="combination-heading-primary">
                      {{ uiText('synergyRateAndBaseline') }}
                    </div>
                    <div class="rate-axis combination-heading-scale" aria-hidden="true">
                      <span v-for="tick in [0, 25, 50, 75, 100]" :key="tick">{{ tick }}%</span>
                    </div>
                  </div>
                </th>
                <th
                  scope="col"
                  :aria-sort="
                    memberSort?.key === 'observedAbsolute' ? memberSort.direction : 'none'
                  "
                >
                  <div class="combination-column-heading combination-column-heading--single">
                    <div class="deviation-heading combination-heading-primary">
                      <button
                        type="button"
                        class="ma-table-sort"
                        :aria-label="
                          memberSortLabel('observedAbsolute', uiText('synergyObservedAbsolute'))
                        "
                        @click="toggleMemberSort('observedAbsolute')"
                      >
                        {{ uiText('synergyObserved')
                        }}<span aria-hidden="true">{{ sortMark('observedAbsolute') }}</span>
                      </button>
                      <MetricHelp
                        :label="uiText('synergyObserved')"
                        :definition="uiText('synergyPoints')"
                        icon-only
                      />
                    </div>
                  </div>
                </th>
                <th
                  scope="col"
                  :aria-sort="
                    memberSort?.key === 'adjustedAbsolute' ? memberSort.direction : 'none'
                  "
                >
                  <div class="combination-column-heading">
                    <div class="deviation-heading combination-heading-primary">
                      <button
                        type="button"
                        class="ma-table-sort"
                        :aria-label="
                          memberSortLabel('adjustedAbsolute', uiText('synergyAdjustedAbsolute'))
                        "
                        @click="toggleMemberSort('adjustedAbsolute')"
                      >
                        {{ uiText('synergyAdjusted')
                        }}<span aria-hidden="true">{{ sortMark('adjustedAbsolute') }}</span>
                      </button>
                      <MetricHelp
                        :label="uiText('synergyAdjusted')"
                        :definition="uiText('synergyPoints')"
                        icon-only
                      />
                    </div>
                    <div class="difference-axis combination-heading-scale" aria-hidden="true">
                      <span>−{{ domainLabel }}</span
                      ><span>0</span><span>+{{ domainLabel }}</span>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="edge in rows"
                :key="edge.key"
                :class="{ selected: edge.key === selectedKey }"
                @click="selectRow(edge.key, $event)"
              >
                <th scope="row">
                  <button
                    class="pair-select"
                    :aria-pressed="edge.key === selectedKey"
                    :aria-controls="evidenceId"
                    :data-combination-key="edge.key"
                    :aria-label="pairAction(edge)"
                    @click.stop="selectEdge(edge.key, $event)"
                  >
                    <span class="pair-name" :title="edge.playerA">{{ short(edge.playerA) }}</span>
                  </button>
                </th>
                <td class="pair-member-cell">
                  <span class="pair-name" :title="edge.playerB" :aria-label="edge.playerB">{{
                    short(edge.playerB)
                  }}</span>
                </td>
                <td class="sample-cell">
                  <div class="sample-count">
                    <span>{{ uiText('synergyGames', { count: edge.games }) }}</span>
                  </div>
                  <small>{{
                    uiText('synergyRecord', { wins: edge.wins, losses: edge.games - edge.wins })
                  }}</small>
                </td>
                <td>
                  <div class="rate-cell">
                    <WinRateInterval
                      :wins="edge.wins"
                      :games="edge.games"
                      :reference="edge.baseline"
                      scale-grid
                      :description="rateDescription(edge)"
                    />
                    <strong>{{ pct(edge.winRate) }}</strong>
                  </div>
                </td>
                <td>{{ difference(edge.observedDifference) }}</td>
                <td>
                  <div class="difference-cell">
                    <div class="difference-track" aria-hidden="true">
                      <i
                        :class="{ negative: edge.adjustedDifference < 0 }"
                        :style="differenceStyle(edge.adjustedDifference)"
                      />
                    </div>
                    <span>{{ difference(edge.adjustedDifference) }}</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <aside
          v-if="selected"
          :id="evidenceId"
          ref="edgeDetail"
          tabindex="-1"
          class="synergy-evidence combination-comparison-evidence"
          role="region"
          :aria-label="uiText('synergyEvidence')"
          @keydown.esc.stop.prevent="clearEdge"
        >
          <header class="evidence-heading">
            <h3>{{ selected.playerA }} × {{ selected.playerB }}</h3>
            <NButton size="small" quaternary @click="clearEdge">{{
              uiText('synergyClose')
            }}</NButton>
          </header>
          <NButton
            size="small"
            secondary
            @click="emit('open-role-pairs', [selected.playerA, selected.playerB])"
            >{{ uiText('combinationOpenRoles') }}</NButton
          >
          <p class="synergy-note">
            {{
              uiText('synergyRecord', {
                wins: selected.wins,
                losses: selected.games - selected.wins
              })
            }}
            · {{ reliabilityLabel(selected.games, minimum) }}
          </p>
          <p class="synergy-note synergy-role-pair">
            <TranslationComponent
              v-if="selected.commonRoles"
              :translation="
                uiText('synergyRolePair', {
                  count: selected.commonRoles.games,
                  total: selected.games
                })
              "
            >
              <template #role-a>
                <span class="synergy-role-pair-role">
                  <PositionIcon
                    v-if="Object.hasOwn(roleKeys, selected.commonRoles!.roleA)"
                    :position="selected.commonRoles!.roleA"
                    class="joint-role-icon"
                    aria-hidden="true"
                  />{{ roleLabel(selected.commonRoles!.roleA) }}
                </span>
              </template>
              <template #role-b>
                <span class="synergy-role-pair-role">
                  <PositionIcon
                    v-if="Object.hasOwn(roleKeys, selected.commonRoles!.roleB)"
                    :position="selected.commonRoles!.roleB"
                    class="joint-role-icon"
                    aria-hidden="true"
                  />{{ roleLabel(selected.commonRoles!.roleB) }}
                </span>
              </template>
            </TranslationComponent>
            <template v-else>{{ uiText('synergyUnknownRole') }}</template>
          </p>
          <section>
            <h4>{{ uiText('synergyBaselineSource') }}</h4>
            <table class="baseline-table">
              <thead>
                <tr>
                  <th scope="col">{{ uiText('synergyMember') }}</th>
                  <th scope="col">{{ uiText('synergyPersonalGames') }}</th>
                  <th scope="col">{{ uiText('synergyPersonalRate') }}</th>
                  <th scope="col">{{ uiText('synergyOutsideGames') }}</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="member in selectedAppearances" :key="member.player">
                  <th scope="row">{{ short(member.player) }}</th>
                  <td>{{ member.games }}</td>
                  <td>{{ pct(member.winRate) }}</td>
                  <td>{{ member.games - selected.games }}</td>
                </tr>
              </tbody>
            </table>
            <dl>
              <dt>{{ uiText('synergyBaselineMean') }}</dt>
              <dd>{{ pct(selected.baseline) }}</dd>
            </dl>
            <h4>{{ uiText('synergyShrinkageHeading') }}</h4>
            <dl>
              <dt>{{ uiText('synergyObserved') }}</dt>
              <dd>{{ points(selected.observedDifference) }}</dd>
              <dt>{{ uiText('synergyWeight') }}</dt>
              <dd>{{ pct(selected.shrinkageWeight) }}</dd>
              <dt>{{ uiText('synergyAdjusted') }}</dt>
              <dd>{{ points(selected.adjustedDifference) }}</dd>
            </dl>
          </section>
          <section class="coverage-section">
            <h4>{{ uiText('synergyCoverage') }}</h4>
            <div class="side-coverage">
              <div>
                <span>{{ uiText('synergyBlue') }}</span
                ><b>{{ uiText('synergySideRecord', selected.blue) }}</b>
              </div>
              <div>
                <span>{{ uiText('synergyRed') }}</span
                ><b>{{ uiText('synergySideRecord', selected.red) }}</b>
              </div>
            </div>
            <dl class="coverage-facts">
              <div>
                <dt>
                  {{ uiText('synergyInterval')
                  }}<small>{{ uiText('synergyConfidenceMethod') }}</small>
                </dt>
                <dd>{{ intervalText(selected) }}</dd>
              </div>
              <div>
                <dt>{{ uiText('synergyDateRange') }}</dt>
                <dd class="coverage-dates">
                  <template v-if="selected.dateFrom && selected.dateTo"
                    ><time :datetime="selected.dateFrom">{{ selected.dateFrom }}</time
                    ><span>{{ uiText('synergyDateTo') }}</span
                    ><time :datetime="selected.dateTo">{{ selected.dateTo }}</time></template
                  ><template v-else>—</template>
                </dd>
              </div>
            </dl>
          </section>
        </aside>
        <aside
          v-else
          class="combination-comparison-evidence combination-comparison-placeholder"
          :aria-label="uiText('combinationEvidencePlaceholder')"
        >
          <h3>{{ uiText('combinationEvidencePlaceholder') }}</h3>
          <p>{{ uiText('combinationSelectMembers') }}</p>
        </aside>
      </div>
      <SynergyHeroStats v-if="heroStats" :key="selectedKey" :stats="heroStats" :minimum="minimum" />
      <section v-if="selected" class="joint-section" :aria-label="uiText('synergyJointGames')">
        <header class="joint-heading">
          <h3>{{ uiText('synergyJointGames') }}</h3>
          <span class="synergy-note"
            >{{ short(selected.playerA) }} × {{ short(selected.playerB) }} ·
            {{
              uiText(showAll ? 'synergyTotalGames' : 'synergyRecentGames', {
                count: selected.games
              })
            }}</span
          >
          <NButton
            size="small"
            secondary
            :aria-expanded="showAll"
            :aria-controls="jointTableId"
            @click="toggleAll"
            >{{
              uiText(showAll ? 'synergyShowRecent' : 'synergyShowAll', { count: selected.games })
            }}</NButton
          >
        </header>
        <div
          :id="jointTableId"
          class="synergy-table-wrap"
          :class="{ 'joint-table-paged': showAll && selected.games > 10 }"
          tabindex="0"
          role="region"
          :aria-label="uiText('synergyJointTable')"
        >
          <table class="joint-table">
            <thead>
              <tr>
                <th scope="col">{{ uiText('synergyDate') }}</th>
                <th scope="col">{{ uiText('synergyResult') }}</th>
                <th scope="col">{{ uiText('synergySide') }}</th>
                <th scope="col">{{ short(selected.playerA) }}</th>
                <th scope="col">{{ short(selected.playerB) }}</th>
                <th scope="col">{{ uiText('synergyDuration') }}</th>
                <th scope="col">{{ uiText('synergyPatch') }}</th>
                <th scope="col">{{ uiText('synergyGameId') }}</th>
                <th scope="col">{{ uiText('synergyMatchDetails') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="game in jointGames" :key="game.gameId">
                <td>{{ game.date || '—' }}</td>
                <td>{{ uiText(game.win ? 'synergyWin' : 'synergyLoss') }}</td>
                <td>{{ uiText(game.side === 'Blue' ? 'synergyBlue' : 'synergyRed') }}</td>
                <td v-for="member in [selected.playerA, selected.playerB]" :key="member">
                  <span v-if="playerIn(game, member)" class="joint-player"
                    ><ChampionIcon
                      :champion-id="championInfo(playerIn(game, member)!.champion)?.id ?? -1"
                    /><span class="joint-player-copy"
                      ><b class="joint-player-champion">{{
                        championInfo(playerIn(game, member)!.champion)?.name ??
                        playerIn(game, member)!.champion
                      }}</b
                      ><small class="joint-player-role"
                        ><PositionIcon
                          v-if="Object.hasOwn(roleKeys, playerIn(game, member)!.role)"
                          :position="playerIn(game, member)!.role"
                          class="joint-role-icon"
                          aria-hidden="true"
                        />{{ roleLabel(playerIn(game, member)!.role) }}</small
                      ></span
                    ></span
                  ><span v-else>—</span>
                </td>
                <td>{{ formatMetric(game.duration, 'time') }}</td>
                <td>{{ game.patch || '—' }}</td>
                <td>{{ game.gameId }}</td>
                <td>
                  <NButton
                    size="small"
                    quaternary
                    :aria-expanded="selectedGameId === game.gameId"
                    :aria-controls="matchDetailId"
                    :aria-label="uiText('synergyMatchAction', { id: game.gameId })"
                    @click="toggleMatch(game.gameId, $event)"
                    >{{
                      uiText(
                        selectedGameId === game.gameId ? 'synergyHideMatch' : 'synergyOpenMatch'
                      )
                    }}</NButton
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <NPagination
          v-if="showAll && selected.games > 10"
          v-model:page="page"
          :page-size="10"
          :item-count="selected.games"
          :aria-label="uiText('synergyPages')"
        />
      </section>
      <section
        v-if="selectedGameId !== null"
        :id="matchDetailId"
        ref="matchDetail"
        tabindex="-1"
        class="synergy-match-detail"
        :aria-label="uiText('synergyMatchAction', { id: selectedGameId })"
        @keydown.esc.stop.prevent="closeMatch"
      >
        <header class="joint-heading">
          <h3>{{ uiText('synergyMatchHeading', { id: selectedGameId }) }}</h3>
          <NButton size="small" secondary @click="closeMatch">{{
            uiText('synergyHideMatch')
          }}</NButton>
        </header>
        <MatchNativeDetails :key="selectedGameId" :game-id="selectedGameId" />
      </section>
    </template>
  </div>
</template>
<script setup lang="ts">
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { useResizeObserver } from '@vueuse/core'
import { NButton, NPagination, NSelect, useThemeVars } from 'naive-ui'
import { TranslationComponent } from 'i18next-vue'
import { computed, nextTick, ref, useId, watch } from 'vue'
import type { SynergyAggregate } from './analytics'
import MatchNativeDetails from './MatchNativeDetails.vue'
import WinRateInterval from './WinRateInterval.vue'
import MetricHelp from './MetricHelp.vue'
import SynergyHeroStats from './SynergyHeroStats.vue'
import { formatMetric } from './metric-defs'
import {
  memberAppearances,
  presentSynergy,
  sortSynergy,
  synergyDifferenceDomain,
  formatSynergyDifference,
  sharedHeroStats,
  type SynergyPresentation,
  type SynergySort
} from './synergy-analysis'
import { uiText } from './ui-text'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { identicalRosters, reliabilityLabel } from './visualization'
import './combination-comparison.css'
import { relatedSynergy, type CombinationMembers } from './combination-navigation'
import { nextRoleTableSort, sortAnalysisTableRows, type RoleTableSort } from './role-table-sort'
const emit = defineEmits<{ 'open-role-pairs': [members: CombinationMembers] }>()
const themeVars = useThemeVars()
const store = useMemberAnalysisStore(),
  lcs = useLeagueClientStore()
const { synergy, games } = useMemberAnalysisData()
const root = ref<HTMLElement | null>(null),
  edgeDetail = ref<HTMLElement | null>(null),
  matchDetail = ref<HTMLElement | null>(null),
  wide = ref(false)
useResizeObserver(root, ([entry]) => {
  wide.value = entry.contentRect.width >= 1560
})
const focus = ref<string | null>(null),
  sort = ref('sample'),
  baseSort = ref<SynergySort>('sample'),
  selectedKey = ref(''),
  selectionUnavailable = ref(false),
  showAll = ref(false),
  page = ref(1),
  selectedGameId = ref<number | null>(null)
const evidenceId = useId(),
  jointTableId = useId(),
  matchDetailId = useId()
let edgeTrigger: HTMLElement | null = null,
  matchTrigger: HTMLElement | null = null
const sameRoster = computed(() => identicalRosters(games.value))
const appearances = computed(() => memberAppearances(games.value))
const minimum = computed(() => (store.sampleSize === 20 ? 2 : store.sampleSize === 50 ? 3 : 5))
const short = (s: string) => s.split('#')[0]
const memberOptions = computed(() =>
  [...new Set(synergy.value.flatMap((e) => [e.playerA, e.playerB]))].map((value) => ({
    label: value,
    value
  }))
)
const memberColumns = computed(() => [
  { key: 'playerA', label: uiText('synergyMemberA') },
  { key: 'playerB', label: uiText('synergyMemberB') }
])
const sortableColumns = computed(() => [
  ...memberColumns.value,
  { key: 'games', label: uiText('synergyJointGames') },
  { key: 'observedAbsolute', label: uiText('synergyObservedAbsolute') },
  { key: 'adjustedAbsolute', label: uiText('synergyAdjustedAbsolute') }
])
const memberSort = computed<RoleTableSort>(() => {
  const [key, direction] = sort.value.split(':')
  return sortableColumns.value.some((column) => column.key === key) &&
    (direction === 'ascending' || direction === 'descending')
    ? { key, direction }
    : null
})
const sortMark = (key: string) =>
  memberSort.value?.key === key ? (memberSort.value.direction === 'descending' ? '↓' : '↑') : '↕'
function selectSort(value: string) {
  if (value === 'sample' || value === 'deviation') baseSort.value = value
  sort.value = value
}
function toggleMemberSort(key: string) {
  const next = nextRoleTableSort(memberSort.value, key)
  sort.value = next ? `${next.key}:${next.direction}` : baseSort.value
}
function memberSortLabel(key: string, label: string) {
  const next = nextRoleTableSort(memberSort.value, key)
  return uiText(
    next ? (next.direction === 'descending' ? 'sortDescending' : 'sortAscending') : 'sortDefault',
    { label }
  )
}
const sortOptions = computed(() => [
  { value: 'sample', label: uiText('synergySortSample') },
  { value: 'deviation', label: uiText('synergySortDeviation') },
  ...sortableColumns.value.flatMap((column) =>
    ['descending', 'ascending'].map((direction) => ({
      value: `${column.key}:${direction}`,
      label: uiText(direction === 'descending' ? 'sortDescending' : 'sortAscending', {
        label: column.label
      })
    }))
  )
])
const presentations = computed(() =>
  presentSynergy(synergy.value.filter((edge) => edge.games >= 4))
)
const visibleEdges = computed(() =>
  focus.value
    ? presentations.value.filter((e) => e.playerA === focus.value || e.playerB === focus.value)
    : presentations.value
)
const rows = computed(() =>
  sortAnalysisTableRows(
    sortSynergy(visibleEdges.value, baseSort.value).map((edge) => ({
      ...edge,
      observedAbsolute: Math.abs(edge.observedDifference),
      adjustedAbsolute: Math.abs(edge.adjustedDifference)
    })),
    memberSort.value,
    ['playerA', 'playerB']
  )
)
const selected = computed(() =>
  sameRoster.value ? undefined : rows.value.find((e) => e.key === selectedKey.value)
)
const heroStats = computed(() => (selected.value ? sharedHeroStats(selected.value) : null))
const selectedAppearances = computed(() =>
  selected.value
    ? appearances.value.filter((m) =>
        [selected.value!.playerA, selected.value!.playerB].includes(m.player)
      )
    : []
)
const domain = computed(() => synergyDifferenceDomain(synergy.value)),
  domainLabel = computed(() => formatMetric(domain.value * 100, 'int'))
const jointGames = computed(
  () =>
    selected.value?.recentGames.slice(
      showAll.value ? (page.value - 1) * 10 : 0,
      showAll.value ? page.value * 10 : 5
    ) ?? []
)
const pct = (v: number) => formatMetric(v, 'pct'),
  difference = formatSynergyDifference
const points = (v: number) => uiText('synergyDifferenceValue', { value: difference(v) })
const intervalText = (edge: SynergyPresentation) =>
  edge.interval ? `${pct(edge.interval.low)}–${pct(edge.interval.high)}` : '—'
const roleKeys = {
  TOP: 'synergyRoleTop',
  JUNGLE: 'synergyRoleJungle',
  MIDDLE: 'synergyRoleMiddle',
  BOTTOM: 'synergyRoleBottom',
  UTILITY: 'synergyRoleUtility'
} as const
const roleLabel = (role: string) =>
  uiText(roleKeys[role as keyof typeof roleKeys] ?? 'synergyUnknownRole')
const pairAction = (edge: SynergyAggregate) =>
  uiText(edge.key === selectedKey.value ? 'synergyClearPair' : 'synergySelectPair', {
    a: edge.playerA,
    b: edge.playerB,
    count: edge.games,
    value: difference(edge.adjustedDifference)
  })
const rateDescription = (edge: SynergyPresentation) =>
  uiText('synergyRateDescription', {
    rate: pct(edge.winRate),
    baseline: pct(edge.baseline),
    interval: intervalText(edge)
  })
const differenceStyle = (value: number) => ({
  width: `${(Math.abs(value) / domain.value) * 50}%`,
  [value < 0 ? 'right' : 'left']: '50%'
})
const playerIn = (game: MemberAnalysisGame, player: string) =>
  game.players.find((p) => p.player === player)
const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
const champions = computed(() => {
  const map = new Map<string, (typeof lcs.gameData.champions)[number]>()
  for (const c of Object.values(lcs.gameData.champions)) {
    map.set(normalize(c.alias), c)
    map.set(normalize(c.name), c)
  }
  return map
})
const championInfo = (value: string) => champions.value.get(normalize(value))
function selectRow(key: string, event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, select, textarea, [role="button"]')) return
  return selectEdge(key, event)
}
async function selectEdge(key: string, event: Event) {
  const source = event.currentTarget as HTMLElement
  edgeTrigger = source.matches('tr') ? source.querySelector<HTMLElement>('.pair-select') : source
  if (selectedKey.value === key) {
    const scrolls = [
      source.closest('.combination-comparison-list'),
      source.closest('.member-analysis-scroll')
    ]
      .filter((element): element is HTMLElement => !!element)
      .map((element) => ({ element, top: element.scrollTop, left: element.scrollLeft }))
    selectedKey.value = ''
    selectionUnavailable.value = false
    await nextTick()
    root.value?.getBoundingClientRect()
    for (const { element, top, left } of scrolls) {
      element.scrollTop = top
      element.scrollLeft = left
    }
    edgeTrigger?.focus({ preventScroll: true })
    return
  }
  selectedKey.value = key
  selectionUnavailable.value = false
  await nextTick()
  if (!wide.value) edgeDetail.value?.scrollIntoView({ block: 'start' })
  edgeDetail.value?.focus({ preventScroll: true })
}
async function clearEdge() {
  selectedKey.value = ''
  selectionUnavailable.value = false
  await nextTick()
  if (edgeTrigger?.isConnected) {
    edgeTrigger.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    edgeTrigger.focus({ preventScroll: true })
  }
}
async function selectMembers(members: CombinationMembers) {
  focus.value = null
  const edge = relatedSynergy(
    synergy.value.filter((edge) => edge.games >= 4),
    members
  )
  if (!edge || sameRoster.value) {
    selectedKey.value = ''
    selectionUnavailable.value = !edge
    await nextTick()
    const status = root.value?.querySelector<HTMLElement>('.synergy-unavailable')
    status?.scrollIntoView({ block: 'center' })
    status?.focus({ preventScroll: true })
    return
  }
  selectedKey.value = edge.key
  selectionUnavailable.value = false
  await nextTick()
  edgeTrigger =
    [...(root.value?.querySelectorAll<HTMLElement>('.pair-select') ?? [])].find(
      (button) => button.dataset.combinationKey === edge.key
    ) ?? null
  edgeDetail.value?.scrollIntoView({ block: 'center' })
  edgeDetail.value?.focus({ preventScroll: true })
}
defineExpose({ selectMembers })
function toggleAll() {
  showAll.value = !showAll.value
  page.value = 1
}
async function toggleMatch(id: number, event: Event) {
  matchTrigger = event.currentTarget as HTMLElement
  if (selectedGameId.value === id) return closeMatch()
  selectedGameId.value = id
  await nextTick()
  matchDetail.value?.scrollIntoView({ block: 'start' })
  matchDetail.value?.focus({ preventScroll: true })
}
async function closeMatch() {
  selectedGameId.value = null
  await nextTick()
  if (matchTrigger?.isConnected) matchTrigger.focus({ preventScroll: true })
}
watch(memberOptions, (options) => {
  if (focus.value && !options.some((option) => option.value === focus.value)) focus.value = null
})
watch(selectedKey, () => {
  showAll.value = false
  page.value = 1
  selectedGameId.value = null
})
watch([rows, sameRoster], () => {
  if (selectedKey.value && !selected.value) {
    selectedKey.value = ''
    selectionUnavailable.value = true
  }
  if (
    selectedGameId.value !== null &&
    !selected.value?.recentGames.some((g) => g.gameId === selectedGameId.value)
  )
    selectedGameId.value = null
  if (selected.value)
    page.value = Math.min(page.value, Math.max(1, Math.ceil(selected.value.games / 10)))
})
</script>
<style scoped>
.synergy-view {
  container-type: inline-size;
  font-family: v-bind('themeVars.fontFamily');
  min-width: 0;
  font-size: 14px;
  line-height: 1.5;
}
.synergy-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.synergy-toolbar :deep(.n-select) {
  width: 190px;
}
.synergy-toolbar > strong {
  font-size: 14px;
  font-weight: 600;
  margin-right: 8px;
}
.synergy-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-left: auto;
  font-size: 12px;
  color: var(--ma-muted);
}
.synergy-table-wrap {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  padding-bottom: 4px;
}
.synergy-table-wrap:focus-visible,
.pair-select:focus-visible,
.synergy-evidence:focus-visible,
.synergy-match-detail:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
  border-radius: 4px;
}
.synergy-comparison,
.baseline-table,
.population-table,
.joint-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.synergy-comparison {
  min-width: 1080px;
  table-layout: fixed;
}
.synergy-comparison th,
.synergy-comparison td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  vertical-align: middle;
}
.synergy-comparison thead th {
  font-size: 13px;
  font-weight: 500;
  border-top: 1px solid var(--ma-grid-strong);
  border-bottom: 1px solid var(--ma-grid-strong);
  padding: 10px 12px;
  color: var(--ma-muted);
}
.synergy-comparison th.combination-member-column {
  width: 150px;
  text-align: left;
}
.synergy-comparison th.combination-sample-column {
  width: 130px;
}
.synergy-comparison .pair-member-cell {
  text-align: left;
}
.synergy-comparison tbody tr {
  height: 64px;
}
.synergy-comparison thead tr {
  height: 72px;
}
.synergy-comparison tbody th {
  font-weight: 400;
}
.deviation-heading {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  white-space: nowrap;
}
.synergy-comparison tbody tr.selected {
  background: color-mix(in srgb, var(--la-color-link) 7%, transparent);
}
.synergy-comparison tbody tr:hover {
  background: var(--ma-hover);
}
.pair-select {
  width: 100%;
  padding: 2px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  line-height: 1.5;
  cursor: pointer;
}
.pair-name {
  display: block;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pair-select small,
.sample-cell small,
.synergy-comparison thead small {
  display: block;
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}
.sample-count {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  white-space: nowrap;
}
.sample-count :deep(.metric-help) {
  min-height: 24px;
  min-width: 24px;
  padding: 0;
}
.rate-heading {
  text-align: left !important;
}
.rate-axis {
  display: flex;
  justify-content: space-between;
  margin: 6px 72px 0 0;
  font-size: 12px;
  font-weight: 400;
}
.rate-cell {
  display: flex;
  gap: 20px;
  align-items: center;
}
.rate-cell > strong {
  font-size: 14px;
  font-weight: 500;
  min-width: 52px;
}
.rate-cell :deep(.win-rate-interval) {
  flex: 1;
}
.difference-cell {
  display: flex;
  align-items: center;
  gap: 12px;
}
.difference-track {
  position: relative;
  flex: 1;
  height: 18px;
  background: linear-gradient(
    to right,
    transparent calc(50% - 0.5px),
    var(--ma-muted) calc(50% - 0.5px),
    var(--ma-muted) calc(50% + 0.5px),
    transparent calc(50% + 0.5px)
  );
}
.difference-track i {
  position: absolute;
  top: 5px;
  height: 8px;
  background: var(--ma-positive);
}
.difference-track i.negative {
  background: var(--ma-negative);
}
.difference-cell > span {
  min-width: 53px;
  text-align: right;
}
.difference-axis {
  display: flex;
  justify-content: space-between;
  margin: 6px 65px 0 0;
  font-size: 12px;
  font-weight: 400;
}
.synergy-evidence {
  min-width: 0;
  padding: 16px 0 0;
  border-top: 1px solid var(--ma-grid-strong);
  scroll-margin-top: 64px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 0 24px;
  align-content: start;
}
.evidence-heading,
.synergy-evidence > .synergy-note {
  grid-column: 1/-1;
}
.evidence-heading {
  display: flex;
  align-items: start;
  gap: 12px;
  justify-content: space-between;
}
.evidence-heading h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.evidence-heading :deep(.n-button) {
  flex: none;
}
.synergy-evidence h4 {
  margin: 16px 0 8px;
  font-size: 14px;
  font-weight: 600;
}
.synergy-note {
  font-size: 12px;
  color: var(--ma-muted);
  margin: 8px 0;
  line-height: 1.6;
}
.baseline-table th,
.baseline-table td {
  padding: 6px 4px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: right;
  overflow-wrap: anywhere;
}
.baseline-table thead th {
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}
.baseline-table th:first-child {
  text-align: left;
  font-weight: 400;
}
.baseline-table tbody th {
  max-width: 140px;
}
.synergy-evidence dl {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 16px;
  margin: 8px 0 0;
}
.synergy-evidence dt {
  color: var(--ma-muted);
}
.synergy-evidence dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  max-width: 240px;
}
.side-coverage {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}
.side-coverage span {
  display: block;
  font-size: 12px;
  color: var(--ma-muted);
  margin-bottom: 4px;
}
.side-coverage b {
  font-weight: 500;
}

.joint-section {
  min-width: 0;
  margin-top: 8px;
  border-top: 1px solid var(--ma-grid-strong);
  padding-top: 16px;
}
.joint-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.joint-heading h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}
.joint-heading .synergy-note {
  margin: 0;
}
.joint-heading :deep(.n-button) {
  margin-left: auto;
}
.joint-table {
  min-width: 1060px;
}
.joint-table-paged {
  /* Ten matches per page; retain the same viewport on a short final page. */
  height: 560px;
  overflow: auto;
  scrollbar-gutter: stable;
}
.joint-table-paged thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--la-color-bg-primary);
}
.joint-table th,
.joint-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: left;
}
.joint-table thead th {
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
  border-bottom: 1px solid var(--ma-grid-strong);
}
.joint-player {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 160px;
}
.joint-player :deep(.champion-icon-container) {
  width: 28px;
  height: 28px;
  flex: none;
}
.joint-player-copy {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.5;
}
.joint-player-role {
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
  margin-top: 2px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.joint-role-icon {
  flex: none;
  font-size: 14px;
}
.synergy-role-pair-role {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
  white-space: nowrap;
}
.joint-player-champion {
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
}
.joint-section :deep(.n-pagination) {
  margin-top: 12px;
}
.synergy-match-detail {
  scroll-margin-top: 64px;
  border-top: 1px solid var(--ma-grid-strong);
  padding-top: 16px;
  min-width: 0;
}
.synergy-unavailable h3 {
  margin: 0;
  font-size: 16px;
}
.synergy-unavailable p {
  margin: 8px 0 20px;
  color: var(--ma-muted);
}
.population-table {
  max-width: 900px;
  min-width: 560px;
}
.population-table th,
.population-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--ma-grid);
  text-align: left;
}
.population-table thead th {
  font-size: 13px;
  color: var(--ma-muted);
  font-weight: 400;
}
.population-table tbody th {
  font-weight: 400;
  overflow-wrap: anywhere;
}
@container (min-width:1560px) {
  .synergy-evidence {
    display: block;
    border-top: 0;
    border-left: 1px solid var(--ma-grid-strong);
    padding: 0 0 0 24px;
  }
  .coverage-section {
    border-top: 1px solid var(--ma-grid);
    padding-top: 8px;
    margin-top: 16px;
  }
}
@container (max-width:680px) {
  .synergy-evidence {
    grid-template-columns: minmax(0, 1fr);
  }
  .evidence-heading,
  .synergy-evidence > .synergy-note {
    grid-column: auto;
  }
  .synergy-legend {
    margin-left: 0;
  }
  .synergy-evidence dd {
    max-width: 190px;
  }
  .baseline-table th,
  .baseline-table td {
    padding: 6px 2px;
  }
  .synergy-toolbar :deep(.n-select) {
    width: 180px;
  }
}
@media (max-height: 600px) {
  .synergy-toolbar {
    gap: 8px;
  }
  .synergy-toolbar > strong {
    margin-right: 0;
  }
  .synergy-toolbar :deep(.n-select) {
    width: 140px;
  }
  .synergy-comparison thead th {
    padding-top: 6px;
    padding-bottom: 6px;
  }
  .synergy-comparison thead th:nth-child(4) > small,
  .synergy-comparison thead th:nth-child(5) > small {
    display: inline;
    margin-left: 4px;
  }
}
</style>

<style scoped>
.synergy-evidence dt {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.6;
}
.synergy-evidence dd {
  font-size: 14px;
  font-weight: 500;
  line-height: 1.6;
}
.synergy-evidence .coverage-facts {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 16px;
}
.coverage-facts > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px 16px;
  align-items: start;
}
.coverage-facts dt small {
  display: block;
  font-size: 12px;
  font-weight: 400;
  margin-top: 2px;
}
.coverage-dates {
  display: grid;
  grid-template-columns: auto auto auto;
  gap: 6px;
  align-items: baseline;
}
.coverage-dates > span {
  font-size: 12px;
  font-weight: 400;
  color: var(--ma-muted);
}
@container (max-width:680px) {
  .coverage-dates {
    grid-template-columns: 1fr;
    text-align: right;
    gap: 2px;
  }
  .coverage-dates > span {
    line-height: 1;
  }
}
</style>
