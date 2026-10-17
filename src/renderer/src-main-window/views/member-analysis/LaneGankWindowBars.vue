<template>
  <div
    ref="root"
    class="gank-window-bars"
    :aria-label="uiText('roleGankWindowScale', { max })"
    :data-gank-scale="max"
  >
    <NPopover
      v-for="(item, index) in items"
      :key="item.key"
      trigger="click"
      placement="top"
      :show="shownWindow === item.key"
      @update:show="shownWindow = $event ? item.key : null"
    >
      <template #trigger>
        <button
          type="button"
          class="gank-window"
          :aria-label="item.accessibleLabel"
          :aria-expanded="shownWindow === item.key"
          :data-gank-window="item.key"
          @keydown.esc.prevent.stop="shownWindow = null"
        >
          <span class="gank-window-tracks" aria-hidden="true">
            <span
              v-for="bar in item.bars"
              :key="bar.tone"
              class="gank-window-track"
              :data-gank-tone="bar.tone"
              :data-gank-value="bar.value ?? 'missing'"
            >
              <i
                v-if="bar.value !== null"
                :style="{ height: `${max > 0 ? (bar.value / max) * 100 : 0}%` }"
              />
              <span
                v-if="bar.value !== null"
                class="gank-window-value"
                :data-gank-value-placement="max > 0 && bar.value / max >= 0.5 ? 'inside' : 'above'"
                :style="{
                  bottom: `calc(${max > 0 ? (bar.value / max) * 100 : 0}% ${max > 0 && bar.value / max >= 0.5 ? '- 16px' : '+ 2px'})`,
                  color: max > 0 && bar.value / max >= 0.5 ? insideColors[bar.tone] : undefined
                }"
                >{{ bar.value }}</span
              >
              <span v-else class="gank-window-missing">—</span>
            </span>
          </span>
          <span v-if="showLabels" class="gank-window-label">{{ labels[index] }}</span>
        </button>
      </template>
      <div>{{ item.label }}</div>
      <div v-for="bar in item.bars.filter((bar) => bar.tone !== 'total')" :key="bar.tone">
        {{ bar.label }}
      </div>
      <div>{{ roleMetricMeta[item.key].description }}</div>
    </NPopover>
  </div>
</template>

<script lang="ts">
function rgbChannels(color: string): number[] | null {
  const hex = color.trim().match(/^#([\da-f]{8}|[\da-f]{6}|[\da-f]{3})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex
    return [
      ...[0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)),
      full.length === 8 ? Number.parseInt(full.slice(6, 8), 16) / 255 : 1
    ]
  }
  const rgb = color
    .trim()
    .match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/i)
  return rgb ? [...rgb.slice(1, 4).map(Number), rgb[4] === undefined ? 1 : Number(rgb[4])] : null
}
export function pillarTextColor(fill: string, themeText: string, themeSurface: string): string {
  const parsedFill = rgbChannels(fill)
  const surface = rgbChannels(themeSurface)
  const candidates = [rgbChannels(themeText), surface]
    .filter((color): color is number[] => color !== null)
    .map((color) => color.slice(0, 3))
  if (!parsedFill || !candidates.length || (parsedFill[3] < 1 && !surface))
    return 'var(--la-color-text-primary)'
  const background = parsedFill
    .slice(0, 3)
    .map(
      (channel, index) => channel * parsedFill[3] + (surface?.[index] ?? 0) * (1 - parsedFill[3])
    )
  const luminance = (color: number[]) =>
    color
      .map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const backgroundLight = luminance(background)
  const contrast = (color: number[]) => {
    const light = luminance(color)
    return (Math.max(light, backgroundLight) + 0.05) / (Math.min(light, backgroundLight) + 0.05)
  }
  const best = candidates.reduce((best, candidate) =>
    contrast(candidate) > contrast(best) ? candidate : best
  )
  if (contrast(best) < 4.5) {
    // Preserve a theme-derived hue where possible, enhancing ink alone until
    // small text is legible. Never change the pillar or add a label surface.
    const endpoint = contrast([0, 0, 0]) >= contrast([255, 255, 255]) ? 0 : 255
    for (let step = 1; step <= 20; step++) {
      const enhanced = best.map((channel) =>
        Math.round(channel + ((endpoint - channel) * step) / 20)
      )
      if (contrast(enhanced) >= 4.5) return `rgb(${enhanced.join(', ')})`
    }
  }
  return `rgb(${best.join(', ')})`
}
</script>

