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
const visibleText = (html: string) => html.replace(/<[^>]*>/g, ' ')
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

test('keeps counts, coverage and exact metrics in a permanent semantic table', async () => {
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
  expect(html).toContain('3 条')
  expect(html).toContain('有效 3 条 / 缺失 1 条')
  expect(html).toContain('样本较少')
  expect(html).not.toContain('样本过少')
  expect(html).not.toContain('<details')
  expect(html).not.toContain('<summary')
  expect(html).not.toContain('相关和拟合仅描述当前样本')
  expect(html).toContain('<table')
  expect(html).toContain('scope="col"')
  expect(html).toContain('scope="row"')
  expect(html).toContain('线性相关系数（Pearson r）')
  expect(html).toContain('-1.000')
  expect(html).toContain('线性拟合 R²')
  expect(html).toContain('1.000')
  expect(html).toContain('0 不代表完全没有关系')
})

test('constant outcomes remain visibly unavailable instead of being shown as zero', async () => {
  const html = await render(
    regressScatterGroups(
      [0, 1, 2].map((x) => ({ player: 'Synthetic A', x, y: 5 })),
      true,
      false
    )
  )
  expect(html).toContain('纵轴恒定，相关系数与 R² 不可计算')
  expect(html).not.toContain('样本过少')
  expect(html).toContain('>—</td>')
  expect(html).not.toContain('>0.000</td>')
})

test('unfittable logistic observations retain their coverage and reason in reachable details', async () => {
  const html = await render(
    regressScatterGroups(
      [1, 2, 3].map((x) => ({ player: 'Synthetic A', x, y: 1 })),
      true,
      true
    )
  )
  expect(html).toContain('data-definition="当前二元结果全部为 1 或全部为 0')
  expect(visibleText(html)).toContain('无法拟合')
  expect(visibleText(html)).not.toContain('当前二元结果全部')
  expect(html).not.toContain('样本过少')
  expect(html).toContain('有效 3 条 / 缺失 0 条')
  expect(html).not.toContain('<details')
  expect(html).toContain('3 条')
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
  expect(html).toContain('横轴指标恒定，无法估计关系')
  expect(html).not.toContain('至少需要')
  expect(html).not.toContain('样本过少')
  expect(html).toContain('Synthetic A')
  expect(html).toContain('Synthetic B')
})

test.each([false, true])(
  'too few observations show only the concise insufficient-sample state, binary = %s',
  async (binary) => {
    const points = binary
      ? [
          { player: 'Synthetic A', x: 1, y: 0 },
          { player: 'Synthetic A', x: 2, y: 1 }
        ]
      : [{ player: 'Synthetic A', x: 1, y: 2 }]
    const html = await render(regressScatterGroups(points, true, binary))
    expect(html).toContain('样本过少')
    expect(html).not.toContain('样本较少')
    expect(visibleText(html)).not.toContain('至少需要')
    expect(html).toContain(`data-definition="至少需要 ${binary ? 3 : 2} 个有效观测"`)
    expect(html).not.toContain('无法拟合')
    expect(html).toContain('>—</td>')
  }
)

test('insufficient valid observations retain missingness instead of counting missing rows as samples', async () => {
  const html = await render(
    regressScatterGroups(
      [
        { player: 'Synthetic A', x: 1, y: 2 },
        { player: 'Synthetic A', x: NaN, y: 3 }
      ],
      true,
      false
    )
  )
  expect(html).toContain('有效 1 条 / 缺失 1 条')
  expect(html).toContain('样本过少')
  expect(html).not.toContain('样本较少')
})

test('a separated logistic sample remains a model failure, not insufficient sample', async () => {
  const html = await render(
    regressScatterGroups(
      [
        { player: 'Synthetic A', x: 1, y: 0 },
        { player: 'Synthetic A', x: 2, y: 0 },
        { player: 'Synthetic A', x: 3, y: 1 },
        { player: 'Synthetic A', x: 4, y: 1 }
      ],
      true,
      true
    )
  )
  expect(html).toContain('完全或准完全分离')
  expect(visibleText(html)).not.toContain('完全或准完全分离')
  expect(html).toContain('aria-label="Synthetic A · 无法拟合"')
  expect(html).not.toContain('样本过少')
})

