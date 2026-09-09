<template>
  <div class="ma-panel ma-workspace jungle-view">
    <header class="ma-view-heading">
      <div><h2>打野路线与表现</h2></div>
      <span>{{ totals.length }} 名打野 · {{ totalGames }} 场分路样本</span>
    </header>

    <div class="jungle-toolbar">
      <NRadioGroup v-model:value="group" size="small">
        <NRadioButton v-for="(value, key) in jungleGroups" :key="key" :value="key">{{
          value.label
        }}</NRadioButton>
      </NRadioGroup>
      <label v-if="store.analysisSide === 'all'" class="side-toggle">
        <span>蓝红方拆分</span>
        <NSwitch v-model:value="store.sideBreakdown" size="small" />
      </label>
    </div>

    <p class="ma-chart-note">
      {{ uiText('rateLegend')
      }}<template v-if="group === 'development'">
        经济差：空心点为 10 分钟，实心点为 15 分钟；中线为零，单位为金币。</template
      >
    </p>
    <section v-if="totals.length" class="jungle-comparison" :class="`is-${group}`">
      <div class="jungle-columns">
        <span>打野成员 / 结果</span>
        <template v-if="group === 'opening'">
          <span>开野归属</span><span>首营地构成</span>
        </template>
        <template v-else-if="group === 'gank'">
          <span><MetricLabel label="抓人等级" :definition="gankLevelHelp" /></span>
          <span>活动区域构成</span><span>场均分路抓人</span>
        </template>
        <template v-else-if="group === 'objectives'">
          <span>首龙</span><span>场均资源控制</span><span>15分钟前结果</span>
        </template>
        <template v-else>
          <span><MetricLabel label="经济对位" :definition="economyHelp" /></span>
          <span><MetricLabel label="15 分钟经验差" :definition="experienceHelp" /></span>
          <span>发育效率</span>
        </template>
      </div>

      <article v-for="row in totals" :key="row.player" class="jungle-row">
        <header class="member-result">
          <strong>{{ short(String(row.player)) }}</strong>
          <span>{{ row.games }} 场 · {{ row.wins }}胜 {{ row.games - row.wins }}负</span>
          <div class="win-line">
            <b>{{ formatMetric(row.winRate, 'pct') }}</b
            ><WinRateInterval :wins="row.wins" :games="row.games" />
          </div>
          <SideValues
            v-if="showSideBreakdown"
            :blue="sideValue(row, '蓝方', 'winRate', 'pct')"
            :red="sideValue(row, '红方', 'winRate', 'pct')"
          />
        </header>

        <template v-if="group === 'opening'">
          <div class="analysis-cell composition-cell" data-label="开野归属">
            <CompositionBar :parts="ownershipParts(row)" />
            <div class="composition-labels two">
              <span
                >己方 <b>{{ pct(row.ownStartRate) }}</b></span
              ><span
                >入侵 <b>{{ pct(row.invadeStartRate) }}</b></span
              >
            </div>
            <small>可识别 {{ integer(row.ownershipSamples) }} 次</small>
            <SideValues
              v-if="showSideBreakdown"
              :blue="
                sideComposition(row, '蓝方', ['ownStartRate', 'invadeStartRate'], ['己', '侵'])
              "
              :red="sideComposition(row, '红方', ['ownStartRate', 'invadeStartRate'], ['己', '侵'])"
            />
          </div>
          <div class="analysis-cell composition-cell camp-cell" data-label="首营地构成">
            <CompositionBar :parts="campParts(row)" />
            <div class="composition-labels four">
              <span
                v-for="part in campParts(row).filter(
                  (part) => part.value === null || part.value > 0
                )"
                :key="part.label"
                ><i :style="{ background: part.color }" />{{ part.short }}
                <b>{{ formatMetric(part.value, 'pct') }}</b></span
              >
            </div>
            <small>可识别 {{ integer(row.startSamples) }} 次 · 未列营地为 0%</small>
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', campKeys, campShorts)"
              :red="sideComposition(row, '红方', campKeys, campShorts)"
            />
          </div>
        </template>

        <template v-else-if="group === 'gank'">
          <div class="analysis-cell timing-cell has-compact-help" data-label="抓人等级">
            <MetricLabel class="compact-metric-help" label="抓人等级" :definition="gankLevelHelp" />
            <div class="metric-pair">
              <span
                >3级 <b>{{ pct(row.level3GankRate) }}</b></span
              ><span
                >4级 <b>{{ pct(row.level4GankRate) }}</b></span
              >
            </div>
            <small>{{ row.games }} 场</small>
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', ['level3GankRate', 'level4GankRate'], ['3', '4'])"
              :red="sideComposition(row, '红方', ['level3GankRate', 'level4GankRate'], ['3', '4'])"
            />
          </div>
          <div class="analysis-cell composition-cell zone-cell" data-label="活动区域构成">
            <CompositionBar :parts="zoneParts(row)" />
            <div class="composition-labels three">
              <span v-for="part in zoneParts(row)" :key="part.label"
                ><i :style="{ background: part.color }" />{{ part.short }}
                <b>{{ formatMetric(part.value, 'pct') }}</b></span
              >
            </div>
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', zoneKeys, ['上', '中', '下'])"
              :red="sideComposition(row, '红方', zoneKeys, ['上', '中', '下'])"
            />
          </div>
          <div class="analysis-cell gank-cell" data-label="场均分路抓人">
            <DotMetric
              v-for="metric in gankMetrics"
              :key="metric.key"
              :label="metric.short"
              :value="number(row[metric.key])"
              :maximum="gankMaximum"
              suffix="/场"
            />
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', gankKeys, ['上', '中', '下'], 'num')"
              :red="sideComposition(row, '红方', gankKeys, ['上', '中', '下'], 'num')"
            />
          </div>
        </template>

        <template v-else-if="group === 'objectives'">
          <div class="analysis-cell first-dragon-cell" data-label="首龙">
            <div>
              <strong>{{ pct(row.firstDragonRate) }}</strong
              ><span>平均 {{ formatMetric(row.firstDragonTime, 'time') }}</span>
            </div>
            <small>{{ integer(row.firstDragonSamples) }} 场有效样本</small>
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideObjective(row, '蓝方')"
              :red="sideObjective(row, '红方')"
            />
          </div>
          <div class="analysis-cell objective-volume" data-label="场均资源控制">
            <span
              ><b>{{ decimal(row.dragonsPG) }}</b> 小龙<small
                >独控 {{ decimal(row.soloDragonsPG) }}</small
              ></span
            >
            <span
              ><b>{{ decimal(row.voidgrubsPG) }}</b> 巢虫</span
            >
            <span
              ><b>{{ decimal(row.heraldsPG) }}</b> 先锋</span
            >
            <span
              ><b>{{ decimal(row.baronsPG) }}</b> 大龙</span
            >
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', objectiveKeys, objectiveShorts, 'num')"
              :red="sideComposition(row, '红方', objectiveKeys, objectiveShorts, 'num')"
            />
          </div>
          <div class="analysis-cell objective-diffs" data-label="15 分钟前结果">
            <span v-for="metric in objectiveDiffs" :key="metric.key"
              ><small>{{ metric.short }}</small
              ><b :class="toneClass(row[metric.key])">{{
                formatSigned(row[metric.key], 1)
              }}</b></span
            >
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', objectiveDiffKeys, ['龙', '虫', '团'], 'signed')"
              :red="sideComposition(row, '红方', objectiveDiffKeys, ['龙', '虫', '团'], 'signed')"
            />
          </div>
        </template>

        <template v-else>
          <div class="analysis-cell trajectory-cell has-compact-help" data-label="经济差（金币）">
            <MetricLabel class="compact-metric-help" label="经济对位" :definition="economyHelp" />
            <div class="trajectory-values">
              <span
                >@10 <b :class="toneClass(row.gd10)">{{ formatSigned(row.gd10, 0) }}</b></span
              ><span
                >@15 <b :class="toneClass(row.gd15)">{{ formatSigned(row.gd15, 0) }}</b></span
              >
            </div>
            <TrajectoryPlot
              :start="number(row.gd10)"
              :end="number(row.gd15)"
              :extent="goldExtent"
            />
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', ['gd10', 'gd15'], ['@10', '@15'], 'signed0')"
              :red="sideComposition(row, '红方', ['gd10', 'gd15'], ['@10', '@15'], 'signed0')"
            />
          </div>
          <div class="analysis-cell single-metric has-compact-help" data-label="15 分钟经验差">
            <MetricLabel
              class="compact-metric-help"
              label="15 分钟经验差"
              :definition="experienceHelp"
            />
            <strong :class="toneClass(row.xpd15)">{{ formatSigned(row.xpd15, 0) }}</strong>
            <small>经验差</small>
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideValue(row, '蓝方', 'xpd15', 'signed0')"
              :red="sideValue(row, '红方', 'xpd15', 'signed0')"
            />
          </div>
          <div class="analysis-cell efficiency-cell" data-label="发育效率">
            <span
              ><MetricLabel label="补刀 / 分" definition="每分钟补刀数。" /><b>{{
                decimal(row.cspm)
              }}</b></span
            >
            <span
              ><MetricLabel label="金币 / 分" definition="每分钟获得经济。" /><b>{{
                decimal(row.gpm)
              }}</b></span
            >
            <span
              ><MetricLabel
                label="目标伤害/分"
                definition="对史诗野怪与防御塔造成的每分钟伤害。"
              /><b>{{ decimal(row.objectiveDamagePM) }}</b></span
            >
            <SideValues
              v-if="showSideBreakdown"
              :blue="sideComposition(row, '蓝方', efficiencyKeys, ['CS', 'G', '目标'], 'num')"
              :red="sideComposition(row, '红方', efficiencyKeys, ['CS', 'G', '目标'], 'num')"
            />
          </div>
        </template>
      </article>
    </section>
    <div v-else class="ma-empty">当前样本没有打野时间线数据。</div>
  </div>
