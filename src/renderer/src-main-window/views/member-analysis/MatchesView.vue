<template>
  <div
    ref="list"
    class="ma-panel ma-workspace match-list"
    role="region"
    aria-label="对局列表"
    tabindex="-1"
  >
    <div
      v-if="store.matchListScope || scopedGames.length > MEMBER_ANALYSIS_MATCH_PAGE_SIZE"
      ref="scopeBanner"
      class="ma-view-toolbar match-list-toolbar"
      role="group"
      aria-label="对局列表"
      tabindex="-1"
    >
      <NButton
        v-if="store.matchListScope"
        size="small"
        secondary
        @click="store.clearMatchListScope()"
        >{{ uiText('matchScopeClear') }}</NButton
      >
      <div
        v-if="scopedGames.length > MEMBER_ANALYSIS_MATCH_PAGE_SIZE"
        class="match-list-pagination"
      >
        <span class="ma-view-meta">{{
          uiText('matchPageSummary', {
            first: paging.start + 1,
            last: paging.end,
            total: scopedGames.length
          })
        }}</span>
        <NPagination
          :page="paging.page"
          :page-size="MEMBER_ANALYSIS_MATCH_PAGE_SIZE"
          :item-count="scopedGames.length"
          :page-slot="3"
          @update:page="changePage"
        />
      </div>
    </div>
    <div v-if="store.matchListScope" class="match-announcement" role="status" aria-live="polite">
      <span class="ma-view-meta">{{
        uiText('matchScopeSummary', {
          source: store.matchListScope.source,
          visible: scopedGames.length,
          requested: listScope.requested,
          sample: games.length
        })
      }}</span>
    </div>
    <p v-if="listScope.expired" class="ma-chart-note" role="status">
      {{ uiText('matchScopeExpired') }}
    </p>
    <p
      v-if="navigationSource || store.matchNavigationFeedback"
      ref="navigationFeedback"
      class="ma-chart-note"
      :class="{ 'match-announcement': !navigationHasError }"
      role="status"
      aria-live="polite"
      tabindex="-1"
    >
      {{ store.matchNavigationFeedback || uiText('matchNavigationPending') }}
    </p>
    <KeepAlive :key="pageCacheEpoch" :max="2">
      <MatchListPage
        :key="paging.page"
        :games="renderedGames"
        :active="props.active"
        :expanded="expanded"
        :format-time="formatTime"
        @toggle="toggle"
      />
    </KeepAlive>
    <div v-if="!scopedGames.length && !listScope.expired" class="ma-empty">
      {{ store.matchListScope ? uiText('matchScopeEmpty') : '当前筛选条件下没有固定五人对局。' }}
    </div>
  </div>
