<template>
  <div class="ma-panel ma-workspace">
    <header class="ma-view-heading">
      <div>
        <h2>事件之后的结果</h2>
      </div>
      <span>{{ total?.games ?? 0 }} 场有效样本</span>
    </header>
    <NRadioGroup v-model:value="sectionIndex" aria-label="事件结果类别"
      ><NRadioButton v-for="(section, index) in sections" :key="section.title" :value="index">{{
        section.title
      }}</NRadioButton></NRadioGroup
    >
    <p class="ma-chart-note">比例横条共用 0–100% 尺度；次数按各自事件窗口统计，不表示因果。</p>
    <div v-if="!total" class="ma-empty">当前筛选下没有事件结果。</div>
    <div v-else class="decision-ledger">
      <article
        v-for="section in [sections[sectionIndex]]"
        :key="section.title"
        class="decision-row"
      >
        <div class="decision-title">
          <b>{{ section.title }}</b>
        </div>
        <div class="flow">
          <div v-for="metric in section.metrics" :key="metric.key">
            <MetricHelp :label="metric.label" :definition="metric.note" /><strong
              :class="metric.risk && Number(total[metric.key]) > 0 ? 'ma-negative' : ''"
              >{{
                formatDecisionMetric(metric.key, total[metric.key], metric.fmt, metric.signed)
              }}</strong
            >
            <div v-if="metric.fmt === 'pct'" class="event-rate" aria-hidden="true">
              <i
                v-if="finiteOrNull(total[metric.key]) !== null"
                :class="{ risk: metric.risk }"
                :style="{ width: `${Math.max(0, Math.min(1, Number(total[metric.key]))) * 100}%` }"
              />
            </div>
            <small
              >{{ denominatorLabel(metric.key, total)
              }}<template v-if="rateCounts[metric.key]">
                · {{ rateWins(metric.key, total) }}/{{
                  rateDenominator(metric.key, total)
                }}
                次</template
              ></small
            >
          </div>
        </div>
      </article>
    </div>
    <div class="ma-section-title"><strong>蓝红方对照</strong><span>当前类别 · 各自样本</span></div>
    <div class="event-side-wrap">
      <table class="event-side-table">
        <thead>
          <tr>
            <th>指标</th>
            <th v-for="row in conversion" :key="row.sideLabel">
              {{ row.sideLabel }} · {{ row.games }} 场
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="metric in sections[sectionIndex].metrics" :key="metric.key">
            <th scope="row">{{ metric.label }}</th>
            <td v-for="row in conversion" :key="row.sideLabel">
              {{ formatDecisionMetric(metric.key, row[metric.key], metric.fmt, metric.signed)
              }}<small v-if="denominatorLabel(metric.key, row)">{{
                denominatorLabel(metric.key, row)
              }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="ma-section-title">
      <strong>死亡代价最高的样本对局</strong>
    </div>
    <p v-if="!costly.length" class="ma-chart-note">当前范围没有记录到正值死亡代价。</p>
    <div v-else class="risk-list">
      <article v-for="game in costly" :key="game.gameId" class="risk-row">
        <div class="ma-card__head">
          <b>{{ game.date }} · {{ game.win ? '胜' : '负' }}</b
          ><span :class="game.side === 'Blue' ? 'ma-blue' : 'ma-red'">{{
            game.side === 'Blue' ? '蓝方' : '红方'
          }}</span>
        </div>
        <strong class="risk-value ma-negative">{{
          formatSigned(game.eventDecision.deathCostPoints)
        }}</strong
        ><span class="risk-note"
          >死亡代价点 · 资源 {{ game.eventDecision.deathCostEpics }} · 塔
          {{ game.eventDecision.deathCostTowers }} · 镀层
          {{ game.eventDecision.deathCostPlates }}</span
        >
      </article>
    </div>
    <details>
      <summary>全部指标明细</summary>
      <div class="event-side-wrap">
        <table class="event-side-table">
          <thead>
            <tr>
              <th>指标</th>
              <th v-for="row in conversion" :key="row.sideLabel">
                {{ row.sideLabel }} · {{ row.games }} 场
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="[key, label, format] in metrics" :key="key">
              <th scope="row">{{ label }}</th>
              <td v-for="row in conversion" :key="row.sideLabel">
                {{ formatDecisionMetric(key, row[key], format, key === 'tradeDelaySec') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { NRadioButton, NRadioGroup } from 'naive-ui'
import MetricHelp from './MetricHelp.vue'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { formatMetric } from './metric-defs'
import { finiteOrNull, formatSigned } from './visualization'
const sectionIndex = ref(0)
const { conversion, games } = useMemberAnalysisData()
const total = computed(
  () => conversion.value.find((x) => x.sideLabel === '总计') ?? conversion.value[0]
)
const costly = computed(() =>
  [...games.value]
    .filter((x) => x.eventDecision.deathCostPoints > 0)
    .sort((a, b) => b.eventDecision.deathCostPoints - a.eventDecision.deathCostPoints)
    .slice(0, 6)
)
const denominatorLabel = (key: string, row: Record<string, unknown>) => {
  if (key.startsWith('kill')) return `${row.killEpisodes ?? 0} 个击杀窗口`
  if (key === 'highCostDeathRate') return `${row.deathEpisodes ?? 0} 个死亡窗口`
  if (key === 'cleanObjectiveRate') return `${row.objectivesTaken ?? 0} 个资源事件`
  if (key === 'objectiveFightWinRate') return `${row.objectiveFightSamples ?? 0} 次资源团`
  if (key === 'crossMapTradeRate') return `${row.enemyObjectives ?? 0} 个敌方资源窗口`
  return ''
}
const rateCounts: Record<string, { wins: string; games: string }> = {
  killConversionRate: { wins: 'convertedKillEpisodes', games: 'killEpisodes' },
  killToEpicRate: { wins: 'killToEpicEpisodes', games: 'killEpisodes' },
  killToTowerRate: { wins: 'killToTowerEpisodes', games: 'killEpisodes' },
  highCostDeathRate: { wins: 'highCostDeathEpisodes', games: 'deathEpisodes' },
  cleanObjectiveRate: { wins: 'cleanObjectives', games: 'objectivesTaken' },
  objectiveFightWinRate: { wins: 'objectiveFightWins', games: 'objectiveFightSamples' },
  crossMapTradeRate: { wins: 'tradedEnemyObjectives', games: 'enemyObjectives' }
}
const rateWins = (key: string, row: Record<string, unknown>) =>
  Number(row[rateCounts[key]?.wins] ?? 0)
const rateDenominator = (key: string, row: Record<string, unknown>) =>
  Number(row[rateCounts[key]?.games] ?? 0)
const formatDecisionMetric = (
  key: string,
  value: unknown,
  format: 'num' | 'pct' | 'int',
  signed: boolean
) => {
  const displayed = signed ? formatSigned(value, 1) : formatMetric(value, format)
  return key === 'conversionDelaySec' || key === 'tradeDelaySec'
    ? displayed === '—'
      ? displayed
      : `${displayed} 秒`
    : displayed
}
const sections = [
  {
    title: '击杀后的兑现',
    metrics: [
      {
        key: 'killConversionRate',
        label: '总兑现率',
        fmt: 'pct',
        note: '击杀后转资源或推塔',
        risk: false,
        signed: false
      },
      {
        key: 'killToEpicRate',
        label: '转资源率',
        fmt: 'pct',
        note: '击杀后取得史诗资源',
        risk: false,
        signed: false
      },
      {
        key: 'killToTowerRate',
        label: '转推塔率',
        fmt: 'pct',
        note: '击杀后取得防御塔',
        risk: false,
        signed: false
      },
      {
        key: 'conversionDelaySec',
        label: '平均延迟',
        fmt: 'num',
        note: '秒',
        risk: false,
        signed: false
      }
    ]
  },
  {
    title: '死亡代价',
    metrics: [
      {
        key: 'highCostDeathRate',
        label: '高代价死亡率',
        fmt: 'pct',
        note: '导致明显资源损失',
        risk: true,
        signed: false
      },
      {
        key: 'deathCostPointsPG',
        label: '场均代价点',
        fmt: 'num',
        note: '资源、塔和镀层加权',
        risk: true,
        signed: false
      },
      {
        key: 'deathCostEpicsPG',
        label: '场均丢资源',
        fmt: 'num',
        note: '史诗资源',
        risk: true,
        signed: false
      }
    ]
  },
  {
    title: '资源团决策',
    metrics: [
      {
        key: 'cleanObjectiveRate',
        label: '干净资源率',
        fmt: 'pct',
        note: '无需付出团战代价',
        risk: false,
        signed: false
      },
      {
        key: 'objectiveFightWinRate',
        label: '资源团胜率',
        fmt: 'pct',
        note: '资源附近团战胜率',
        risk: false,
        signed: false
      },
      {
        key: 'objectivesTaken',
        label: '取得资源',
        fmt: 'int',
        note: '当前样本总数',
        risk: false,
        signed: false
      }
    ]
  },
  {
    title: '跨图交换',
    metrics: [
      {
        key: 'crossMapTradeRate',
        label: '交换率',
        fmt: 'pct',
        note: '敌方拿资源时取得跨图收益',
        risk: false,
        signed: false
      },
      {
        key: 'tradeDelaySec',
        label: '交换延迟',
        fmt: 'num',
        note: '负数表示提前交换',
        signed: true,
        risk: false
      },
      {
        key: 'enemyObjectives',
        label: '敌方资源事件',
        fmt: 'int',
        note: '可交换窗口',
        risk: false,
        signed: false
      }
    ]
  }
] as const
const metrics = [
  ['games', '场次', 'int'],
  ['winRate', '胜率', 'pct'],
  ['killEpisodes', '击杀窗口', 'int'],
  ['killConversionRate', '击杀兑现率', 'pct'],
  ['killToEpicRate', '击杀转资源率', 'pct'],
  ['killToTowerRate', '击杀转推塔率', 'pct'],
  ['conversionDelaySec', '兑现延迟(秒)', 'num'],
  ['deathEpisodes', '死亡窗口', 'int'],
  ['highCostDeathRate', '高代价死亡率', 'pct'],
  ['deathCostPointsPG', '场均死亡代价', 'num'],
  ['deathCostEpicsPG', '场均丢资源', 'num'],
  ['deathCostTowersPG', '场均丢塔', 'num'],
  ['shutdownBountyLostPG', '场均终结赏金', 'num'],
  ['objectivesTaken', '取得资源', 'int'],
  ['cleanObjectiveRate', '干净资源率', 'pct'],
  ['objectiveFightSamples', '资源团样本', 'int'],
  ['objectiveFightWins', '资源团获胜', 'int'],
  ['objectiveFightWinRate', '资源团胜率', 'pct'],
  ['enemyObjectives', '敌方资源', 'int'],
  ['crossMapTradeRate', '跨图交换率', 'pct'],
  ['tradeDelaySec', '交换延迟(秒)', 'num']
] as const
</script>
<style scoped>
.decision-ledger {
  border-top: 1px solid var(--ma-grid);
}
.decision-title {
  padding: 16px 0 4px;
  color: var(--ma-muted);
  font-size: 12px;
}
.flow {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(155px, 1fr));
  gap: 24px;
  padding: 8px 0 24px;
}
.flow > div {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
}
.flow strong {
  font-size: 30px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 1.15;
}
.flow small {
  color: var(--ma-muted);
  font-size: 12px;
}
.event-rate {
  height: 5px;
  background: var(--ma-grid);
  border-radius: 2px;
}
.event-rate i {
  display: block;
  height: 100%;
  background: var(--ma-positive);
  border-radius: inherit;
}
.event-rate i.risk {
  background: var(--ma-negative);
}
.event-side-wrap {
  overflow-x: auto;
}
.event-side-table {
  width: 100%;
  border-collapse: collapse;
  font-variant-numeric: tabular-nums;
  min-width: 480px;
}
.event-side-table th,
.event-side-table td {
  text-align: right;
  padding: 13px 12px;
  border-bottom: 1px solid var(--ma-grid);
}
.event-side-table th:first-child {
  text-align: left;
  font-weight: 500;
}
.event-side-table thead,
.event-side-table small {
  color: var(--ma-muted);
  font-size: 12px;
  font-weight: 400;
}
.event-side-table small {
  display: block;
  margin-top: 4px;
}
.risk-row {
  display: grid;
  grid-template-columns: 180px 90px 1fr;
  gap: 16px;
  padding: 14px 0;
  border-bottom: 1px solid var(--ma-grid);
  align-items: center;
}
.risk-value {
  font-size: 20px;
  font-variant-numeric: tabular-nums;
}
.risk-note {
  font-size: 12px;
  color: var(--ma-muted);
}
@media (max-width: 760px) {
  .flow {
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }
  .flow strong {
    font-size: 24px;
  }
  .risk-row {
    grid-template-columns: 1fr auto;
  }
  .risk-note {
    grid-column: 1/-1;
  }
}
</style>
