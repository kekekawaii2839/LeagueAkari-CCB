<template>
  <main
    ref="pageRoot"
    class="member-analysis-page"
    :data-active-section="activeSection"
    aria-labelledby="member-analysis-title"
  >
    <MemberAnalysisHeader
      :generated-at="store.overview?.generatedAt ?? null"
      :loading="store.loading || jobRunning"
      :refresh-reason="refreshReason"
      :refresh-disabled="
        !store.settings?.enabled ||
        store.settings.members.length < 5 ||
        !store.capabilities?.workerAvailable
      "
      @refresh="memberAnalysis.startRefresh"
      @settings="openSettings"
    >
      <template #filters>
        <MemberAnalysisFilters
          v-if="store.settings?.enabled"
          :disabled="activeSection === 'prediction' || independentRouteSelected"
          embedded
        />
      </template>
    </MemberAnalysisHeader>

    <div ref="pageScrollOwner" class="member-analysis-scroll" @scroll="rememberPageScroll">
      <p
        v-if="
          !independentRouteSelected &&
          (hasLegacyUnknownMetrics || (store.overview && !audit && store.overview.gameCount > 0))
        "
        class="member-analysis-notice"
        role="status"
      >
        {{ uiText(hasLegacyUnknownMetrics ? 'legacyUnknownMetrics' : 'oldData') }}
      </p>

      <div v-if="store.job && jobRunning" class="member-analysis-job">
        <NProgress
          type="line"
          :percentage="Math.round(store.job.progress * 100)"
          :show-indicator="false"
        />
        <span>{{ jobProgressLabel }}</span>
        <NButton size="tiny" @click="memberAnalysis.cancelRefresh">取消</NButton>
      </div>

      <div
        v-if="
          hasPublishedOverview && jobFailureNotice && dismissedJobFailure !== jobFailureNotice.key
        "
        :key="`job-failure-${jobFailureNotice.key}`"
        class="member-analysis-failure member-analysis-failure-job"
        role="status"
      >
        <span class="member-analysis-failure-copy">
          <NIcon class="member-analysis-failure-icon" :size="16" aria-hidden="true"
            ><ErrorIcon
          /></NIcon>
          <span
            tabindex="0"
            :title="friendlyJobError"
            :aria-label="`${uiText('overviewReloadFailed')}。${friendlyJobError}`"
            >{{ uiText('overviewReloadFailed') }}</span
          >
        </span>
        <span class="member-analysis-failure-actions">
          <NButton
            size="tiny"
            quaternary
            :disabled="store.loading || jobRunning || !!refreshReason"
            :title="refreshReason?.text"
            @click="memberAnalysis.startRefresh()"
            >{{ uiText('retry') }}</NButton
          >
          <NButton size="tiny" quaternary aria-label="关闭提示" @click="jobFailureNotice.close"
            ><template #icon
              ><NIcon><CloseIcon /></NIcon></template
          ></NButton>
        </span>
      </div>
      <NAlert
        v-if="jobFailureNotice && !hasPublishedOverview"
        :key="`job-failure-${jobFailureNotice.key}`"
        class="member-analysis-audit"
        type="error"
        :title="uiText('jobRefreshFailed')"
      >
        {{ friendlyJobError }}
      </NAlert>

      <div class="member-analysis-content">
        <p
          v-if="hasPublishedOverview && store.loading"
          class="member-analysis-notice"
          role="status"
        >
          {{ uiText('overviewReloading') }}
        </p>
        <div
          v-else-if="
            hasPublishedOverview &&
            errorFailureNotice &&
            dismissedErrorFailure !== errorFailureNotice.key
          "
          :key="`overview-failure-${errorFailureNotice.key}`"
          class="member-analysis-failure"
          role="status"
        >
          <span class="member-analysis-failure-copy">
            <NIcon class="member-analysis-failure-icon" :size="16" aria-hidden="true"
              ><ErrorIcon
            /></NIcon>
            <span
              tabindex="0"
              :title="unavailableMessage"
              :aria-label="`${uiText('overviewReloadFailed')}。${unavailableMessage}`"
              >{{ uiText('overviewReloadFailed') }}</span
            >
          </span>
          <span class="member-analysis-failure-actions">
            <NButton size="tiny" quaternary @click="memberAnalysis.reload()">{{
              uiText('retry')
            }}</NButton>
            <NButton size="tiny" quaternary aria-label="关闭提示" @click="errorFailureNotice.close"
              ><template #icon
                ><NIcon><CloseIcon /></NIcon></template
            ></NButton>
          </span>
        </div>
        <p
          v-else-if="
            hasPublishedOverview &&
            !store.error &&
            store.job?.status !== 'failed' &&
            overviewReloaded &&
            dismissedOverviewSuccess !== overviewSuccessNotice.key
          "
          class="member-analysis-notice member-analysis-success"
          role="status"
        >
          <span>{{ uiText('overviewReloaded') }}</span>
          <NButton size="tiny" quaternary aria-label="关闭提示" @click="overviewSuccessNotice.close"
            ><template #icon
              ><NIcon><CloseIcon /></NIcon></template
          ></NButton>
        </p>
        <template v-if="!independentPageSelected">
          <div v-if="store.viewState === 'loading'" class="member-analysis-centered">
            <NSpin size="large" description="正在初始化成员分析" />
          </div>

          <NResult
            v-else-if="store.viewState === 'feature-disabled'"
            status="info"
            title="成员分析已关闭"
            description="在设置中重新启用后，才能更新和查看成员分析。"
          >
            <template #footer>
              <NButton type="primary" @click="openSettings()">打开设置</NButton>
            </template>
          </NResult>

          <NResult
            v-else-if="store.viewState === 'first-run'"
            status="info"
            title="尚未生成分析数据"
            :description="uiText('firstRunHelp')"
          >
            <template #footer>
              <NButton type="primary" @click="openSettings('members')">配置成员</NButton>
            </template>
          </NResult>

          <NEmpty
            v-else-if="store.viewState === 'empty'"
            description="当前筛选范围内没有可显示的对局"
          />

          <NAlert v-else-if="store.viewState === 'error'" type="error" title="成员分析暂时不可用">
            {{ unavailableMessage }}
            <NButton secondary @click="memberAnalysis.reload()">{{ uiText('retry') }}</NButton>
          </NAlert>
        </template>

        <NEmpty
          v-if="lpPageSelected && store.settings?.experimentalLpTrendEnabled !== true"
          :description="uiText('lpTrendClosed')"
        >
          <template #extra
            ><NButton secondary @click="openSettings()">{{
              uiText('openSettings')
            }}</NButton></template
          >
        </NEmpty>

        <NEmpty
          v-if="versionPageSelected && store.settings?.experimentalVersionTrendEnabled !== true"
          :description="uiText('versionTrendClosed')"
        >
          <template #extra
            ><NButton secondary @click="openSettings()">{{
              uiText('openSettings')
            }}</NButton></template
          >
        </NEmpty>

        <div
          v-if="renderAnalysisTabs"
          ref="primaryPanels"
          class="member-analysis-ready"
          @click.capture="primaryMotion.capture"
        >
          <NTabs :value="primarySection" type="line" @update:value="selectPrimarySection">
            <NTabPane
              v-for="section in sections"
              :key="section.key"
              :name="section.key"
              :tab="section.label"
              :tab-props="primaryTabProps(section.key)"
              :style="section.key === 'champions' ? { paddingTop: '0' } : undefined"
              display-directive="show:lazy"
            >
              <div
                :data-member-pane="section.key"
                :id="`${primaryTabId}-panel-${section.key}`"
                role="tabpanel"
                :aria-labelledby="`${primaryTabId}-${section.key}`"
                style="min-width: 0"
              >
                <LpTrendView v-if="section.key === 'lp-trend'" :active="lpPageSelected" />
                <VersionTrendPanel
                  v-else-if="section.key === 'version-trend'"
                  :active="versionPageSelected"
                />
                <template v-else-if="store.viewState === 'ready'">
                  <CombinationView
                    v-if="section.key === 'pairs'"
                    :view="combinationSection"
                    :context-note="collectionStatus"
                    @update:view="activateCombination"
                  />
                  <MatchesView
                    v-else-if="section.key === 'matches'"
                    :active="primarySection === 'matches'"
                  />
                  <WinPrediction
                    v-else-if="section.key === 'prediction'"
                    :active="primarySection === 'prediction'"
                  />
                  <MemberRoleView
                    v-else-if="section.key === 'roles'"
                    :active="primarySection === 'roles'"
                  />
                  <ScatterView
                    v-else-if="section.key === 'scatter'"
                    :active="primarySection === 'scatter'"
                  />
                  <component v-else :is="section.component" />
                </template>
              </div>
            </NTabPane>
          </NTabs>
        </div>
      </div>
    </div>

    <MemberAnalysisSettingsDrawer
      v-if="store.settings"
      v-model:show="store.settingsDrawerVisible"
      :settings="store.settings"
      :focus-section="store.settingsFocus"
      :saving="savingSettings"
      :save-error="settingsError"
      :cleanup-error="cleanupError"
      :storage-status="store.storageStatus"
      :cleanup-preview="store.cleanupPreview"
      :cleaning="cleaning"
      @save="saveSettings"
      @preview-cleanup="previewCleanup"
      @confirm-cleanup="confirmCleanup"
    />
  </main>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { useMediaQuery } from '@vueuse/core'
