<template>
  <NDrawer
    :show="show"
    :width="520"
    style="max-width: 100%"
    placement="right"
    to=".member-analysis-page"
    @update:show="requestClose"
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
          <NAlert v-if="confirmDiscard" type="warning">
            {{ uiText('discard') }}
            <NButton @click="discard">{{ uiText('discardConfirm') }}</NButton>
            <NButton @click="confirmDiscard = false">{{ uiText('keepEditing') }}</NButton>
          </NAlert>
        </div>
        <div class="member-analysis-settings__row">
          <div>
            <div class="member-analysis-settings__label">启用成员分析</div>
            <div class="member-analysis-settings__description">
              关闭后停止更新，已保存的本地分析数据不会自动删除。
            </div>
          </div>
          <NSwitch v-model:value="draft.enabled" />
        </div>

        <h3 class="settings-group-heading">采集范围</h3>
        <NFormItem label="固定五人结果目标">
          <div class="member-analysis-settings__field">
            <NSelect v-model:value="draft.historyDepth" :options="historyOptions" />
            <div class="member-analysis-settings__description">
              选择“全部”时不裁剪最终有效样本，持续扫描到历史耗尽或下方安全上限。
            </div>
          </div>
        </NFormItem>
        <NFormItem label="单成员历史扫描安全上限">
          <div class="member-analysis-settings__field">
            <NInputNumber
              v-model:value="draft.scanLimitPerMember"
              :min="100"
              :max="5000"
              :step="100"
            />
            <div class="member-analysis-settings__description">
              每名成员最多读取的历史条目数。数值越高越可能找到更早的固定五人对局，但刷新时间和本地占用也会增加。
            </div>
          </div>
        </NFormItem>
        <NFormItem label="比赛模式">
          <div class="member-analysis-settings__field">
            <NSelect v-model:value="draft.historyTag" :options="historyTagOptions" />
            <div class="member-analysis-settings__description">
              “排位积分类模式”沿用 League Akari 的 SGP ranked
              定义；选择“5人排位赛”等具体模式时则只读取该模式。
            </div>
          </div>
        </NFormItem>

        <h3 class="settings-group-heading">存储与参考</h3>
        <NFormItem label="本地存储软上限（GiB）">
          <NInputNumber v-model:value="draft.storageLimitGiB" :min="1" :max="1000" />
        </NFormItem>

        <div class="member-analysis-settings__row">
          <div>
            <div class="member-analysis-settings__label">OP.GG 公共参考数据</div>
            <div class="member-analysis-settings__description">
              默认关闭。开启也不得发送 Riot ID、PUUID、gameId 或比赛数据。
            </div>
          </div>
          <NSwitch v-model:value="draft.opggEnabled" />
        </div>

        <section ref="memberList">
          <div class="member-analysis-settings__section-title">
            <span>固定成员列表</span>
            <NButton size="tiny" :disabled="draft.members.length >= 20" @click="addMember"
              >添加成员</NButton
            >
          </div>
          <div v-if="!draft.members.length" class="member-analysis-settings__empty">
            {{ uiText('membersRequired') }}
          </div>
          <div v-for="(member, index) in draft.members" :key="index" class="member-analysis-member">
            <NInput
              v-model:value="member.serverId"
              aria-label="服务器 ID"
              placeholder="服务器 ID"
            />
            <NInput
              v-model:value="member.gameName"
              :input-props="riotIdInputProps(member)"
              aria-label="成员名称"
              placeholder="Riot ID（可粘贴 名称#Tag）"
            />
            <NInput v-model:value="member.tagLine" aria-label="Tag" placeholder="Tag" />
            <NButton quaternary type="error" @click="removeMember(index)">删除</NButton>
          </div>
        </section>

        <NAlert type="info" title="隐私与本地数据">
          登录凭据仅用于本机读取，不会写入分析数据或日志。玩家数据只保存在本机应用数据目录。
        </NAlert>

        <section class="member-analysis-storage">
          <NAlert v-if="cleanupError" type="error">{{ cleanupError }}</NAlert>
          <div class="member-analysis-settings__section-title">本地数据清理</div>
          <div class="member-analysis-settings__description">
            当前占用 {{ formatBytes(storageStatus?.totalBytes ?? 0) }}；软上限
            {{ formatBytes(storageStatus?.limitBytes ?? draft.storageLimitGiB * 1024 ** 3) }}。
            不会自动删除数据；清理仅移除最旧的历史原始数据，并保留设置和当前分析结果。
          </div>
          <NButton :loading="cleaning" @click="$emit('preview-cleanup')">预览清理</NButton>
          <div
            v-if="cleanupPreview"
            ref="cleanupConfirmation"
            tabindex="-1"
            class="settings-feedback"
          >
            <NAlert type="warning" title="需要二次确认">
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

        <p v-if="!valid" role="status">{{ uiText('membersRequired') }}</p>
      </div>
      <template #footer
        ><NButton type="primary" :loading="saving" :disabled="!valid" @click="$emit('save', draft)"
          >保存设置</NButton
        ></template
      >
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
  NSelect,
  NSwitch
} from 'naive-ui'
import { uiText } from './ui-text'
import { computed, nextTick, reactive, ref, watch } from 'vue'

