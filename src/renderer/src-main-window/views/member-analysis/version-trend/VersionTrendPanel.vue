<template>
  <NEmpty
    v-if="!members.length || !store.overview || store.overview.firstRun"
    :description="text('empty')"
  />
  <template v-else>
    <VersionTrendView
      :request="request"
      :result="result"
      :loading="loading"
      :error="error"
      :members="members"
      :roles="roles"
      :champions="champions"
      :filter-summary="''"
      :text="text"
      @update:request="request = $event"
    >
      <template #error-action>
        <NButton secondary :loading="loading" :disabled="loading" @click="reloadSequence++">{{
          uiText('retry')
        }}</NButton>
      </template>
    </VersionTrendView>
  </template>
</template>
<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, toRaw, watch } from 'vue'
import { NButton, NEmpty } from 'naive-ui'
import { useInstance } from '@renderer-shared/shards'
import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import type { MemberAnalysisPublishedMemberIdentitiesPage } from '@shared/shards/member-analysis/published-member-identities'
import { uiText } from '../ui-text'
import { trendRequestKey, type TrendInput, type TrendRequest, type TrendResult } from './domain'
import VersionTrendView, { type TrendCopyKey } from './VersionTrendView.vue'
import TrendWorker from './version-trend.worker?worker'
import type { TrendWorkerMessage, TrendWorkerReply } from './worker-protocol'
const props = defineProps<{ active: boolean }>()
const store = useMemberAnalysisStore()
const api = useInstance(MemberAnalysisRenderer)
const text = (key: TrendCopyKey, values: Record<string, string | number> = {}) => {
  const localeKey = `versionTrend${key.charAt(0).toUpperCase()}${key.slice(1)}` as Parameters<
    typeof uiText
  >[0]
  return uiText(localeKey, values)
}
const members = computed(() =>
  (store.settings?.members ?? []).map((member, index) => ({
    value: `member-slot-${index + 1}`,
    label: `${member.gameName}#${member.tagLine}`
  }))
)
const roles = [
  { label: '上', value: 'TOP' },
  { label: '野', value: 'JUNGLE' },
  { label: '中', value: 'MIDDLE' },
  { label: '下', value: 'BOTTOM' },
  { label: '辅', value: 'UTILITY' }
] satisfies { label: string; value: TrendRequest['role'] }[]
const champions = computed(() =>
  [
    ...new Set(
      store.overview?.games.flatMap((game) => game.players.map((player) => player.champion)) ?? []
    )
  ]
    .sort()
    .map((value) => ({ value, label: value }))
)
const request = ref<TrendRequest>({
  axis: 'patch',
  timeBucket: 'week',
  memberId: members.value[0]?.value ?? '',
  role: 'TOP',
  metric: 'player:winRate',
  champion: null,
  side: 'all',
  outcome: 'all',
  patchFrom: '',
  patchTo: '',
  dateFrom: '',
  dateTo: '',
  durationMin: null,
  durationMax: null,
  includeMemberIds: [],
  excludeMemberIds: [],
  completeness: 'all'
})
const result = ref<TrendResult | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const reloadSequence = ref(0)
const configuration = computed(() => JSON.stringify(store.settings?.members ?? []))
let sequence = 0
let worker: Worker | null = null
type PreparedInput = { generation: number; token: string; configuration: string; input: TrendInput }
let cached: PreparedInput | null = null
let pendingIdentities: { scope: string; promise: Promise<PreparedInput> } | null = null
// Retain only completed pages, not a live hidden-page request. Reopening an
// interrupted cold load resumes its cursor instead of repeating validated IO.
let identityProgress: {
  scope: string
  cursor: string | null
  complete: boolean
  configurationToken: string | null
  configuredMemberIds: string[]
  identities: TrendInput['identities']
  cursors: Set<string>
} | null = null
let identitySequence = 0
let activeOperationKey: string | null = null
let resultScope: string | null = null
const resultCache = new Map<string, TrendResult>()
let observedReloadSequence = 0
function invalidateData() {
  identitySequence++
  pendingIdentities = null
  cached = null
  identityProgress = null
  resultCache.clear()
}
function rememberResult(key: string, value: TrendResult) {
  resultCache.delete(key)
  resultCache.set(key, value)
  while (resultCache.size > 8) resultCache.delete(resultCache.keys().next().value!)
}
let routeActivated = true
const permitted = () =>
  routeActivated &&
  props.active &&
  store.settings?.enabled === true &&
  store.settings.experimentalVersionTrendEnabled === true
