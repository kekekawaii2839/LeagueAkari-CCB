<template>
  <main class="member-analysis-page" aria-labelledby="member-analysis-title">
    <MemberAnalysisHeader
      :generated-at="store.overview?.generatedAt ?? null"
      :loading="store.loading || jobRunning"
      :refresh-disabled="
        !store.settings?.enabled ||
        store.settings.members.length < 5 ||
        !store.capabilities?.workerAvailable
      "
      @refresh="memberAnalysis.startRefresh"
      @settings="store.settingsDrawerVisible = true"
    />

    <div class="member-analysis-scroll">
      <MemberAnalysisFilters v-if="store.settings?.enabled" />

      <p
        v-if="store.overview && !audit && store.overview.gameCount > 0"
        class="member-analysis-notice"
        role="status"
      >
        {{ uiText('oldData') }}
      </p>

      <section v-if="store.overview" class="member-analysis-context" aria-label="当前分析范围">
        <span>来源 {{ store.overview.source }}</span>

        <strong>当前分析 {{ rendererAudit.sample }} 场</strong>
        <span>版本 {{ patchScope }}</span>
        <span v-if="audit">{{ collectionStatus }}</span>
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

      <NAlert
        v-if="store.job?.status === 'failed'"
        class="member-analysis-audit"
        type="error"
        title="刷新失败，已保留上一版数据"
      >
        {{ friendlyJobError }}
      </NAlert>

      <div class="member-analysis-content">
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
            <NButton type="primary" @click="store.settingsDrawerVisible = true">打开设置</NButton>
          </template>
        </NResult>

        <NResult
          v-else-if="store.viewState === 'first-run'"
          status="info"
          title="尚未生成分析数据"
          description="请先配置固定成员，然后运行首次刷新。刷新可取消，失败时仍保留上一版数据。"
        >
          <template #footer>
            <NButton type="primary" @click="store.settingsDrawerVisible = true">配置成员</NButton>
          </template>
        </NResult>

        <NEmpty
          v-else-if="store.viewState === 'empty'"
          description="当前筛选范围内没有可显示的对局"
        />

        <NAlert v-else-if="store.viewState === 'error'" type="error" title="成员分析暂时不可用">
          {{ store.error?.code }}：{{ store.error?.message }}
        </NAlert>

        <div v-else class="member-analysis-ready">
          <NTabs v-model:value="activeSection" type="line">
            <NTabPane
              v-for="section in sections"
              :key="section.key"
              :name="section.key"
              :tab="section.label"
              display-directive="show:lazy"
            >
              <component :is="section.component" />
            </NTabPane>
          </NTabs>
        </div>
      </div>
    </div>

    <MemberAnalysisSettingsDrawer
      v-if="store.settings"
      v-model:show="store.settingsDrawerVisible"
      :settings="store.settings"
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
import { NAlert, NButton, NEmpty, NProgress, NResult, NSpin, NTabPane, NTabs } from 'naive-ui'
import { computed, ref, watch } from 'vue'
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
import MemberRoleView from './MemberRoleView.vue'
import PairView from './PairView.vue'
import ScatterView from './ScatterView.vue'
import SynergyView from './SynergyView.vue'
import './member-analysis-visuals.css'
import { uiText } from './ui-text'

const sections = [
  { key: 'roles', label: '成员分路', description: '', component: MemberRoleView },
  { key: 'champions', label: '英雄', description: '', component: ChampionView },
  { key: 'pairs', label: '组合', description: '', component: PairView },
  { key: 'jungle', label: '打野', description: '', component: JungleView },
  { key: 'conversion', label: '事件结果', description: '', component: ConversionView },
  { key: 'early', label: '前期与胜负', description: '', component: EarlyConversionView },
  { key: 'synergy', label: '同队偏差', description: '', component: SynergyView },
  { key: 'scatter', label: '指标对比', description: '', component: ScatterView },
  { key: 'matches', label: '对局明细', description: '', component: MatchesView }
] as const

const store = useMemberAnalysisStore()
const memberAnalysis = useInstance(MemberAnalysisRenderer)
const route = useRoute()
const router = useRouter()
const requestedSection = String(route.params.section ?? '')
const activeSection = ref(
  sections.some((section) => section.key === requestedSection) ? requestedSection : 'roles'
)
const savingSettings = ref(false)
const settingsError = ref('')
const cleanupError = ref('')
const cleaning = ref(false)
const jobRunning = computed(() =>
  store.job ? !['completed', 'failed', 'cancelled'].includes(store.job.status) : false
)
const jobProgressLabel = computed(() => {
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
const audit = computed(() => store.overview?.collectionAudit ?? null)
const rendererAudit = computed(() => {
  const selection = selectMemberAnalysisSample(
    store.overview?.games ?? [],
    store.filters,
    store.analysisSide,
    store.sampleSize
  )
  const global = selection.globallyFiltered.length
  const sample = selection.sample.length
  return { global, sample }
})
const patchScope = computed(() => {
  const selection = selectMemberAnalysisSample(
    store.overview?.games ?? [],
    store.filters,
    store.analysisSide,
    store.sampleSize
  ).sample
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
const friendlyJobError = computed(() => {
  const code = store.job?.error?.code
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
  void router.replace({ name: 'member-analysis', params: { section } })
})

watch(
  () => route.params.section,
  (section) => {
    const next = String(section ?? '')
    if (sections.some((candidate) => candidate.key === next)) activeSection.value = next
  }
)

async function saveSettings(settings: Parameters<MemberAnalysisRenderer['updateSettings']>[0]) {
  savingSettings.value = true
  try {
    settingsError.value = ''
    const result = await memberAnalysis.updateSettings(settings)
    if (result.ok) store.settingsDrawerVisible = false
    else settingsError.value = uiText('saveFailed')
  } catch {
    settingsError.value = uiText('saveFailed')
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
