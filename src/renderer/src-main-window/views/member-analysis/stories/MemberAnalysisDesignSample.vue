<template>
  <main class="member-analysis-page design-sample">
    <header class="sample-header">
      <div class="page-identity">
        <NIcon :component="AnalyticsOutline" />
        <h1>成员分析</h1>
      </div>
      <nav class="sample-nav" aria-label="页面结构预览，其他页面未接入">
        <span
          v-for="tab in tabs"
          :key="tab"
          :aria-current="tab === '成员分路' ? 'page' : undefined"
          >{{ tab }}</span
        >
      </nav>
    </header>
    <div class="sample-body">
      <div class="sample-toolbar">
        <div class="sample-scope">
          <strong>{{ sampleGames.length }} 场对局</strong><span>{{ sideName }}</span
          ><span>版本 {{ patches || '—' }}</span
          ><span class="preview-label">代码样板 · 合成数据</span>
        </div>
        <NButton
          secondary
          :aria-expanded="filtersOpen"
          aria-controls="sample-filters"
          @click="filtersOpen = !filtersOpen"
          ><template #icon><NIcon :component="OptionsOutline" /></template>筛选范围</NButton
        >
      </div>
      <div v-if="filterLabels.length" class="active-filters">
        <span v-for="label in filterLabels" :key="label">{{ label }}</span
        ><NButton quaternary @click="store.resetFilters()">清除筛选</NButton>
      </div>
      <div v-if="filtersOpen" id="sample-filters"><MemberAnalysisFilters /></div>
      <MemberRoleComparison />
      <details class="sample-method">
        <summary>数据口径与限制</summary>
        <p>
          成员按设置顺序展示，不按成绩排名。缺失值不参与当前图中均值，— 不表示
          0。已有历史数据可能将部分缺失值计为零，本次只改显示，不修复历史数据。胜率区间使用 Wilson
          方法。
        </p>
        <p>
          这是独立代码样板，使用合成对局和现有聚合计算，不连接客户端。其他页面未接入，英雄池未修改。
        </p>
      </details>
    </div>
  </main>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NIcon } from 'naive-ui'
import { AnalyticsOutline, OptionsOutline } from '@vicons/ionicons5'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { useMemberAnalysisData } from '../useMemberAnalysisData'
import MemberAnalysisFilters from '../MemberAnalysisFilters.vue'
import MemberRoleComparison from '../MemberRoleComparison.vue'
import '../member-analysis-visuals.css'
const store = useMemberAnalysisStore()
const { games: sampleGames } = useMemberAnalysisData()
const filtersOpen = ref(false)
const roles = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助'
} as const
const shortName = (name: string) => name.split('#')[0]
const tabs = [
  '成员分路',
  '英雄池',
  '组合',
  '打野',
  '事件结果',
  '前期与胜负',
  '同队偏差',
  '指标对比',
  '对局明细'
]
const sideName = computed(() =>
  store.analysisSide === 'all' ? '蓝红合计' : store.analysisSide === 'Blue' ? '蓝方' : '红方'
)
const patches = computed(() => [...new Set(sampleGames.value.map((g) => g.patch))].join('、'))
const filterLabels = computed(() => {
  const f = store.filters
  return [
    f.query && `搜索：${f.query}`,
    f.outcome !== 'all' && `结果：${f.outcome === 'win' ? '胜利' : '失败'}`,
    f.participant !== 'all' && `成员：${shortName(f.participant)}`,
    f.champion !== 'all' && `英雄：${f.champion}`,
    f.matchRole !== 'all' && `分路：${roles[f.matchRole]}`,
    f.patch !== 'all' && `版本：${f.patch}`,
    f.dateFrom && `开始：${f.dateFrom}`,
    f.dateTo && `结束：${f.dateTo}`,
    f.durationMin !== null && `至少 ${f.durationMin} 分钟`,
    f.durationMax !== null && `至多 ${f.durationMax} 分钟`
  ].filter(Boolean) as string[]
})
</script>
<style scoped>
.design-sample {
  height: 100%;
  overflow: auto;
  color: var(--la-color-text-primary);
  background: var(--la-color-bg-primary);
  font-variant-numeric: tabular-nums;
  --sample-muted: var(--ma-muted);
}
.sample-header,
.page-identity,
.sample-toolbar,
.sample-scope,
.comparison-heading,
.metric-heading,
.role-switch {
  display: flex;
  align-items: center;
}
.sample-header {
  justify-content: space-between;
  padding: 0 24px;
  gap: 28px;
  border-bottom: 1px solid var(--ma-grid);
}
.page-identity {
  flex-shrink: 0;
  gap: 10px;
}
.page-identity .n-icon {
  font-size: 22px;
  color: var(--la-color-link);
}
h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0;
}
.preview-label {
  font-size: 12px;
  color: var(--sample-muted);
}
.sample-nav {
  display: flex;
  gap: 20px;
  padding: 0;
  min-width: 0;
  flex: 1;
  overflow: auto;
}
.sample-nav > span {
  white-space: nowrap;
  padding: 18px 0;
  font-size: 14px;
  color: var(--sample-muted);
}
.sample-nav > [aria-current] {
  color: var(--la-color-text-primary);
  box-shadow: inset 0 -2px var(--la-color-link);
  font-weight: 600;
}
.sample-body {
  padding: 0 24px 24px;
}
.sample-toolbar {
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
}
.sample-scope {
  gap: 20px;
  font-size: 12px;
  color: var(--sample-muted);
  flex-wrap: wrap;
}
.sample-scope strong {
  font-size: 14px;
  color: var(--la-color-text-primary);
  font-weight: 500;
}

.active-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  align-items: center;
  margin-bottom: 12px;
  font-size: 12px;
}
.sample-method {
  margin-top: 12px;
  font-size: 12px;
  color: var(--sample-muted);
}
.sample-method summary {
  padding: 8px 0;
  cursor: pointer;
}
.sample-method p {
  max-width: 840px;
  line-height: 1.7;
}
@media (max-width: 950px) {
  .sample-header {
    padding: 0 12px;
    gap: 20px;
  }
  .sample-body {
    padding: 0 12px 16px;
  }
}
</style>