function cancel() {
  activeOperationKey = null
  sequence++
  worker?.terminate()
  worker = null
  loading.value = false
}
const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function run() {
  const operationKey = JSON.stringify([
    store.overviewGeneration,
    store.overview?.publicationToken,
    configuration.value,
    trendRequestKey(request.value),
    reloadSequence.value
  ])
  // Activation and reactive selection can notify in the same turn. They must
  // not terminate/restart the identical worker or invalidate its current job.
  if (permitted() && loading.value && activeOperationKey === operationKey) return
  cancel()
  if (!permitted()) {
    // A hidden pane keeps only completed same-scope facts, never a pending read.
    identitySequence++
    pendingIdentities = null
    if (!store.settings?.enabled || !store.settings.experimentalVersionTrendEnabled) {
      invalidateData()
      result.value = null
    }
    return
  }
  if (observedReloadSequence !== reloadSequence.value) {
    observedReloadSequence = reloadSequence.value
    invalidateData()
  }
  const overview = store.overview
  const token = overview?.publicationToken
  const generation = store.overviewGeneration
  const scope = configuration.value
  if (!overview || overview.firstRun || !members.value.length) {
    result.value = null
    return
  }
  if (!members.value.some((member) => member.value === request.value.memberId)) {
    request.value = {
      ...request.value,
      memberId: members.value[0].value,
      includeMemberIds: [],
      excludeMemberIds: []
    }
    return
  }
  if (!token) {
    result.value = null
    error.value = uiText('versionTrendReadFailed')
    return
  }
  const dataScope = JSON.stringify([generation, token, scope])
  if (resultScope !== dataScope) {
    invalidateData()
    resultScope = dataScope
    result.value = null
  }
  const id = sequence
  const current = () =>
    id === sequence &&
    permitted() &&
    store.overviewGeneration === generation &&
    configuration.value === scope &&
    store.overview?.publicationToken === token
  const selection = {
    ...toRaw(request.value),
    includeMemberIds: [...request.value.includeMemberIds],
    excludeMemberIds: [...request.value.excludeMemberIds]
  }
  const key = trendRequestKey(selection)
  activeOperationKey = operationKey
  loading.value = true
  error.value = null
  if (result.value?.generation !== generation) result.value = null
  try {
    const reused = resultCache.get(key)
    if (reused) {
      rememberResult(key, reused)
      result.value = reused
      loading.value = false
      return
    }
    let finishPosted = false
    let aggregationFailed = false
    const createAggregation = (configuredMemberIds: string[]) => {
      const instance = new TrendWorker()
      worker = instance
      instance.onmessage = (event: MessageEvent<TrendWorkerReply>) => {
        const reply = event.data
        if (
          !finishPosted ||
          !current() ||
          worker !== instance ||
          reply.jobId !== id ||
          key !== trendRequestKey(request.value)
        )
          return
        loading.value = false
        if (
          reply.type === 'done' &&
          reply.requestKey === key &&
          reply.result.generation === generation
        ) {
          result.value = reply.result
          rememberResult(key, reply.result)
        } else {
          result.value = null
          error.value = uiText('versionTrendReadFailed')
        }
        instance.terminate()
        if (worker === instance) worker = null
      }
      instance.onerror = () => {
        if (!current() || worker !== instance) return
        aggregationFailed = true
        instance.terminate()
        if (worker === instance) worker = null
        loading.value = false
        result.value = null
        error.value = uiText('versionTrendReadFailed')
      }
      const post = (message: TrendWorkerMessage) => {
        if (current() && worker === instance && !aggregationFailed) instance.postMessage(message)
      }
      post({
        type: 'start',
        jobId: id,
        generation,
        configuredMemberIds,
        request: selection
      })
      return { instance, post }
    }
    const uploadGames = async (
      instance: Worker,
      post: (message: TrendWorkerMessage) => void,
      games: TrendInput['games']
    ) => {
      let sliceStarted = performance.now(),
        chunksSinceYield = 0
      for (let offset = 0; offset < games.length; offset += 25) {
        if (!current() || worker !== instance || aggregationFailed) return
        post({
          type: 'chunk',
          jobId: id,
          games: games.slice(offset, offset + 25).map(toRaw),
          identities: []
        })
        chunksSinceYield++
        if (
          offset + 25 < games.length &&
          (performance.now() - sliceStarted >= 4 || chunksSinceYield >= 8)
        ) {
          await turn()
          sliceStarted = performance.now()
          chunksSinceYield = 0
        }
      }
    }
    const overviewIds = new Set(overview.games.map((game) => game.gameId))
    // Ambiguous numeric IDs retain the established fully prepared producer.
    let earlyDisabled = !overview.games.length || overviewIds.size !== overview.games.length
    type EarlyAggregation = ReturnType<typeof createAggregation> & {
      uploaded: Promise<void>
      seen: Set<number>
      configuredIds: string
    }
    const earlyState: { value: EarlyAggregation | null } = { value: null }
    const discardEarly = () => {
      earlyDisabled = true
      if (!earlyState.value) return
      earlyState.value.instance.terminate()
      if (worker === earlyState.value.instance) worker = null
      earlyState.value = null
    }
    const feedEarly = (configuredMemberIds: string[], identities: TrendInput['identities']) => {
      if (earlyDisabled || !current() || aggregationFailed) return
      if (
        earlyState.value &&
        earlyState.value.configuredIds !== JSON.stringify(configuredMemberIds)
      ) {
        discardEarly()
        return
      }
      if (!earlyState.value) {
        const aggregation = createAggregation(configuredMemberIds)
        earlyState.value = {
          ...aggregation,
          uploaded: Promise.resolve(),
          seen: new Set(),
          configuredIds: JSON.stringify(configuredMemberIds)
        }
        const started = earlyState.value
        started.uploaded = uploadGames(started.instance, started.post, toRaw(overview.games)).catch(
          () => {
            if (earlyState.value === started) discardEarly()
          }
        )
      }
      const stream = earlyState.value
      const relevant = identities.filter((identity) => overviewIds.has(identity.gameId))
      const incomingIds = new Set<number>()
      for (const identity of relevant) {
        if (stream.seen.has(identity.gameId) || incomingIds.has(identity.gameId)) {
          // Keep the original last-wins Map behavior via the prepared path.
          discardEarly()
          return
        }
        incomingIds.add(identity.gameId)
      }
      for (let offset = 0; offset < relevant.length; offset += 25) {
        const chunk = relevant.slice(offset, offset + 25)
        for (const identity of chunk) stream.seen.add(identity.gameId)
        stream.post({ type: 'chunk', jobId: id, games: [], identities: chunk })
      }
    }
    if (
      !cached ||
      cached.generation !== generation ||
      cached.token !== token ||
      cached.configuration !== scope
    ) {
      if (!pendingIdentities || pendingIdentities.scope !== dataScope) {
        const identityId = ++identitySequence
        const dataCurrent = () =>
          identityId === identitySequence &&
          permitted() &&
          store.overviewGeneration === generation &&
          configuration.value === scope &&
          store.overview?.publicationToken === token
        const promise = (async (): Promise<PreparedInput> => {
          if (!identityProgress || identityProgress.scope !== dataScope)
            identityProgress = {
              scope: dataScope,
              cursor: null,
              complete: false,
              configurationToken: null,
              configuredMemberIds: [],
              identities: [],
              cursors: new Set()
            }
          const progress = identityProgress
          // Interrupted reads retain their original prepared-path behavior.
          if (progress.identities.length) earlyDisabled = true
          let earlyCaughtUp = false
          while (!progress.complete && dataCurrent()) {
            const reply = await api.getPublishedMemberIdentities({
              publicationToken: token,
              memberSlots: members.value.map((_, index) => index + 1),
              pageSize: 25,
              cursor: progress.cursor
            })
            if (!dataCurrent()) throw new Error('identity-load-cancelled')
            if (!reply.ok) throw new Error('identity-read-failed')
            const page: MemberAnalysisPublishedMemberIdentitiesPage = reply.value
            if (
              page.publicationToken !== token ||
              (progress.configurationToken !== null &&
                progress.configurationToken !== page.configurationToken)
            )
              throw new Error('identity-scope-changed')
            const cursor = page.pagination.nextCursor
            if (cursor && progress.cursors.has(cursor)) throw new Error('repeated-cursor')
            progress.configurationToken = page.configurationToken
            progress.configuredMemberIds = page.configuredMemberIds
            const identities = page.games
              .filter((game) => game.status === 'available')
              .map((game) => ({ gameId: game.gameId, members: game.members }))
            progress.identities.push(...identities)
            feedEarly(
              progress.configuredMemberIds,
              earlyCaughtUp ? identities : progress.identities
            )
            earlyCaughtUp = true
            progress.cursor = cursor
            progress.complete = cursor === null
            if (cursor) progress.cursors.add(cursor)
            await turn()
          }
          if (!dataCurrent()) throw new Error('identity-load-cancelled')
          const prepared: PreparedInput = {
            generation,
            token,
            configuration: scope,
            input: {
              generation,
              identitiesGeneration: generation,
              configuredMemberIds: progress.configuredMemberIds,
              identities: progress.identities,
              games: toRaw(overview.games)
            }
          }
          if (!dataCurrent()) throw new Error('identity-load-cancelled')
          cached = prepared
          return prepared
        })()
        pendingIdentities = { scope: dataScope, promise }
      }
      const pending = pendingIdentities
      try {
        await pending.promise
      } finally {
        if (pendingIdentities === pending) pendingIdentities = null
      }
    }
    if (!current()) return
    if (aggregationFailed) throw new Error('trend-worker-failed')
    const streamed = earlyState.value
    if (streamed) {
      await streamed.uploaded
      if (earlyState.value === streamed && current() && worker === streamed.instance) {
        finishPosted = true
        streamed.post({ type: 'finish', jobId: id })
        return
      }
    }
    if (!current()) return
    const { instance, post } = createAggregation(cached!.input.configuredMemberIds)
    // Keep each payload bounded; yield after 4ms of work or at most eight chunks.
    const identityByGame = new Map(
      cached!.input.identities.map((identity) => [identity.gameId, identity])
    )
    let sliceStarted = performance.now(),
      chunksSinceYield = 0
    for (let offset = 0; offset < cached!.input.games.length; offset += 25) {
      if (!current()) return
      const games = cached!.input.games.slice(offset, offset + 25).map(toRaw)
      const gameIds = new Set(games.map((game) => game.gameId))
      post({
        type: 'chunk',
        jobId: id,
        games,
        identities: [...gameIds].flatMap((gameId) => {
          const identity = identityByGame.get(gameId)
          return identity ? [identity] : []
        })
      })
      chunksSinceYield++
      if (
        offset + 25 < cached!.input.games.length &&
        (performance.now() - sliceStarted >= 4 || chunksSinceYield >= 8)
      ) {
        await turn()
        sliceStarted = performance.now()
        chunksSinceYield = 0
      }
    }
    if (current() && worker === instance) {
      finishPosted = true
      post({ type: 'finish', jobId: id })
    }
  } catch {
    if (!current()) return
    worker?.terminate()
    worker = null
    loading.value = false
    result.value = null
    error.value = uiText('versionTrendReadFailed')
  }
}
watch(
  [
    () => props.active,
    () => store.settings?.enabled,
    () => store.settings?.experimentalVersionTrendEnabled,
    () => store.overviewGeneration,
    () => store.overview?.publicationToken,
    configuration,
    () => trendRequestKey(request.value),
    reloadSequence
  ],
  () => void run(),
  { immediate: true }
)
let lastTerminalIdentityJobId: string | null = null
// A failed/cancelled refresh may still have changed the catalog's resolved
// identities. Invalidate once at that terminal transition, never on progress.
watch(
  () => (store.job ? `${store.job.jobId}:${store.job.status}` : ''),
  (terminal, previous) => {
    if (terminal === previous || !store.job || !['failed', 'cancelled'].includes(store.job.status))
      return
    if (store.job.jobId === lastTerminalIdentityJobId) return
    lastTerminalIdentityJobId = store.job.jobId
    invalidateData()
    cancel()
    result.value = null
    reloadSequence.value++
  },
  { flush: 'sync' }
)
onActivated(() => {
  routeActivated = true
  void run()
})
onDeactivated(() => {
  routeActivated = false
  cancel()
  identitySequence++
  pendingIdentities = null
})
onBeforeUnmount(() => {
  cancel()
  invalidateData()
})
</script>
