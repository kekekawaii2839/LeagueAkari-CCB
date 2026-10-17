// sort-imports-ignore
import './test-i18n'
import { describe, expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, createSSRApp, h, nextTick, ssrContextKey, type VNodeChild } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'
import LaneGankWindowBars, { pillarTextColor } from './LaneGankWindowBars.vue'
vi.mock('naive-ui', () => ({
  NPopover: (props: any, { slots }: { slots: Record<string, () => VNodeChild> }) =>
    h('div', { 'data-shown': props.show, 'onUpdate:show': props['onUpdate:show'] }, [
      slots.trigger?.(),
      slots.default?.()
    ])
}))
const render = (values: unknown[], max: number, extra = {}) =>
  renderToString(createSSRApp({ render: () => h(LaneGankWindowBars, { values, max, ...extra }) }))
describe('categorical lane-gank counts', () => {
  test('keyboard Escape dismisses the controlled window without moving trigger focus', async () => {
    const descriptor = parse(
      readFileSync(new URL('./LaneGankWindowBars.vue', import.meta.url), 'utf8')
    ).descriptor
    LaneGankWindowBars.render = new Function(
      'Vue',
      compile(descriptor.template!.content, {
        mode: 'function',
        prefixIdentifiers: true,
        bindingMetadata: compileScript(descriptor, { id: 'gank-window-keyboard' }).bindings
      }).code
    )(Vue)
    type Node = {
      type: string
      props: Record<string, any>
      text: string
      children: Node[]
      parent: Node | null
    }
    const node = (type: string): Node => ({ type, props: {}, text: '', children: [], parent: null })
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
    const all = (): Node[] => {
      const visit = (n: Node): Node[] => [n, ...n.children.flatMap(visit)]
      return visit(root)
    }
    const app = renderer.createApp({
      render: () => h(LaneGankWindowBars, { values: [0, 1, null, 2, 3], max: 3 })
    })
    app.provide(ssrContextKey, { modules: new Set() })
    app.mount(root)
    try {
      const buttons = () => all().filter((n) => n.type === 'button')
      const popovers = () => all().filter((n) => n.type === 'div' && 'data-shown' in n.props)
      expect(buttons().every((n) => n.props['aria-expanded'] === false)).toBe(true)
      popovers()[0].props['onUpdate:show'](true)
      await nextTick()
      expect(buttons()[0].props['aria-expanded']).toBe(true)
      const trigger = buttons()[0]
      trigger.props.onKeydown({ key: 'Escape', preventDefault() {}, stopPropagation() {} })
      await nextTick()
      expect(buttons()[0]).toBe(trigger)
      expect(buttons()[0].props['aria-expanded']).toBe(false)
      expect(popovers()[0].props['data-shown']).toBe(false)
      popovers()[1].props['onUpdate:show'](true)
      await nextTick()
      expect(buttons().map((n) => n.props['aria-expanded'])).toEqual([
        false,
        true,
        false,
        false,
        false
      ])
      popovers()[1].props['onUpdate:show'](false)
      await nextTick()
      expect(buttons().every((n) => n.props['aria-expanded'] === false)).toBe(true)
    } finally {
      app.unmount()
    }
  })

  test('chooses contrasting theme-derived ink for actual pillar fills without a label backing', () => {
    expect(pillarTextColor('#73a4d6', 'rgba(255, 255, 255, 0.86)', '#18181c')).toBe(
      'rgb(24, 24, 28)'
    )
    expect(pillarTextColor('#d9868d', 'rgba(255, 255, 255, 0.86)', '#18181c')).toBe(
      'rgb(24, 24, 28)'
    )
    expect(pillarTextColor('#285c94', 'rgba(0, 0, 0, 0.86)', '#f3f3f4')).toBe('rgb(243, 243, 244)')
    expect(pillarTextColor('#9d344c', 'rgba(0, 0, 0, 0.86)', '#f3f3f4')).toBe('rgb(243, 243, 244)')
    expect(pillarTextColor('rgba(0, 0, 0, 0.1)', 'rgba(0, 0, 0, 0.86)', '#f3f3f4')).toBe(
      'rgb(0, 0, 0)'
    )
    expect(pillarTextColor('var(--unresolved)', '#123', '#fff')).toBe(
      'var(--la-color-text-primary)'
    )
  })
  test('enhances insufficient butter-theme ink to readable contrast, including translucent fills', () => {
    const luminance = (channels: number[]) =>
      channels
        .map((channel) => {
          const value = channel / 255
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const contrast = (ink: string, background: number[]) => {
      const color = ink.match(/[\d.]+/g)!.map(Number)
      const levels = [luminance(color), luminance(background)].sort((a, b) => a - b)
      return (levels[1] + 0.05) / (levels[0] + 0.05)
    }
    const butter = pillarTextColor('#c27f22', 'rgba(66, 57, 48, 0.93)', '#fff5d6')
    expect(contrast(butter, [194, 127, 34])).toBeGreaterThanOrEqual(4.5)
    const translucent = pillarTextColor(
      'rgba(194, 127, 34, 0.5)',
      'rgba(66, 57, 48, 0.93)',
      '#fff5d6'
    )
    expect(contrast(translucent, [224.5, 186, 124])).toBeGreaterThanOrEqual(4.5)
    expect(pillarTextColor('#c27f2200', 'rgba(66, 57, 48, 0.93)', '#fff5d6')).toBe(
      'rgb(66, 57, 48)'
    )
  })
  test('uses centrally defined compact axis labels when requested', async () => {
    const html = await render([1, 2, 3, 4, 5], 5, { showLabels: true })
    for (const label of ['0–3', '3–4', '4–5', '5–10', '10–14']) {
      expect(html).toContain(`>${label}</span>`)
    }
    expect(html).toContain('被抓死亡次数 · 0–3分钟：1 次')
  })
  test('keeps five exact windows and zero distinct from missing', async () => {
    const html = await render([2, 0, null, 4, 1], 8)
    expect(html).toContain('被抓死亡次数 · 0–3分钟：2 次')
    expect(html).toContain('被抓死亡次数 · 3–4分钟：0 次')
    expect(html).toContain('被抓死亡次数 · 4–5分钟：未获取')
    expect(html).toContain('被抓死亡次数 · 5–10分钟：4 次')
    expect(html).toContain('被抓死亡次数 · 10–14分钟：1 次')
    for (const boundary of [
      '0:00（含）至 3:00（不含）',
      '3:00（含）至 4:00（不含）',
      '4:00（含）至 5:00（不含）',
      '5:00（含）至 10:00（不含）',
      '10:00（含）至 14:00（不含）'
    ])
      expect(html).toContain(boundary)
    expect(html).toContain('height:0%')
    expect(html).toContain('height:25%')
    expect(html).toContain('height:50%')
    expect(html.match(/type="button"/g)).toHaveLength(5)
  })
  test('uses a common zero-based scale across different members', async () => {
    const first = await render([2, 0, 0, 0, 0], 8)
    const second = await render([8, 0, 0, 0, 0], 8)
    expect(first).toContain('height:25%')
    expect(second).toContain('height:100%')
    expect(first).toContain('共同上限 8 次')
    expect(second).toContain('共同上限 8 次')
  })
  test('does not draw non-finite or absent observations as zeros', async () => {
    const html = await render([undefined, NaN, Infinity, null, -1], 0)
    expect(html.match(/未获取/g)).toHaveLength(10)
    expect(html).not.toContain('<i ')
    expect(html).not.toContain('NaN')
  })
  test('has no repeated body labels by default but preserves explicit legacy labels', async () => {
    const html = await render([30, 4, 5, 0, null], 30)
    expect(html).not.toContain('class="gank-window-label"')
    expect(html).toContain('height:100%')
    expect(html).toContain('height:13.333333333333334%')
    expect(html).toContain('height:16.666666666666664%')
    const labeled = await render([1, 1, 1, 1, 1], 1, { showLabels: true })
    expect(labeled.match(/class="gank-window-label"/g)).toHaveLength(5)
  })
  test('places blue and red on the same categories and scale, retaining total in exact details', async () => {
    const html = await render([30, 4, 5, 0, null], 30, {
      breakdown: [
        { label: '蓝方', tone: 'blue', values: [20, 4, 0, 0, null] },
        { label: '红方', tone: 'red', values: [10, 0, 5, 0, null] }
      ]
    })
    expect(html.match(/type="button"/g)).toHaveLength(5)
    expect(html.match(/data-gank-tone="blue"/g)).toHaveLength(5)
    expect(html.match(/data-gank-tone="red"/g)).toHaveLength(5)
    expect(html).not.toContain('data-gank-tone="total"')
    expect(html).toContain('被抓死亡次数 · 0–3分钟：30 次')
    expect(html).toContain('蓝方 · 被抓死亡次数 · 0–3分钟：20 次')
    expect(html).toContain('红方 · 被抓死亡次数 · 0–3分钟：10 次')
    expect(html).toContain('height:66.66666666666666%')
    expect(html).toContain('data-gank-value="0"')
    expect(html).toContain('data-gank-value="missing"')
  })
  test('prints each exact count above short pillars and inside tall pillars without raising zeros', async () => {
    const html = await render([30, 4, 5, 0, null], 30)
    expect(html).toMatch(/data-gank-value-placement="inside"[^>]*>30<\/span>/)
    for (const value of [4, 5, 0])
      expect(html).toMatch(new RegExp(`data-gank-value-placement="above"[^>]*>${value}<\\/span>`))
    expect(html.match(/class="gank-window-value"/g)).toHaveLength(4)
    expect(html).toMatch(/class="gank-window-missing"[^>]*>—<\/span>/)
    expect(html).toContain('height:0%')
    expect(html).toContain('bottom:calc(100% - 16px)')
  })
  test('prints independent blue and red counts with no hidden aggregate pillar', async () => {
    const html = await render([30, 0, 0, 0, 0], 30, {
      breakdown: [
        { label: '蓝方', tone: 'blue', values: [20, 0, 0, 0, null] },
        { label: '红方', tone: 'red', values: [10, 0, 0, 0, 0] }
      ]
    })
    expect(html).toMatch(/data-gank-value-placement="inside"[^>]*>20<\/span>/)
    expect(html).toMatch(/data-gank-value-placement="above"[^>]*>10<\/span>/)
    expect(html.match(/class="gank-window-value"/g)).toHaveLength(9)
    expect(html).not.toMatch(/class="gank-window-value"[^>]*>30<\/span>/)
  })
})
