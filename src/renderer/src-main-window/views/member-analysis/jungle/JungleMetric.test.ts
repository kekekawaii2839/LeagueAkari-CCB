// sort-imports-ignore
import '../test-i18n'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { i18next } from '@renderer-shared/i18n'
import I18nextVue from 'i18next-vue'
import { expect, test } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { aggregateJungle } from '../analytics'
import { jungleEvidence, evidenceKey } from './analysis'
import JungleMetric from './JungleMetric.vue'

function game(
  cs: number | null,
  gold: number | null,
  objectiveDamage: number | null,
  minutes: number
): MemberAnalysisGame {
  return {
    side: 'Blue',
    win: true,
    players: [{ player: 'Synthetic', role: 'JUNGLE', cs, gold, objectiveDamage, minutes }],
    jungle: { player: 'Synthetic', startCamp: null, startCampOwn: null }
  } as MemberAnalysisGame
}
async function renderMetric(games: MemberAnalysisGame[], metric: string) {
  await i18next.changeLanguage('zh-CN')
  const row = aggregateJungle(games)[0]
  const evidence = jungleEvidence(games).get(evidenceKey('Synthetic', '总计'))!
  return renderToString(
    createSSRApp({ render: () => h(JungleMetric, { row, evidence, metric }) }).use(I18nextVue, {
      i18next
    })
  )
}
test('existing efficiency label displays its own exposure, not total-player minutes', async () => {
  const games = [game(null, null, null, 50), game(0, 0, 0, 30), game(120, null, 300, 15)]
  const cs = await renderMetric(games, 'cspm')
  const gold = await renderMetric(games, 'gpm')
  const objective = await renderMetric(games, 'objectiveDamagePM')
  expect(cs).toContain('有效 2/3 场')
  expect(cs).toContain('总时长 45 分钟')
  expect(gold).toContain('有效 1/3 场')
  expect(gold).toContain('总时长 30 分钟')
  expect(gold).toContain('0.00')
  expect(objective).toContain('有效 2/3 场')
  expect(objective).toContain('总时长 45 分钟')
  for (const html of [cs, gold, objective]) expect(html).not.toContain('总时长 95 分钟')
})
test('all-invalid efficiency shows unavailable, zero valid population and zero eligible time', async () => {
  for (const metric of ['cspm', 'gpm', 'objectiveDamagePM']) {
    const html = await renderMetric([game(null, null, null, 50)], metric)
    expect(html).toContain('—')
    expect(html).toContain('有效 0/1 场')
    expect(html).toContain('总时长 0 分钟')
    expect(html).not.toContain('总时长 50 分钟')
  }
})
