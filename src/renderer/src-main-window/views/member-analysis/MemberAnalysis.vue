<template>
  <main class="member-analysis-page" aria-labelledby="member-analysis-title">
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
    />

    <div class="member-analysis-scroll">
      <MemberAnalysisFilters
        v-if="store.settings?.enabled"
        :disabled="activeSection === 'prediction'"
        :compact="(primarySection === 'pairs' || primarySection === 'jungle') && compactHeight"
      />

      <p
        v-if="hasLegacyUnknownMetrics || (store.overview && !audit && store.overview.gameCount > 0)"
        class="member-analysis-notice"
        role="status"
      >
        {{ uiText(hasLegacyUnknownMetrics ? 'legacyUnknownMetrics' : 'oldData') }}
      </p>

      <section v-if="store.overview" class="member-analysis-context" aria-label="当前分析范围">
        <span>来源 {{ store.overview.source }}</span>

        <strong>复盘范围 {{ rendererAudit.sample }} 场</strong>
        <span>固定排除不足 15 分钟对局</span>
        <span>版本 {{ patchScope }}</span>
        <span v-if="audit && !(primarySection === 'pairs' && compactHeight)">{{
          collectionStatus
        }}</span>
      </section>

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
            overviewReloaded
          "
          class="member-analysis-notice"
          role="status"
        >
          {{ uiText('overviewReloaded') }}
        </p>
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

        <div
          v-else
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
              display-directive="show:lazy"
            >
              <div :data-member-pane="section.key" style="min-width: 0">
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
                <component v-else :is="section.component" />
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
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { selectMemberAnalysisSample } from './analytics'
import { useMemberAnalysisData } from './useMemberAnalysisData'

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
import './member-analysis-visuals.css'
import { uiText } from './ui-text'
import { createPrimaryTabMotion } from './primary-tab-motion'

const allSections = [
  { key: 'roles', label: '成员分路', description: '', component: MemberRoleView },
  { key: 'champions', label: '英雄', description: '', component: ChampionView },
  { key: 'pairs', label: '组合', description: '', component: CombinationView },
  { key: 'jungle', label: '打野', description: '', component: JungleView },
  { key: 'conversion', label: '事件结果', description: '', component: ConversionView },
  { key: 'early', label: '前期与胜负', description: '', component: EarlyConversionView },
  { key: 'scatter', label: '指标对比', description: '', component: ScatterView },
  { key: 'prediction', label: '阵容胜率预测', description: '', component: WinPrediction },
  {
    key: 'opponent-ranks',
    label: uiText('rankTabTitle'),
    description: '',
    component: OpponentRanksView
  },
  { key: 'matches', label: '对局列表', description: '', component: MatchesView }
] as const

const store = useMemberAnalysisStore()
const { selection: analysisSelection } = useMemberAnalysisData()
const sections = computed(() =>
  allSections.filter(
    (section) =>
      section.key !== 'prediction' || store.settings?.experimentalPredictionEnabled === true
  )
)
const memberAnalysis = useInstance(MemberAnalysisRenderer)
const route = useRoute()
const router = useRouter()
const requestedSection = String(route.params.section ?? '')
const compactHeight = useMediaQuery('(max-height: 600px)')
const isKnownSection = (section: string) =>
  section === 'synergy' || sections.value.some((candidate) => candidate.key === section)
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
  }
)
const rendererAudit = computed(() => {
  const selection = analysisSelection.value
  const global = selection.globallyFiltered.length
  const sample = selection.sample.length
  return { global, sample }
})
const patchScope = computed(() => {
  const selection = analysisSelection.value.sample
  const patches = [...new Set(selection.map((game) => game.patch))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
  if (!patches.length) return '—'
  return patches.length === 1 ? patches[0] : `${patches[0]}–${patches.at(-1)}`
})
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

.member-analysis-scroll {
  scroll-padding-top: 60px;
  min-height: 0;
  overflow: auto;
  flex: 1;
}
.member-analysis-notice {
  margin: 8px 20px;
  padding: 8px 12px;
  border-left: 3px solid var(--ma-series-3);
  background: var(--ma-grid);
  color: var(--la-color-text-primary);
  font-size: 12px;
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
