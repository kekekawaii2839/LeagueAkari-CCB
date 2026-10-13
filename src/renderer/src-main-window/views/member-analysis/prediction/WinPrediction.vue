<template>
  <section class="ma-panel ma-workspace win-prediction" aria-label="五排阵容胜率预测">
    <div>
      <p id="member-analysis-prediction-filter-note" class="prediction-note">
        {{ uiText('predictionIntro') }}
      </p>
      <p class="prediction-note">{{ uiText('predictionContinuesAway') }}</p>
      <div class="lineup-inputs" role="group" aria-label="五排成员 ID 与分路">
        <label v-for="option in roleOptions" :key="option.value">
          <span>{{ option.label }}</span>
          <NSelect
            v-model:value="lineup[option.value]"
            :options="optionsForRole(option.value)"
            filterable
            :placeholder="uiText('chooseMember')"
            :aria-label="`${option.label}成员 ID`"
          />
        </label>
      </div>
      <div class="prediction-controls">
        <label class="side-input">
          <span>预测方位</span>
          <NSelect v-model:value="side" :options="sideOptions" aria-label="预测方位" />
        </label>
        <NButton :disabled="!completeLineup || running" type="primary" @click="start"
          >计算胜率</NButton
        >
        <NButton v-if="running" @click="cancel">取消计算</NButton>
        <span v-if="!completeLineup">请为五个分路选择不同成员。</span>
      </div>
      <p v-if="message" role="status">{{ message }}</p>
      <NProgress
        v-if="running"
        type="line"
        :percentage="progress"
        :show-indicator="false"
        :aria-label="uiText('predictionProgress')"
      />
      <p v-if="result?.status === 'unavailable'" tabindex="-1" role="status">
        {{
          uiText(
            predictionFailure === 'sample'
              ? 'predictionInsufficient'
              : predictionFailure === 'outcome'
                ? 'predictionOutcomeMissing'
                : 'predictionCalculationFailed'
          )
        }}
      </p>
      <p v-if="result?.status === 'unavailable' && predictionFailure !== 'calculation'">
        {{ uiText('predictionHistoryMissing') }}
      </p>
      <div v-if="result?.status === 'unavailable'" class="prediction-recovery">
        <NButton
          v-if="predictionFailure !== 'calculation'"
          size="small"
          secondary
          @click="openCollectionSettings"
          >{{ uiText('openCollectionSettings') }}</NButton
        >
        <NButton
          v-else
          size="small"
          secondary
          :disabled="!completeLineup || running"
          @click="start"
          >{{ uiText('retry') }}</NButton
        >
        <NButton size="small" quaternary @click="showValidationConditions">{{
          uiText('viewValidationConditions')
        }}</NButton>
      </div>
      <section v-if="overallReference" aria-label="未完成预测时的总体历史参考">
        <h4>{{ sideLabel }} · 总体历史参考（不是阵容预测）</h4>
        <p>
          已加载成员的五人同队对局：
          {{ overallReference.wins }} 胜 / {{ overallReference.games }} 场，历史实际胜率
          <strong>{{ percent(overallReference.winRate) }}</strong
          >； {{ date(overallReference.from) }}–{{ date(overallReference.to) }}。
        </p>
        <p>历史胜率 Wilson 95% 区间：{{ overallReferenceInterval }}。</p>
        <p class="prediction-note">
          {{ uiText('historicalReferenceLimit') }}
        </p>
      </section>
      <section
        v-if="result?.status === 'available'"
        tabindex="-1"
        class="prediction-result"
        :aria-label="
          uiText(
            result.estimateKind === 'reference'
              ? 'predictionReferenceResult'
              : 'predictionEstimateResult'
          )
        "
        aria-live="polite"
      >
        <h4>
          {{
            uiText(
              result.estimateKind === 'reference'
                ? 'predictionReferenceTitle'
                : 'predictionEstimateTitle',
              { side: sideLabel }
            )
          }}
        </h4>
        <p>
          <strong
            >{{
              uiText(
                result.estimateKind === 'reference'
                  ? 'predictionReferenceRate'
                  : 'predictionNextRate'
              )
            }}
            {{ percent(result.probability) }}</strong
          >
          ·
          {{
            uiText(
              result.estimateKind === 'reference'
                ? 'predictionReferenceInterval'
                : 'predictionInterval'
            )
          }}：<strong>{{
            result.interval
              ? `${percent(result.interval[0])}–${percent(result.interval[1])}`
              : uiText('intervalUnavailable')
          }}</strong>
        </p>
        <p class="prediction-note">{{ uiText('predictionResultLimit') }}</p>
        <p v-if="result.estimateKind === 'reference'">{{ uiText('predictionReferenceLimit') }}</p>
        <p v-if="!result.lineupHistoryGames">{{ uiText('predictionLineupMissing') }}</p>
        <p>
          {{ predictionMethodName }} ·
          {{
            uiText('predictionSample', { total: result.totalGames, validation: result.testGames })
          }}
        </p>
        <p
          v-if="
            result.validation.brier >= result.baseline.brier ||
            result.validation.logLoss >= result.baseline.logLoss
          "
          class="prediction-warning"
        >
          {{ uiText('predictionNoAdvantage') }}
        </p>
      </section>
      <NButton
        size="small"
        quaternary
        :aria-expanded="details"
        aria-controls="prediction-method"
        @click="details = !details"
        >{{
          uiText(
            details
              ? 'hidePredictionDetails'
              : result?.status === 'available'
                ? 'predictionDetails'
                : 'predictionHelp'
          )
        }}</NButton
      >
      <div v-if="details" id="prediction-method">
        <section
          ref="validationConditions"
          tabindex="-1"
          :aria-label="uiText('predictionValidationConditions')"
        >
          <h4>{{ uiText('predictionValidationConditions') }}</h4>
          <p>{{ uiText('predictionValidationRequirements') }}</p>
          <p>{{ uiText('predictionEligibleRequirement') }}</p>
        </section>
        <p>{{ uiText('predictionHistoryScope') }}</p>
        <p>{{ uiText('predictionLimit') }}</p>
        <p>{{ uiText('predictionIntervalLimit') }}</p>
        <template v-if="result?.status === 'available'">
          <ul>
            <li v-for="profile in result.profiles" :key="profile.role">
              {{ roleLabel(profile.role) }}：{{ profile.member }} · {{ profile.games }} 场 （蓝方
              {{ profile.blueGames }} / 红方 {{ profile.redGames }}；{{ profile.from }}–{{
                profile.to
              }}）
            </li>
          </ul>
          <p v-if="result.lineupHistoryGames">
            {{ sideLabel }} · 相同阵容历史：{{ result.lineupHistoryWins }} 胜 /
            {{ result.lineupHistoryGames }} 场，
            {{ percent(result.lineupHistoryWins / result.lineupHistoryGames) }}；Wilson 95% 区间
            {{ historyInterval }}。
            {{ uiText('predictionLineupHistoryLimit') }}
          </p>
          <p>
            {{
              uiText('predictionValidationScope', {
                trainFrom: date(result.trainFrom),
                trainTo: date(result.trainTo),
                testFrom: date(result.testFrom),
                testTo: date(result.testTo)
              })
            }}
          </p>
          <MemberAnalysisMetricTable
            :columns="validationColumns"
            :rows="validationRows"
            :scroll-x="450"
          />
          <table class="prediction-calibration">
            <caption>
              {{
                uiText('predictionValidation')
              }}
            </caption>
            <thead>
              <tr>
                <th>概率范围</th>
                <th>对局场数</th>
                <th>平均预测</th>
                <th>实际胜率</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(bin, index) in result.validation.bins" :key="index">
                <th>{{ index * 20 }}–{{ (index + 1) * 20 }}%</th>
                <td>{{ bin.n }}</td>
                <td>{{ bin.predicted === null ? '—' : percent(bin.predicted) }}</td>
                <td>{{ bin.observed === null ? '—' : percent(bin.observed) }}</td>
              </tr>
            </tbody>
          </table>
          <MemberAnalysisMetricTable
            :columns="featureColumns"
            :rows="
              result.target.map((row) => ({
                ...row,
                used: result!.status === 'available' && result!.usedMetrics.includes(row.key)
              }))
            "
            :scroll-x="580"
          />
        </template>
      </div>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, h, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import {
  NButton,
  NProgress,
  NSelect,
  useMessage,
  type DataTableColumns,
  type MessageReactive
} from 'naive-ui'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { formatMetric, roleMetricMeta } from '../metric-defs'
import { wilsonInterval } from '../visualization'
import MemberAnalysisMetricTable from '../MemberAnalysisMetricTable.vue'
import MetricHelp from '../MetricHelp.vue'
import PredictionWorker from './prediction.worker?worker'
import type { AdaptiveWinPredictionResult } from './adaptive'
import { predictionObservations } from './observations'
import { predictionFeatures, predictionRoles, type PredictionRole } from './model'
import { uiText } from '../ui-text'
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
const side = computed({
  get: () => store.predictionViewState.side,
  set: (value: 'all' | 'Blue' | 'Red') => {
    store.predictionViewState.side = value
  }
})
const sideOptions = [
  { label: '红蓝综合', value: 'all' },
  { label: '蓝方', value: 'Blue' },
  { label: '红方', value: 'Red' }
]
const sideLabel = computed(() => sideOptions.find((option) => option.value === side.value)!.label)
const details = ref(false)
const result = ref<AdaptiveWinPredictionResult | null>(null)
const predictionFailure = computed(() => {
  if (result.value?.status !== 'unavailable') return null
  if (result.value.reason.startsWith('回测样本不足')) return 'sample'
  if (result.value.reason.includes('只有一种胜负')) return 'outcome'
  return 'calculation'
})
const validationConditions = ref<HTMLElement | null>(null)
async function showValidationConditions() {
  details.value = true
  await nextTick()
  validationConditions.value?.scrollIntoView({ block: 'start' })
  validationConditions.value?.focus({ preventScroll: true })
}
function openCollectionSettings() {
  store.settingsFocus = 'collection'
  store.settingsDrawerVisible = true
}
const predictionMethodName = computed(() => {
  if (result.value?.status !== 'available') return ''
  const key =
    result.value.modelId === 'baseline' || result.value.modelId === 'recent'
      ? 'predictionBaseline'
      : result.value.modelId === 'lineup'
        ? 'lineupHistoryMethod'
        : result.value.modelId === 'blend'
          ? 'blendedHistoryMethod'
          : 'memberPerformanceMethod'
  return uiText(key)
})
const message = ref('')
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
const roleOptions: { label: string; value: PredictionRole }[] = [
  { label: '上路', value: 'TOP' },
  { label: '打野', value: 'JUNGLE' },
  { label: '中路', value: 'MIDDLE' },
  { label: '下路', value: 'BOTTOM' },
  { label: '辅助', value: 'UTILITY' }
]
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
const optionsForRole = (role: PredictionRole) =>
  memberOptions.value.map((option) => ({
    ...option,
    disabled: predictionRoles.some(
      (other) => other !== role && lineup.value[other] === option.value
    )
  }))