import { Close as CloseIcon, ErrorFilled as ErrorIcon } from '@vicons/carbon'
import {
  NAlert,
  NButton,
  NEmpty,
  NIcon,
  NProgress,
  NResult,
  NSpin,
  NTabPane,
  NTabs
} from 'naive-ui'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  useId,
  watch
} from 'vue'
import type { HTMLAttributes } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { selectMemberAnalysisSample } from './analytics'

import MemberAnalysisFilters from './MemberAnalysisFilters.vue'
import MemberAnalysisHeader from './MemberAnalysisHeader.vue'
import MemberAnalysisSettingsDrawer from './MemberAnalysisSettingsDrawer.vue'
import ChampionView from './ChampionView.vue'
import ConversionView from './ConversionView.vue'
import EarlyConversionView from './EarlyConversionView.vue'
import JungleView from './JungleView.vue'
import MatchesView from './MatchesView.vue'
import OpponentRanksView from './opponent-ranks/OpponentRanksView.vue'
import MemberRoleView from './MemberRoleView.vue'
import CombinationView from './CombinationView.vue'
import ScatterView from './ScatterView.vue'
import { WinPrediction } from './prediction'
import LpTrendView from './lp-trend/LpTrendView.vue'
import VersionTrendPanel from './version-trend/VersionTrendPanel.vue'
import './member-analysis-visuals.css'
import './member-analysis-scrollbars.css'
import { observeTableScrollbarInsets } from './table-scrollbar-inset'
import { uiText } from './ui-text'
import { createPrimaryTabMotion } from './primary-tab-motion'
import { observeNavigationScrollbarInset } from './navigation-scrollbar-inset'

