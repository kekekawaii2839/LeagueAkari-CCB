import { expect, test } from 'vitest'

import { positionCellPopover } from './cell-popover-position'

const bounds = { left: 12, top: 72, right: 1268, bottom: 788 }
test.each([
  { left: 100, top: 100, right: 160, bottom: 134 },
  { left: 100, top: 700, right: 160, bottom: 734 },
  { left: 100, top: 380, right: 160, bottom: 414 },
  { left: 1100, top: 380, right: 1160, bottom: 414 }
])('keeps the trigger and entire popup separate for anchor %j', (anchor) => {
  const popup = positionCellPopover(bounds, anchor)!
  expect(popup.x >= bounds.left && popup.x + popup.width <= bounds.right).toBe(true)
  expect(popup.y >= bounds.top && popup.y + popup.maxHeight <= bounds.bottom).toBe(true)
  expect(
    popup.x >= anchor.right + 8 ||
      popup.x + popup.width <= anchor.left - 8 ||
      popup.y >= anchor.bottom + 8 ||
      popup.y + popup.maxHeight <= anchor.top - 8
  ).toBe(true)
})
test('narrow zoomed windows use a scrollable side rather than covering the selected cell', () => {
  const b = { left: 12, top: 72, right: 525, bottom: 413 },
    a = { left: 220, top: 220, right: 280, bottom: 254 }
  const p = positionCellPopover(b, a, 600)!
  expect(p.maxHeight).toBeLessThan(600)
  expect(p.y >= a.bottom + 8 || p.y + p.maxHeight <= a.top - 8).toBe(true)
  expect(p.y >= b.top && p.y + p.maxHeight <= b.bottom).toBe(true)
})
test('offscreen trigger is not followed', () => {
  expect(positionCellPopover(bounds, { left: 100, top: 800, right: 160, bottom: 834 })).toBeNull()
})