</template>
<script lang="ts">
// Session-local delivery acknowledgement survives a lazy pane remount, not
// just tab switches. It contains no dataset and never writes persisted state.
const consumedMatchScopes = new WeakMap<object, number>()
</script>
<script setup lang="ts">
import { uiText } from './ui-text'
import { NButton, NPagination } from 'naive-ui'
import {
  KeepAlive,
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  reactive,
  ref,
  watch
} from 'vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { useMemberMatchDetailsPageOrder } from './useMemberMatchDetails'
import MatchListPage from './MatchListPage.vue'
import {
  useMemberAnalysisStore,
  type MemberAnalysisMatchNavigation
} from '@main-window/shards/member-analysis/store'
import { createMatchNavigation, resolveMatchNavigationTarget } from './match-navigation'
import {
  MEMBER_ANALYSIS_MATCH_PAGE_SIZE,
  matchListPageForGame,
  resolveMatchListPage,
  resolveMatchListScope
} from './match-list'
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: false })
const store = useMemberAnalysisStore()
const list = ref<HTMLElement | null>(null)
const navigationSource = ref('')
const navigationHasError = computed(() =>
  Boolean(
    store.matchNavigationFeedback &&
    ![uiText('matchNavigationPending'), uiText('matchNavigationLocated')].includes(
      store.matchNavigationFeedback
    )
  )
)
const navigationFeedback = ref<HTMLElement | null>(null)
const scopeBanner = ref<HTMLElement | null>(null)
let scopeFocusToken = 0
function consumeScope(sequence: number) {
  consumedMatchScopes.set(store, Math.max(consumedMatchScopes.get(store) ?? 0, sequence))
}
watch(
  [
    () => store.matchListScope?.sequence,
    () => store.matchListScope?.status,
    () => store.overviewGeneration,
    () => props.active,
    () => store.matchNavigation
  ],
  async () => {
    const token = ++scopeFocusToken
    const scope = store.matchListScope
    if (!scope || scope.sequence <= (consumedMatchScopes.get(store) ?? 0)) return
    consumeScope(scope.sequence)
    const current = () =>
      token === scopeFocusToken &&
      props.active &&
      store.viewState === 'ready' &&
      store.matchListScope === scope &&
      scope.status === 'active' &&
      scope.publishedGeneration === store.overviewGeneration &&
      !store.matchNavigation
    if (!current()) return
    await nextTick()
    const banner = scopeBanner.value
    if (
      !current() ||
      !banner?.isConnected ||
      !banner.getClientRects().length ||
      !banner.checkVisibility({ opacityProperty: true, visibilityProperty: true })
    )
      return
    banner.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    banner.focus({ preventScroll: true })
  },
  { immediate: true, flush: 'post' }
)
const { games } = useMemberAnalysisData()
const listScope = computed(() =>
  resolveMatchListScope(games.value, store.matchListScope, store.overviewGeneration)
)
const scopedGames = computed(() => listScope.value.games)
const page = ref(1)
const paging = computed(() => resolveMatchListPage(scopedGames.value.length, page.value))
const renderedGames = computed(() => scopedGames.value.slice(paging.value.start, paging.value.end))
// Two visited pages at most; a changed publication, scope, filter or sample
// discards the entire DOM cache rather than retaining obsolete identities.
const pageCacheEpoch = ref(0)
watch(
  [
    scopedGames,
    () => store.overviewGeneration,
    () => ({ ...store.matchListScope }),
    () => ({ ...store.filters }),
    () => store.analysisSide,
    () => store.sampleSize
  ],
  () => {
    pageCacheEpoch.value++
  },
  { flush: 'sync' }
)
watch(
  renderedGames,
  () => {
    const root = list.value
    const focused = root?.ownerDocument?.activeElement as HTMLElement | null | undefined
    if (focused?.closest('[data-match-id]') && root?.contains(focused))
      root.focus({ preventScroll: true })
  },
  { flush: 'sync' }
)
useMemberMatchDetailsPageOrder(
  () => renderedGames.value.map((game) => game.gameId),
  () => props.active
)
watch(scopedGames, () => {
  page.value = paging.value.page
})
watch(
  () => store.matchListScope?.sequence,
  (sequence) => {
    if (sequence) page.value = 1
  },
  { flush: 'sync' }
)
function changePage(value: number) {
  page.value = resolveMatchListPage(scopedGames.value.length, value).page
}
const expanded = reactive(new Set<number>())
const navigation = createMatchNavigation<MemberAnalysisMatchNavigation>({
  current: (request) =>
    props.active && store.viewState === 'ready' && store.matchNavigation === request,
  resolve: (request) =>
    resolveMatchNavigationTarget(store.overview?.games ?? [], scopedGames.value, request.gameId),
  rendered: () => nextTick(),
  expand: (game) => {
    const targetPage = matchListPageForGame(scopedGames.value, game)
    if (targetPage !== null) page.value = targetPage
    expanded.add(game.gameId)
  },
  feedback: () => navigationFeedback.value,
  row: (game) => list.value?.querySelector<HTMLElement>(`[data-match-id="${game.gameId}"]`) ?? null,
  settled: (_request, result) => {
    const messages = {
      found: 'matchNavigationPending',
      located: 'matchNavigationLocated',
      ambiguous: 'matchNavigationAmbiguous',
      excluded: 'matchNavigationExcluded',
      missing: 'matchNavigationMissing',
      unavailable: 'matchNavigationUnavailable'
    } as const
    store.matchNavigationFeedback = uiText(messages[result])
  }
})
watch(
  [() => props.active, () => store.matchNavigation],
  ([active, request]) => {
    navigation.cancel()
    if (!request) {
      navigationSource.value = ''
    }
    if (!active || !request || store.viewState !== 'ready') return
    navigationSource.value = request.source
    void navigation.locate(request)
  },
  { immediate: true, flush: 'post' }
)
function stopNavigation() {
  navigation.cancel()
  scopeFocusToken++
  if (store.matchListScope) consumeScope(store.matchListScope.sequence)
}
onDeactivated(stopNavigation)
onBeforeUnmount(stopNavigation)
watch(games, (value) => {
  const ids = new Set(value.map((game) => game.gameId))
  for (const id of expanded) if (!ids.has(id)) expanded.delete(id)
})
const toggle = (id: number) => (expanded.has(id) ? expanded.delete(id) : expanded.add(id))
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
</script>
<style scoped>
.match-list {
  gap: 0;
  overflow-x: auto;
  width: 100%;
  max-width: 1160px;
  margin-inline: auto;
  box-sizing: border-box;
}
.match-list-toolbar {
  flex-wrap: nowrap;
  justify-content: space-between;
  gap: 12px;
  overflow-x: auto;
}
.match-list-toolbar > :deep(.n-button) {
  flex: 0 0 auto;
}
.match-list-pagination {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  flex: 0 0 auto;
  white-space: nowrap;
}

.match-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
</style>
