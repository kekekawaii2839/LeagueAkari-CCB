// sort-imports-ignore
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, nextTick, ref, ssrContextKey } from 'vue'
import MatchCardDetails from '@renderer-shared/components/match-card/MatchCardDetails.vue'
import MatchCard from '@renderer-shared/components/match-card/MatchCard.vue'
const fixture = vi.hoisted(() => ({ provided: [] as any[] }))
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@vicons/fluent', () => ({
  Games24Filled: () => null,
  Replay20Filled: () => null,
  Replay20Regular: () => null
}))
vi.mock('naive-ui', () => ({ NButton: () => null, NIcon: () => null, NTooltip: () => null }))
vi.mock('@renderer-shared/components/match-card/context', () => ({
  provideMatchCard: (context: any) => fixture.provided.push(context),
  useMatchCard: () => ({
    basicInfo: ref({ dataSource: 'sgp' }),
    teams: ref({ teamStatMap: {} }),
    participants: ref([{ puuid: 'synthetic', perks: { styles: [{ selections: [{ perk: 1 }] }] } }]),
    puuid: ref(null),
    replayState: ref(null),
    canDryRunOngoingGame: ref(false)
  })
}))
vi.mock('@renderer-shared/components/match-card/MatchCardOverview.vue', () => ({
  default: defineComponent({
    emits: ['toggleExpand'],
    setup:
      (_props, { emit }) =>
      () =>
        h('button', { onClick: () => emit('toggleExpand') }, 'Native overview')
  })
}))
vi.mock('@renderer-shared/components/match-card/utils/theme', () => ({
  useCardBorderClass: () => ref('')
}))
vi.mock('@renderer-shared/components/match-card/widgets/TabSwitch.vue', () => ({
  default: defineComponent({
    props: ['tabs', 'selectedTab'],
    emits: ['update:selectedTab'],
    setup:
      (props, { emit }) =>
      () =>
        h(
          'nav',
          props.tabs.map((t: any) =>
            h('button', { onClick: () => emit('update:selectedTab', t.value) }, t.label)
          )
        )
  })
}))
vi.mock('@renderer-shared/components/match-card/tabs/MatchCardSummaryTab.vue', () => ({
  default: () => h('p', 'Native summary')
}))
vi.mock('@renderer-shared/components/match-card/tabs/MatchCardDetailsTab.vue', () => ({
  default: () => h('p', 'Native details')
}))
vi.mock('@renderer-shared/components/match-card/tabs/MatchCardRunesTab.vue', () => ({
  default: () => h('p', 'Native runes')
}))
vi.mock('@renderer-shared/components/match-card/tabs/MatchCardEventsTab.vue', () => ({
  default: () => h('p', 'Native events')
}))
vi.mock('@renderer-shared/components/match-card/tabs/MatchCardBuildsTab.vue', () => ({
  default: () => h('p', 'Native builds')
}))
vi.mock('@renderer-shared/components/match-card/tabs/timeline/MatchCardTimelineTab.vue', () => ({
  default: () => h('p', 'Native timeline')
}))
const descriptor = parse(
  readFileSync(
    new URL(
      '../../../../renderer-shared/components/match-card/MatchCardDetails.vue',
      import.meta.url
    ),
    'utf8'
  )
).descriptor
MatchCardDetails.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'extra-tab-test' }).bindings
  }).code
)(Vue)
const cardPath = fileURLToPath(
  new URL('../../../../renderer-shared/components/match-card/MatchCard.vue', import.meta.url)
)
const cardDescriptor = parse(readFileSync(cardPath, 'utf8'), { filename: cardPath }).descriptor
MatchCard.render = new Function(
  'Vue',
  compile(cardDescriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(cardDescriptor, {
      id: 'native-card-isolation',
      fs: { fileExists: existsSync, readFile: (path) => readFileSync(path, 'utf8') }
    }).bindings
  }).code
)(Vue)
type Node = {
  type: string
  parent: Node | null
  children: Node[]
  text: string
  props: Record<string, any>
}
const node = (type = ''): Node => ({ type, parent: null, children: [], text: '', props: {} })
const renderer = createRenderer<Node, Node>({
  createElement: node,
  createText: (text) => ({ ...node(), text }),
  createComment: () => node(),
  setText: (n, t) => {
    n.text = t
  },
  setElementText: (n, t) => {
    n.text = t
    n.children = []
  },
  patchProp: (n, k, _o, v) => {
    n.props[k] = v
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert(n, p, a) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = p
    const i = a ? p.children.indexOf(a) : -1
    p.children.splice(i < 0 ? p.children.length : i, 0, n)
  },
  remove(n) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = null
  }
})
function harness(label?: string, nativeCard = false) {
  const currentLabel = ref(label),
    expanded = ref(true),
    navigate = vi.fn(),
    slot = vi.fn(() => h('section', 'Existing rank evidence'))
  const root = node(),
    app = renderer.createApp({
      render: () =>
        h(
          nativeCard ? MatchCard : MatchCardDetails,
          nativeCard
            ? {
                summary: {} as any,
                puuid: 'Synthetic native owner',
                isExpanded: expanded.value,
                extraDetailsTabLabel: currentLabel.value,
                onNavigateToSummonerByPuuid: navigate,
                'onUpdate:isExpanded': (value: boolean) => {
                  expanded.value = value
                }
              }
            : { extraTabLabel: currentLabel.value },
          { [nativeCard ? 'extra-details-tab' : 'extra-tab']: slot }
        )
    })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = (): Node[] => {
    const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  return {
    all,
    navigate,
    slot,
    context: fixture.provided.at(-1),
    setLabel: (value?: string) => {
      currentLabel.value = value
    },
    dispose: () => app.unmount()
  }
}
test('default native callers keep exactly their existing tabs, without an extension tab or content', () => {
  const host = harness()
  try {
    expect(
      host
        .all()
        .filter((n) => n.type === 'button')
        .map((n) => n.text)
    ).toEqual(
      ['summary', 'details', 'runes', 'events', 'builds', 'timeline'].map(
        (x) => 'matchCard.tabs.' + x
      )
    )
    expect(host.all().some((n) => n.text === 'Existing rank evidence')).toBe(false)
  } finally {
    host.dispose()
  }
})
test('opt-in rank evidence appears after timeline and native tabs remain selectable', async () => {
  const host = harness('Opponent ranks')
  try {
    const buttons = () => host.all().filter((n) => n.type === 'button')
    expect(buttons().at(-1)!.text).toBe('Opponent ranks')
    expect(buttons().at(-2)!.text).toBe('matchCard.tabs.timeline')
    buttons().at(-1)!.props.onClick()
    await nextTick()
    expect(host.all().some((n) => n.text === 'Existing rank evidence')).toBe(true)
    buttons()[0].props.onClick()
    await nextTick()
    expect(host.all().some((n) => n.text === 'Native summary')).toBe(true)
    expect(host.all().some((n) => n.text === 'Existing rank evidence')).toBe(false)
  } finally {
    host.dispose()
  }
})

test('real MatchCard forwarding stays opt-in and simultaneous native and member cards do not share selected tabs or content', async () => {
  const native = harness(undefined, true),
    member = harness('Opponent ranks', true)
  try {
    const tabs = (host: typeof native) =>
      host.all().filter((n) => n.type === 'button' && n.text !== 'Native overview')
    expect(tabs(native).map((n) => n.text)).toEqual(
      ['summary', 'details', 'runes', 'events', 'builds', 'timeline'].map(
        (x) => 'matchCard.tabs.' + x
      )
    )
    expect(tabs(member).at(-1)!.text).toBe('Opponent ranks')
    expect(native.slot).not.toHaveBeenCalled()
    expect(member.slot).not.toHaveBeenCalled()
    tabs(member).at(-1)!.props.onClick()
    await nextTick()
    expect(member.all().some((n) => n.text === 'Existing rank evidence')).toBe(true)
    expect(native.all().some((n) => n.text === 'Existing rank evidence')).toBe(false)
    expect(native.all().some((n) => n.text === 'Native summary')).toBe(true)
    expect(native.slot).not.toHaveBeenCalled()
    native.context.navigateToSummonerByPuuid('Synthetic navigation target', true)
    expect(native.navigate).toHaveBeenCalledWith('Synthetic navigation target', true)
    expect(member.navigate).not.toHaveBeenCalled()
    expect(native.context.hidePrivacy()).toBe(false)
    member.setLabel(undefined)
    await nextTick()
    expect(tabs(member).map((n) => n.text)).toEqual(tabs(native).map((n) => n.text))
    expect(member.all().some((n) => n.text === 'Existing rank evidence')).toBe(false)
    expect(member.all().some((n) => n.text === 'Native summary')).toBe(true)
  } finally {
    native.dispose()
    member.dispose()
  }
})

test('native overview collapse and reopen behavior remains local and unchanged without feature opt-in', async () => {
  const native = harness(undefined, true)
  try {
    const overview = () =>
      native.all().find((n) => n.type === 'button' && n.text === 'Native overview')!
    overview().props.onClick()
    await nextTick()
    expect(native.all().some((n) => n.text === 'Native summary')).toBe(false)
    expect(native.slot).not.toHaveBeenCalled()
    overview().props.onClick()
    await nextTick()
    expect(native.all().some((n) => n.text === 'Native summary')).toBe(true)
    expect(native.all().some((n) => n.text === 'Opponent ranks')).toBe(false)
  } finally {
    native.dispose()
  }
})
