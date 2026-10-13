// sort-imports-ignore
import './test-i18n'

import { expect, test, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { i18next } from '@renderer-shared/i18n'
import ScatterFitSummary from './ScatterFitSummary.vue'
import { regressScatterGroups } from './scatter-analysis'

vi.mock('./MetricHelp.vue', () => ({
  default: (props: { label: string; definition: string }) =>
    h('button', { 'aria-label': props.label, 'data-definition': props.definition }, props.label)
}))

type Model = ReturnType<typeof regressScatterGroups>[number]
const render = (models: Model[], winOutcome = true) =>
  renderToString(
    createSSRApp({
      render: () =>
        h(ScatterFitSummary, {
          models: models.map((model) => ({ ...model, color: 'currentColor' })),
          winOutcome
        })
    })
  )

test('keeps coverage and limits outside the closed fit details, preserving exact linear values', async () => {
  const models = regressScatterGroups(
    [
      { player: 'Synthetic A', x: 1, y: 3 },
      { player: 'Synthetic A', x: 2, y: 2 },
      { player: 'Synthetic A', x: 3, y: 1 },
      { player: 'Synthetic A', x: NaN, y: 0 }
    ],
    true,
    false
  )
  const html = await render(models)
  const [visible, details] = html.split('<details')
  expect(visible).toContain('有效 3 条 / 缺失 1 条')
  expect(visible).toContain('样本较少')
  expect(visible).toContain('不代表因果关系或下一场预测效果')
  expect(details).not.toMatch(/\bopen(?:=|\s|>)/)
  expect(details).toContain('线性相关系数（Pearson r）')
  expect(details).toContain('-1.000')
  expect(details).toContain('线性拟合 R²')
  expect(details).toContain('1.000')
  expect(details).toContain('0 不代表完全没有关系')
})

test('constant outcomes remain visibly unavailable instead of being shown as zero', async () => {
  const html = await render(
    regressScatterGroups(
      [0, 1, 2].map((x) => ({ player: 'Synthetic A', x, y: 5 })),
      true,
      false
    )
  )
  expect(html.split('<details')[0]).toContain('纵轴恒定，相关系数与 R² 不可计算')
  expect(html).toContain('>—</span>')
  expect(html).not.toContain('>0.000</span>')
})

test('unfittable logistic observations keep the reason and never offer empty fit details', async () => {
  const html = await render(
    regressScatterGroups(
      [1, 2, 3].map((x) => ({ player: 'Synthetic A', x, y: 1 })),
      true,
      true
    )
  )
  expect(html).toContain('无法拟合：当前二元结果全部为 1 或全部为 0')
  expect(html).toContain('有效 3 条 / 缺失 0 条')
  expect(html).not.toContain('<details')
})

test('linear fit failure remains visible when another member has usable details', async () => {
  const html = await render(
    regressScatterGroups(
      [
        { player: 'Synthetic A', x: 1, y: 2 },
        { player: 'Synthetic A', x: 1, y: 3 },
        { player: 'Synthetic B', x: 1, y: 1 },
        { player: 'Synthetic B', x: 2, y: 2 }
      ],
      true,
      false
    )
  )
  const [visible, details] = html.split('<details')
  expect(visible).toContain('至少需要 2 个有效观测且横轴不能恒定')
  expect(details).not.toContain('Synthetic A')
  expect(details).toContain('Synthetic B')
})

test.each([true, false])(
  'preserves binary counts and the pseudo-R² caveat, wins = %s',
  async (wins) => {
    const models = regressScatterGroups(
      [0, 1, 2, 3, 4, 5].map((x) => ({ player: 'Synthetic A', x, y: x % 2 })),
      true,
      true
    )
    expect(models[0].logistic?.status).toBe('available')
    const html = await render(models, wins)
    expect(html).toContain(wins ? '3 胜 / 3 负' : '3 是 / 3 否')
    expect(html).toContain('Logistic 拟合：McFadden 伪 R²')
    expect(html).toContain('不能按普通 R² 解读')
    const fit = models[0].logistic!
    if (fit.status === 'available') expect(html).toContain(fit.pseudoRSquared.toFixed(3))
  }
)

test('English keeps labels, valid counts and limits in the active locale', async () => {
  await i18next.changeLanguage('en')
  try {
    const html = await render(
      regressScatterGroups(
        [1, 2].map((x) => ({ player: 'Synthetic A', x, y: x })),
        true,
        false
      )
    )
    expect(html).toContain('2 valid / 0 missing observations')
    expect(html).toContain('Linear correlation (Pearson r)')
    expect(html).toContain('not causation or next-match performance')
  } finally {
    await i18next.changeLanguage('zh-CN')
  }
})
