<template>
  <div ref="scrollRoot" class="member-analysis-segments" role="tablist" :aria-label="ariaLabel">
    <NTabs
      class="member-analysis-segments__tabs"
      :value="modelValue"
      :style="{ '--segment-slot': `${slotWidth}px`, width: `${options.length * slotWidth + 6}px` }"
      :tab-style="{ fontSize: '14px' }"
      :theme-overrides="{
        colorSegment: 'var(--la-card-muted-surface)',
        tabColorSegment: 'color-mix(in srgb, var(--la-color-link) 12%, var(--la-card-surface-95))',
        tabTextColorSegment: 'var(--la-color-text-primary)',
        tabTextColorActiveSegment: 'var(--la-color-text-primary)',
        tabTextColorHoverSegment: 'var(--la-color-link)'
      }"
      type="segment"
      size="small"
      @update:value="select"
    >
      <NTab
        v-for="(option, index) in options"
        :key="option.value"
        :name="option.value"
        :tab="renderLabel ? () => renderLabel?.(option) : option.label"
        :disabled="option.disabled"
        role="tab"
        :aria-selected="modelValue === option.value"
        :aria-disabled="option.disabled || undefined"
        :aria-controls="ariaControls"
        :tabindex="!option.disabled && option.value === focusValue ? 0 : -1"
        @keydown="onKey($event, index)"
      />
    </NTabs>
  </div>
</template>

<script setup lang="ts">
import { NTab, NTabs } from 'naive-ui'
import { computed, nextTick, ref, type VNodeChild } from 'vue'

type SegmentValue = string | number
const props = withDefaults(
  defineProps<{
    modelValue: SegmentValue
    options: readonly { value: SegmentValue; label: string; disabled?: boolean }[]
    renderLabel?: (option: { value: SegmentValue; label: string; disabled?: boolean }) => VNodeChild
    slotWidth?: number
    ariaLabel: string
    ariaControls?: string
  }>(),
  { slotWidth: 112 }
)
const emit = defineEmits<{ 'update:modelValue': [value: SegmentValue] }>()
const scrollRoot = ref<HTMLElement | null>(null)
const focusValue = computed(
  () =>
    props.options.find((option) => option.value === props.modelValue && !option.disabled)?.value ??
    props.options.find((option) => !option.disabled)?.value
)
function select(value: SegmentValue) {
  if (props.options.some((option) => option.value === value && !option.disabled))
    emit('update:modelValue', value)
}
async function onKey(event: KeyboardEvent, index: number) {
  if (props.options[index]?.disabled) return
  const enabled = props.options.map((option, i) => (option.disabled ? -1 : i)).filter((i) => i >= 0)
  const position = enabled.indexOf(index)
  let target: number
  switch (event.key) {
    case 'ArrowRight':
      target = enabled[(position + 1) % enabled.length]
      break
    case 'ArrowLeft':
      target = enabled[(position - 1 + enabled.length) % enabled.length]
      break
    case 'Home':
      target = enabled[0]
      break
    case 'End':
      target = enabled[enabled.length - 1]
      break
    case 'Enter':
    case ' ':
      target = index
      break
    default:
      return
  }
  event.preventDefault()
  select(props.options[target].value)
  await nextTick()
  const root = scrollRoot.value
  const tab = root?.querySelectorAll<HTMLElement>('[role="tab"]')[target]
  tab?.focus({ preventScroll: true })
  if (root && tab) {
    const viewport = root.getBoundingClientRect()
    const bounds = tab.getBoundingClientRect()
    if (bounds.left < viewport.left) root.scrollLeft -= viewport.left - bounds.left
    else if (bounds.right > viewport.right) root.scrollLeft += bounds.right - viewport.right
  }
}
</script>

<style scoped>
.member-analysis-segments {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}
.member-analysis-segments__tabs {
  flex: none;
}
.member-analysis-segments :deep(.n-tabs-rail) {
  width: 100%;
  box-sizing: border-box;
}
.member-analysis-segments :deep(.n-tabs-rail > .n-tabs-tab-wrapper) {
  flex: 0 0 var(--segment-slot);
  min-width: var(--segment-slot);
  max-width: var(--segment-slot);
}
/* More specific than the containing analysis page's deep sticky navigation. */
.member-analysis-segments .member-analysis-segments__tabs :deep(.n-tabs-nav) {
  position: relative;
  top: auto;
  z-index: 1;
  padding-top: 0;
  background: transparent;
}
.member-analysis-segments :deep(.n-tabs-tab) {
  width: 100%;
  box-sizing: border-box;
  white-space: nowrap;
  justify-content: center;
}
.member-analysis-segments :deep(.n-tabs-tab:focus-visible) {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
@media (prefers-reduced-motion: reduce) {
  .member-analysis-segments :deep(.n-tabs-capsule) {
    transition: none;
  }
}
</style>