const allSections = [
  { key: 'roles', label: '成员分路', description: '', component: MemberRoleView },
  { key: 'champions', label: '英雄池', description: '', component: ChampionView },
  { key: 'pairs', label: '组合分析', description: '', component: CombinationView },
  { key: 'jungle', label: '打野分析', description: '', component: JungleView },
  { key: 'conversion', label: '事件结果', description: '', component: ConversionView },
  { key: 'early', label: '前期与胜负', description: '', component: EarlyConversionView },
  { key: 'scatter', label: '指标对比', description: '', component: ScatterView },
  { key: 'prediction', label: '阵容胜率预测', description: '', component: WinPrediction },
  {
    key: 'version-trend',
    label: uiText('versionTrendTab'),
    description: '',
    component: VersionTrendPanel
  },
  { key: 'lp-trend', label: uiText('lpTrendTab'), description: '', component: LpTrendView },
  {
    key: 'opponent-ranks',
    label: uiText('rankTabTitle'),
    description: '',
    component: OpponentRanksView
  },
  { key: 'matches', label: '对局列表', description: '', component: MatchesView }
] as const

const store = useMemberAnalysisStore()
const sections = computed(() =>
  allSections.filter(
    (section) =>
      (section.key !== 'prediction' || store.settings?.experimentalPredictionEnabled === true) &&
      (section.key !== 'lp-trend' || store.settings?.experimentalLpTrendEnabled === true) &&
      (section.key !== 'version-trend' || store.settings?.experimentalVersionTrendEnabled === true)
  )
)
const memberAnalysis = useInstance(MemberAnalysisRenderer)
const route = useRoute()
const router = useRouter()
const requestedSection = String(route.params.section ?? '')
const isKnownSection = (section: string) =>
  section === 'synergy' ||
  section === 'lp-trend' ||
  section === 'version-trend' ||
  sections.value.some((candidate) => candidate.key === section)