import { ALL_SGPTAG_VALUE, useSgpTagOptions } from '@renderer-shared/composables/useSgpTagOptions'

import type {
  MemberAnalysisCleanupPreview,
  MemberAnalysisSettings,
  MemberAnalysisStorageStatus
} from '@shared/shards/member-analysis'

import { parseRiotId } from './riot-id'

type Member = MemberAnalysisSettings['members'][number]

const props = defineProps<{
  show: boolean
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
  save: [value: MemberAnalysisSettings]
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
    opggEnabled: settings.opggEnabled
  }
}

const draft = reactive<MemberAnalysisSettings>(cloneSettings(props.settings))
watch(
  () => props.settings,
  (settings) => Object.assign(draft, cloneSettings(settings)),
  { deep: true }
)
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
  if (props.saving) return
  if (JSON.stringify(draft) !== JSON.stringify(cloneSettings(props.settings)))
    confirmDiscard.value = true
  else emit('update:show', false)
}
function discard() {
  Object.assign(draft, cloneSettings(props.settings))
  confirmDiscard.value = false
  emit('update:show', false)
}
watch(
  () => props.show,
  () => {
    confirmDiscard.value = false
  }
)
const valid = computed(
  () =>
    (!draft.enabled || draft.members.length >= 5) &&
    draft.members.every((member) => member.serverId && member.gameName && member.tagLine) &&
    Boolean(draft.historyTag) &&
    draft.scanLimitPerMember >= 100 &&
    draft.scanLimitPerMember <= 5000
)
const akariHistoryTagOptions = useSgpTagOptions()
const historyTagOptions = computed(() =>
  (akariHistoryTagOptions.value as any[])
    .map((group) =>
      group.type === 'group'
        ? {
            ...group,
            children: group.children?.filter(
              (option: { value?: unknown }) => option.value !== ALL_SGPTAG_VALUE
            )
          }
        : group
    )
    .filter((group) => group.type !== 'group' || group.children?.length)
)
const historyOptions: { label: string; value: number | 'all' }[] = [
  20, 50, 100, 200, 500, 1000
].map((value) => ({
  label: `最近 ${value} 场固定五人有效样本`,
  value
}))
historyOptions.push({ label: '全部有效样本（受扫描安全上限约束）', value: 'all' })
const memberList = ref<HTMLElement | null>(null)
async function addMember() {
  if (draft.members.length >= 20) return
  draft.members.push({ serverId: '', gameName: '', tagLine: '' })
  await nextTick()
  memberList.value
    ?.querySelector<HTMLInputElement>('.member-analysis-member:last-child input')
    ?.focus()
}
async function removeMember(index: number) {
  draft.members.splice(index, 1)
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
  display: grid;
  grid-template-columns: 84px minmax(120px, 1fr) 76px auto;
  gap: 8px;
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
  padding: 12px 0;
  border-bottom: 1px solid var(--ma-grid);
}
.settings-feedback {
  display: grid;
  gap: 12px;
  outline-offset: 3px;
}
</style>
