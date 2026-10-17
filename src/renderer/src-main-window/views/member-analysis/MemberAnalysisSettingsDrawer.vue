<template>
  <NDrawer
    :show="show"
    :width="520"
    style="max-width: 100%"
    placement="right"
    to=".member-analysis-page"
    @update:show="requestClose"
    @after-enter="focusRequestedSection"
  >
    <NDrawerContent title="成员分析设置" closable>
      <div class="member-analysis-settings">
        <div
          v-if="saveError || confirmDiscard"
          ref="feedback"
          tabindex="-1"
          class="settings-feedback"
        >
          <NAlert v-if="saveError" type="error" role="alert">{{ saveError }}</NAlert>
          <NAlert v-if="confirmDiscard" type="warning" class="settings-discard-warning">
            <div class="settings-discard-content">
              <span class="settings-discard-message">{{ uiText('discard') }}</span>
              <div class="settings-discard-actions">
                <NButton size="small" @click="discard">{{ uiText('discardConfirm') }}</NButton>
                <NButton size="small" @click="confirmDiscard = false">{{
                  uiText('keepEditing')
                }}</NButton>
              </div>
            </div>
          </NAlert>
        </div>
        <div class="member-analysis-settings__row">
          <div>
            <div class="member-analysis-settings__label">启用成员分析</div>
            <div class="member-analysis-settings__description">
              关闭后停止更新，已保存的本地分析数据不会自动删除。
            </div>
          </div>
          <NSwitch v-model:value="draft.enabled" aria-label="启用成员分析" />
        </div>

        <h3 ref="collectionHeading" tabindex="-1" class="settings-group-heading">采集范围</h3>
        <NFormItem
          :label="uiText('collectionCount')"
          :validation-status="fieldError('historyDepth') ? 'error' : undefined"
          :show-feedback="false"
        >
          <div class="member-analysis-settings__field" data-validation-key="historyDepth">
            <NSelect
              v-model:value="draft.historyDepth"
              :options="historyOptions"
              :aria-invalid="Boolean(fieldError('historyDepth'))"
              :aria-describedby="fieldError('historyDepth') ? errorId('historyDepth') : undefined"
              @blur="touch('historyDepth')"
            />
            <p
              v-if="fieldError('historyDepth')"
              :id="errorId('historyDepth')"
              class="settings-field-error"
            >
              {{ fieldError('historyDepth') }}
            </p>
            <div class="member-analysis-settings__description">
              {{ uiText('collectionCountHelp') }}
            </div>
          </div>
        </NFormItem>
        <NFormItem
          :label="uiText('historyQueryLimit')"
          :validation-status="fieldError('scanLimitPerMember') ? 'error' : undefined"
          :show-feedback="false"
        >
          <div class="member-analysis-settings__field" data-validation-key="scanLimitPerMember">
            <NInputNumber
              v-model:value="draft.scanLimitPerMember"
              aria-label="每名成员最多查询场数"
              :input-props="validationInputProps('scanLimitPerMember')"
              @blur="touch('scanLimitPerMember')"
              :min="100"
              :max="5000"
              :step="100"
            />
            <div class="member-analysis-settings__description">
              {{ uiText('historyQueryLimitHelp') }}
            </div>
            <p
              v-if="fieldError('scanLimitPerMember')"
              :id="errorId('scanLimitPerMember')"
              class="settings-field-error"
            >
              {{ fieldError('scanLimitPerMember') }}
            </p>
          </div>
        </NFormItem>
        <NFormItem
          label="比赛模式"
          :validation-status="fieldError('historyTag') ? 'error' : undefined"
          :show-feedback="false"
        >
          <div class="member-analysis-settings__field" data-validation-key="historyTag">
            <NSelect
              v-model:value="draft.historyTag"
              :options="historyTagOptions"
              aria-label="比赛模式"
              :aria-invalid="Boolean(fieldError('historyTag'))"
              :aria-describedby="fieldError('historyTag') ? errorId('historyTag') : undefined"
              @blur="touch('historyTag')"
            />
            <div class="member-analysis-settings__description">
              {{ uiText('collectionModeHelp') }}
            </div>
            <p
              v-if="fieldError('historyTag')"
              :id="errorId('historyTag')"
              class="settings-field-error"
            >
              {{ fieldError('historyTag') }}
            </p>
          </div>
        </NFormItem>

        <h3 class="settings-group-heading">存储与参考</h3>
        <NFormItem
          label="本地存储软上限（GiB）"
          :validation-status="fieldError('storageLimitGiB') ? 'error' : undefined"
          :show-feedback="false"
        >
          <div class="member-analysis-settings__field" data-validation-key="storageLimitGiB">
            <NInputNumber
              v-model:value="draft.storageLimitGiB"
              :min="1"
              :max="1000"
              :input-props="validationInputProps('storageLimitGiB')"
              @blur="touch('storageLimitGiB')"
            />
            <p
              v-if="fieldError('storageLimitGiB')"
              :id="errorId('storageLimitGiB')"
              class="settings-field-error"
            >
              {{ fieldError('storageLimitGiB') }}
            </p>
          </div>
        </NFormItem>

        <div class="member-analysis-settings__row">
          <div>
            <div class="member-analysis-settings__label">OP.GG 公共参考数据</div>
            <div class="member-analysis-settings__description">
              {{ uiText('publicReferenceHelp') }}
            </div>
          </div>
          <NSwitch v-model:value="draft.opggEnabled" aria-label="OP.GG 公共参考数据" />
        </div>

        <h3 class="settings-group-heading">{{ uiText('experimentalPredictionGroup') }}</h3>
        <div class="member-analysis-settings__row">
          <div>
            <div id="experimental-prediction-label" class="member-analysis-settings__label">
              {{ uiText('experimentalPredictionLabel') }}
            </div>
            <div id="experimental-prediction-help" class="member-analysis-settings__description">
              {{ uiText('experimentalPredictionHelp') }}
            </div>
          </div>
          <NSwitch
            v-model:value="draft.experimentalPredictionEnabled"
            aria-labelledby="experimental-prediction-label"
            aria-describedby="experimental-prediction-help"
            :disabled="saving"
          />
        </div>

        <div class="member-analysis-settings__row">
          <div>
            <div id="experimental-lp-trend-label" class="member-analysis-settings__label">
              {{ uiText('lpTrendSettingLabel') }}
            </div>
            <div id="experimental-lp-trend-help" class="member-analysis-settings__description">
              {{ uiText('lpTrendSettingHelp') }}
            </div>
          </div>
          <NSwitch
            v-model:value="draft.experimentalLpTrendEnabled"
            aria-labelledby="experimental-lp-trend-label"
            aria-describedby="experimental-lp-trend-help"
            :disabled="saving"
          />
        </div>

        <div class="member-analysis-settings__row">
          <div>
            <div id="experimental-version-trend-label" class="member-analysis-settings__label">
              {{ uiText('versionTrendSettingLabel') }}
            </div>
            <div id="experimental-version-trend-help" class="member-analysis-settings__description">
              {{ uiText('versionTrendSettingHelp') }}
            </div>
          </div>
          <NSwitch
            v-model:value="draft.experimentalVersionTrendEnabled"
            aria-labelledby="experimental-version-trend-label"
            aria-describedby="experimental-version-trend-help"
            :disabled="saving"
          />
        </div>

        <section ref="memberList" tabindex="-1" data-validation-key="members">
          <div class="member-analysis-settings__section-title">
            <span>固定成员列表</span>
            <NButton
              size="tiny"
              :disabled="sortingLocked || Boolean(draggedMember) || draft.members.length >= 20"
              @click="addMember"
              >添加成员</NButton
            >
          </div>
          <p
            v-if="draft.enabled && draft.members.length < 5"
            class="settings-field-error"
            role="status"
          >
            {{ uiText('settingsMemberCount', { count: draft.members.length }) }}
          </p>
          <div
            v-if="!draft.enabled && !draft.members.length"
            class="member-analysis-settings__empty"
          >
            {{ uiText('membersRequired') }}
          </div>
          <span class="sr-only" role="status">{{ memberOrderFeedback }}</span>
          <span :id="`${formId}-member-order-help`" class="sr-only">
            拖动调整成员顺序；键盘使用上、下方向键移动，Home 移至首位，End 移至末位。
          </span>
          <TransitionGroup
            name="member-order"
            tag="div"
            class="member-order-list"
            @dragenter.capture="allowMemberDrop"
            @dragenter="allowMemberDrop"
            @dragover.capture="allowMemberDrop"
            @dragover="dragOverMemberList"
            @drop="dropMember($event)"
          >
            <div
              v-for="(member, index) in displayedMembers"
              :key="memberRowKey(member)"
              :data-member-row="memberRowKey(member)"
              class="member-analysis-member"
              :class="{
                'member-drop-target': dropTarget === member,
                'member-drop-after': dropTarget === member && dropAfter
              }"
              role="group"
              :aria-label="`成员 ${index + 1}：${member.gameName}#${member.tagLine}`"
              @dragover="dragOverMember($event, member)"
              @drop="dropMember($event, member)"
              @keydown.esc="cancelMemberDrag($event)"
            >
              <button
                type="button"
                class="member-drag-handle"
                :draggable="!sortingLocked"
                :disabled="sortingLocked"
                :aria-label="`拖动排序成员 ${member.gameName}#${member.tagLine}`"
                :aria-describedby="`${formId}-member-order-help`"
                @dragstart="startMemberDrag($event, member)"
                @dragend="cancelMemberDrag()"
                @keydown="moveMemberByKey($event, member)"
              >
                <NIcon :size="16"><DragHandleIcon /></NIcon>
              </button>
              <div
                v-for="field in memberFields"
                :key="field.key"
                :data-validation-key="memberKey(draft.members.indexOf(member), field.key)"
                class="member-input-field"
              >
                <NInput
                  v-model:value="member[field.key]"
                  :input-props="memberInputProps(member, draft.members.indexOf(member), field.key)"
                  :aria-label="field.label"
                  :placeholder="field.placeholder"
                  :status="
                    fieldError(memberKey(draft.members.indexOf(member), field.key))
                      ? 'error'
                      : undefined
                  "
                  @blur="touch(memberKey(draft.members.indexOf(member), field.key))"
                />
                <p
                  v-if="fieldError(memberKey(draft.members.indexOf(member), field.key))"
                  :id="errorId(memberKey(draft.members.indexOf(member), field.key))"
                  class="settings-field-error"
                >
                  {{ fieldError(memberKey(draft.members.indexOf(member), field.key)) }}
                </p>
              </div>
              <div class="member-order-actions">
                <NButton
                  size="small"
                  quaternary
                  type="error"
                  :disabled="sortingLocked"
                  :aria-disabled="sortingLocked || Boolean(draggedMember)"
                  :aria-label="`删除成员 ${member.gameName}#${member.tagLine}`"
                  @click="removeMember(draft.members.indexOf(member))"
                  >删除</NButton
                >
              </div>
            </div>
          </TransitionGroup>
        </section>

        <section class="member-analysis-storage">
          <NAlert v-if="cleanupError" type="error">{{ cleanupError }}</NAlert>
          <div class="member-analysis-settings__section-title">本地数据清理</div>
          <div class="member-analysis-settings__description">
            当前占用 {{ formatBytes(storageStatus?.totalBytes ?? 0) }}；软上限
            {{
              formatBytes(storageStatus?.limitBytes ?? (draft.storageLimitGiB ?? 0) * 1024 ** 3)
            }}。 不会自动删除数据；清理仅移除最旧的历史原始数据，并保留设置和当前分析结果。
          </div>
          <NButton :loading="cleaning" @click="$emit('preview-cleanup')">预览清理</NButton>
          <div
            v-if="cleanupPreview"
            ref="cleanupConfirmation"
            tabindex="-1"
            class="settings-feedback"
          >
            <NAlert type="warning" :title="uiText('confirmCleanupTitle')">
              将清理 {{ cleanupPreview.gameCount }} 场最旧历史原始数据，预计释放
              {{ formatBytes(cleanupPreview.reclaimableBytes) }}。当前可查看的分析结果不会被删除。
              <NButton
                class="member-analysis-storage__confirm"
                size="small"
                type="error"
                :loading="cleaning"
                @click="$emit('confirm-cleanup', cleanupPreview.previewId)"
              >
                确认清理
              </NButton>
            </NAlert>
          </div>
        </section>
      </div>
      <template #footer>
        <div class="settings-footer">
          <div v-if="!valid" class="settings-validation-summary">
            <span role="status">{{
              uiText('settingsIssueCount', { count: validationIssues.length })
            }}</span>
            <NButton size="small" quaternary @click="showIssues">{{
              uiText('settingsShowIssues')
            }}</NButton>
          </div>
          <NButton type="primary" :loading="saving" :disabled="!valid" @click="saveDraft"
            >保存设置</NButton
          >
        </div>
      </template>
    </NDrawerContent>
  </NDrawer>
