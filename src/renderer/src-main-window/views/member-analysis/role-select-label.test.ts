import { renderToString } from '@vue/server-renderer'
import { describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import {
  type RoleSelectOption,
  renderRolePairSegmentLabel,
  renderRoleSelectLabel,
  renderRoleSelectTag
} from './role-select-label'

vi.mock('@renderer-shared/components/icons/position-icons/PositionIcon.vue', () => ({
  default: defineComponent({
    props: ['position'],
    setup: (props) => () => h('i', { 'data-position': props.position })
  })
}))

const render = (option: RoleSelectOption) =>
  renderToString(h('div', {}, [renderRoleSelectLabel(option)]))

describe('native role select labels', () => {
  test.each([
    ['upper_pair', '上野', 'TOP', 'JUNGLE'],
    ['mid_jg_pair', '中野', 'MIDDLE', 'JUNGLE'],
    ['bot_pair', '下辅', 'BOTTOM', 'UTILITY']
  ])(
    'renders the always-visible %s selector with two icons and its original short title',
    async (value, label, first, second) => {
      const html = await renderToString(
        h('div', {}, [renderRolePairSegmentLabel({ value, label })])
      )
      expect(html.match(/data-position=/g)).toHaveLength(2)
      expect(html).toContain(`data-position="${first}"`)
      expect(html).toContain(`data-position="${second}"`)
      expect(html).toContain(`>${label}</span>`)
    }
  )
  test.each([
    ['TOP', '上路'],
    ['JUNGLE', '打野'],
    ['MIDDLE', '中路'],
    ['BOTTOM', '下路'],
    ['UTILITY', '辅助']
  ])(
    'renders a native icon and full name for %s without changing its searchable label',
    async (value, name) => {
      const option = { value, label: name.slice(0, 1) }
      const before = { ...option }
      const html = await render(option)
      expect(html).toContain(`data-position="${value}"`)
      expect(html).toContain(`>${name}</span>`)
      expect(html).toContain('aria-hidden="true"')
      expect(option).toEqual(before)
    }
  )

  test.each(['ALL', 'all', 'MIXED', 'NONE', 'toString'])(
    'does not invent an icon for %s',
    async (value) => {
      expect(await render({ value, label: '全部分路（探索）' })).toBe('<div>全部分路（探索）</div>')
    }
  )

  test('keeps the member identity in a canonical role/member selection', async () => {
    const option = {
      value: 'TOP|SYNTHETIC_TESTONLY',
      label: '匿名成员 / 上路',
      role: 'TOP',
      memberLabel: '匿名成员'
    }
    const html = await render(option)
    expect(html).toContain('data-position="TOP"')
    expect(html).toContain('上路')
    expect(html).toContain('· 匿名成员')
    expect(option.label).toBe('匿名成员 / 上路')
  })

  test('renders two proven role icons with full names and preserves the composite value', async () => {
    const option = {
      value: '["upper_pair","SYNTHETIC_TESTONLY"]',
      label: '上野 · 匿名甲 / 匿名乙',
      roles: ['TOP', 'JUNGLE'],
      memberLabel: '匿名甲 / 匿名乙'
    }
    const before = JSON.stringify(option)
    const html = await render(option)
    expect(html.match(/data-position=/g)).toHaveLength(2)
    expect(html).toContain('上路')
    expect(html).toContain('打野')
    expect(html).toContain('· 匿名甲 / 匿名乙')
    expect(JSON.stringify(option)).toBe(before)
  })

  test('fails closed for incomplete role metadata', async () => {
    expect(await render({ value: 'composite', label: '保留原选项', roles: ['TOP', 'MIXED'] })).toBe(
      '<div>保留原选项</div>'
    )
  })

  test('keeps compound selection on one line while the open option can wrap the complete member text', async () => {
    const option = {
      value: 'synthetic-pair',
      label: '上野 · 匿名长成员甲 × 匿名长成员乙',
      roles: ['TOP', 'JUNGLE'],
      memberLabel: '匿名长成员甲 × 匿名长成员乙'
    }
    const menu = await render(option)
    const selected = await renderToString(h('div', {}, [renderRoleSelectTag({ option })]))
    expect(menu).toContain('white-space:normal')
    expect(menu).toContain('overflow-wrap:anywhere')
    expect(selected).toContain('flex-wrap:nowrap')
    expect(selected).toContain('text-overflow:ellipsis')
    expect(selected).toContain('title="匿名长成员甲 × 匿名长成员乙"')
    for (const html of [menu, selected]) {
      expect(html.match(/data-position=/g)).toHaveLength(2)
      expect(html).toContain('上路')
      expect(html).toContain('打野')
      expect(html).toContain('· 匿名长成员甲 × 匿名长成员乙')
    }
  })
})
