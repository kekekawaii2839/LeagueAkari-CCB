<template>
  <NPopover v-model:show="show" trigger="click" placement="bottom" :style="{ maxWidth: '300px' }">
    <template #trigger>
      <button ref="trigger" type="button" class="metric-help" :aria-expanded="show">
        {{ label }} <span aria-hidden="true">ⓘ</span>
      </button>
    </template>
    <div class="metric-help-content">
      <p>{{ definition }}</p>
      <NButton size="small" @click="close">{{ uiText('closeHelp') }}</NButton>
    </div>
  </NPopover>
</template>
<script setup lang="ts">
import { NButton, NPopover } from 'naive-ui'
import { nextTick, onMounted, onUnmounted, ref } from 'vue'
import { uiText } from './ui-text'
defineProps<{ label: string; definition: string }>()
const show = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
async function close() {
  show.value = false
  await nextTick()
  trigger.value?.focus()
}
function onKeydown(event: KeyboardEvent) {
  if (show.value && event.key === 'Escape') {
    event.preventDefault()
    void close()
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>
<style scoped>
.metric-help {
  font: inherit;
  color: inherit;
  background: transparent;
  border: 0;
  padding: 4px 0;
  min-height: 32px;
  text-align: inherit;
  cursor: pointer;
}
.metric-help > span {
  font-size: 12px;
  opacity: 0.75;
}
.metric-help-content p {
  margin: 0 0 12px;
  line-height: 1.6;
}
</style>