</template>

<script setup lang="ts">
import { NRadioButton, NRadioGroup, NSwitch } from 'naive-ui'
import { computed, defineComponent, h, ref, type PropType } from 'vue'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { formatMetric, jungleGroups } from './metric-defs'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { finiteOrNull, formatSigned } from './visualization'
import WinRateInterval from './WinRateInterval.vue'
import MetricLabel from './MetricHelp.vue'
import { uiText } from './ui-text'

const gankLevelHelp =
  '3级抓人率与4级抓人率分别统计该等级是否发生过抓人；两项可能在同一场同时发生，因此不构成100%。'
const economyHelp =
  '比赛 10 / 15 分钟时相对敌方打野的经济差，单位为金币。空心点为 10 分钟，实心点为 15 分钟；不是连续走势。'
const experienceHelp = '比赛15分钟时，相对敌方打野的经验差。'
type Group = keyof typeof jungleGroups
type Side = '蓝方' | '红方'
type Part = { label: string; short: string; value: number | null; color: string }

const CompositionBar = defineComponent({
  props: { parts: { type: Array as PropType<Part[]>, required: true } },
  setup: (props) => () => {
    const visible = props.parts.filter(
      (part): part is Part & { value: number } => part.value !== null && part.value > 0
    )
    return h(
      'div',
      {
        class: 'composition-bar',
        role: 'img',
        'aria-label': props.parts
          .map((part) =>
            part.value === null
              ? `${part.label} 暂无数据`
              : `${part.label} ${(part.value * 100).toFixed(1)}%`
          )
          .join('，')
      },
      visible.map((part) =>
        h('i', {
          style: { width: `${part.value * 100}%`, background: part.color },
          title: `${part.label} ${(part.value * 100).toFixed(1)}%`
        })
      )
    )
  }
})
const SideValues = defineComponent({
  props: { blue: { type: String, required: true }, red: { type: String, required: true } },
  setup: (props) => () =>
    h('span', { class: 'side-values' }, [
      h('b', { class: 'blue' }, `蓝 ${props.blue}`),
      h('b', { class: 'red' }, `红 ${props.red}`)
    ])
})
const DotMetric = defineComponent({
  props: {
    label: { type: String, required: true },
    value: { type: Number as PropType<number | null>, default: null },
    maximum: { type: Number, required: true },
    suffix: { type: String, default: '' }
  },
  setup: (props) => () =>
    h('div', { class: 'dot-metric' }, [
      h('span', props.label),
      h('i', [
        props.value === null
          ? null
          : h('b', {
              style: {
                left: `${Math.min(100, Math.max(0, (Number(props.value ?? 0) / props.maximum) * 100))}%`
              }
            })
      ]),
      h('strong', `${props.value === null ? '—' : props.value.toFixed(1)}${props.suffix}`)
    ])
})
const TrajectoryPlot = defineComponent({
  props: {
    start: { type: Number as PropType<number | null>, default: null },
    end: { type: Number as PropType<number | null>, default: null },
    extent: { type: Number, required: true }
  },
  setup: (props) => () => {
    if (props.start === null && props.end === null)
      return h('div', { class: 'trajectory empty' }, '—')
    const position = (value: number) => 50 + Math.max(-1, Math.min(1, value / props.extent)) * 46
    const start = props.start === null ? null : position(props.start)
    const end = props.end === null ? null : position(props.end)
    return h(
      'div',
      {
        class: 'trajectory',
        role: 'img',
        'aria-label': `10分钟经济差 ${props.start ?? '无数据'}，15分钟经济差 ${props.end ?? '无数据'}，单位金币`
      },
      [
        h('i', { class: 'zero' }),
        start === null ? null : h('b', { class: 'start', style: { left: `${start}%` } }),
        end === null ? null : h('b', { class: 'end', style: { left: `${end}%` } })
      ]
    )
  }
})

