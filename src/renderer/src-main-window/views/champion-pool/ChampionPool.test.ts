// sort-imports-ignore
import { readFileSync } from 'node:fs'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { flushPromises } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, ssrContextKey } from 'vue'
import type { DraftRole } from '@shared/shards/member-analysis/champion-pool/scoring'
import ChampionPool from './ChampionPool.vue'

const fixture = vi.hoisted(() => {
  const champion = { id: 1, name: 'Synthetic champion' }
  const champions = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    name: `Synthetic ${index + 1}`
  }))
  const pools = { TOP: [1], JUNGLE: [1], MID: [1], ADC: [1], SUP: [1] }
  return {
    api: {
      getPreferences: async () => ({ status: 'ready', data: { lastRole: 'ADC', pools } }),
      savePool: vi.fn(async () => ({ status: 'ready', data: { pools } })),
      getCatalog: async (role: string) => ({
        status: 'ready',
        data: { datasetId: role, role, champions }
      }),
      getCoverage: async (role: string) => ({
        status: 'ready',
        data: { role, champions: [champion], targets: [] }
      })
    }
  }
})
vi.mock('@renderer-shared/shards', () => ({ useInstance: () => fixture.api }))
vi.mock('@main-window/shards/champion-pool', () => ({ ChampionPoolRenderer: class {} }))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: () => ({ gameData: { champions: {} } })
}))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({
    champions: { searchKeywords: (id: number) => (id === 1 ? ['合成英雄', '测试别名'] : []) }
  })
}))
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@vicons/material', () => ({ ViewModuleRound: () => null }))
vi.mock('./CoverageHeatmap.vue', () => ({ default: () => null }))
vi.mock('./select-renderers', () => ({
  renderRoleLabel: () => null,
  renderChampionLabel: () => null,
  renderChampionTag: () => null
}))
vi.mock('naive-ui', () =>
  Object.fromEntries(
    [
      'Alert',
      'Button',
      'Checkbox',
      'Empty',
      'Icon',
      'Input',
      'Select',
      'Spin',
      'Tab',
      'Tabs',
      'Popover',
      'Tag'
    ].map((kind) => [
      'N' + kind,
      (props: Record<string, unknown>) => h('control', { ...props, kind })
    ])
  )
)

const descriptor = parse(
  readFileSync(new URL('./ChampionPool.vue', import.meta.url), 'utf8')
).descriptor
ChampionPool.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'champion-pool-test' }).bindings
  }).code
)(Vue)

type HostNode = {
  props: Record<string, unknown>
  children: HostNode[]
  parent: HostNode | null
}
const node = (): HostNode => ({ props: {}, children: [], parent: null })

function mountPool() {
  function remove(child: HostNode) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const renderer = createRenderer<HostNode, HostNode>({
    createElement: node,
    createText: node,
    createComment: node,
    setText() {},
    setElementText() {},
    patchProp: (n, key, _old, value) => {
      n.props[key] = value
    },
    parentNode: (n) => n.parent,
    nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
    insert(child, parent, anchor) {
      remove(child)
      child.parent = parent
      parent.children.splice(
        anchor ? parent.children.indexOf(anchor) : parent.children.length,
        0,
        child
      )
    },
    remove
  })
  const root = node()
  const app = renderer.createApp(ChampionPool)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const walk = (n: HostNode): HostNode[] => [n, ...n.children.flatMap(walk)]
  const control = (id: string) =>
    walk(root).find((n) => (n.props['input-props'] as { id: string } | undefined)?.id === id)!.props
  async function update(props: Record<string, unknown>, value: string | number[]) {
    ;(props['onUpdate:value'] as (v: string | number[]) => void)(value)
    await flushPromises()
  }
  return {
    setRole: (role: DraftRole) => update(control('pool-role'), role),
    setMode: (mode: string) => update(walk(root).find((n) => n.props.kind === 'Tabs')!.props, mode),
    setTarget: (role: DraftRole) => update(control('pool-target-role'), role),
    target: () => control('pool-target-role').value,
    champions: () => control('pool-champions'),
    setChampions: (ids: number[]) => update(control('pool-champions'), ids),
    dispose: () => app.unmount()
  }
}

test('defaults target lane in both tabs for every player lane', async () => {
  const pool = mountPool()
  try {
    await flushPromises()
    expect(pool.target()).toBe('ADC')
    await pool.setMode('synergy')
    expect(pool.target()).toBe('SUP')
    const cases = [
      ['MID', 'JUNGLE'],
      ['TOP', 'JUNGLE'],
      ['JUNGLE', 'MID'],
      ['ADC', 'SUP'],
      ['SUP', 'ADC']
    ] as const
    for (const [role, partner] of cases) {
      await pool.setRole(role)
      await pool.setMode('synergy')
      expect(pool.target()).toBe(partner)
      await pool.setMode('matchup')
      expect(pool.target()).toBe(role)
    }
  } finally {
    pool.dispose()
  }
})

test('keeps manual targets per tab until the player lane changes', async () => {
  const pool = mountPool()
  try {
    await flushPromises()
    await pool.setRole('MID')
    expect(pool.target()).toBe('MID')
    await pool.setTarget('TOP')
    await pool.setMode('synergy')
    expect(pool.target()).toBe('JUNGLE')
    await pool.setTarget('SUP')
    await pool.setMode('matchup')
    expect(pool.target()).toBe('TOP')
    await pool.setMode('synergy')
    expect(pool.target()).toBe('SUP')
    await pool.setRole('SUP')
    expect(pool.target()).toBe('ADC')
    await pool.setMode('matchup')
    expect(pool.target()).toBe('SUP')
  } finally {
    pool.dispose()
  }
})

test('keeps remaining champions selectable and saves the full pool after eight selections', async () => {
  const pool = mountPool()
  try {
    await flushPromises()
    await pool.setChampions(Array.from({ length: 8 }, (_, index) => index + 1))
    const options = pool.champions().options as { value: number; disabled?: boolean }[]
    expect(options.find((option) => option.value === 9)?.disabled).toBeFalsy()
    const ids = Array.from({ length: 12 }, (_, index) => index + 1)
    await pool.setChampions(ids)
    expect(pool.champions().value).toEqual(ids)
    const filter = pool.champions().filter as (pattern: string, option: unknown) => boolean
    expect(filter('csbm', { value: 1, label: 'Synthetic 1' })).toBe(true)
    expect(filter('no-match', { value: 1, label: 'Synthetic 1' })).toBe(false)
    expect(fixture.api.savePool).toHaveBeenLastCalledWith('ADC', ids)
  } finally {
    pool.dispose()
  }
})
