<template>
  <section
    class="member-analysis-filters"
    aria-label="成员分析筛选"
    :aria-describedby="disabled ? 'member-analysis-prediction-filter-note' : undefined"
  >
    <div v-if="compact" class="compact-filter-summary">
      <NButton
        ref="compactButton"
        size="small"
        quaternary
        :aria-expanded="expanded"
        aria-controls="member-analysis-filter-controls"
        @click="toggleCompact"
        >{{ uiText(expanded ? 'combinationHideFilters' : 'combinationShowFilters') }}</NButton
      >
      <span
        >{{ sampleOptions.find((option) => option.value === store.sampleSize)?.label }} ·
        {{ sideOptions.find((option) => option.value === store.analysisSide)?.label }} ·
        {{ outcomeOptions.find((option) => option.value === store.filters.outcome)?.label }}</span
      >
      <p v-if="activeDescriptions.length">{{ activeDescriptions.join(' · ') }}</p>
    </div>
    <div
      ref="controls"
      id="member-analysis-filter-controls"
      v-show="!compact || expanded"
      class="member-analysis-filter-controls"
    >
      <NInput
        :disabled="disabled"
        v-model:value="store.filters.query"
        class="member-analysis-filters__query"
        clearable
        size="small"
        aria-label="搜索对局、成员或英雄"
        placeholder="搜索对局、成员或英雄"
      />
      <NSelect
        v-model:show="menus.sample"
        :menu-props="menuProps('sample')"
        :disabled="disabled"
        v-model:value="store.sampleSize"
        class="member-analysis-filters__select"
        :options="sampleOptions"
        size="small"
        aria-label="样本范围"
      />
      <NSelect
        v-model:show="menus.side"
        :menu-props="menuProps('side')"
        :disabled="disabled"
        v-model:value="store.analysisSide"
        class="member-analysis-filters__select"
        :options="sideOptions"
        size="small"
        aria-label="阵营"
      />
      <NSelect
        v-model:show="menus.outcome"
        :menu-props="menuProps('outcome')"
        :disabled="disabled"
        v-model:value="store.filters.outcome"
        class="member-analysis-filters__select"
        :options="outcomeOptions"
        size="small"
        aria-label="结果"
      />
      <NButton
        :disabled="disabled"
        ref="advancedButton"
        size="small"
        quaternary
        :aria-expanded="advanced"
        aria-controls="member-analysis-advanced-filters"
        @click="toggleAdvanced"
      >
        {{ advanced ? '收起高级筛选' : `高级筛选${activeAdvanced ? ` · ${activeAdvanced}` : ''}` }}
      </NButton>
      <NButton
        :disabled="disabled"
        v-if="activeFilters"
        size="small"
        quaternary
        type="warning"
        @click="store.resetFilters"
        >重置 {{ activeFilters }}</NButton
      >
      <div
        ref="advancedControls"
        v-show="advancedShown"
        :inert="!advanced"
        :aria-hidden="!advanced || undefined"
        id="member-analysis-advanced-filters"
        class="member-analysis-filters__advanced-shell"
      >
        <div ref="advancedContent" class="member-analysis-filters__advanced">
          <NSelect
            v-model:show="menus.participant"
            :menu-props="menuProps('participant')"
            :disabled="disabled"
            v-model:value="store.filters.participant"
            class="member-analysis-filters__select"
            :options="participantOptions"
            aria-label="成员"
          />
          <NSelect
            v-model:show="menus.role"
            :menu-props="menuProps('role')"
            :disabled="disabled"
            v-model:value="store.filters.matchRole"
            class="member-analysis-filters__select"
            :options="roleOptions"
            aria-label="分路"
          />
          <NSelect
            v-model:show="menus.champion"
            :menu-props="menuProps('champion')"
            :disabled="disabled"
            v-model:value="store.filters.champion"
            class="member-analysis-filters__select"
            :options="championOptions"
            aria-label="英雄"
          />
          <NSelect
            v-model:show="menus.patch"
            :menu-props="menuProps('patch')"
            :disabled="disabled"
            v-model:value="store.filters.patch"
            class="member-analysis-filters__select"
            :options="patchOptions"
            aria-label="版本"
          />
          <NInputNumber
            :disabled="disabled"
            v-model:value="store.filters.durationMin"
            class="member-analysis-filters__duration"
            :min="0"
            :max="180"
            clearable
            aria-label="最短对局分钟"
            placeholder="最短分钟"
          />
          <NInput
            :disabled="disabled"
            v-model:value="store.filters.dateFrom"
            class="member-analysis-filters__date"
            :input-props="{ type: 'date', 'aria-label': '开始日期' }"
            placeholder=""
          />
          <NInput
            :disabled="disabled"
            v-model:value="store.filters.dateTo"
            class="member-analysis-filters__date"
            :input-props="{ type: 'date', 'aria-label': '结束日期' }"
            placeholder=""
          />
          <NInputNumber
            :disabled="disabled"
            v-model:value="store.filters.durationMax"
            class="member-analysis-filters__duration"
            :min="0"
            :max="180"
            clearable
            aria-label="最长对局分钟"
            placeholder="最长分钟"
          />
        </div>
      </div>
      <p v-if="activeFilters && !advancedShown" class="active-filter-summary">
        当前筛选：{{ activeDescriptions.join(' · ') }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import { computed, nextTick, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import type { HTMLAttributes } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { uiText } from './ui-text'
import { createAdvancedFilterMotion } from './advanced-filter-motion'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

const store = useMemberAnalysisStore()
const props = defineProps<{ disabled?: boolean; compact?: boolean }>()
const expanded = ref(false)
const advanced = ref(false)
const advancedShown = ref(false)
const advancedContent = ref<HTMLElement | null>(null)
const controls = ref<HTMLElement | null>(null)
const advancedControls = ref<HTMLElement | null>(null)
const advancedButton = ref<InstanceType<typeof NButton> | null>(null)
const compactButton = ref<InstanceType<typeof NButton> | null>(null)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const filterMotion = createAdvancedFilterMotion(() => reducedMotion.value)
const menus = reactive({
  sample: false,
  side: false,
  outcome: false,
  participant: false,
  role: false,
  champion: false,
  patch: false
})
const menuProps = (key: keyof typeof menus): HTMLAttributes => ({
  class: 'member-analysis-filter-menu',
  inert: !menus[key],
  'aria-hidden': !menus[key] || undefined,
  style: { pointerEvents: menus[key] ? undefined : 'none' }
})
const controlsVisible = computed(() => !props.compact || expanded.value)
let sequence = 0
function cancelMotion() {
  sequence++
  filterMotion.cancel()
  advancedShown.value = advanced.value
}
function closeMenus() {
  for (const key of Object.keys(menus) as (keyof typeof menus)[]) menus[key] = false
}
function returnFocus(region: HTMLElement | null, button: InstanceType<typeof NButton> | null) {
  if (typeof document !== 'undefined' && region?.contains(document.activeElement))
    (button?.$el as HTMLElement | undefined)?.focus({ preventScroll: true })
}
function toggleAdvanced() {
  if (props.disabled) return
  if (advanced.value) returnFocus(advancedControls.value, advancedButton.value)
  advanced.value = !advanced.value
}
function toggleCompact() {
  if (expanded.value) returnFocus(controls.value, compactButton.value)
  expanded.value = !expanded.value
}
watch(
  advanced,
  async (open) => {
    const token = ++sequence
    const fresh = !advancedShown.value
    advancedShown.value = true
    if (!open) {
      returnFocus(advancedControls.value, advancedButton.value)
      closeMenus()
    }
    await nextTick()
    if (token !== sequence) return
    if (!controlsVisible.value || props.disabled) {
      cancelMotion()
      return
    }
    filterMotion.run(advancedControls.value, advancedContent.value, open, fresh, () => {
      advancedShown.value = advanced.value
    })
  },
  { flush: 'sync' }
)
watch(
  controlsVisible,
  async (visible) => {
    cancelMotion()
    if (!visible) {
      const hadFocus =
        typeof document !== 'undefined' && controls.value?.contains(document.activeElement)
      closeMenus()
      await nextTick()
      if (hadFocus && !controlsVisible.value)
        (compactButton.value?.$el as HTMLElement | undefined)?.focus({ preventScroll: true })
    }
  },
  { flush: 'sync' }
)
watch(reducedMotion, cancelMotion)
watch(
  () => props.disabled,
  () => {
    cancelMotion()
    closeMenus()
  }
)
function dispose() {
  cancelMotion()
  closeMenus()
}
onDeactivated(dispose)
onBeforeUnmount(dispose)
const patchVersionCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})
const activeAdvanced = computed(
  () =>
    [
      store.filters.participant,
      store.filters.matchRole,
      store.filters.champion,
      store.filters.patch
    ].filter((value) => value !== 'all').length +
    [
      store.filters.durationMin,
      store.filters.durationMax,
      store.filters.dateFrom,
      store.filters.dateTo
    ].filter(Boolean).length
)
const activeFilters = computed(
  () =>
    activeAdvanced.value +
    Number(Boolean(store.filters.query)) +
    Number(store.filters.outcome !== 'all') +
    Number(store.analysisSide !== 'all')
)
const sampleOptions = [
  { label: '最近 20 场', value: 20 },
  { label: '最近 50 场', value: 50 },
  { label: '最近 100 场', value: 100 },
  { label: '全部样本', value: 'all' }
]
const sideOptions = [
  { label: '蓝红合计', value: 'all' },
  { label: '仅蓝方', value: 'Blue' },
  { label: '仅红方', value: 'Red' }
]
const outcomeOptions = [
  { label: '全部结果', value: 'all' },
  { label: '胜利', value: 'win' },
  { label: '失败', value: 'loss' }
]
const roleOptions = [
  { label: '全部分路', value: 'all' },
  { label: '上路', value: 'TOP' },
  { label: '打野', value: 'JUNGLE' },
  { label: '中路', value: 'MIDDLE' },
  { label: '下路', value: 'BOTTOM' },
  { label: '辅助', value: 'UTILITY' }
]
const patchOptions = computed(() => [
  { label: '全部版本', value: 'all' },
  ...Array.from(new Set(store.overview?.games.map((game) => game.patch) ?? []))
    .sort((a, b) => patchVersionCollator.compare(b, a))
    .map((patch) => ({ label: patch, value: patch }))
])
const participantOptions = computed(() => [
  { label: '全部成员', value: 'all' },
  ...Array.from(
    new Set(store.overview?.games.flatMap((game) => game.players.map((row) => row.player)) ?? [])
  )
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({ label: value, value }))
])
const championOptions = computed(() => [
  { label: '全部英雄', value: 'all' },
  ...Array.from(
    new Set(store.overview?.games.flatMap((game) => game.players.map((row) => row.champion)) ?? [])
  )
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))
    .map((value) => ({ label: value, value }))
])
const activeDescriptions = computed(() => {
  const f = store.filters
  return [
    f.query ? `搜索 ${f.query}` : '',
    store.analysisSide !== 'all'
      ? sideOptions.find((x) => x.value === store.analysisSide)?.label
      : '',
    f.outcome !== 'all' ? outcomeOptions.find((x) => x.value === f.outcome)?.label : '',
    f.participant !== 'all' ? f.participant : '',
    f.matchRole !== 'all' ? roleOptions.find((x) => x.value === f.matchRole)?.label : '',
    f.champion !== 'all' ? f.champion : '',
    f.patch !== 'all' ? `版本 ${f.patch}` : '',
    f.durationMin !== null ? `至少 ${f.durationMin} 分钟` : '',
    f.durationMax !== null ? `至多 ${f.durationMax} 分钟` : '',
    f.dateFrom ? `从 ${f.dateFrom}` : '',
    f.dateTo ? `至 ${f.dateTo}` : ''
  ].filter(Boolean)
})
</script>

