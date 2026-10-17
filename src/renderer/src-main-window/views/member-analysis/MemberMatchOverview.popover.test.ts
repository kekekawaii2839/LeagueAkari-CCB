// sort-imports-ignore
import './test-i18n'
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: vi.fn() }) }))
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, nextTick, ref, ssrContextKey } from 'vue'
import { MemberAnalysisGameSchema } from '@shared/shards/member-analysis'
import { normalizeRankedStats } from '@shared/shards/member-analysis/opponent-ranks'
import MemberMatchOverview from './MemberMatchOverview.vue'
const fixture = vi.hoisted(() => ({ streamerMode: false, tooltipRenders: 0 }))
vi.mock('@renderer-shared/shards/app-common/store', () => ({
  useAppCommonStore: () => ({ settings: Vue.reactive(fixture) })
}))
vi.mock('@vicons/material', () => ({
  ArrowBackIosFilled: (props: Record<string, unknown>) => h('svg', props)
}))
vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: defineComponent({
    props: { position: String },
    setup: (props) => () => h('role-icon', { 'data-position': props.position })
  })
}))
vi.mock('@vicons/carbon', () => ({ Information: () => null }))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({ default: () => null }))
vi.mock('./useMemberMatchDetails', () => ({
  useMemberMatchOverview: () => ({
    match: ref({
      participantRanks: {
        version: 1,
        source: 'local-game-player-rank-snapshot',
        participants: [
          {
            participantId: 1,
            timing: 'during-game',
            observedAt: '2026-10-13T12:00:00Z',
            snapshot: normalizeRankedStats(
              {
                queues: [
                  { queueType: 'RANKED_FLEX_SR', tier: 'GOLD', rank: 'II', leaguePoints: 0 },
                  { queueType: 'RANKED_SOLO_5x5', tier: 'SILVER', rank: 'II', leaguePoints: 9 }
                ]
              },
              '2026-10-13T12:05:00Z'
            )
          }
        ]
      },
      summary: {
        data: {
          json: {
            gameId: 1,
            participants: Array.from({ length: 10 }, (_, i) => ({
              participantId: i + 1,
              puuid: `synthetic-${i}`,
              championId: i + 1,
              teamId: i < 5 ? 100 : 200,
              riotIdGameName: `Synthetic ${i}`,
              riotIdTagline: 'TEST',
              teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5]
            }))
          }
        }
      }
    }),
    loading: ref(false),
    error: ref(false),
    load: vi.fn()
  })
}))
vi.mock('@renderer-shared/theme/naive-ui', () => ({
  getNaiveUiThemeOverrides: () => ({ Button: {} })
}))
vi.mock('naive-ui', () => ({
  useThemeVars: () =>
    Vue.computed(() => ({
      textColor2: 'currentColor',
      buttonColor2Hover: 'transparent',
      buttonColor2Pressed: 'transparent',
      primaryColor: 'currentColor',
      opacityDisabled: '0.5',
      cubicBezierEaseInOut: 'ease'
    })),
  NIcon: () => null,
  NTooltip: defineComponent({
    props: { show: Boolean },
    setup(props, { slots }) {
      return () => (
        fixture.tooltipRenders++,
        [
          slots.trigger?.(),
          props.show ? h('div', { 'data-tooltip': true }, slots.default?.()) : null
        ]
      )
    }
  }),
  NButton: (props: Record<string, unknown>, { slots }: { slots: Record<string, Function> }) =>
    h('button', props, [slots.default?.(), slots.icon?.()])
}))
type Host = {
  type: string
  props: Record<string, unknown>
  parent: Host | null
  children: Host[]
  text: string
  querySelector: () => { focus: () => void }
  ownerDocument: { activeElement: Host | null }
  getBoundingClientRect: () => { left: number; top: number; width: number; height: number }
}
const node = (type: string): Host => ({
  type,
  props: {},
  parent: null,
  children: [],
  text: '',
  ownerDocument: { activeElement: null },
  getBoundingClientRect: () => ({ left: 100, top: 100, width: 120, height: 20 }),
  querySelector: () => ({
    focus: () => {
      // Focus remains on the trigger; tooltip dismissal does not move it.
    }
  })
})
const descriptor = parse(
  readFileSync(new URL('./MemberMatchOverview.vue', import.meta.url), 'utf8')
).descriptor
MemberMatchOverview.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'rank-popover' }).bindings
  }).code
)(Vue)
const renderer = createRenderer<Host, Host>({
  createElement: node,
  createComment: () => node('comment'),
  createText: (text) => ({ ...node('text'), text }),
  setText: (n, text) => {
    n.text = text
  },
  setElementText: (n, text) => {
    n.text = text
    n.children = []
  },
  patchProp: (n, key, _old, value) => {
    n.props[key] = value
  },
  parentNode: (n) => n.parent,
  nextSibling: (n) => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  insert(n, parent, anchor) {
    if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, n)
  },
  remove(n) {
    n.parent?.children.splice(n.parent.children.indexOf(n), 1)
    n.parent = null
  }
})
test('identity and rank explanations open by focus or click and close by Escape, blur and inactive pane', async () => {
  const game = MemberAnalysisGameSchema.parse({
    gameId: 1,
    timestamp: 1,
    date: '2026-10-13',
    patch: '26.1',
    side: 'Blue',
    win: true,
    duration: 1800,
    roster: 'Synthetic',
    dragon15Diff: null,
    grub15Diff: null,
    objectiveFight15Diff: null,
    counterMean: null,
    upperGold15: null,
    botGold15: null,
    gold20Diff: null,
    tower20Diff: null,
    jungle: null,
    eventDecision: null,
    players: []
  })
  const active = ref(true),
    expanded = ref(false),
    root = node('root')
  let toggles = 0
  const eventWindow = new EventTarget()
  vi.stubGlobal('window', eventWindow)
  const removeListener = vi.spyOn(eventWindow, 'removeEventListener')
  const app = renderer.createApp({
    render: () =>
      h(MemberMatchOverview, {
        game,
        active: active.value,
        expanded: expanded.value,
        onToggle: () => {
          toggles++
          expanded.value = !expanded.value
        },
        timeLabel: 'Synthetic time',
        expandLabel: 'Expand synthetic match'
      })
  })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = (): Host[] => {
    const walk = (n: Host): Host[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  const invoke = (value: unknown, event?: unknown) => {
    if (typeof value !== 'function') throw new Error('Missing control callback')
    value(event)
  }
  const tooltipCount = () => all().filter((n) => n.props['data-tooltip']).length
  const triggers = () => all().filter((n) => n.type === 'span' && n.props.tabindex === '0')
  try {
    const disclosure = all().find(
      (n) => n.type === 'button' && n.props['aria-controls'] === 'match-detail-1'
    )!
    expect(disclosure.props.type).toBe('button')
    expect(disclosure.props['aria-label']).toBe('Expand synthetic match')
    expect(disclosure.props['aria-expanded']).toBe(false)
    // Browser Enter/Space synthesize click. No additional key toggle handler
    // may double-activate the native disclosure; actual keyboard requires an actual UI check.
    expect(disclosure.props.onKeydown).toBeUndefined()
    expect(disclosure.props.onKeyup).toBeUndefined()
    invoke(disclosure.props.onClick)
    await nextTick()
    expect(toggles).toBe(1)
    expect(disclosure.props['aria-expanded']).toBe(true)
    invoke(disclosure.props.onClick)
    await nextTick()
    expect(toggles).toBe(2)
    expect(disclosure.props['aria-expanded']).toBe(false)
    const arrow = disclosure.children.find((n) => n.type === 'svg')!
    expect(arrow.props['aria-hidden']).toBe('true')
    expect(arrow.props.focusable).toBe('false')
    expect(tooltipCount()).toBe(0)
    expect(fixture.tooltipRenders).toBe(0)
    expect(triggers()).toHaveLength(20)
    expect(all().filter((n) => n.type === 'role-icon')).toHaveLength(10)
    expect(String(triggers()[1].props['aria-label'])).not.toContain('<')
    for (const trigger of triggers().slice(0, 2)) {
      invoke(trigger.props.onFocus, { currentTarget: trigger })
      await nextTick()
      expect(tooltipCount()).toBe(1)
      invoke(trigger.props.onKeydown, { key: 'Escape', stopPropagation() {} })
      await nextTick()
      expect(tooltipCount()).toBe(0)
      invoke(trigger.props.onClick, { currentTarget: trigger })
      await nextTick()
      expect(tooltipCount()).toBe(1)
      invoke(trigger.props.onBlur)
      await nextTick()
      expect(tooltipCount()).toBe(0)
    }
    invoke(triggers()[1].props.onFocus, { currentTarget: triggers()[1] })
    await nextTick()
    expect(tooltipCount()).toBe(1)
    expect(triggers()[1].props['aria-describedby']).toBe('match-1-participant-tooltip')
    const detailText = all()
      .map((n) => n.text)
      .join(' ')
    expect(detailText).toContain('灵活组排：黄金 II · 0 LP')
    expect(detailText).toContain('单双排：白银 II · 9 LP')
    expect(detailText).toContain('local-game-player-rank-snapshot')
    active.value = false
    await nextTick()
    expect(tooltipCount()).toBe(0)
    invoke(triggers()[1].props.onFocus, { currentTarget: triggers()[1] })
    await nextTick()
    expect(tooltipCount()).toBe(0)
    const beforeReturn = fixture.tooltipRenders
    active.value = true
    await nextTick()
    expect(fixture.tooltipRenders - beforeReturn).toBe(0)
    expect(tooltipCount()).toBe(0)
    // Reusing a closed roster must not cache unmasked accessibility text.
    Vue.reactive(fixture).streamerMode = true
    await nextTick()
    expect(triggers()[0].props['aria-label']).toBe('●●●●●●')
    invoke(triggers()[0].props.onFocus, { currentTarget: triggers()[0] })
    await nextTick()
    expect(tooltipCount()).toBe(1)
    Vue.reactive(fixture).streamerMode = false
    await nextTick()
    expect(triggers()[0].props['aria-label']).toContain('Synthetic')
    expect(tooltipCount()).toBe(0)
    const hovered = triggers()[1]
    invoke(hovered.props.onMouseenter, { currentTarget: hovered })
    await nextTick()
    expect(tooltipCount()).toBe(1)
    eventWindow.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(tooltipCount()).toBe(0)
    expect(removeListener).toHaveBeenCalledWith('scroll', expect.any(Function), true)
    invoke(hovered.props.onMouseenter, { currentTarget: hovered })
    await nextTick()
    hovered.ownerDocument.activeElement = hovered
    invoke(hovered.props.onMouseleave, { currentTarget: hovered })
    await nextTick()
    expect(tooltipCount()).toBe(1)
    eventWindow.dispatchEvent(new Event('resize'))
    await nextTick()
    expect(tooltipCount()).toBe(0)
  } finally {
    fixture.streamerMode = false
    app.unmount()
    vi.unstubAllGlobals()
  }
})