</template>

<script setup lang="ts">
import {
  NAlert,
  NButton,
  NDrawer,
  NDrawerContent,
  NFormItem,
  NInput,
  NInputNumber,
  NIcon,
  NSelect,
  NSwitch
} from 'naive-ui'
import { ReOrderDotsVertical20Regular as DragHandleIcon } from '@vicons/fluent'
import { uiText } from './ui-text'
import { computed, nextTick, onBeforeUnmount, reactive, ref, useId, watch } from 'vue'

import { ALL_SGPTAG_VALUE, useSgpTagOptions } from '@renderer-shared/composables/useSgpTagOptions'

import type {
  MemberAnalysisCleanupPreview,
  MemberAnalysisSettings,
  MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'

import { MemberAnalysisSettingsSchema } from '@shared/shards/member-analysis'

import { parseRiotId } from './riot-id'

type Member = MemberAnalysisSettings['members'][number]

const props = defineProps<{
  show: boolean
  focusSection?: 'collection' | 'members' | null
  settings: MemberAnalysisSettings
  saving: boolean
  storageStatus: MemberAnalysisStorageStatus | null
  cleanupPreview: MemberAnalysisCleanupPreview | null
  cleaning: boolean
  saveError?: string
  cleanupError?: string
}>()
const emit = defineEmits<{
  'update:show': [value: boolean]
  save: [value: MemberAnalysisSettings, complete: (saved: MemberAnalysisSettings | null) => void]
  'preview-cleanup': []
  'confirm-cleanup': [previewId: string]
}>()

function cloneSettings(settings: MemberAnalysisSettings): MemberAnalysisSettings {
  return {
    enabled: settings.enabled,
    members: settings.members.map((member) => ({ ...member })),
    historyDepth: settings.historyDepth,
    scanLimitPerMember: settings.scanLimitPerMember,
    historyTag: settings.historyTag,
    storageLimitGiB: settings.storageLimitGiB,
    opggEnabled: settings.opggEnabled,
    experimentalPredictionEnabled: settings.experimentalPredictionEnabled ?? false,
    experimentalLpTrendEnabled: settings.experimentalLpTrendEnabled ?? false,
    experimentalVersionTrendEnabled: settings.experimentalVersionTrendEnabled ?? false
  }
}

type SettingsDraft = Omit<MemberAnalysisSettings, 'scanLimitPerMember' | 'storageLimitGiB'> & {
  scanLimitPerMember: number | null
  storageLimitGiB: number | null
}
const draft = reactive<SettingsDraft>(cloneSettings(props.settings))
const baseline = ref(cloneSettings(props.settings))
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(baseline.value))
const pendingSave = ref<symbol | null>(null)
watch(
  () => props.settings,
  (settings) => {
    if (dirty.value || pendingSave.value) return
    baseline.value = cloneSettings(settings)
    Object.assign(draft, cloneSettings(settings))
  },
  { deep: true }
)
onBeforeUnmount(() => {
  pendingSave.value = null
})
function saveDraft() {
  if (props.saving || pendingSave.value) return
  const parsed = MemberAnalysisSettingsSchema.safeParse(draft)
  if (!parsed.success || !valid.value) {
    void showIssues()
    return
  }
  const submittedDraft = JSON.stringify(draft)
  const token = Symbol('settings-save')
  pendingSave.value = token
  emit('save', cloneSettings(parsed.data), (saved) => {
    if (pendingSave.value !== token) return
    pendingSave.value = null
    if (!saved) return
    baseline.value = cloneSettings(saved)
    // The response acknowledges only the submitted revision, never newer input.
    if (JSON.stringify(draft) !== submittedDraft) return
    Object.assign(draft, cloneSettings(saved))
    emit('update:show', false)
  })
}
const confirmDiscard = ref(false)
const feedback = ref<HTMLElement | null>(null)
const cleanupConfirmation = ref<HTMLElement | null>(null)
watch(
  () => props.cleanupPreview,
  async (preview) => {
    if (!preview || !props.show) return
    await nextTick()
    cleanupConfirmation.value?.scrollIntoView({ block: 'nearest' })
    cleanupConfirmation.value?.focus({ preventScroll: true })
  }
)
watch([() => props.saveError, confirmDiscard], async ([error, discard]) => {
  if (!error && !discard) return
  await nextTick()
  feedback.value?.scrollIntoView({ block: 'start' })
  feedback.value?.focus({ preventScroll: true })
})
function requestClose(show: boolean) {
  if (show) {
    emit('update:show', true)
    return
  }
  if (props.saving || pendingSave.value) return
  if (dirty.value) confirmDiscard.value = true
  else emit('update:show', false)
}
function discard() {
  pendingSave.value = null
  baseline.value = cloneSettings(props.settings)
  Object.assign(draft, cloneSettings(props.settings))
  confirmDiscard.value = false
  emit('update:show', false)
}
watch(
  () => props.show,
  (show) => {
    if (!show) pendingSave.value = null
    memberOrderFeedback.value = ''
    confirmDiscard.value = false
    touched.value.clear()
    revealIssues.value = false
  }
)
const formId = useId()
const touched = ref(new Set<string>())
const revealIssues = ref(false)
const collectionHeading = ref<HTMLElement | null>(null)
type MemberField = 'serverId' | 'gameName' | 'tagLine'
const memberFields: { key: MemberField; label: string; placeholder: string }[] = [
  { key: 'serverId', label: '服务器 ID', placeholder: '服务器 ID' },
  { key: 'gameName', label: '成员名称', placeholder: 'Riot ID（可粘贴 名称#Tag）' },
  { key: 'tagLine', label: 'Tag', placeholder: 'Tag' }
]
const memberKey = (index: number, field: MemberField) => 'member-' + index + '-' + field
const errorId = (key: string) => formId + '-error-' + key
const validationIssues = computed(() => {
  const issues: { key: string; message: string }[] = []
  if (draft.enabled && draft.members.length < 5)
    issues.push({
      key: 'members',
      message: uiText('settingsMemberCount', { count: draft.members.length })
    })
  const parsed = MemberAnalysisSettingsSchema.safeParse(draft)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [field, index, memberField] = issue.path
      const key =
        field === 'members' && typeof index === 'number' && memberField
          ? memberKey(index, memberField as MemberField)
          : String(field)
      const messageKey =
        field === 'members' && memberField
          ? memberField === 'serverId'
            ? 'settingsServerInvalid'
            : memberField === 'gameName'
              ? 'settingsNameInvalid'
              : 'settingsTagInvalid'
          : field === 'scanLimitPerMember'
            ? 'settingsScanInteger'
            : field === 'storageLimitGiB'
              ? 'settingsStorageInvalid'
              : field === 'historyDepth'
                ? 'settingsHistoryInvalid'
                : field === 'historyTag'
                  ? 'settingsModeRequired'
                  : 'settingsFieldInvalid'
      if (!issues.some((existing) => existing.key === key))
        issues.push({ key, message: uiText(messageKey) })
    }
  }
  return issues
})
const valid = computed(() => validationIssues.value.length === 0)
function touch(key: string) {
  touched.value.add(key)
}
function fieldError(key: string) {
  return revealIssues.value || touched.value.has(key)
    ? (validationIssues.value.find((issue) => issue.key === key)?.message ?? '')
    : ''
}
function validationInputProps(key: string) {
  const error = fieldError(key)
  return { 'aria-invalid': Boolean(error), 'aria-describedby': error ? errorId(key) : undefined }
}
function memberInputProps(member: Member, index: number, field: MemberField) {
  return {
    ...validationInputProps(memberKey(index, field)),
    ...(field === 'gameName' ? riotIdInputProps(member) : {})
  }
}
async function showIssues() {
  revealIssues.value = true
  await nextTick()
  const key = validationIssues.value[0]?.key
  if (!key) return
  const root = memberList.value?.closest('.member-analysis-settings')
  const field = root?.querySelector<HTMLElement>('[data-validation-key="' + key + '"]')
  field?.scrollIntoView({ block: 'center' })
  const control =
    field?.querySelector<HTMLElement>('input') ??
    field?.querySelector<HTMLElement>('button, [tabindex="0"]') ??
    field
  control?.focus({ preventScroll: true })
}
async function focusRequestedSection() {
  if (!props.show || !props.focusSection) return
  await nextTick()
  const target = props.focusSection === 'collection' ? collectionHeading.value : memberList.value
  target?.scrollIntoView({ block: 'start' })
  target?.focus({ preventScroll: true })
}
watch(() => props.focusSection, focusRequestedSection)
const akariHistoryTagOptions = useSgpTagOptions()
const historyTagOptions = computed(() =>
  (akariHistoryTagOptions.value as any[])
    .map((group) =>
      group.type === 'group'
        ? {
            ...group,
            children: group.children
              ?.filter((option: { value?: unknown }) => option.value !== ALL_SGPTAG_VALUE)
              .map((option: { value?: unknown }) =>
                option.value === 'ranked' ? { ...option, label: uiText('rankedModes') } : option
              )
          }
        : group
    )
    .filter((group) => group.type !== 'group' || group.children?.length)
)
const historyOptions: { label: string; value: number | 'all' }[] = [
  20, 50, 100, 200, 500, 1000
].map((value) => ({
  label: uiText('collectionRecent', { count: value }),
  value
}))
historyOptions.push({ label: uiText('collectionAll'), value: 'all' })
const memberList = ref<HTMLElement | null>(null)
// Draft-only keys follow the whole member object through edits and reordering.
// They are never persisted or used as player identities or historical slots.
const memberRowKeys = new WeakMap<Member, number>()
let nextMemberRowKey = 0
function memberRowKey(member: Member) {
  let key = memberRowKeys.get(member)
  if (key === undefined) {
    key = ++nextMemberRowKey
    memberRowKeys.set(member, key)
  }
  return key
}
const memberOrderFeedback = ref('')
const draggedMember = ref<Member | null>(null)
const dropTarget = ref<Member | null>(null)
const dropAfter = ref(false)
const dragOriginalOrder = ref<Member[] | null>(null)
const memberPreview = ref<Member[] | null>(null)
const displayedMembers = computed(() => memberPreview.value ?? draft.members)
const sortingLocked = computed(() => props.saving || pendingSave.value !== null)
const memberDragType = 'application/x-akari-member-order'
function cancelMemberDrag(event?: KeyboardEvent) {
  if (draggedMember.value && event) {
    event.preventDefault()
    event.stopPropagation()
  }
  draggedMember.value = null
  dropTarget.value = null
  memberPreview.value = null
  dragOriginalOrder.value = null
}
watch([() => props.show, sortingLocked], () => cancelMemberDrag(), { flush: 'sync' })
function startMemberDrag(event: DragEvent, member: Member) {
  if (sortingLocked.value || !event.dataTransfer || !draft.members.includes(member)) {
    event.preventDefault()
    return
  }
  draggedMember.value = member
  dragOriginalOrder.value = draft.members.slice()
  memberPreview.value = draft.members.slice()
  event.dataTransfer.effectAllowed = 'move'
  const row = (event.currentTarget as HTMLElement | null)?.closest('.member-analysis-member')
  if (row && row instanceof HTMLElement) {
    const bounds = row.getBoundingClientRect()
    event.dataTransfer.setDragImage(row, event.clientX - bounds.left, event.clientY - bounds.top)
  }
  // Only a draft-local opaque row key is put on the OS drag clipboard, never a Riot ID.
  event.dataTransfer.setData(memberDragType, String(memberRowKey(member)))
}
function allowMemberDrop(event: DragEvent) {
  if (sortingLocked.value || !draggedMember.value || !memberPreview.value) return false
  // Capture covers native inputs/SVG/controls and the gaps exposed during FLIP.
  // Accept only this drawer's active internal move, never external data or a locked save.
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  return true
}
function dragOverMember(event: DragEvent, member: Member) {
  if (!allowMemberDrop(event)) return
  const source = draggedMember.value
  const order = memberPreview.value
  if (!source || !order || member === source) return
  const preview = order.slice()
  const index = preview.indexOf(source)
  const target = preview.indexOf(member)
  if (index < 0 || target < 0) return
  const list = memberList.value?.querySelector<HTMLElement>('.member-order-list')
  const row = list?.querySelector<HTMLElement>(`[data-member-row="${memberRowKey(member)}"]`)
  if (row && list) {
    // offsetTop is the destination slot, unlike getBoundingClientRect during FLIP.
    // Crossing that stable midpoint prevents repeated dragovers reversing a preview.
    const center = list.getBoundingClientRect().top + row.offsetTop + row.offsetHeight / 2
    if (
      (index < target && event.clientY < center - 2) ||
      (index > target && event.clientY > center + 2)
    )
      return
  } else if (dropTarget.value === member) return
  dropTarget.value = member
  dropAfter.value = index < target
  preview.splice(index, 1)
  preview.splice(target, 0, source)
  // Only the keyed visual order changes while held. Cancel restores the untouched draft.
  memberPreview.value = preview
}
function dragOverMemberList(event: DragEvent) {
  if (!allowMemberDrop(event)) return
  const list = memberList.value?.querySelector<HTMLElement>('.member-order-list')
  if (!list) return
  const top = list.getBoundingClientRect().top
  const target =
    displayedMembers.value.find((member) => {
      const row = list.querySelector<HTMLElement>(`[data-member-row="${memberRowKey(member)}"]`)
      return row && event.clientY < top + row.offsetTop + row.offsetHeight
    }) ?? displayedMembers.value.at(-1)
  if (target) dragOverMember(event, target)
}
async function dropMember(event: DragEvent, member?: Member) {
  const source = draggedMember.value
  const order = memberPreview.value
  if (
    sortingLocked.value ||
    !source ||
    !order ||
    (member !== undefined && !order.includes(member)) ||
    !dragOriginalOrder.value?.every((entry, index) => draft.members[index] === entry) ||
    order.length !== draft.members.length ||
    event.dataTransfer?.getData(memberDragType) !== String(memberRowKey(source))
  ) {
    cancelMemberDrag()
    return
  }
  event.preventDefault()
  const target = order.indexOf(source)
  cancelMemberDrag()
  draft.members.splice(0, draft.members.length, ...order)
  touched.value.clear()
  memberOrderFeedback.value = `${source.gameName}#${source.tagLine} 已移至第 ${target + 1} 位`
  await focusMemberHandle(source)
}
function moveMemberByKey(event: KeyboardEvent, member: Member) {
  const index = draft.members.indexOf(member)
  const target =
    event.key === 'ArrowUp'
      ? index - 1
      : event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? draft.members.length - 1
            : null
  if (target === null) return
  event.preventDefault()
  cancelMemberDrag()
  void moveMember(index, target)
}
async function moveMember(index: number, target: number) {
  if (
    props.saving ||
    pendingSave.value ||
    index < 0 ||
    index >= draft.members.length ||
    target < 0 ||
    target >= draft.members.length ||
    target === index
  )
    return
  const member = draft.members[index]
  draft.members.splice(index, 1)
  draft.members.splice(target, 0, member)
  touched.value.clear()
  memberOrderFeedback.value = `${member.gameName}#${member.tagLine} 已移至第 ${target + 1} 位`
  await focusMemberHandle(member)
}
async function focusMemberHandle(member: Member) {
  await nextTick()
  const row = memberList.value?.querySelector<HTMLElement>(
    `[data-member-row="${memberRowKey(member)}"]`
  )
  row?.querySelector<HTMLButtonElement>('.member-drag-handle')?.focus()
}
async function addMember() {
  if (sortingLocked.value || draggedMember.value || draft.members.length >= 20) return
  memberOrderFeedback.value = ''
  draft.members.push({ serverId: '', gameName: '', tagLine: '' })
  await nextTick()
  memberList.value
    ?.querySelector<HTMLInputElement>('.member-analysis-member:last-child input')
    ?.focus()
}
async function removeMember(index: number) {
  if (sortingLocked.value || draggedMember.value) return
  memberOrderFeedback.value = ''
  draft.members.splice(index, 1)
  touched.value.clear()
  await nextTick()
  const rows = memberList.value?.querySelectorAll('.member-analysis-member')
  rows?.[Math.min(index, rows.length - 1)]?.querySelector<HTMLInputElement>('input')?.focus()
}

