// sort-imports-ignore
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { createInstance } from 'i18next'
import { parse as parseYaml } from 'yaml'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, reactive, ssrContextKey } from 'vue'
import type { PoolCell, PoolTarget } from '@shared/shards/champion-pool/coverage'
import CoverageCellDetails from './CoverageCellDetails.vue'

const io = vi.hoisted(() => ({ i18next: null as any }))
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string, options?: object) => io.i18next.t(key, options),
    i18next: io.i18next
  })
}))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({
    champions: { name: (id: number) => (id === 1 ? '合成英雄甲' : '') }
  })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: {
    props: ['championId'],
    setup: (props: any) => () => h('champion-icon', { championId: props.championId })
  }
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: (props: any) => h('role-icon', props)
}))
vi.mock('naive-ui', () => ({
  useThemeVars: () => ({ value: { successColor: '#22aa55', errorColor: '#dd3344' } }),
  NButton: (props: any, { slots }: any) => h('button', props, slots.default?.())
}))
io.i18next = createInstance()
await io.i18next.init({
  lng: 'zh-CN',
  interpolation: { escapeValue: false },
  resources: Object.fromEntries(
    ['zh-CN', 'en'].map((language) => [
      language,
      {
        translation: parseYaml(
          readFileSync(
            new URL(
              '../../../../shared/i18n/' + language + '/renderer/shell.yaml',
              import.meta.url
            ),
            'utf8'
          )
        )
      }
    ])
  )
})
const descriptor = parse(
  readFileSync(new URL('./CoverageCellDetails.vue', import.meta.url), 'utf8')
).descriptor
CoverageCellDetails.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'pair-details-test' }).bindings
  }).code
)(Vue)