<style scoped>
.member-analysis-filters {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  padding: 8px 24px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.12);
  background: color-mix(in srgb, var(--la-card-muted-surface) 38%, transparent);
}

.member-analysis-filters__query {
  width: clamp(200px, 28vw, 320px);
}
.member-analysis-filter-controls {
  display: contents;
}
.compact-filter-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 8px;
  min-width: 0;
  font-size: 12px;
  line-height: 1.5;
}
.compact-filter-summary p {
  flex-basis: 100%;
  margin: 0;
  overflow-wrap: anywhere;
}
.member-analysis-filters__sample {
  color: color-mix(in srgb, var(--la-color-text-primary) 58%, transparent);
  font-size: 12px;
  white-space: nowrap;
}
.member-analysis-filters__advanced-shell {
  width: 100%;
  min-width: 0;
}
.member-analysis-filters__advanced {
  display: flex;
  width: 100%;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 2px;
}

.member-analysis-filters__select {
  width: 128px;
}

.member-analysis-filters__duration {
  width: 116px;
}
.member-analysis-filters__date {
  width: 145px;
}

@media (max-width: 760px) {
  .member-analysis-filters {
    flex-wrap: wrap;
    padding: 8px 16px;
  }

  .member-analysis-filters__query {
    width: 100%;
  }

  .member-analysis-filters__select {
    width: calc(33.333% - 5px);
    min-width: 104px;
  }

  .member-analysis-filters__advanced {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .member-analysis-filters__advanced > * {
    width: 100%;
  }
}
.active-filter-summary {
  flex-basis: 100%;
  margin: 4px 0 0;
  color: var(--ma-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}
</style>