function riotIdInputProps(member: Member) {
  return {
    onPaste: (event: ClipboardEvent) => {
      const parsed = parseRiotId(event.clipboardData?.getData('text/plain') ?? '')
      if (!parsed) return

      event.preventDefault()
      member.gameName = parsed.gameName
      member.tagLine = parsed.tagLine
    }
  }
}

function formatBytes(value: number) {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MiB`
  return `${(value / 1024 ** 3).toFixed(2)} GiB`
}
</script>

<style scoped>
.member-analysis-settings {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.member-analysis-settings__row,
.member-analysis-settings__section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.member-analysis-settings__label,
.member-analysis-settings__section-title {
  font-weight: 500;
}
.member-analysis-settings__description,
.member-analysis-settings__empty {
  margin-top: 4px;
  color: color-mix(in srgb, var(--la-color-text-primary) 62%, transparent);
  font-size: 12px;
  line-height: 1.6;
}
.member-analysis-settings__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.member-analysis-settings__field > :deep(.n-select),
.member-analysis-settings__field > :deep(.n-input-number) {
  width: 100%;
}
.member-analysis-member {
  position: relative;
  display: grid;
  align-items: center;
  box-sizing: border-box;
  min-height: 50px;
  grid-template-columns: 24px 84px minmax(120px, 1fr) 76px auto;
  gap: 8px;
  margin-top: 0;
}
.member-order-list {
  position: relative;
  margin-top: 8px;
}
.member-analysis-storage {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.member-analysis-settings > section {
  padding-top: 16px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.16);
}
.member-analysis-storage__confirm {
  margin-top: 8px;
}
@media (max-width: 560px) {
  .member-analysis-member {
    grid-template-columns: 1fr 1fr;
  }
}
.settings-group-heading {
  margin: 8px 0 0;
  padding-top: 20px;
  border-top: 1px solid var(--ma-grid);
  font-size: 16px;
  font-weight: 600;
}
.member-analysis-settings__description {
  color: var(--ma-muted);
}
.member-analysis-member {
  padding: 8px 0;
  border-bottom: 0;
  box-shadow: inset 0 -1px var(--ma-grid);
}
.member-order-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}
.member-order-actions :deep(.n-button) {
  min-height: 24px;
  min-width: 24px;
  padding-inline: 4px;
}
.member-drag-handle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  box-sizing: border-box;
  width: 24px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--ma-muted);
  font: inherit;
  cursor: grab;
}
.member-drag-handle:active {
  cursor: grabbing;
}
.member-drag-handle:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.member-drag-handle:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 1px;
}
.member-drop-target {
  outline: 1px solid var(--la-color-link);
  outline-offset: 1px;
}
.member-drop-target::after {
  position: absolute;
  top: -1px;
  right: 0;
  left: 0;
  height: 2px;
  background: var(--la-color-link);
  content: '';
  pointer-events: none;
}
.member-drop-after::after {
  top: auto;
  bottom: -1px;
}
.member-order-move {
  transition: transform 180ms cubic-bezier(0.25, 1, 0.5, 1);
}
@media (prefers-reduced-motion: reduce) {
  .member-order-move {
    transition: none !important;
  }
}
/* Keep the alert's native warning surface; only align this confirmation's content. */
.settings-discard-content,
.settings-discard-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}
.settings-discard-content {
  gap: 12px;
}
.settings-discard-message {
  flex: 1 1 140px;
  min-width: 0;
}
.settings-discard-actions {
  gap: 8px;
  max-width: 100%;
}
.settings-discard-warning :deep(.n-alert__icon) {
  top: 50%;
  margin-top: 0;
  margin-bottom: 0;
  transform: translateY(-50%);
}
.settings-feedback {
  display: grid;
  gap: 12px;
  outline-offset: 3px;
}
</style>

<style scoped>
.settings-field-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--ma-negative);
  line-height: 1.5;
}
.member-input-field {
  min-width: 0;
}
.settings-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}
.settings-validation-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}
</style>
