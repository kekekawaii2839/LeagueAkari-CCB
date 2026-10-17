<template>
  <NPopover v-model:show="show" trigger="click" placement="bottom" :style="{ maxWidth: '300px' }">
    <template #trigger>
      <button
        ref="trigger"
        type="button"
        class="metric-help"
        :class="{ 'metric-help--icon-only': iconOnly }"
        :aria-expanded="show"
        :aria-label="iconOnly ? `${label}说明` : undefined"
      >
        <span v-if="!iconOnly" class="metric-help__label">{{ label }}</span>
        <NIcon class="metric-help__icon" :component="InfoOutlined" :size="16" aria-hidden="true" />
      </button>
    </template>
    <div class="metric-help-content">
      <p>{{ definition }}</p>
    </div>
  </NPopover>
</template>
<script setup lang="ts">
import { InfoOutlined } from '@vicons/material'
import { NIcon, NPopover } from 'naive-ui'
import { nextTick, onDeactivated, ref, watch } from 'vue'
defineProps<{ label: string; definition: string; iconOnly?: boolean }>()
const show = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
async function close() {
  show.value = false
  await nextTick()
  if (trigger.value?.getClientRects().length) trigger.value.focus({ preventScroll: true })
}
// Lazy analysis panes stay mounted when hidden. Dismiss their teleported help
// instead of leaving an explanation (or a hidden focus target) on the next page.
watch(show, (open, _previous, onCleanup) => {
  if (!open || typeof document === 'undefined') return
  document.addEventListener('keydown', onKeydown)
  const observer =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          if (!trigger.value?.getClientRects().length) show.value = false
        })
  for (let ancestor = trigger.value?.parentElement; ancestor; ancestor = ancestor.parentElement)
    observer?.observe(ancestor, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'inert', 'aria-hidden']
    })
  onCleanup(() => {
    observer?.disconnect()
    document.removeEventListener('keydown', onKeydown)
  })
})
onDeactivated(() => {
  show.value = false
})
function onKeydown(event: KeyboardEvent) {
  if (show.value && event.key === 'Escape') {
    event.preventDefault()
    void close()
  }
}
</script>
<style scoped>
.metric-help {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  vertical-align: middle;
  box-sizing: border-box;
  font: inherit;
  line-height: 1.5;
  color: inherit;
  background: transparent;
  border: 0;
  padding: 4px 0;
  min-height: 32px;
  min-width: 24px;
  text-align: inherit;
  cursor: pointer;
}
.metric-help--icon-only {
  justify-content: center;
  width: 32px;
  padding: 0;
}
.metric-help__label {
  min-width: 0;
}
.metric-help .metric-help__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  flex: 0 0 16px;
  line-height: 1;
  vertical-align: middle;
  color: var(--ma-muted);
}
.metric-help__icon :deep(svg) {
  display: block;
}
.metric-help-content p {
  margin: 0;
  line-height: 1.6;
}
</style>