const store = useMemberAnalysisStore()
const { jungle } = useMemberAnalysisData()
const group = ref<Group>('opening')
const totals = computed(() =>
  jungle.value.filter(
    (row) =>
      row.sideLabel === '总计' ||
      !jungle.value.some(
        (candidate) => candidate.player === row.player && candidate.sideLabel === '总计'
      )
  )
)
const totalGames = computed(() => totals.value.reduce((sum, row) => sum + Number(row.games), 0))
const showSideBreakdown = computed(() => store.analysisSide === 'all' && store.sideBreakdown)
const sideMap = computed(
  () => new Map(jungle.value.map((row) => [`${row.player}|${row.sideLabel}`, row]))
)
const sideRow = (row: (typeof totals.value)[number], side: Side) =>
  sideMap.value.get(`${row.player}|${side}`)
const short = (value: string) => value.split('#')[0]
const number = (value: unknown) => finiteOrNull(value)
const pct = (value: unknown) => formatMetric(value, 'pct')
const decimal = (value: unknown) => formatMetric(value, 'num')
const integer = (value: unknown) => formatMetric(value, 'int')
const toneClass = (value: unknown) => {
  const amount = number(value)
  return amount === null || amount === 0 ? '' : amount > 0 ? 'ma-positive' : 'ma-negative'
}
const colors = [
  'var(--ma-red)',
  'var(--ma-blue)',
  'var(--ma-series-1)',
  'var(--ma-series-3)',
  'var(--ma-series-6)',
  'var(--ma-series-5)'
]
const parts = (
  row: Record<string, unknown>,
  keys: readonly string[],
  labels: readonly string[],
  shorts: readonly string[],
  palette = colors
): Part[] =>
  keys.map((key, index) => ({
    label: labels[index],
    short: shorts[index],
    value: number(row[key]),
    color: palette[index]
  }))