const activeSection = ref(isKnownSection(requestedSection) ? requestedSection : 'roles')
const combinationSection = ref<'pairs' | 'synergy'>(
  activeSection.value === 'synergy' ? 'synergy' : 'pairs'
)
const primarySection = computed({
  get: () => (activeSection.value === 'synergy' ? 'pairs' : activeSection.value),
  set: (section: string) => {
    activeSection.value = section === 'pairs' ? combinationSection.value : section
  }
})
const primaryPanels = ref<HTMLElement | null>(null)
const pageScrollOwner = ref<HTMLElement | null>(null)
const pageRoot = ref<HTMLElement | null>(null)
let tableScrollbarRoot: HTMLElement | null = null
let stopTableScrollbars: (() => void) | undefined
function startTableScrollbars() {
  if (!pageRoot.value || tableScrollbarRoot === pageRoot.value) return
  stopTableScrollbars?.()
  tableScrollbarRoot = pageRoot.value
  stopTableScrollbars = observeTableScrollbarInsets(pageRoot.value)
}
function stopTableScrollbarObservation() {
  stopTableScrollbars?.()
  stopTableScrollbars = undefined
  tableScrollbarRoot = null
}
watch(pageRoot, startTableScrollbars, { flush: 'post' })
onActivated(startTableScrollbars)
onDeactivated(stopTableScrollbarObservation)
onBeforeUnmount(stopTableScrollbarObservation)
const primaryTabId = useId()
function primaryTabProps(section: string): HTMLAttributes {
  return {
    id: `${primaryTabId}-${section}`,
    role: 'tab',
    tabindex: primarySection.value === section ? 0 : -1,
    'aria-selected': primarySection.value === section,
    'aria-controls': `${primaryTabId}-panel-${section}`,
    onKeydown: (event: KeyboardEvent) => void handlePrimaryTabKey(event, section)
  }
}
async function handlePrimaryTabKey(event: KeyboardEvent, section: string) {
  const keys = sections.value.map((item) => item.key as string)
  const index = keys.indexOf(section)
  let target: string | undefined
  if (event.key === 'ArrowRight') target = keys[(index + 1) % keys.length]
  else if (event.key === 'ArrowLeft') target = keys[(index - 1 + keys.length) % keys.length]
  else if (event.key === 'Home') target = keys[0]
  else if (event.key === 'End') target = keys.at(-1)
  else if (event.key === 'Enter' || event.key === ' ') target = section
  else return
  if (!target) return
  event.preventDefault()
  selectPrimarySection(target)
  await nextTick()
  const tab = primaryPanels.value?.querySelector<HTMLElement>(`[id="${primaryTabId}-${target}"]`)
  tab?.focus({ preventScroll: true })
  // NTabs follows its active value with its own horizontal XScroll. Calling
  // scrollIntoView here also scrolls the shared vertical owner (including its
  // sticky-nav scroll padding), overwriting the destination's saved position.
}
watch(
  primaryPanels,
  (panels, _previous, onCleanup) => {
    if (!panels || typeof panels.querySelector !== 'function') return
    const navigation = panels?.querySelector<HTMLElement>('.n-tabs-nav')
    const owner = pageScrollOwner.value
    if (!navigation || !owner || typeof ResizeObserver === 'undefined') return
    navigation.setAttribute('role', 'tablist')
    navigation.setAttribute('aria-label', '成员分析页面')
    onCleanup(observeNavigationScrollbarInset(owner, navigation))
  },
  { flush: 'post' }
)
const pageScrollPositions = new Map<string, number>()
let scrollTransition = 0
let restoringPageScroll = false
let scrollRestoreFrame = 0
let restoreScrollAnchoring: (() => void) | null = null
function scheduleScrollFrame(callback: () => void) {
  if (typeof requestAnimationFrame === 'undefined') callback()
  else scrollRestoreFrame = requestAnimationFrame(callback)
}
function cancelPageScrollRestore() {
  scrollTransition++
  if (scrollRestoreFrame && typeof cancelAnimationFrame !== 'undefined')
    cancelAnimationFrame(scrollRestoreFrame)
  scrollRestoreFrame = 0
  restoreScrollAnchoring?.()
  restoreScrollAnchoring = null
  restoringPageScroll = false
}
function rememberPageScroll() {
  if (!restoringPageScroll && pageScrollOwner.value)
    pageScrollPositions.set(activeSection.value, pageScrollOwner.value.scrollTop)
}
watch(
  activeSection,
  async (section, previous) => {
    const owner = pageScrollOwner.value
    if (!owner) return
    if (!restoringPageScroll) pageScrollPositions.set(previous, owner.scrollTop)
    cancelPageScrollRestore()
    restoringPageScroll = true
    const transition = scrollTransition
    // A lazy pane can briefly retain the shorter outgoing pane's extent after
    // the parent update. Do not save that clamp as the incoming page's position.
    // Browser anchoring must not compete with this explicit tab restoration.
    if (owner.style) {
      const anchoring = owner.style.overflowAnchor
      owner.style.overflowAnchor = 'none'
      restoreScrollAnchoring = () => {
        owner.style.overflowAnchor = anchoring
      }
    }
    await nextTick()
    if (transition !== scrollTransition) return
    scheduleScrollFrame(() => {
      scrollRestoreFrame = 0
      if (transition !== scrollTransition) return
      if (!(section === 'matches' && store.matchNavigation))
        owner.scrollTop = pageScrollPositions.get(section) ?? 0
      // Keep intermediate programmatic scroll events out of the memory map
      // until the restored layout has passed a rendering frame.
      scheduleScrollFrame(() => {
        scrollRestoreFrame = 0
        if (transition !== scrollTransition) return
        restoreScrollAnchoring?.()
        restoreScrollAnchoring = null
        restoringPageScroll = false
      })
    })
  },
  { flush: 'sync' }
)
onDeactivated(cancelPageScrollRestore)
onBeforeUnmount(cancelPageScrollRestore)
const lpRouteSelected = computed(() => primarySection.value === 'lp-trend')
const versionRouteSelected = computed(() => primarySection.value === 'version-trend')
const versionPageSelected = computed(
  () => versionRouteSelected.value && store.settings?.enabled === true
)
const independentRouteSelected = computed(() => lpRouteSelected.value || versionRouteSelected.value)
const independentPageSelected = computed(() => lpPageSelected.value || versionPageSelected.value)
const lpPageSelected = computed(() => lpRouteSelected.value && store.settings?.enabled === true)
const renderAnalysisTabs = computed(
  () =>
    store.viewState === 'ready' ||
    (store.settings?.enabled === true &&
      (store.settings.experimentalLpTrendEnabled === true ||
        store.settings.experimentalVersionTrendEnabled === true))
)
const reducedTabMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const primaryMotion = createPrimaryTabMotion({
  root: () => primaryPanels.value,
  active: () => primarySection.value,
  reduced: () => reducedTabMotion.value,
  rendered: () => nextTick()
})
function selectPrimarySection(section: string | number) {
  if (typeof section !== 'string') return
  primarySection.value = section
  void primaryMotion.enter(section)
}
watch(reducedTabMotion, () => primaryMotion.cancel())
watch(
  () => store.viewState,
  () => primaryMotion.cancel()
)
onDeactivated(() => primaryMotion.cancel())
onBeforeUnmount(() => primaryMotion.cancel())
watch(
  () => store.matchNavigation,
  (request) => {
    if (!request) return
    primaryMotion.cancel()
    activeSection.value = 'matches'
  },
  { flush: 'sync' }
)
watch(
  () => store.matchListScope?.sequence,
  (sequence) => {
    if (!sequence || store.matchListScope?.status !== 'active') return
    primaryMotion.cancel()
    activeSection.value = 'matches'
  },
  { flush: 'sync' }
)
watch(activeSection, (section) => {
  if (section !== 'matches') store.cancelMatchNavigation()
})
watch(
  [
    () => store.overview,
    () => JSON.stringify([store.filters, store.sampleSize, store.analysisSide])
  ],
  () => {
    if (!store.matchNavigation) return
    const gameId = store.matchNavigation.gameId
    const overviewGames = store.overview?.games ?? []
    const sample = selectMemberAnalysisSample(
      overviewGames,
      store.filters,
      store.analysisSide,
      store.sampleSize
    ).sample
    if (
      overviewGames.filter((game) => game.gameId === gameId).length === 1 &&
      sample.some((game) => game.gameId === gameId)
    )
      return
    store.cancelMatchNavigation()
    store.matchNavigationFeedback = uiText('matchNavigationScopeChanged')
  },
  { flush: 'sync' }
)
onDeactivated(() => store.cancelMatchNavigation())
onBeforeUnmount(() => store.cancelMatchNavigation())
function activateCombination(section: 'pairs' | 'synergy') {
  combinationSection.value = section
  activeSection.value = section
}
const savingSettings = ref(false)
const settingsError = ref('')
const cleanupError = ref('')
const cleaning = ref(false)
const jobRunning = computed(() =>
  store.job ? !['completed', 'failed', 'cancelled'].includes(store.job.status) : false
)
const jobProgressLabel = computed(() => {
  if (store.job?.status === 'collecting' && store.job.message.startsWith('opponent-ranks '))
    return '正在获取对手当前段位'
  const labels = {
    starting: '正在准备刷新',
    collecting: '正在读取对局历史',
    indexing: '正在整理本地数据',
    analyzing: '正在生成分析结果',
    publishing: '正在保存分析结果',
    completed: '刷新完成',
    failed: '刷新失败',
    cancelled: '刷新已取消',
    idle: '等待刷新'
  } as const
  return store.job ? labels[store.job.status] : ''
})
const refreshReason = computed(() => {
  if (store.loading || jobRunning.value) return null
  if (!store.settings?.enabled)
    return { kind: 'closed' as const, text: uiText('refreshDisabledClosed') }
  if (store.settings.members.length < 5)
    return {
      kind: 'members' as const,
      text: uiText('refreshDisabledMembers', { count: store.settings.members.length })
    }
  if (!store.capabilities?.workerAvailable)
    return { kind: 'service' as const, text: uiText('refreshDisabledService') }
  return null
})
function openSettings(section: 'collection' | 'members' | null = null) {
  store.settingsFocus = section
  store.settingsDrawerVisible = true
}
const audit = computed(() => store.overview?.collectionAudit ?? null)
const hasLegacyUnknownMetrics = computed(
  () => store.overview?.games.some((game) => game.metricSemantics === 'legacy-unknown') ?? false
)
const hasPublishedOverview = computed(
  () => store.viewState === 'ready' || store.viewState === 'empty'
)
const jobFailureEpoch = ref(0)
const dismissedJobFailure = ref<number | null>(null)
watch(
  [() => store.job?.jobId, () => store.job?.status],
  ([id, status], previous) => {
    if (status === 'failed' && (previous?.[1] !== 'failed' || id !== previous?.[0]))
      jobFailureEpoch.value++
  },
  { immediate: true, flush: 'sync' }
)
const jobFailureNotice = computed(() => {
  if (store.job?.status !== 'failed') return null
  const id = store.job.jobId
  const key = jobFailureEpoch.value
  return {
    key,
    close: () => {
      if (
        hasPublishedOverview.value &&
        store.job?.status === 'failed' &&
        store.job.jobId === id &&
        jobFailureEpoch.value === key
      )
        dismissedJobFailure.value = key
      // Parent-owned dismissal must not leave NAlert internally hidden when
      // a newer failure replaces this one in the same render tick.
      return false
    }
  }
})
const errorFailureEpoch = ref(0)
const dismissedErrorFailure = ref<number | null>(null)
watch(
  () => store.error,
  (error) => {
    if (error) errorFailureEpoch.value++
  },
  { immediate: true, flush: 'sync' }
)
watch(
  () => store.loading,
  (loading) => {
    if (loading) errorFailureEpoch.value++
  },
  { flush: 'sync' }
)
const errorFailureNotice = computed(() => {
  if (!store.error) return null
  const error = store.error
  const key = errorFailureEpoch.value
  return {
    key,
    close: () => {
      if (hasPublishedOverview.value && store.error === error && errorFailureEpoch.value === key)
        dismissedErrorFailure.value = key
      return false
    }
  }
})
const overviewReloaded = ref(false)
const overviewSuccessEpoch = ref(0)
const dismissedOverviewSuccess = ref<number | null>(null)
const overviewSuccessNotice = computed(() => {
  const key = overviewSuccessEpoch.value
  return {
    key,
    close: () => {
      if (overviewReloaded.value && overviewSuccessEpoch.value === key)
        dismissedOverviewSuccess.value = key
    }
  }
})
watch(
  () => store.loading,
  (loading) => {
    if (loading) overviewReloaded.value = false
  }
)
watch(
  () => store.overview,
  (overview, previous) => {
    // Reading the same published generation after saving settings is not a
    // new collection. Do not label an unchanged publication as updated data.
    overviewReloaded.value = Boolean(
      overview &&
      previous &&
      (overview.generatedAt !== previous.generatedAt ||
        overview.gameCount !== previous.gameCount ||
        overview.playerCount !== previous.playerCount ||
        overview.source !== previous.source)
    )
    // Only a genuinely changed publication creates a new dismissible notice.
    // Re-reading the same generation cannot revive a manually dismissed notice.
    if (overviewReloaded.value) overviewSuccessEpoch.value++
  }
)
const collectionStatus = computed(() => {
  if (!audit.value) return ''
  const labels = {
    'target-reached': '已达到目标样本',
    'source-exhausted': '历史记录已读完',
    'safety-limit': '已达到扫描上限'
  } as const
  return labels[audit.value.collectionStopReason]
})
const unavailableMessage = computed(() => {
  const keys = {
    FEATURE_DISABLED: 'errorDisabled',
    NOT_INITIALIZED: 'errorInitializing',
    INVALID_ARGUMENT: 'errorSettings',
    WORKER_UNAVAILABLE: 'errorAnalysisUnavailable',
    JOB_ALREADY_RUNNING: 'errorJobRunning',
    JOB_NOT_FOUND: 'errorJobMissing',
    CANCELLED: 'errorCancelled',
    INTERNAL_ERROR: 'errorUnavailable'
  } as const
  return uiText(keys[store.error?.code ?? 'INTERNAL_ERROR'])
})
const friendlyJobError = computed(() => {
  const code = store.job?.error?.code
  if (code === 'SUMMARY_STAT_UNAVAILABLE') return uiText('missingRequiredSummary')
  if (code === 'PIPELINE_FAILED') {
    const unresolved = Number(
      /failed to resolve (\d+)/i.exec(store.job?.error?.message ?? '')?.[1] ?? 0
    )
    return unresolved && unresolved > 0
      ? `${unresolved} 名成员身份无法解析，请检查服务器与 Riot ID。`
      : '刷新未能完成，请检查成员、服务器和网络状态后重试。'
  }
  if (code === 'CANCELLED') return '刷新已取消，现有数据没有变化。'
  return '刷新未能完成，请稍后重试；现有数据没有变化。'
})

