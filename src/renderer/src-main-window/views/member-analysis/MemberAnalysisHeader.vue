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
      <NButton aria-label="设置" secondary @click="$emit('settings')">
        <template #icon><NIcon :component="SettingsRound" /></template>
        设置
      </NButton>
    </div>
  </header>
</template>

<script setup lang="ts">
import { AnalyticsRound, RefreshRound, SettingsRound } from '@vicons/material'
import { NButton, NIcon } from 'naive-ui'
import { computed } from 'vue'

const props = defineProps<{
  generatedAt: string | null
  loading: boolean
  refreshDisabled: boolean
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

defineEmits<{
  refresh: []
  settings: []
}>()
</script>

<style scoped>
.member-analysis-header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 20px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
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
  flex: none;
  gap: 8px;
}

@media (max-width: 720px) {
  .member-analysis-header {
    align-items: flex-start;
    padding: 14px 16px 12px;
  }

  .member-analysis-heading__subtitle time {
    display: none;
  }

  .member-analysis-header__actions :deep(.n-button__content) {
    font-size: 0;
  }

  .member-analysis-header__actions :deep(.n-button__icon) {
    margin: 0;
  }
}
</style>