const ownershipParts = (row: Record<string, unknown>) =>
  parts(
    row,
    ['ownStartRate', 'invadeStartRate'],
    ['己方野区', '入侵野区'],
    ['己方', '入侵'],
    ['var(--ma-blue)', 'var(--ma-red)']
  )
const campKeys = [
  'redStartRate',
  'blueStartRate',
  'grompStartRate',
  'raptorsStartRate',
  'wolvesStartRate',
  'krugsStartRate'
] as const
const campShorts = ['红BUFF', '蓝BUFF', '魔沼蛙', 'F6', '三狼', '石甲虫'] as const
const campParts = (row: Record<string, unknown>) =>
  parts(row, campKeys, ['红BUFF', '蓝BUFF', '魔沼蛙', 'F6', '三狼', '石甲虫'], campShorts)
const zoneKeys = ['topZoneRate', 'midZoneRate', 'botZoneRate'] as const
const zoneParts = (row: Record<string, unknown>) =>
  parts(
    row,
    zoneKeys,
    ['上半区', '中路', '下半区'],
    ['上', '中', '下'],
    ['var(--ma-series-3)', 'var(--ma-series-6)', 'var(--ma-blue)']
  )
const gankMetrics = [
  { key: 'topGanksPG', short: '上' },
  { key: 'midGanksPG', short: '中' },
  { key: 'botGanksPG', short: '下' }
] as const
const gankKeys = gankMetrics.map((metric) => metric.key)
const gankMaximum = computed(
  () =>
    Math.max(1, ...totals.value.flatMap((row) => gankKeys.map((key) => number(row[key]) ?? 0))) *
    1.08
)
const objectiveKeys = [
  'dragonsPG',
  'soloDragonsPG',
  'voidgrubsPG',
  'heraldsPG',
  'baronsPG'
] as const
const objectiveShorts = ['龙', '独', '虫', '峡', '大'] as const
const objectiveDiffs = [
  { key: 'dragon15', short: '小龙差' },
  { key: 'grub15', short: '巢虫差' },
  { key: 'objectiveFight15', short: '团战净击杀' }
] as const
const objectiveDiffKeys = objectiveDiffs.map((metric) => metric.key)
const efficiencyKeys = ['cspm', 'gpm', 'objectiveDamagePM'] as const
const goldExtent = computed(
  () =>
    Math.max(
      500,
      ...totals.value.flatMap((row) => [
        Math.abs(number(row.gd10) ?? 0),
        Math.abs(number(row.gd15) ?? 0)
      ])
    ) * 1.08
)