const roleLabel = (role: PredictionRole) =>
  roleOptions.find((option) => option.value === role)!.label
const featureLabel = (key: string) => {
  const feature = predictionFeatures.find((feature) => feature.key === key)!
  return `${roleLabel(feature.role)} · ${roleMetricMeta[feature.metric].label}`
}
const percent = (value: number) => `${(value * 100).toFixed(1)}%`
const date = (value: number) => new Date(value).toLocaleDateString('zh-CN')
const overallReference = computed(() => {
  const current = result.value
  return current?.status === 'unavailable' && 'overallReference' in current
    ? current.overallReference
    : null
})
const overallReferenceInterval = computed(() => {
  const current = overallReference.value
  if (!current) return '—'
  const interval = wilsonInterval(current.wins, current.games)
  return interval ? `${percent(interval.low)}–${percent(interval.high)}` : '—'
})
const historyInterval = computed(() => {
  if (result.value?.status !== 'available') return '—'
  const interval = wilsonInterval(result.value.lineupHistoryWins, result.value.lineupHistoryGames)
  return interval ? `${percent(interval.low)}–${percent(interval.high)}` : '—'
})
const featureColumns: DataTableColumns = [
  { title: '历史指标', key: 'key', render: (row) => featureLabel(String(row.key)) },
  {
    title: uiText('historyAverage'),
    key: 'value',
    render: (row) =>
      formatMetric(row.available === 0 ? null : row.value, roleMetricMeta[String(row.metric)].fmt)
  },
  { title: '有效场数', key: 'available' },
  {
    title: uiText('predictionInput'),
    key: 'used',
    render: (row) => uiText(row.used ? 'inputUsed' : 'inputUnused')
  }
]
const validationRows = computed(() => {
  if (result.value?.status !== 'available') return []
  return [
    { method: uiText('predictionMethod'), ...result.value.validation },
    { method: uiText('predictionBaseline'), ...result.value.baseline }
  ]
})
const validationColumns: DataTableColumns = [
  { title: uiText('predictionMethod'), key: 'method' },
  {
    title: () => h(MetricHelp, { label: uiText('statBrier'), definition: uiText('statBrierHelp') }),
    key: 'brier',
    render: (row) => Number(row.brier).toFixed(3)
  },
  {
    title: () =>
      h(MetricHelp, { label: uiText('statLogLoss'), definition: uiText('statLogLossHelp') }),
    key: 'logLoss',
    render: (row) => Number(row.logLoss).toFixed(3)
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
  message.value = '计算已取消，未保留未完成结果。'
}
function invalidate() {
  clearTaskMessage()
  const hadResult = running.value || result.value !== null
  dispose()
  store.predictionTaskStatus = 'idle'
  result.value = null
  details.value = false
  message.value = hadResult ? '成员、分路、方位或数据已改变，请重新计算。' : ''
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
  progress.value = 0
  const current = generation
  message.value = uiText('predictionCalculating')
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
        message.value = uiText('predictionCalculating')
        return
      }
      if (data.type === 'done') {
        result.value = data.result
        dispose()
        store.predictionTaskStatus =
          data.result.status === 'available' ? 'completed' : 'unavailable'
        message.value = data.result.status === 'available' ? uiText('predictionTaskCompleted') : ''
        notifyBackground(data.result.status === 'available' ? 'success' : 'warning')
      }
    }
    worker.onerror = () => {
      if (generation === current) {
        dispose()
        store.predictionTaskStatus = 'failed'
        message.value = '本地预测计算失败，请重试。'
        notifyBackground('error')
      }
    }
    worker.postMessage({ observations, lineup: { ...lineup.value }, side: side.value })
  } catch {
    dispose()
    store.predictionTaskStatus = 'failed'
    message.value = '无法启动本地计算任务，请重试。'
    notifyBackground('error')
  }
}
</script>
<style scoped>
.win-prediction {
  font-size: 14px;
}
.prediction-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}
h3,
h4 {
  margin: 0;
  font-size: 14px;
}
.side-input {
  display: grid;
  gap: 4px;
  width: 180px;
  max-width: 100%;
}
p {
  margin: 8px 0;
  line-height: 1.6;
}
.lineup-inputs {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-block: 12px;
}
.lineup-inputs label {
  display: grid;
  gap: 4px;
}
.prediction-note {
  color: var(--ma-muted);
  font-size: 12px;
}
.prediction-result {
  margin-top: 16px;
  scroll-margin-top: 110px;
}
.prediction-result:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 4px;
}
[role='status'] {
  scroll-margin-top: 110px;
}
.prediction-result > p:first-of-type strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.prediction-warning {
  font-weight: 600;
}
.prediction-calibration {
  border-collapse: collapse;
  margin: 12px 0;
  width: 100%;
  font-variant-numeric: tabular-nums;
}
.prediction-calibration th,
.prediction-calibration td {
  padding: 8px;
  text-align: right;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.prediction-calibration caption,
.prediction-calibration th:first-child {
  text-align: left;
}
</style>

<style scoped>
.prediction-recovery {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
#prediction-method section {
  scroll-margin-top: 80px;
}
</style>