type Node = {
  type: string
  text: string
  props: Record<string, any>
  children: Node[]
  parent: Node | null
}
const node = (type: string): Node => ({ type, text: '', props: {}, children: [], parent: null })
function harness(
  cell: PoolCell = { championId: 1, state: 'available', deltaPp: 2.345, games: 38 }
) {
  const props = reactive({
    champion: { id: 1, name: 'Synthetic A' },
    target: {
      championId: 2,
      name: 'Synthetic B',
      role: 'SUP',
      mode: 'matchup',
      pickRate: 0.025,
      cells: [cell],
      bestChampionId: 1,
      bestDeltaPp: 2.345,
      complete: false,
      status: 'unknown',
      top3: {
        score: 99,
        reason: null,
        count: 3,
        referenceCount: 5,
        referenceTotal: 5,
        meanPp: 0,
        sdPp: 1
      }
    } as PoolTarget,
    cell,
    ownRole: 'MID' as const,
    patch: '26.22',
    fetchedAt: '2026-11-16T12:00:00.000Z'
  })
  const renderer = createRenderer<Node, Node>({
    createElement: node,
    createComment: node,
    createText: (text) => ({ ...node('text'), text }),
    setText: (n, text) => {
      n.text = text
    },
    setElementText: (n, text) => {
      n.text = text
      n.children = []
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    patchProp: (n, key, _old, value) => {
      n.props[key] = value
    },
    insert(n, parent, anchor) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
      n.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    }
  })
  const root = node('root')
  const close = vi.fn()
  const app = renderer.createApp({
    render: () => h(CoverageCellDetails, { ...props, onClose: close })
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
  return {
    props,
    close,
    all: () => walk(root),
    text: () =>
      walk(root)
        .map((n) => n.text)
        .join(' '),
    dispose: () => app.unmount()
  }
}

test('pair details show both heroes, roles, units, sample and source without whole-pool scoring', async () => {
  await io.i18next.changeLanguage('zh-CN')
  const f = harness()
  try {
    expect(f.text()).toContain('对位详情')
    expect(f.text()).toContain('合成英雄甲')
    expect(f.text()).toContain('Synthetic B')
    expect(f.text()).toContain('中路')
    expect(f.text()).toContain('辅助')
    expect(f.text()).toContain('+2.35 个百分点')
    expect(f.text()).toContain('38 场')
    expect(f.text()).not.toContain('2.5%')
    expect(f.text()).toContain('Lolalytics · 26.22 · 全球 · 翡翠+ · 单双排')
    expect(f.text()).not.toContain('本批基础数据获取于')
    expect(f.text()).not.toContain('不是实际胜率')
    expect(f.text()).not.toContain('小样本可能波动')
    expect(f.text()).not.toContain('Top-3')
    expect(f.text()).not.toContain('覆盖')
    expect(
      f
        .all()
        .filter((n) => n.type === 'champion-icon')
        .map((n) => n.props.championId)
    ).toEqual([1, 2])
    expect(
      f
        .all()
        .filter((n) => n.type === 'role-icon')
        .map((n) => n.props.position)
    ).toEqual(['MID', 'SUPPORT'])
    f.all()
      .find((n) => n.type === 'button' && n.props['aria-label'] === '关闭配对详情')!
      .props.onClick()
    expect(f.close).toHaveBeenCalledOnce()
  } finally {
    f.dispose()
  }
})

test.each([
  [-3.456, '-3.46 个百分点'],
  [0, '0.00 个百分点']
])('zero/negative delta %s and zero samples remain numeric, not missing', async (deltaPp, text) => {
  await io.i18next.changeLanguage('zh-CN')
  const f = harness({ championId: 1, state: 'available', deltaPp, games: 0 })
  try {
    expect(f.text()).toContain(text)
    expect(f.text()).toContain('0 场')
    expect(f.text()).not.toContain('暂无可估数据')
    expect(f.text()).not.toContain('未知')
  } finally {
    f.dispose()
  }
})

test.each([
  ['missing', '— 暂无可估数据', '不能视为 0 或劣势'],
  ['unavailable', '× 英雄已占用', '同一英雄不能同时']
] as const)(
  '%s is explicit and never converted to a win rate or zero',
  async (state, label, explanation) => {
    await io.i18next.changeLanguage('zh-CN')
    const f = harness({ championId: 1, state, deltaPp: null, games: null })
    try {
      expect(f.text()).toContain(label)
      expect(f.text()).toContain(explanation)
      expect(f.text()).toContain('未知')
      expect(f.text()).not.toContain('0.00 个百分点')
    } finally {
      f.dispose()
    }
  }
)

test('English synergy keeps role direction, source and unknown estimates, including long identities', async () => {
  await io.i18next.changeLanguage('en')
  const f = harness({ championId: 1, state: 'available', deltaPp: null, games: 12 })
  try {
    f.props.target.mode = 'synergy'
    f.props.target.role = 'JUNGLE'
    f.props.target.name = 'A very long synthetic teammate identity without truncating the name'
    f.props.target.pickRate = 0
    await nextTick()
    expect(f.text()).toContain('Synergy details')
    expect(f.text()).toContain('Teammate')
    expect(f.text()).toContain('Jungle')
    expect(f.text()).toContain(f.props.target.name)
    expect(f.text()).toContain('— No estimate')
    expect(f.text()).toContain('12 games')
    expect(f.text()).not.toContain('0.0%')
    expect(f.text()).toContain('Global · Emerald+ · Ranked solo/duo')
    expect(f.text()).not.toContain('not an actual win rate')
    expect(f.text()).not.toContain('Top-3')
  } finally {
    f.dispose()
    await io.i18next.changeLanguage('zh-CN')
  }
})

test('English pair sample uses the singular unit for exactly one game', async () => {
  await io.i18next.changeLanguage('en')
  const f = harness({ championId: 1, state: 'available', deltaPp: 0, games: 1 })
  try {
    expect(f.text()).toContain('1 game')
    expect(f.text()).not.toContain('1 games')
  } finally {
    f.dispose()
    await io.i18next.changeLanguage('zh-CN')
  }
})

test.each(['matchup', 'synergy'] as const)(
  'actual win rates preserve both overall populations and the %s pair sample',
  async (mode) => {
    await io.i18next.changeLanguage('zh-CN')
    const f = harness({
      championId: 1,
      state: 'available',
      deltaPp: 2.35,
      games: 38,
      ownWinRate: 0.5123,
      targetWinRate: 0.4987,
      pairWinRate: 0.56,
      ownGames: 1234,
      targetGames: 2345
    })
    try {
      f.props.target.mode = mode
      await nextTick()
      const rows = f.all().filter((n) => n.type === 'tr')
      const text = (n: Node): string => [n.text, ...n.children.map(text)].join(' ')
      expect(text(rows[1])).toContain('51.23%')
      expect(text(rows[1])).toContain('49.87%')
      expect(text(rows[1])).toContain('1234 场')
      expect(text(rows[1])).toContain('2345 场')
      expect(f.text()).toContain('56.00%')
      if (mode === 'matchup') {
        expect(f.text()).toContain('44.00%')
        expect(f.all().find((n) => n.props.role === 'img')?.props['aria-label']).toContain('44.00%')
      } else {
        expect(f.all().some((n) => n.props.role === 'img')).toBe(false)
        expect(f.all().filter((n) => n.text === '56.00%')).toHaveLength(1)
      }
      expect(f.text()).toContain('38 场')
      expect(f.text()).not.toContain('目标分路出场占比')
    } finally {
      f.dispose()
    }
  }
)
test('legacy cache and zero pair sample never invent an actual win rate from the delta', async () => {
  await io.i18next.changeLanguage('zh-CN')
  const f = harness({ championId: 1, state: 'available', deltaPp: 3, games: 20 })
  try {
    expect(f.text()).toContain('未采集')
    expect(f.text()).not.toContain('53.00%')
    f.props.cell = { ...f.props.cell, games: 0, pairWinRate: 0.7 }
    await nextTick()
    expect(f.text()).not.toContain('70.00%')
    expect(f.text()).toContain('0 场')
  } finally {
    f.dispose()
  }
})

test.each([0, 1])(
  'pair rate boundary %s is not missing or visually clamped',
  async (pairWinRate) => {
    await io.i18next.changeLanguage('zh-CN')
    const f = harness({
      championId: 1,
      state: 'available',
      deltaPp: 0,
      games: 10,
      pairWinRate,
      ownWinRate: 0,
      targetWinRate: 1
    })
    try {
      const bar = f.all().find((n) => n.props.role === 'img')!
      expect(bar.props['aria-label']).toContain('0.00%')
      expect(bar.props['aria-label']).toContain('100.00%')
      expect(f.text()).not.toContain('未采集')
    } finally {
      f.dispose()
    }
  }
)
