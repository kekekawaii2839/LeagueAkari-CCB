<template>
  <section class="member-analysis-filters" aria-label="成员分析筛选">
    <NInput
      v-model:value="store.filters.query"
      class="member-analysis-filters__query"
      clearable
      size="small"
      aria-label="搜索对局、成员或英雄"
      placeholder="搜索对局、成员或英雄"
    />
    <NSelect
      v-model:value="store.sampleSize"
      class="member-analysis-filters__select"
      :options="sampleOptions"
      size="small"
      aria-label="样本范围"
    />
    <NSelect
      v-model:value="store.analysisSide"
      class="member-analysis-filters__select"
      :options="sideOptions"
      size="small"
      aria-label="阵营"
    />
    <NSelect
      v-model:value="store.filters.outcome"
      class="member-analysis-filters__select"
      :options="outcomeOptions"
      size="small"
      aria-label="结果"
    />
    <NButton
      size="small"
      quaternary
      :aria-expanded="advanced"
      aria-controls="member-analysis-advanced-filters"
      @click="advanced = !advanced"
    >
      {{ advanced ? '收起高级筛选' : `高级筛选${activeAdvanced ? ` · ${activeAdvanced}` : ''}` }}
    </NButton>
    <NButton v-if="activeFilters" size="small" quaternary type="warning" @click="store.resetFilters"
      >重置 {{ activeFilters }}</NButton
    >
    <div
      v-show="advanced"
      id="member-analysis-advanced-filters"
      class="member-analysis-filters__advanced"
    >
      <NSelect
        v-model:value="store.filters.participant"
        class="member-analysis-filters__select"
        :options="participantOptions"
        aria-label="成员"
      />
      <NSelect
        v-model:value="store.filters.matchRole"
        class="member-analysis-filters__select"
        :options="roleOptions"
        aria-label="分路"
      />
      <NSelect
        v-model:value="store.filters.champion"
        class="member-analysis-filters__select"
        :options="championOptions"
        aria-label="英雄"
      />
      <NSelect
        v-model:value="store.filters.patch"
        class="member-analysis-filters__select"
        :options="patchOptions"
        aria-label="版本"
      />
      <NInputNumber
        v-model:value="store.filters.durationMin"
        class="member-analysis-filters__duration"
        :min="0"
        :max="180"
        clearable
        aria-label="最短对局分钟"
        placeholder="最短分钟"
      />
      <NInput
        v-model:value="store.filters.dateFrom"
        class="member-analysis-filters__date"
        :input-props="{ type: 'date', 'aria-label': '开始日期' }"
      />
      <NInput
        v-model:value="store.filters.dateTo"
        class="member-analysis-filters__date"
        :input-props="{ type: 'date', 'aria-label': '结束日期' }"
      />
      <NInputNumber
        v-model:value="store.filters.durationMax"
        class="member-analysis-filters__duration"
        :min="0"
        :max="180"
        clearable
        aria-label="最长对局分钟"
        placeholder="最长分钟"
      />
    </div>
    <p v-if="activeFilters && !advanced" class="active-filter-summary">
      当前筛选：{{ activeDescriptions.join(' · ') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import { computed, ref } from 'vue'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

const store = useMemberAnalysisStore()
const advanced = ref(false)
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
    .sort((a, b) => b.localeCompare(a))
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
.member-analysis-filters__sample {
  color: color-mix(in srgb, var(--la-color-text-primary) 58%, transparent);
  font-size: 12px;
  white-space: nowrap;
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