watch(activeSection, (section) => {
  if (section === 'pairs' || section === 'synergy') combinationSection.value = section
  void router.replace({ name: 'member-analysis', params: { section } })
})

watch(
  [
    () => route.params.section,
    () => store.settings?.experimentalPredictionEnabled,
    () => store.loading
  ],
  ([section]) => {
    // Wait for persisted settings before rejecting an opted-in prediction deep link.
    if (store.loading) return
    const next = String(section ?? '')
    if (next === 'prediction' && store.settings?.experimentalPredictionEnabled !== true) {
      primaryMotion.cancel()
      activeSection.value = 'roles'
      void router.replace({ name: 'member-analysis', params: { section: 'roles' } })
    } else if (isKnownSection(next) && activeSection.value !== next) {
      primaryMotion.cancel()
      activeSection.value = next
    }
  },
  { immediate: true }
)

async function saveSettings(
  settings: Parameters<MemberAnalysisRenderer['updateSettings']>[0],
  complete: (saved: NonNullable<typeof store.settings> | null) => void
) {
  if (savingSettings.value) {
    complete(null)
    return
  }
  savingSettings.value = true
  try {
    settingsError.value = ''
    const result = await memberAnalysis.updateSettings(settings)
    if (result.ok) complete(result.value)
    else {
      settingsError.value = uiText('saveFailed')
      complete(null)
    }
  } catch {
    settingsError.value = uiText('saveFailed')
    complete(null)
  } finally {
    savingSettings.value = false
  }
}

