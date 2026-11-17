import { describe, expect, it, vi } from 'vitest'
import { isVNode } from 'vue'

import { RENDER_GROUPS } from './groups'
import { useValueRenderer } from './renderers'

vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer-shared/composables/useNumberFormatter', () => ({
  useNumberFormatter: () => ({ formatNumber: (value: number) => String(value) })
}))
vi.mock('@renderer-shared/components/akari-score', () => ({ AkariScorePopover: {} }))

function collectText(value: unknown): string {
  if (isVNode(value)) return collectText(value.children)
  if (Array.isArray(value)) return value.map(collectText).join('')
  return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
}

function renderVisionNode(key: string, value: unknown) {
  const item = RENDER_GROUPS.find((group) => group.group === 'vision')?.items.find(
    (entry) => entry.key === key
  )
  if (!item?.render || typeof item.render !== 'string') throw new Error('Missing vision renderer')
  const render = useValueRenderer()[item.render] as (value: unknown) => unknown
  return render(value)
}

function renderVisionValue(key: string, value: unknown) {
  return collectText(renderVisionNode(key, value))
}

describe('detailed match vision statistics', () => {
  it.each([
    [0.5820763899, '0.58'],
    [1.239, '1.24'],
    [2, '2.00'],
    [0, '0.00']
  ])(
    'displays per-minute vision %s with two decimals and unrounded hover text',
    (value, expected) => {
      const node = renderVisionNode('visionScorePerMinute', value)
      expect(collectText(node)).toBe(expected)
      expect(isVNode(node)).toBe(true)
      if (isVNode(node)) expect(node.props?.title).toBe(String(value))
    }
  )

  it.each([null, undefined, NaN, Infinity])(
    'keeps unavailable per-minute vision %s distinct from zero',
    (value) => {
      expect(renderVisionValue('visionScorePerMinute', value)).toBe('N/A')
    }
  )

  it('preserves total vision score and other float formatting', () => {
    expect(renderVisionValue('visionScore', 42)).toBe('42')
    expect(renderVisionValue('visionScore', 0)).toBe('0')
    expect(renderVisionValue('visionScoreAdvantageLaneOpponent', 0)).toBe('0')
    expect(renderVisionValue('visionScoreAdvantageLaneOpponent', 0.123)).toBe('0.12')
  })
})
