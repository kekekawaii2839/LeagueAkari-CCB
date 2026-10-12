import { describe, expect, test } from 'vitest'

import { resolveChampionPoolPosition } from './champion-pool-position'

const bounds = { left: 200, top: 180, right: 1280, bottom: 794 }
const anchor = { left: 500, top: 350, right: 550, bottom: 480 }

describe('hero pool visible-area positioning', () => {
  test('keeps a tall center popup inside the page instead of flipping above the window', () => {
    const result = resolveChampionPoolPosition(bounds, anchor)!
    expect(result.y).toBe(250)
    expect(result.y + result.maxHeight).toBe(bounds.bottom)
    expect(result.x).toBe(500)
  })
  test('prefers below or above when the actual content fits, and repositions on growth', () => {
    expect(resolveChampionPoolPosition(bounds, anchor, 200)?.y).toBe(486)
    const lower = { ...anchor, top: 710, bottom: 750 }
    expect(resolveChampionPoolPosition(bounds, lower, 200)?.y).toBe(504)
    expect(resolveChampionPoolPosition(bounds, anchor, 544)?.y).toBe(250)
  })
  test('clamps width and scrollable content height in the minimum zoomed viewport', () => {
    const narrow = { left: 180, top: 150, right: 665, bottom: 474 }
    const result = resolveChampionPoolPosition(narrow, anchor)!
    expect(result.width).toBe(485)
    expect(result.x).toBe(180)
    expect(result.maxHeight).toBe(324)
    expect(result.panelMaxHeight).toBe(300)
    expect(result.y).toBe(150)
  })
  test('dismisses anchors scrolled outside any visible edge, but keeps partial anchors', () => {
    for (const hidden of [
      { ...anchor, top: 100, bottom: 180 },
      { ...anchor, top: 794, bottom: 900 },
      { ...anchor, left: 100, right: 200 },
      { ...anchor, left: 1280, right: 1300 }
    ])
      expect(resolveChampionPoolPosition(bounds, hidden)).toBeNull()
    expect(resolveChampionPoolPosition(bounds, { ...anchor, top: 150, bottom: 220 })).not.toBeNull()
  })
  test('keeps every corner bounded after resize and when the native headings get taller', () => {
    for (const top of [180, 260]) {
      for (const height of [100, 300, 544, 900]) {
        const area = { ...bounds, top, right: 900 }
        const result = resolveChampionPoolPosition(area, anchor, height)!
        expect(result.x).toBeGreaterThanOrEqual(area.left)
        expect(result.x + result.width).toBeLessThanOrEqual(area.right)
        expect(result.y).toBeGreaterThanOrEqual(area.top)
        expect(result.y + Math.min(height, result.maxHeight)).toBeLessThanOrEqual(area.bottom)
      }
    }
    expect(resolveChampionPoolPosition({ ...bounds, bottom: bounds.top + 24 }, anchor)).toBeNull()
  })
})
