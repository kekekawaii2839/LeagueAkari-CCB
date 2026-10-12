import I18nextVue from 'i18next-vue'
// sort-imports-ignore
import '../test-i18n'
import { vi, beforeEach, expect, test } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'
import { i18next } from '@renderer-shared/i18n'
import { aggregateJungle } from '../analytics'
import JungleView from '../JungleView.vue'
import JungleCampTable from './JungleCampTable.vue'
import JungleCells from './JungleCells.vue'
import { jungleEvidence, evidenceKey } from './analysis'
vi.mock('naive-ui', () => ({
  NButton: (_p: unknown, { slots }: { slots: { default: () => unknown } }) =>
    h('button', slots.default?.() as any),
  NRadioButton: (_p: unknown, { slots }: { slots: { default: () => unknown } }) =>
    h('span', slots.default?.() as any),
  NRadioGroup: (_p: unknown, { slots }: { slots: { default: () => unknown } }) =>
    h('div', slots.default?.() as any),
  NSwitch: () => null
}))
const data = vi.hoisted(() => ({ jungle: null as any, games: null as any }))
vi.mock('../useMemberAnalysisData', () => ({ useMemberAnalysisData: () => data }))
const game = (camp: string | null, own: boolean | null, side = 'Blue'): MemberAnalysisGame =>
  ({
    side,
    win: false,
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    players: [
      {
        player: 'A#X',
        role: 'JUNGLE',
        minutes: 30,
        cs: 0,
        gold: 10000,
        objectiveDamage: 0,
        gd10: 0,
        gd15: null,
        xpd15: null
      }
    ],
    jungle: {
      player: 'A#X',
      startCamp: camp,
      startCampOwn: own,
      level3Gank: false,
      level4Gank: false,
      topGanks: 0,
      midGanks: 0,
      botGanks: 0,
      topZoneWeight: 0,
      midZoneWeight: 0,
      botZoneWeight: 0,
      totalZoneWeight: 0,
      gotFirstDragon: null,
      firstDragonTimeSec: null,
      dragons: 0,
      soloDragons: 0,
      voidgrubs: 0,
      heralds: 0,
      barons: 0
    }
  }) as MemberAnalysisGame
beforeEach(async () => {
  setActivePinia(createPinia())
  await i18next.changeLanguage('zh-CN')
  data.games = ref([game('red', true), game('blue', null, 'Red'), game(null, null)])
  data.jungle = ref(aggregateJungle(data.games.value))
})
const render = (component: any, props = {}) =>
  renderToString(createSSRApp({ render: () => h(component, props) }).use(I18nextVue, { i18next }))
test('main opening has own/enemy only, unknown counts remain next to their unchanged eligible denominator', async () => {
  const text = await render(JungleView)
  expect(text).toContain('归属可判定 1/2 场')
  expect(text).toContain('归属未知 1 场')
  expect(text).toContain('首营地可识别 2/3 场')
  expect(text).toContain('50.0%')
  expect(text).toContain('营地未知 1 场未计入')
  expect(text).not.toMatch(/<th[^>]*scope="row"[^>]*>归属未知<\/th>/)
})
test('side breakdown directly retains both side samples and unknown count without requiring selection', async () => {
  useMemberAnalysisStore().sideBreakdown = true
  const text = await render(JungleView)
  expect(text).toContain('蓝方')
  expect(text).toContain('红方')
  expect(text).toContain('归属可判定 0/1 场')
  expect(text).toContain('归属未知 1 场')
  expect(text).not.toContain('完整打野数据')
})
test('complete camp details retain unknown camp count/share, genuine zero, and no-data missingness', async () => {
  const e = jungleEvidence(data.games.value).get(evidenceKey('A#X', '总计'))!
  const text = await render(JungleCampTable, { evidence: e, complete: true })
  expect(text).toMatch(/<th[^>]*scope="row"[^>]*>归属未知<\/th>/)
  expect(text).toContain('1 场')
  expect(text).toContain('50.0%')
  expect(text).toContain('0 场')
  expect(text).toContain('0.0%')
  const missing = jungleEvidence([game(null, null)]).get(evidenceKey('A#X', '总计'))!
  const noData = await render(JungleCampTable, { evidence: missing })
  expect(noData).toContain('无有效营地记录')
  expect(noData).not.toContain('0.0%')
  expect(noData).not.toContain('— 无可识别营地')
})
test('gank and development keep overlapping rates, exact zero and independent snapshot missingness', async () => {
  const row = data.jungle.value[0],
    e = jungleEvidence(data.games.value).get(evidenceKey('A#X', '总计'))!,
    scales = { gank: 1, gold: 500, xp: 300, dragon15: 1, grub15: 1, objectiveFight15: 1 }
  const gank = await render(JungleCells, { row, evidence: e, group: 'gank', scales })
  expect(gank).toContain('3级抓人率')
  expect(gank).toContain('4级抓人率')
  expect(gank).toContain('0.0%')
  expect(gank).toContain('权重分母 0')
  const dev = await render(JungleCells, { row, evidence: e, group: 'development', scales })
  expect(dev).toContain('10 分钟经济差（金币）')
  expect(dev).toContain('有效 0/3 场')
  expect(dev).toContain('缺失 3 场')
  expect(dev).toContain('—')
  expect(dev).not.toContain('10 分钟经验差')
})
test('new English copy retains the same camp counts/denominator and main-only ownership policy', async () => {
  await i18next.changeLanguage('en')
  const text = await render(JungleView)
  expect(text).toContain('1/2 identified camps with known ownership')
  expect(text).toContain('1 camps with unknown ownership')
  expect(text).toContain('Shared denominator: 2/3')
  expect(text).toContain('50.0%')
  expect(text).not.toMatch(/<th[^>]*scope="row"[^>]*>Unknown ownership<\/th>/)
})

test('configured member order and stable ordinal do not follow aggregate sample ranking', async () => {
  const other = {
    ...game('red', true),
    players: game('red', true).players.map((p) => ({ ...p, player: 'B#X' })),
    jungle: { ...game('red', true).jungle!, player: 'B#X' }
  }
  data.games.value.push(other)
  data.jungle.value = aggregateJungle(data.games.value)
  useMemberAnalysisStore().settings = {
    enabled: true,
    members: [
      { serverId: 'X', gameName: 'B', tagLine: 'X' },
      { serverId: 'X', gameName: 'A', tagLine: 'X' }
    ],
    historyDepth: 100,
    scanLimitPerMember: 2000,
    historyTag: 'ranked',
    storageLimitGiB: 10,
    opggEnabled: false
  }
  const text = await render(JungleView)
  expect(text.indexOf('>B</button>')).toBeLessThan(text.indexOf('>A</button>'))
  expect(text).toContain('1 场 · 0 胜 / 1 负')
})
test('empty sample has no fabricated member or camp comparison', async () => {
  data.games.value = []
  data.jungle.value = []
  const text = await render(JungleView)
  expect(text).toContain('当前样本没有打野时间线数据。')
  expect(text).not.toContain('营地归属')
})
