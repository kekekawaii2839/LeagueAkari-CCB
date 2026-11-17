<template>
  <div class="analysis-settings-pane">
    <MemberAnalysisSettingsDrawer
      v-if="store.settings"
      ref="form"
      embedded
      :show="active"
      :settings="store.settings"
      :focus-section="store.settingsFocus"
      :saving="savingSettings"
      :save-error="settingsError"
      :cleanup-error="cleanupError"
      :storage-status="store.storageStatus"
      :cleanup-preview="store.cleanupPreview"
      :cleaning="cleaning"
      @update:show="emit('discard')"
      @save="saveSettings"
      @preview-cleanup="previewCleanup"
      @confirm-cleanup="confirmCleanup"
    />
    <NResult v-else status="error" title="五排分析设置暂时不可用">
      <template #footer><NButton @click="memberAnalysis.reload()">重试</NButton></template>
    </NResult>
  </div>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import { NButton, NResult, useMessage } from 'naive-ui'
import { useInstance } from '@renderer-shared/shards'
import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import MemberAnalysisSettingsDrawer from '@main-window/views/member-analysis/MemberAnalysisSettingsDrawer.vue'
import { uiText } from '@main-window/views/member-analysis/ui-text'
defineProps<{ active: boolean }>()
const emit = defineEmits<{ discard: [] }>()
const message = useMessage()
const store = useMemberAnalysisStore()
const memberAnalysis = useInstance(MemberAnalysisRenderer)
const form = ref<InstanceType<typeof MemberAnalysisSettingsDrawer> | null>(null)
const savingSettings = ref(false)
const settingsError = ref('')
const cleanupError = ref('')
const cleaning = ref(false)
defineExpose({ canLeave: () => form.value?.requestClose(false) ?? true })
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
    if (result.ok) {
      complete(result.value)
      message.success(uiText('settingsSaved'))
    } else {
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
.analysis-settings-pane {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
</style>