async function previewCleanup() {
  cleaning.value = true
  try {
    cleanupError.value = ''
    const result = await memberAnalysis.previewCleanup()
    if (!result.ok) cleanupError.value = uiText('cleanupPreviewFailed')
  } catch {
    cleanupError.value = uiText('cleanupPreviewFailed')
  } finally {
    cleaning.value = false
  }
}

async function confirmCleanup(previewId: string) {
  cleaning.value = true
  try {
    cleanupError.value = ''
    const result = await memberAnalysis.confirmCleanup(previewId)
    if (!result.ok) cleanupError.value = uiText('cleanupFailed')
  } catch {
    cleanupError.value = uiText('cleanupFailed')
  } finally {
    cleaning.value = false
  }
}
</script>

<style scoped>
.member-analysis-page {
  position: relative;
  display: flex;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
  color: var(--la-color-text-primary);
}

/* Only the active Scatter workspace needs a definite-height tab chain.
   Other pages retain their existing shared scroll owner and restoration. */
.member-analysis-page[data-active-section='scatter'] .member-analysis-scroll {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.member-analysis-page[data-active-section='scatter'] .member-analysis-content {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
}
.member-analysis-page[data-active-section='scatter'] .member-analysis-ready {
  display: flex;
  flex: 1 1 0;
  min-height: 0;
}
.member-analysis-page[data-active-section='scatter'] .member-analysis-ready > :deep(.n-tabs) {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
}
.member-analysis-page[data-active-section='scatter']
  .member-analysis-ready
  > :deep(.n-tabs > .n-tabs-nav) {
  flex: none;
}
.member-analysis-page[data-active-section='scatter']
  .member-analysis-ready
  > :deep(.n-tabs > .n-tab-pane) {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  box-sizing: border-box;
}
.member-analysis-page[data-active-section='scatter']
  .member-analysis-ready
  > :deep(.n-tabs > .n-tab-pane > [data-member-pane='scatter']) {
  display: flex;
  flex-direction: column;
  flex: 1 1 0;
  min-height: 0;
  padding-bottom: 8px;
  box-sizing: border-box;
}

.member-analysis-scroll {
  scroll-padding-top: 60px;
  min-height: 0;
  overflow: auto;
  flex: 1;
}
.member-analysis-scroll::-webkit-scrollbar-track:vertical {
  margin-top: var(--member-navigation-scrollbar-inset, 60px);
}
.member-analysis-notice {
  margin: 8px 20px;
  padding: 8px 12px;
  border-left: 3px solid var(--ma-series-3);
  background: var(--ma-grid);
  color: var(--la-color-text-primary);
  font-size: 12px;
}
.member-analysis-success {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.member-analysis-success > :deep(.n-button) {
  flex-shrink: 0;
}
.member-analysis-content {
  min-width: 0;
  flex: 1;
  padding: 0 20px 24px;
}

.member-analysis-job {
  display: grid;
  grid-template-columns: minmax(120px, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 8px 24px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.12);
  font-size: 12px;
}

.member-analysis-audit {
  margin: 10px 24px 0;
}

.member-analysis-failure {
  display: flex;
  box-sizing: border-box;
  min-width: 0;
  min-height: 36px;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 4px 12px;
  border: 1px solid color-mix(in srgb, var(--ma-red) 14%, var(--la-color-bg-primary));
  border-radius: 3px;
  background: color-mix(in srgb, var(--ma-red) 16%, var(--la-color-bg-primary));
  font-size: 14px;
  font-family: inherit;
  font-weight: 400;
  line-height: 1.5;
}
.member-analysis-failure-job {
  margin: 0 20px;
}
.member-analysis-failure-copy {
  display: flex;
  min-width: 0;
  flex: 1 1 300px;
  align-items: center;
  gap: 8px;
  overflow-wrap: anywhere;
}
.member-analysis-failure-icon {
  flex: 0 0 auto;
  color: var(--ma-red);
}
.member-analysis-failure-copy > span:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.member-analysis-failure-copy > span {
  cursor: help;
}
.member-analysis-failure-actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.member-analysis-failure-actions :deep(.n-button) {
  min-width: 24px;
  height: 24px;
}

.member-analysis-context {
  display: flex;
  min-height: 36px;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 18px;
  padding: 0 24px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.12);
  color: color-mix(in srgb, var(--la-color-text-primary) 62%, transparent);
  font-size: 12px;
}
.member-analysis-context strong {
  color: var(--la-color-text-primary);
  font-weight: 500;
}

.member-analysis-content > :deep(.n-result),
.member-analysis-content > :deep(.n-empty),
.member-analysis-content > :deep(.n-alert) {
  max-width: 760px;
  margin: 56px auto 0;
}

.member-analysis-centered {
  display: grid;
  min-height: 280px;
  place-items: center;
}

.member-analysis-ready {
  min-width: 0;
  min-height: 360px;
  padding: 0;
}

.member-analysis-ready :deep(.n-tabs-nav) {
  position: sticky;
  z-index: 5;
  top: 0;
  padding-top: 8px;
  background: var(--la-color-bg-primary);
}

/* Naive UI clips tab panes by default, which prevents view-local sticky controls
   from using member-analysis-content as their scroll container. */
.member-analysis-ready :deep(.n-tabs-pane-wrapper) {
  overflow: visible;
}

@media (max-width: 760px) {
  .member-analysis-failure-job {
    margin: 0 16px;
  }
  .member-analysis-content {
    padding: 0 16px 16px;
  }

  .member-analysis-context {
    padding: 8px 16px;
  }
}

@media (max-height: 680px) {
  .member-analysis-context {
    min-height: 28px;
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .member-analysis-ready :deep(.n-tabs-nav) {
    padding-top: 0;
  }
  .member-analysis-content > :deep(.n-result),
  .member-analysis-content > :deep(.n-empty),
  .member-analysis-content > :deep(.n-alert) {
    margin-top: 20px;
  }
}
</style>
