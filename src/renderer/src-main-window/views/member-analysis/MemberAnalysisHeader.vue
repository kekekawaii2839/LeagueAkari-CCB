<template>
  <header class="member-analysis-header">
    <div class="member-analysis-heading">
      <NIcon class="member-analysis-heading__icon" :component="AnalyticsRound" aria-hidden="true" />
      <div>
        <div id="member-analysis-title" class="member-analysis-heading__title">成员分析</div>
        <div class="member-analysis-heading__subtitle">
          <time v-if="generatedAt" :datetime="generatedAt">更新于 {{ formattedGeneratedAt }}</time>
        </div>
      </div>
    </div>

    <div v-if="$slots.filters" class="member-analysis-header__filters"><slot name="filters" /></div>

    <div class="member-analysis-header__actions">
      <NButton
        aria-label="刷新"
        secondary
        :disabled="refreshDisabled"
        :loading="loading"
        @click="$emit('refresh')"
      >
        <template #icon><NIcon :component="RefreshRound" /></template>
        刷新
      </NButton>
      <NPopover
        v-if="refreshReason"
        v-model:show="reasonOpen"
        trigger="click"
        placement="bottom"
        :style="{ maxWidth: '300px' }"
      >
        <template #trigger
          ><NButton
            ref="reasonTrigger"
            size="small"
            quaternary
            :aria-label="uiText('refreshDisabledHelp')"
            :aria-expanded="reasonOpen"
            @keydown.esc.prevent="closeReason"
            ><template #icon><NIcon :component="InfoOutlined" /></template></NButton
        ></template>
        <div class="refresh-reason-content" @keydown.esc.prevent.stop="closeReason">
          <p>{{ refreshReason.text }}</p>
          <NButton
            v-if="refreshReason.kind !== 'service'"
            size="small"
            @click="openReasonSettings"
            >{{
              uiText(refreshReason.kind === 'members' ? 'configureMembers' : 'openSettings')
            }}</NButton
          >
        </div>
      </NPopover>
      <NButton aria-label="设置" secondary @click="$emit('settings')">
        <template #icon><NIcon :component="SettingsRound" /></template>
        设置
      </NButton>
    </div>
    <p v-if="refreshReason?.kind === 'service'" class="refresh-unavailable" role="status">
      {{ refreshReason.text }}
    </p>
  </header>
</template>

<script setup lang="ts">
import { AnalyticsRound, InfoOutlined, RefreshRound, SettingsRound } from '@vicons/material'
import { NButton, NIcon, NPopover } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { uiText } from './ui-text'

const props = defineProps<{
  generatedAt: string | null
  loading: boolean
  refreshDisabled: boolean
  refreshReason?: { kind: 'closed' | 'members' | 'service'; text: string } | null
}>()

const formattedGeneratedAt = computed(() => {
  if (!props.generatedAt) return ''
  const value = new Date(props.generatedAt)
  if (!Number.isFinite(value.getTime())) return props.generatedAt
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(value)
})

const emit = defineEmits<{
  refresh: []
  settings: [section?: 'members' | null]
}>()
const reasonOpen = ref(false)
const reasonTrigger = ref<InstanceType<typeof NButton> | null>(null)
async function closeReason() {
  reasonOpen.value = false
  await nextTick()
  reasonTrigger.value?.$el?.focus()
}
function openReasonSettings() {
  reasonOpen.value = false
  emit('settings', props.refreshReason?.kind === 'members' ? 'members' : null)
}
watch(
  () => props.refreshReason?.kind,
  () => {
    reasonOpen.value = false
  }
)
</script>

<style scoped>
.member-analysis-header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  flex: none;
  min-width: 0;
  align-items: start;
  column-gap: 24px;
  row-gap: 12px;
  padding: 10px 20px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
}

.member-analysis-header__filters {
  min-width: 0;
  width: 100%;
}

.member-analysis-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12px;
}

.member-analysis-heading__icon {
  flex: none;
  color: var(--la-color-link);
  font-size: 20px;
}

.member-analysis-heading__title {
  font-size: 17px;
  font-weight: 600;
  line-height: 1.25;
}

.member-analysis-heading__subtitle {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 2px;
  color: color-mix(in srgb, var(--la-color-text-primary) 62%, transparent);
  font-size: 12px;
}

.member-analysis-header__actions {
  display: flex;
  grid-column: 3;
  flex: none;
  gap: 8px;
}

@media (max-width: 720px) {
  .member-analysis-header {
    column-gap: 16px;
    row-gap: 8px;
    padding: 8px 12px;
  }
  .member-analysis-heading {
    gap: 8px;
  }
}
</style>

<style scoped>
.refresh-unavailable {
  grid-column: 1 / -1;
  flex-basis: 100%;
  margin: 0;
  font-size: 12px;
  color: var(--ma-muted);
}
.refresh-reason-content {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}
.refresh-reason-content p {
  margin: 0;
}
</style>