<script setup lang="ts">
import { NPopover } from 'naive-ui'
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { roleMetricMeta } from './metric-defs'
import { uiText } from './ui-text'

const props = withDefaults(
  defineProps<{
    values: readonly unknown[]
    max: number
    showLabels?: boolean
    breakdown?: readonly { label: string; tone: 'blue' | 'red'; values: readonly unknown[] }[]
  }>(),
  { showLabels: false }
)
const root = ref<HTMLElement | null>(null)
const shownWindow = ref<string | null>(null)
function closeWindowOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && shownWindow.value !== null) {
    event.preventDefault()
    shownWindow.value = null
  }
}
const insideColors = ref({
  total: 'var(--la-color-text-primary)',
  blue: 'var(--la-color-text-primary)',
  red: 'var(--la-color-text-primary)'
})
let themeObserver: MutationObserver | undefined
function updateInsideColors() {
  if (typeof HTMLElement === 'undefined' || !(root.value instanceof HTMLElement)) return
  const style = getComputedStyle(root.value)
  const text = style.getPropertyValue('--la-color-text-primary')
  const surface = style.getPropertyValue('--la-color-bg-primary')
  insideColors.value = {
    total: pillarTextColor(style.getPropertyValue('--la-color-link').trim(), text, surface),
    blue: pillarTextColor(style.getPropertyValue('--ma-blue').trim(), text, surface),
    red: pillarTextColor(style.getPropertyValue('--ma-red').trim(), text, surface)
  }
}
onMounted(() => {
  if (typeof document !== 'undefined') document.addEventListener('keydown', closeWindowOnEscape)
  updateInsideColors()
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return
  themeObserver = new MutationObserver(updateInsideColors)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'data-theme-id']
  })
})
onBeforeUnmount(() => {
  themeObserver?.disconnect()
  if (typeof document !== 'undefined') document.removeEventListener('keydown', closeWindowOnEscape)
})
const keys = [
  'laneGankBefore3',
  'laneGankMinute3',
  'laneGankMinute4',
  'laneGankMinute5To10',
  'laneGankMinute10To14'
] as const
const labels = keys.map((key) => roleMetricMeta[key].windowLabel!)
const count = (raw: unknown) =>
  typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null
const countLabel = (key: (typeof keys)[number], value: number | null) =>
  uiText(value === null ? 'roleGankWindowMissing' : 'roleGankWindowCount', {
    label: roleMetricMeta[key].label,
    count: value
  })
const items = computed(() =>
  keys.map((key, index) => {
    const value = count(props.values[index])
    const label = countLabel(key, value)
    const bars = props.breakdown?.length
      ? props.breakdown.map((series) => {
          const value = count(series.values[index])
          return { tone: series.tone, value, label: `${series.label} · ${countLabel(key, value)}` }
        })
      : [{ tone: 'total' as const, value, label }]
    return {
      key,
      label,
      bars,
      accessibleLabel: [
        label,
        ...bars.filter((bar) => bar.tone !== 'total').map((bar) => bar.label)
      ].join('; ')
    }
  })
)
</script>

<style scoped>
.gank-window-bars {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 1px;
  width: 100%;
  min-width: 0;
}
.gank-window {
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
  border-radius: 3px;
}
.gank-window-track {
  position: relative;
  height: var(--gank-window-track-height, 44px);
  min-width: 0;
  box-sizing: border-box;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  border-bottom: 1px solid var(--ma-grid-strong);
}
.gank-window-tracks {
  display: flex;
  gap: 1px;
  height: var(--gank-window-track-height, 44px);
}
.gank-window-tracks > .gank-window-track {
  flex: 1;
}
.gank-window-track i {
  display: block;
  width: 100%;
  background: var(--la-color-link);
}
.gank-window-track[data-gank-tone='blue'] i {
  background: var(--ma-blue);
}
.gank-window-track[data-gank-tone='red'] i {
  background: var(--ma-red);
}
.gank-window-value {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  color: var(--la-color-text-primary);
  font-size: 12px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  pointer-events: none;
}
.gank-window-label {
  display: block;
  margin-top: 3px;
  font-size: 12px;
  line-height: 16px;
  color: var(--ma-muted);
  white-space: nowrap;
}
.gank-window-missing {
  align-self: center;
  color: var(--ma-muted);
}
.gank-window:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: 2px;
}
.gank-window:hover {
  background: var(--ma-grid);
}
</style>