const displayByKind = (value: unknown, kind: string) =>
  kind === 'pct'
    ? pct(value)
    : kind === 'signed'
      ? formatSigned(value, 1)
      : kind === 'signed0'
        ? formatSigned(value, 0)
        : decimal(value)
const sideValue = (row: (typeof totals.value)[number], side: Side, key: string, kind: string) => {
  const selected = sideRow(row, side)
  return selected ? displayByKind(selected[key], kind) : '—'
}
const sideComposition = (
  row: (typeof totals.value)[number],
  side: Side,
  keys: readonly string[],
  labels: readonly string[],
  kind = 'pct'
) => {
  const selected = sideRow(row, side)
  return selected
    ? keys.map((key, index) => `${labels[index]}${displayByKind(selected[key], kind)}`).join(' · ')
    : '—'
}
const sideObjective = (row: (typeof totals.value)[number], side: Side) => {
  const selected = sideRow(row, side)
  return selected
    ? `${pct(selected.firstDragonRate)} · ${formatMetric(selected.firstDragonTime, 'time')}`
    : '—'
}
</script>

<style scoped>
.jungle-view {
  --jungle-tab-offset: 50px;
  --jungle-toolbar-height: 48px;
}
.jungle-toolbar {
  position: static;
  z-index: 5;
  top: var(--jungle-tab-offset);
  display: flex;
  min-height: var(--jungle-toolbar-height);
  box-sizing: border-box;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 7px 0;
  border-bottom: 1px solid var(--ma-grid-strong);
  background: var(--la-color-bg-primary);
}
.side-toggle {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  color: var(--ma-muted);
  font-size: 13px;
  cursor: pointer;
}
.jungle-comparison {
  border: 1px solid var(--ma-grid-strong);
  border-radius: 8px;
  background: color-mix(in srgb, var(--la-card-surface-95) 88%, transparent);
}
.jungle-columns,
.jungle-row {
  display: grid;
  align-items: stretch;
}
.jungle-columns {
  position: static;
  z-index: 4;
  top: calc(var(--jungle-tab-offset) + var(--jungle-toolbar-height));
  min-height: 34px;
  align-items: center;
  border-bottom: 1px solid var(--ma-grid-strong);
  border-radius: 7px 7px 0 0;
  background: var(--la-color-bg-primary);
  box-shadow: 0 1px 0 var(--ma-grid-strong);
}
.jungle-columns > span {
  padding: 0 12px;
  color: var(--ma-muted);
  font-size: 13px;
  text-align: right;
}
.jungle-columns > span:first-child {
  text-align: left;
}
.jungle-row {
  border-bottom: 1px solid var(--ma-grid);
}
.jungle-row:last-child {
  border-bottom: 0;
}
.jungle-row:hover {
  background: var(--ma-grid);
}
.is-opening .jungle-columns,
.is-opening .jungle-row {
  grid-template-columns: 170px minmax(200px, 0.8fr) minmax(360px, 1.6fr);
}
.is-gank .jungle-columns,
.is-gank .jungle-row {
  grid-template-columns: 180px minmax(175px, 0.65fr) minmax(300px, 1.1fr) minmax(300px, 1.1fr);
}
.is-objectives .jungle-columns,
.is-objectives .jungle-row {
  grid-template-columns: 180px minmax(190px, 0.7fr) minmax(390px, 1.45fr) minmax(280px, 1fr);
}
.is-development .jungle-columns,
.is-development .jungle-row {
  grid-template-columns: 180px minmax(300px, 1.1fr) minmax(145px, 0.5fr) minmax(360px, 1.3fr);
}
.member-result,
.analysis-cell {
  min-width: 0;
  padding: 11px 12px;
}
.member-result {
  position: static;
  z-index: 2;
  left: 0;
  border-right: 1px solid var(--ma-grid);
  background: var(--la-color-bg-primary);
}
.jungle-row:hover .member-result {
  background: color-mix(in srgb, var(--la-color-bg-primary) 86%, var(--ma-grid));
}
.member-result > strong {
  display: block;
  overflow: hidden;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.member-result > span {
  display: block;
  margin-top: 2px;
  color: var(--ma-muted);
  font-size: 13px;
}
.win-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 7px;
}
.win-line > b {
  min-width: 38px;
  font-size: 13px;
}
.win-line > :last-child {
  width: 88px;
}
.analysis-cell {
  border-left: 1px solid var(--ma-grid);
  font-size: 13px;
}
.analysis-cell > small {
  display: block;
  margin-top: 5px;
  color: var(--ma-muted);
  font-size: 13px;
}
.composition-bar {
  display: flex;
  overflow: hidden;
  height: 8px;
  border-radius: 2px;
  background: var(--ma-grid-strong);
}
.composition-bar i {
  display: block;
  min-width: 0;
  height: 100%;
  box-shadow: 1px 0 0 rgb(0 0 0 / 35%);
}
.composition-labels {
  display: grid;
  gap: 5px;
  margin-top: 7px;
  color: var(--ma-muted);
  font-variant-numeric: tabular-nums;
}
.composition-labels.two {
  grid-template-columns: repeat(2, 1fr);
}
.composition-labels.three {
  grid-template-columns: repeat(3, 1fr);
}
.composition-labels.four {
  grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
}
.composition-labels span {
  white-space: nowrap;
}
.composition-labels span:not(:first-child) {
  text-align: right;
}
.composition-labels i {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 4px;
  border-radius: 1px;
}
.composition-labels b {
  color: var(--la-color-text-primary);
  font-weight: 600;
}
.metric-pair {
  display: flex;
  align-items: baseline;
  gap: 20px;
}
.metric-pair span {
  color: var(--ma-muted);
}
.metric-pair b {
  margin-left: 4px;
  color: var(--la-color-text-primary);
  font-size: 13px;
}
.gank-cell {
  display: grid;
  gap: 7px;
}
.dot-metric {
  display: grid;
  grid-template-columns: 14px 1fr 52px;
  align-items: center;
  gap: 7px;
}
.dot-metric > span {
  color: var(--ma-muted);
}
.dot-metric > i {
  position: relative;
  height: 7px;
  background: linear-gradient(var(--ma-grid-strong), var(--ma-grid-strong)) center/100% 1px
    no-repeat;
}
.dot-metric > i b {
  position: absolute;
  top: 0;
  width: 7px;
  height: 7px;
  margin-left: -3px;
  border: 1px solid var(--la-card-surface-95);
  border-radius: 50%;
  background: var(--ma-blue);
}
.dot-metric > strong {
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.first-dragon-cell > div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.first-dragon-cell strong {
  font-size: 18px;
}
.first-dragon-cell span {
  color: var(--ma-muted);
  font-size: 13px;
}
.objective-volume {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.objective-volume > span {
  color: var(--ma-muted);
  white-space: nowrap;
}
.objective-volume > span b {
  display: block;
  color: var(--la-color-text-primary);
  font-size: 14px;
}
.objective-volume > span small {
  display: block;
  margin-top: 3px;
  font-size: 13px;
}
.objective-diffs {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.objective-diffs > span small,
.objective-diffs > span b {
  display: block;
  text-align: right;
}
.objective-diffs > span small {
  color: var(--ma-muted);
  font-size: 13px;
}
.objective-diffs > span b {
  margin-top: 4px;
  font-size: 13px;
}
.trajectory-values {
  display: flex;
  justify-content: space-between;
  color: var(--ma-muted);
}
.trajectory-values b {
  margin-left: 4px;
  font-size: 13px;
}
.trajectory {
  position: relative;
  height: 12px;
  margin-top: 7px;
  background: linear-gradient(var(--ma-grid-strong), var(--ma-grid-strong)) center/100% 1px
    no-repeat;
}
.trajectory .zero {
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 50%;
  width: 1px;
  background: var(--ma-muted);
  opacity: 0.55;
}
.trajectory span {
  position: absolute;
  top: 5px;
  height: 2px;
  background: var(--ma-muted);
}
.trajectory b {
  position: absolute;
  top: 2px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border-radius: 50%;
  background: var(--la-color-bg-primary);
  border: 2px solid var(--ma-blue);
}
.trajectory b.end {
  background: var(--ma-blue);
}
.trajectory.empty {
  color: var(--ma-muted);
  text-align: center;
}
.single-metric {
  text-align: right;
}
.single-metric > strong {
  display: block;
  font-size: 18px;
}
.single-metric > small {
  font-size: 13px;
}
.efficiency-cell {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.efficiency-cell > span {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  color: var(--ma-muted);
}
.efficiency-cell > span b {
  margin-top: 4px;
  color: var(--la-color-text-primary);
  font-size: 14px;
}
.metric-label {
  font: inherit;
  color: inherit;
  padding: 4px 0;
  min-height: 32px;
  border: 0;
  background: transparent;
  text-align: inherit;
  border-bottom: 1px dotted currentcolor;
  cursor: help;
}
.metric-label:focus-visible {
  outline: 1px solid var(--la-color-link);
  outline-offset: 3px;
}
.side-values {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px 10px;
  margin-top: 7px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.25;
}
.side-values b {
  font-weight: 500;
}
.side-values .blue {
  color: var(--ma-blue);
}
.side-values .red {
  color: var(--ma-red);
}
:deep(.composition-bar i) {
  display: block;
  min-width: 0;
  height: 100%;
  box-shadow: 1px 0 0 rgb(0 0 0 / 35%);
}
:deep(.dot-metric > span) {
  color: var(--ma-muted);
}
:deep(.dot-metric > i) {
  position: relative;
  height: 7px;
  background: linear-gradient(var(--ma-grid-strong), var(--ma-grid-strong)) center/100% 1px
    no-repeat;
}
:deep(.dot-metric > i b) {
  position: absolute;
  top: 0;
  width: 7px;
  height: 7px;
  margin-left: -3px;
  border: 1px solid var(--la-card-surface-95);
  border-radius: 50%;
  background: var(--ma-blue);
}
:deep(.dot-metric > strong) {
  text-align: right;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
:deep(.trajectory .zero) {
  position: absolute;
  top: 1px;
  bottom: 1px;
  left: 50%;
  width: 1px;
  background: var(--ma-muted);
  opacity: 0.55;
}
:deep(.trajectory span) {
  position: absolute;
  top: 5px;
  height: 2px;
  background: var(--ma-muted);
}
:deep(.trajectory b) {
  position: absolute;
  top: 2px;
  width: 8px;
  height: 8px;
  margin-left: -4px;
  border: 2px solid var(--ma-blue);
  border-radius: 50%;
  background: var(--la-color-bg-primary);
}
:deep(.trajectory b.end) {
  background: var(--ma-blue);
}
:deep(.side-values b) {
  font-weight: 500;
}
:deep(.side-values .blue) {
  color: var(--ma-blue);
}
:deep(.side-values .red) {
  color: var(--ma-red);
}
@container jungle-content (max-width: 1200px) {
  .jungle-view {
    --jungle-toolbar-height: 40px;
  }
  .jungle-toolbar {
    align-items: center;
    flex-direction: row;
    justify-content: space-between;
  }
  .jungle-columns {
    display: none;
  }
  .jungle-comparison {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    border: 0;
    background: transparent;
  }
  .jungle-row,
  .is-opening .jungle-row,
  .is-gank .jungle-row,
  .is-objectives .jungle-row,
  .is-development .jungle-row {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--ma-grid-strong);
    border-radius: 8px;
    background: color-mix(in srgb, var(--la-card-surface-95) 88%, transparent);
  }
  .member-result {
    position: static;
    border-right: 0;
    border-bottom: 1px solid var(--ma-grid);
  }
  .analysis-cell::before {
    content: attr(data-label);
    display: block;
    grid-column: 1 / -1;
    color: var(--ma-muted);
    font-size: 12px;
    margin-bottom: 8px;
  }
  .analysis-cell {
    border-top: 1px solid var(--ma-grid);
    border-left: 0;
  }
  .analysis-cell:first-of-type {
    border-top: 0;
  }
  .camp-cell {
    min-height: 88px;
  }
  .composition-labels.four {
    grid-template-columns: repeat(3, 1fr);
    row-gap: 5px;
  }
  .composition-labels.four span {
    text-align: left !important;
  }
  .composition-labels.four span:nth-child(3n + 2) {
    text-align: center !important;
  }
  .composition-labels.four span:nth-child(3n) {
    text-align: right !important;
  }
  .side-values {
    justify-content: flex-start;
  }
}
@container jungle-content (max-width: 720px) {
  .jungle-comparison {
    grid-template-columns: 1fr;
  }
  .objective-volume {
    grid-template-columns: repeat(4, 1fr);
  }
}
.jungle-columns {
  background: transparent;
  padding-top: 8px;
  padding-bottom: 8px;
}
.jungle-row {
  padding-top: 20px;
  padding-bottom: 20px;
}
.member-result > strong {
  font-size: 16px;
}
.member-result > span {
  font-size: 12px;
}
.composition-labels {
  line-height: 1.7;
}
@media (max-height: 680px) {
  .jungle-row {
    padding-top: 12px;
    padding-bottom: 12px;
  }
}
.jungle-toolbar {
  background: transparent;
  border: 0;
  padding-left: 0;
  padding-right: 0;
}
.jungle-comparison {
  border-left: 0;
  border-right: 0;
  border-radius: 0;
}
.member-result,
.jungle-row:hover .member-result {
  background: transparent;
  border-right: 0;
}
.analysis-cell {
  border-left: 0;
}
.jungle-view {
  container-type: inline-size;
  container-name: jungle-content;
}
.jungle-toolbar {
  position: static;
}
.compact-metric-help {
  display: none;
}
@container jungle-content (max-width: 1200px) {
  .compact-metric-help {
    display: block;
    grid-column: 1 / -1;
    color: var(--ma-muted);
    font-size: 12px;
  }
  .has-compact-help::before {
    display: none;
  }
}
</style>
