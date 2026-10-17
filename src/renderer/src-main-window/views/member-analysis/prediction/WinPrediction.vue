<template>
  <section class="ma-panel ma-workspace win-prediction" :aria-label="uiText('predictionPageLabel')">
    <div class="prediction-workbench">
      <section class="prediction-configuration">
        <header class="prediction-section-heading">
          <h3>{{ uiText('predictionConfiguration') }}</h3>
          <MetricHelp
            :label="uiText('predictionScopeHelp')"
            :definition="
              [uiText('predictionEntertainmentMethod'), uiText('predictionContinuesAway')].join(' ')
            "
            icon-only
          />
        </header>
        <div class="lineup-inputs" role="group" :aria-label="uiText('predictionLineupLabel')">
          <label v-for="option in roleOptions" :key="option.value">
            <span class="prediction-role-label"
              ><PositionIcon
                class="prediction-role-icon"
                :position="option.value"
                aria-hidden="true"
              />
              <span>{{ option.label }}</span></span
            >
            <NSelect
              :value="lineup[option.value] || null"
              @update:value="setLineupMember(option.value, $event)"
              :options="memberOptions"
              filterable
              clearable
              :placeholder="uiText('chooseMember')"
              :aria-label="uiText('predictionMemberId', { role: option.label })"
            />
          </label>
        </div>
        <div class="prediction-controls">
          <label class="side-input">
            <span>{{ uiText('predictionSide') }}</span>
            <NSelect
              v-model:value="side"
              :options="sideOptions"
              :aria-label="uiText('predictionSide')"
            />
          </label>
          <NButton
            :disabled="!completeLineup || running"
            :aria-describedby="
              !completeLineup && (message || result) ? 'prediction-input-reason' : undefined
            "
            type="primary"
            @click="start"
            >{{ uiText('predictionCalculate') }}</NButton
          >
          <NButton v-if="running" @click="cancel">{{ uiText('predictionCancel') }}</NButton>
          <span
            v-if="!completeLineup && (message || result)"
            id="prediction-input-reason"
            class="prediction-note"
            >{{ uiText('predictionDistinctMembers') }}</span
          >
        </div>
      </section>
      <div class="prediction-outcome">
        <header class="prediction-section-heading">
          <h3>{{ uiText('predictionEntertainmentTitle') }}</h3>
          <MetricHelp
            :label="uiText('predictionResultScope')"
            :definition="uiText('predictionEntertainmentMethod')"
            icon-only
          />
        </header>
        <p class="prediction-entertainment-notice">
          {{ uiText('predictionEntertainmentDisclaimer') }}
        </p>
        <NProgress
          v-if="running"
          type="line"
          :percentage="progress"
          :show-indicator="false"
          :aria-label="uiText('predictionProgress')"
        />
        <p v-if="!result && !running && !message" class="prediction-idle">
          {{ uiText('predictionPending') }}
        </p>
        <section
          v-if="result?.status === 'unavailable'"
          class="prediction-unavailable"
          role="status"
        >
          <p>{{ unavailableText }}</p>
          <div class="prediction-recovery">
            <NButton
              v-if="result.reason === 'calculation-failed'"
              size="small"
              secondary
              :disabled="!completeLineup || running"
              @click="start"
              >{{ uiText('retry') }}</NButton
            ><NButton v-else size="small" secondary @click="openCollectionSettings">{{
              uiText('openCollectionSettings')
            }}</NButton
            ><NButton size="small" quaternary @click="showSupportConditions">{{
              uiText('predictionViewSupport')
            }}</NButton>
          </div>
        </section>
        <section
          v-if="result?.status === 'available'"
          class="prediction-result"
          :aria-label="uiText('predictionEntertainmentValue')"
          aria-live="polite"
          tabindex="-1"
        >
          <div class="prediction-estimate">
            <div>
              <span class="prediction-value-label">{{
                uiText('predictionEntertainmentValue')
              }}</span
              ><strong class="prediction-probability">{{ percent(result.score) }}</strong>
            </div>
          </div>
          <dl class="prediction-summary">
            <div>
              <dt>{{ uiText('predictionReferenceGames') }}</dt>
              <dd>{{ result.referenceGames }}</dd>
            </div>
            <div>
              <dt>{{ uiText('predictionSupportedRoles') }}</dt>
              <dd>{{ result.support.supportedRoles }} / 5</dd>
            </div>
            <div>
              <dt>{{ uiText('predictionUsedApplicable') }}</dt>
              <dd>{{ result.support.usedFeatures }} / {{ result.support.applicableFeatures }}</dd>
            </div>
            <div>
              <dt>{{ uiText('predictionSupportedGroups') }}</dt>
              <dd>{{ result.support.supportedGroups }} / {{ groupCount }}</dd>
            </div>
          </dl>
          <p class="prediction-note">{{ uiText('predictionEntertainmentSupportNote') }}</p>
        </section>
        <div class="prediction-task-state">
          <span v-if="message" role="status">{{ message }}</span
          ><span v-if="running" class="prediction-note">{{
            uiText('predictionContinuesAway')
          }}</span>
        </div>
      </div>
    </div>
    <div class="prediction-evidence">
      <NButton
        class="prediction-evidence-toggle"
        size="small"
        secondary
        :aria-expanded="details"
        aria-controls="prediction-method"
        @click="details = !details"
        ><NIcon :size="14" aria-hidden="true"
          ><ChevronDown20Regular v-if="details" /><ChevronRight20Regular v-else /></NIcon
        ><span>{{ uiText('predictionEvidence') }}</span></NButton
      >
      <div v-if="details" id="prediction-method">
        <template v-if="result?.status === 'available'">
          <section class="prediction-evidence-section">
            <h4>{{ uiText('predictionProfileSupportTitle') }}</h4>
            <div
              class="prediction-profiles-scroll"
              tabindex="0"
              role="region"
              :aria-label="uiText('predictionProfileSupportTitle')"
            >
              <table class="prediction-profiles">
                <thead>
                  <tr>
                    <th>{{ uiText('predictionProfileMember') }}</th>
                    <th>{{ uiText('predictionSameRoleGames') }}</th>
                    <th>{{ uiText('predictionOtherRoleGames') }}</th>
                    <th>{{ uiText('predictionBorrowedWeight') }}</th>
                    <th>{{ uiText('predictionMetricCoverage') }}</th>
                    <th>{{ uiText('predictionRoleValue') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="profile in result.profiles"
                    :key="profile.role"
                    class="prediction-profile-row"
                  >
                    <th scope="row">
                      <span class="prediction-profile-identity"
                        ><PositionIcon
                          v-if="hasRoleIcon(profile.role)"
                          class="prediction-role-icon"
                          :position="profile.role"
                          aria-hidden="true"
                        /><span
                          ><strong :title="profile.member">{{ profile.member }}</strong
                          ><small>{{ roleLabel(profile.role) }}</small></span
                        ></span
                      >
                    </th>
                    <td>{{ profile.sameRoleGames }}</td>
                    <td>{{ profile.otherRoleGames }}</td>
                    <td>{{ decimal(profile.borrowedEquivalentWeight) }}</td>
                    <td>
                      {{
                        uiText('predictionProfileCounts', {
                          used: profile.usedMetrics,
                          missing: profile.missingMetrics,
                          unsupported: profile.unsupportedMetrics,
                          excluded: profile.notApplicableMetrics
                        })
                      }}
                    </td>
                    <td>{{ profile.roleScore === null ? '—' : percent(profile.roleScore) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p class="prediction-note">{{ uiText('predictionBorrowingNote') }}</p>
          </section>
          <section class="prediction-evidence-section">
            <h4>{{ uiText('predictionGroupSupportTitle') }}</h4>
            <MemberAnalysisMetricTable
              :columns="groupColumns"
              :rows="result.groups.map((row) => ({ ...row }))"
              :scroll-x="580"
            />
            <h4>{{ uiText('predictionTopDrivers') }}</h4>
            <p class="prediction-note">{{ uiText('predictionContributionNote') }}</p>
            <MemberAnalysisMetricTable
              :columns="featureColumns"
              :rows="result.topDrivers.map((row) => ({ ...row }))"
              :scroll-x="1000"
            />
          </section>
          <div class="prediction-feature-evidence">
            <NButton
              class="prediction-evidence-toggle"
              size="small"
              secondary
              :aria-expanded="featureDetails"
              aria-controls="prediction-features"
              @click="featureDetails = !featureDetails"
              ><NIcon :size="14" aria-hidden="true"
                ><ChevronDown20Regular v-if="featureDetails" /><ChevronRight20Regular
                  v-else /></NIcon
              ><span>{{ uiText('predictionFeatureEvidence') }}</span></NButton
            >
            <div v-if="featureDetails" id="prediction-features">
              <MemberAnalysisMetricTable
                :columns="featureColumns"
                :rows="result.features.map((row) => ({ ...row }))"
                :scroll-x="1000"
              />
            </div>
          </div>
        </template>
        <section
          ref="supportConditions"
          tabindex="-1"
          :aria-label="uiText('predictionSupportMethodTitle')"
        >
          <h4>{{ uiText('predictionSupportMethodTitle') }}</h4>
          <p v-if="supportExpanded">{{ uiText('predictionEntertainmentMethod') }}</p>
          <MetricHelp
            v-else
            :label="uiText('predictionSupportMethodTitle')"
            :definition="uiText('predictionEntertainmentMethod')"
          />
        </section>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { ChevronDown20Regular, ChevronRight20Regular } from '@vicons/fluent'
import { computed, h, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import {
  NButton,
  NIcon,
  NProgress,
  NSelect,
  useMessage,
  type DataTableColumns,
  type MessageReactive
} from 'naive-ui'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { formatMetric, roleMetricMeta } from '../metric-defs'
import MemberAnalysisMetricTable from '../MemberAnalysisMetricTable.vue'
import MetricHelp from '../MetricHelp.vue'
import PredictionWorker from './prediction.worker?worker'
import {
  entertainmentGroups,
  type EntertainmentPredictionResult,
  type EntertainmentFeatureStatus,
  type EntertainmentUnavailableReason
} from './adaptive'
import { predictionObservations } from './observations'
import { predictionFeatures, predictionRoles, type PredictionRole } from './model'
import { uiText as featureUiText } from '../ui-text'
import { i18next } from '@renderer-shared/i18n'
const language = ref(i18next.resolvedLanguage ?? i18next.language)
const updateLanguage = (value: string) => {
  language.value = value
}
i18next.on('languageChanged', updateLanguage)
onBeforeUnmount(() => i18next.off('languageChanged', updateLanguage))
const uiText = (key: Parameters<typeof featureUiText>[0], values: Record<string, unknown> = {}) =>
  featureUiText(key, { ...values, lng: language.value })
const store = useMemberAnalysisStore()
const props = withDefaults(defineProps<{ active?: boolean }>(), { active: true })
const nativeMessage = useMessage()
const routeActive = ref(true)
const predictionVisible = computed(() => props.active && routeActive.value)
onActivated(() => {
  routeActive.value = true
})
onDeactivated(() => {
  routeActive.value = false
})
const lineup = computed(() => store.predictionViewState.lineup)
function setLineupMember(role: PredictionRole, value: unknown) {
  const next = value === null ? '' : value
  if (typeof next !== 'string' || (next && !memberOptions.value.some((o) => o.value === next)))
    return
  const previous = lineup.value[role]
  if (next === previous) return
  const updated = { ...lineup.value, [role]: next }
  if (next) {
    const occupied = predictionRoles.find((other) => other !== role && lineup.value[other] === next)
    if (occupied)
      updated[occupied] = memberOptions.value.some((o) => o.value === previous) ? previous : ''
  }
  // Publish the exchange atomically: observers never see a duplicated member.
  store.predictionViewState.lineup = updated
}
const side = computed({
  get: () => store.predictionViewState.side,
  set: (value: 'all' | 'Blue' | 'Red') => {
    store.predictionViewState.side = value
  }
})
const sideOptions = computed(() => [
  { label: uiText('predictionBothSides'), value: 'all' },
  { label: uiText('predictionBlueSide'), value: 'Blue' },
  { label: uiText('predictionRedSide'), value: 'Red' }
])
const details = ref(false)
const featureDetails = ref(false)
const supportExpanded = ref(false)
const result = ref<EntertainmentPredictionResult | null>(null)
const unavailableReasonKeys = {
  'invalid-lineup': 'predictionReasonLineup',
  'invalid-request': 'predictionReasonRequest',
  'no-history': 'predictionReasonHistory',
  'no-comparable-metrics': 'predictionReasonMetrics',
  'calculation-failed': 'predictionCalculationFailed'
} as const satisfies Record<EntertainmentUnavailableReason, Parameters<typeof featureUiText>[0]>
const unavailableText = computed(() =>
  result.value?.status === 'unavailable' ? uiText(unavailableReasonKeys[result.value.reason]) : ''
)
const groupCount = Object.keys(entertainmentGroups).length
const supportConditions = ref<HTMLElement | null>(null)
async function showSupportConditions() {
  supportExpanded.value = true
  details.value = true
  await nextTick()
  supportConditions.value?.scrollIntoView({ block: 'start' })
  supportConditions.value?.focus({ preventScroll: true })
}
function openCollectionSettings() {
  store.settingsFocus = 'collection'
  store.settingsDrawerVisible = true
}
const messageKey = ref<Parameters<typeof featureUiText>[0] | ''>('')
const message = computed(() => (messageKey.value ? uiText(messageKey.value) : ''))
const running = ref(false)
const progress = ref(0)
let worker: Worker | null = null
let generation = 0
let backgroundAnnounced = false
let taskMessage: MessageReactive | null = null
function clearTaskMessage() {
  taskMessage?.destroy()
  taskMessage = null
}
function notifyBackground(type: 'info' | 'success' | 'warning' | 'error') {
  if (
    predictionVisible.value ||
    !store.settings?.enabled ||
    !store.settings.experimentalPredictionEnabled
  )
    return
  const keys = {
    info: 'predictionBackgroundRunning',
    success: 'predictionBackgroundCompleted',
    warning: 'predictionBackgroundUnavailable',
    error: 'predictionBackgroundFailed'
  } as const
  clearTaskMessage()
  taskMessage = nativeMessage[type](() => uiText(keys[type]), { closable: true, duration: 3500 })
}
watch(
  predictionVisible,
  (visible) => {
    if (visible) clearTaskMessage()
    else if (running.value && !backgroundAnnounced) {
      backgroundAnnounced = true
      notifyBackground('info')
    }
  },
  { flush: 'sync' }
)
const roleOptions = computed<{ label: string; value: PredictionRole }[]>(() => [
  { label: uiText('predictionRoleTop'), value: 'TOP' },
  { label: uiText('predictionRoleJungle'), value: 'JUNGLE' },
  { label: uiText('predictionRoleMiddle'), value: 'MIDDLE' },
  { label: uiText('predictionRoleBottom'), value: 'BOTTOM' },
  { label: uiText('predictionRoleSupport'), value: 'UTILITY' }
])
const memberOptions = computed(() =>
  (store.settings?.members ?? []).map((row) => ({
    label: `${row.gameName}#${row.tagLine}`,
    value: `${row.gameName}#${row.tagLine}`
  }))
)
const completeLineup = computed(
  () =>
    predictionRoles.every((role) => lineup.value[role]) &&
    new Set(Object.values(lineup.value)).size === 5
)
const roleLabel = (role: PredictionRole) =>
  roleOptions.value.find((option) => option.value === role)?.label ?? role
const hasRoleIcon = (role: string) => predictionRoles.includes(role as PredictionRole)
const featureLabel = (key: string) => {
  const feature = predictionFeatures.find((feature) => feature.key === key)
  return feature
    ? `${roleLabel(feature.role)} · ${uiText(`predictionMetric_${feature.metric}`)}`
    : key
}
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const decimal = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—'
const featureStatusKeys = {
  used: 'inputUsed',
  missing: 'predictionStatusMissing',
  'not-applicable': 'predictionStatusNotApplicable',
  'insufficient-reference': 'predictionStatusInsufficient',
  'constant-reference': 'predictionStatusConstant',
  'single-outcome-reference': 'predictionStatusSingleOutcome',
  'no-direction': 'predictionStatusNoDirection'
} as const satisfies Record<EntertainmentFeatureStatus, Parameters<typeof featureUiText>[0]>
const groupLabel = (group: unknown) =>
  uiText(`predictionGroup_${String(group)}` as Parameters<typeof featureUiText>[0])
const featureColumns: DataTableColumns = [
  {
    title: () => uiText('predictionHistoricalMetric'),
    key: 'key',
    render: (row) => {
      const key = String(row.key),
        feature = predictionFeatures.find((feature) => feature.key === key)
      return h('span', { class: 'prediction-feature-label' }, [
        feature && hasRoleIcon(feature.role)
          ? h(PositionIcon, {
              position: feature.role,
              class: 'prediction-feature-role-icon',
              'aria-hidden': 'true'
            })
          : null,
        h('span', featureLabel(key))
      ])
    }
  },
  {
    title: () => uiText('predictionMetricGroup'),
    key: 'group',
    render: (row) => groupLabel(row.group)
  },
  {
    title: () => uiText('predictionSameRoleMean'),
    key: 'sameRoleMean',
    render: (row) =>
      formatMetric(
        typeof row.sameRoleMean === 'number' ? row.sameRoleMean : null,
        roleMetricMeta[String(row.metric)].fmt
      )
  },
  {
    title: () => uiText('predictionMetricSupport'),
    key: 'sameRoleN',
    render: (row) =>
      uiText('predictionMetricSupportCounts', {
        same: row.sameRoleN,
        other: row.otherRoleN,
        reference: row.referenceN
      })
  },
  {
    title: () => uiText('predictionBorrowedWeight'),
    key: 'borrowedEquivalentWeight',
    render: (row) => decimal(row.borrowedEquivalentWeight)
  },
  {
    title: () => uiText('predictionMetricStatus'),
    key: 'status',
    render: (row) => uiText(featureStatusKeys[row.status as EntertainmentFeatureStatus])
  },
  {
    title: () => uiText('predictionContribution'),
    key: 'contribution',
    render: (row) => decimal(row.contribution)
  }
]
const groupColumns: DataTableColumns = [
  { title: () => uiText('predictionMetricGroup'), key: 'id', render: (row) => groupLabel(row.id) },
  {
    title: () => uiText('predictionUsedApplicable'),
    key: 'usedFeatures',
    render: (row) => `${row.usedFeatures} / ${row.applicableFeatures}`
  },
  {
    title: () => uiText('predictionMetricStatus'),
    key: 'status',
    render: (row) => uiText(row.status === 'available' ? 'inputUsed' : 'predictionStatusMissing')
  },
  {
    title: () => uiText('predictionContribution'),
    key: 'contribution',
    render: (row) => decimal(row.contribution)
  }
]
function dispose() {
  if (!worker && !running.value) return
  generation++
  worker?.terminate()
  worker = null
  running.value = false
}
function cancel() {
  clearTaskMessage()
  dispose()
  store.predictionTaskStatus = 'idle'
  result.value = null
  messageKey.value = 'predictionCancelled'
}
function invalidate() {
  clearTaskMessage()
  const hadResult = running.value || result.value !== null
  dispose()
  store.predictionTaskStatus = 'idle'
  result.value = null
  details.value = false
  featureDetails.value = false
  supportExpanded.value = false
  messageKey.value = hadResult ? 'predictionInvalidated' : ''
}
watch(() => ({ ...lineup.value }), invalidate)
watch(side, invalidate)
watch(
  [
    () => store.overview,
    () => store.settings,
    () => store.settings?.enabled,
    () => store.settings?.experimentalPredictionEnabled
  ],
  invalidate
)
// show:lazy and route KeepAlive retain the task. Only real unmount cleans it up.
onBeforeUnmount(() => {
  clearTaskMessage()
  dispose()
  store.predictionTaskStatus = 'idle'
})
function start() {
  if (
    running.value ||
    !completeLineup.value ||
    !store.settings?.enabled ||
    store.settings.experimentalPredictionEnabled !== true
  )
    return
  dispose()
  clearTaskMessage()
  backgroundAnnounced = false
  result.value = null
  details.value = false
  featureDetails.value = false
  supportExpanded.value = false
  progress.value = 0
  const current = generation
  messageKey.value = 'predictionCalculating'
  const observations = predictionObservations(
    store.overview?.games ?? [],
    memberOptions.value.map((option) => option.value)
  )
  try {
    worker = new PredictionWorker()
    running.value = true
    store.predictionTaskStatus = 'running'
    worker.onmessage = ({ data }) => {
      if (generation !== current) return
      if (data.type === 'progress') {
        progress.value = data.done
        messageKey.value = 'predictionCalculating'
        return
      }
      if (data.type === 'done') {
        result.value = data.result
        dispose()
        store.predictionTaskStatus =
          data.result.status === 'available' ? 'completed' : 'unavailable'
        messageKey.value = data.result.status === 'available' ? 'predictionTaskCompleted' : ''
        notifyBackground(data.result.status === 'available' ? 'success' : 'warning')
      }
    }
    worker.onerror = () => {
      if (generation === current) {
        dispose()
        store.predictionTaskStatus = 'failed'
        messageKey.value = 'predictionWorkerFailed'
        notifyBackground('error')
      }
    }
    worker.postMessage({ observations, lineup: { ...lineup.value }, side: side.value })
  } catch {
    dispose()
    store.predictionTaskStatus = 'failed'
    messageKey.value = 'predictionStartupFailed'
    notifyBackground('error')
  }
}
</script>
<style scoped>
.win-prediction {
  font-size: 14px;
  gap: 16px;
  min-width: 0;
}
.prediction-workbench {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 32px;
  align-items: start;
}
.prediction-outcome {
  display: grid;
  gap: 12px;
  min-width: 0;
  border-left: 1px solid var(--ma-grid-strong);
  padding-left: 32px;
}
.prediction-configuration {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.prediction-section-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
h3,
h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.prediction-configuration h3 {
  font-size: 18px;
}
p {
  margin: 0;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.lineup-inputs {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
}
.lineup-inputs label,
.side-input {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.lineup-inputs :deep(.n-select) {
  min-width: 0;
}
.prediction-role-label {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}
.prediction-role-icon {
  align-self: center;
  flex: none;
  width: 16px;
  height: 16px;
  font-size: 16px;
  line-height: 1;
}
.prediction-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px 12px;
}
.side-input {
  width: 100%;
  flex-basis: 100%;
  max-width: 100%;
}
.prediction-controls > button {
  flex: 1;
}
.prediction-controls > span {
  display: flex;
  align-items: center;
  min-height: 34px;
}
.prediction-task-state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  min-width: 0;
}
.prediction-task-state:empty {
  display: none;
}
.prediction-task-state > span {
  font-size: 12px;
}
.prediction-note,
.prediction-idle {
  color: var(--ma-muted);
  font-size: 12px;
}
.prediction-idle {
  padding: 8px 0;
}
.prediction-unavailable,
.prediction-result {
  display: grid;
  gap: 12px;
  min-width: 0;
}
.prediction-unavailable > section {
  display: grid;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--ma-grid);
}
.prediction-estimate {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 12px 40px;
}
.prediction-estimate > div {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.prediction-value-label {
  display: flex;
  align-items: center;
  min-height: 32px;
}
.prediction-probability {
  font-size: 28px;
  font-weight: 600;
  line-height: 1.25;
  font-variant-numeric: tabular-nums;
}
.prediction-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px 24px;
  margin: 0;
  padding: 12px 0;
  border-top: 1px solid var(--ma-grid);
  border-bottom: 1px solid var(--ma-grid);
}
.prediction-summary > div {
  min-width: 0;
}
.prediction-summary dt {
  font-size: 12px;
  color: var(--ma-muted);
}
.prediction-summary dd {
  margin: 4px 0 0;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.prediction-result-notes {
  display: grid;
  gap: 6px;
}
.prediction-warning {
  font-weight: 600;
}
.prediction-recovery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.prediction-evidence-toggle {
  min-height: 34px;
  font-weight: 500;
}
.prediction-evidence-toggle :deep(.n-button__content) {
  gap: 8px;
}
.prediction-evidence-toggle[aria-expanded='true'] {
  box-shadow: inset 0 0 0 1px var(--ma-grid-strong);
}
.prediction-evidence {
  border-top: 1px solid var(--ma-grid-strong);
  padding-top: 8px;
  min-width: 0;
}
#prediction-method {
  display: grid;
  gap: 20px;
  padding-top: 12px;
  min-width: 0;
}
#prediction-method section {
  display: grid;
  gap: 8px;
  min-width: 0;
  scroll-margin-top: 80px;
}
#prediction-method ul {
  margin: 0;
  padding-left: 20px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.prediction-profiles-scroll {
  min-width: 0;
  overflow: auto;
}
.prediction-profiles {
  width: 100%;
  min-width: 850px;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
}
.prediction-profiles th,
.prediction-profiles td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ma-grid);
  font-weight: 400;
}
.prediction-profiles thead th {
  font-size: 12px;
  color: var(--ma-muted);
}
.prediction-profile-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.prediction-profile-identity > span {
  min-width: 0;
}
.prediction-profile-identity strong {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.prediction-profile-identity small {
  display: block;
  color: var(--ma-muted);
  font-size: 12px;
}
.win-prediction :deep(.prediction-feature-label) {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  min-width: 0;
}
.win-prediction :deep(.prediction-feature-role-icon) {
  align-self: center;
  flex: none;
  width: 14px;
  height: 14px;
  font-size: 14px;
  line-height: 1;
}
@media (max-width: 1100px) {
  .prediction-workbench {
    grid-template-columns: 280px minmax(0, 1fr);
    gap: 24px;
  }
  .prediction-outcome {
    padding-left: 24px;
  }
}
@media (max-width: 899px) {
  .prediction-workbench {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }
  .prediction-outcome {
    border-left: none;
    border-top: 1px solid var(--ma-grid-strong);
    padding: 20px 0 0;
  }
}
@media (max-width: 520px) {
  .prediction-summary {
    grid-template-columns: minmax(0, 1fr);
  }
  .prediction-estimate {
    flex-direction: column;
    gap: 12px;
  }
}
.prediction-entertainment-notice {
  font-weight: 600;
}
</style>