test('constant outcomes use a short correlation status without falsely claiming the constant line cannot fit', async () => {
  const html = await render(
    regressScatterGroups(
      [0, 1, 2].map((x) => ({ player: 'Synthetic A', x, y: 5 })),
      true,
      false
    )
  )
  expect(visibleText(html)).toContain('相关性不可用')
  expect(visibleText(html)).not.toContain('纵轴恒定')
  expect(visibleText(html)).not.toContain('无法拟合')
  expect(html).toContain('data-definition="纵轴恒定，相关系数与 R² 不可计算"')
})

test('missing observations keep a short count beside a help trigger with exact valid and missing coverage', async () => {
  const html = await render(
    regressScatterGroups(
      [
        { player: 'Synthetic A', x: 1, y: 2 },
        { player: 'Synthetic A', x: 2, y: 3 },
        { player: 'Synthetic A', x: NaN, y: 0 }
      ],
      true,
      false
    )
  )
  expect(visibleText(html)).toContain('缺失 1 条')
  expect(visibleText(html)).not.toContain('有效 2 条 / 缺失 1 条')
  expect(html).toContain('aria-label="Synthetic A · 缺失 1 条"')
  expect(html).toContain('data-definition="有效 2 条 / 缺失 1 条"')
})

test('insufficient sample and constant-predictor states use the active English locale', async () => {
  await i18next.changeLanguage('en')
  try {
    const insufficient = await render(
      regressScatterGroups([{ player: 'Synthetic A', x: 1, y: 2 }], true, false)
    )
    expect(insufficient).toContain('Insufficient sample')
    expect(visibleText(insufficient)).not.toContain('At least')
    expect(insufficient).toContain('data-definition="At least 2 valid observations are required"')
    expect(insufficient).not.toContain('Small sample')
    const constant = await render(
      regressScatterGroups(
        [
          { player: 'Synthetic A', x: 1, y: 2 },
          { player: 'Synthetic A', x: 1, y: 3 }
        ],
        true,
        false
      )
    )
    expect(constant).toContain('The predictor is constant')
    expect(constant).not.toContain('Insufficient sample')
  } finally {
    await i18next.changeLanguage('zh-CN')
  }
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
    expect(html).toContain('2 observations')
    expect(html).toContain('Sample')
    expect(html).toContain('2 valid / 0 missing observations')
    expect(html).toContain('Linear correlation (Pearson r)')
    expect(html).not.toContain('Correlation and fitting describe only')
  } finally {
    await i18next.changeLanguage('zh-CN')
  }
})

test('per-member results preserve all six fitted members and their exact details', async () => {
  const models = regressScatterGroups(
    Array.from({ length: 6 }, (_, member) =>
      Array.from({ length: 12 }, (_, i) => ({
        player: `匿名成员${member + 1}`,
        x: i,
        y: i * (member + 1) + 2
      }))
    ).flat(),
    true,
    false
  )
  const html = await render(models)
  expect(models).toHaveLength(6)
  for (let member = 1; member <= 6; member++) {
    expect(html).toContain(`title="匿名成员${member}"`)
  }
  expect(html.match(/>1\.000<\/td>/g)).toHaveLength(12)
  expect(html.match(/<table/g)).toHaveLength(1)
  expect(html.match(/<button/g)).toHaveLength(2)
})

test('long same-name identities remain full in pointer titles and keyboard-focusable readable text without extra popovers', async () => {
  const names = [
    '匿名同名长成员名称#LONG_ANONYMOUS_TAG_A',
    '匿名同名长成员名称#LONG_ANONYMOUS_TAG_B'
  ]
  const models = regressScatterGroups(
    names.flatMap((player) => [1, 2, 3].map((x) => ({ player, x, y: x }))),
    true,
    false
  )
  const html = await render(models)
  for (const name of names) {
    expect(html).toContain(`title="${name}"`)
    expect(html).toContain(`aria-label="${name}" tabindex="0"`)
    expect(html).toContain(name)
  }
  expect(html).toContain('…OUS_TAG_A')
  expect(html).toContain('…OUS_TAG_B')
  expect(html.match(/<button/g)).toHaveLength(2)
})
