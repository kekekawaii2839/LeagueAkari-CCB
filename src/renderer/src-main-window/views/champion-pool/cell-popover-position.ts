export type CellPopoverRect = { left: number; right: number; top: number; bottom: number }
/** Keep the whole trigger unobscured. If no side fits the natural height, scroll on the roomier vertical side. */
export function positionCellPopover(
  bounds: CellPopoverRect,
  anchor: CellPopoverRect,
  naturalHeight = 480
) {
  const width = Math.min(360, bounds.right - bounds.left)
  const height = Math.min(naturalHeight, bounds.bottom - bounds.top)
  const gap = 8
  if (
    width <= 0 ||
    height <= 0 ||
    anchor.right <= bounds.left ||
    anchor.left >= bounds.right ||
    anchor.bottom <= bounds.top ||
    anchor.top >= bounds.bottom
  )
    return null
  const x = Math.max(bounds.left, Math.min(anchor.left, bounds.right - width))
  const below = Math.max(0, bounds.bottom - anchor.bottom - gap)
  const above = Math.max(0, anchor.top - gap - bounds.top)
  if (below >= height) return { x, y: anchor.bottom + gap, width, maxHeight: height }
  if (above >= height) return { x, y: anchor.top - gap - height, width, maxHeight: height }
  const y = Math.max(bounds.top, Math.min(anchor.top, bounds.bottom - height))
  if (bounds.right - anchor.right - gap >= width)
    return { x: anchor.right + gap, y, width, maxHeight: height }
  if (anchor.left - gap - bounds.left >= width)
    return { x: anchor.left - gap - width, y, width, maxHeight: height }
  const maxHeight = Math.max(below, above)
  if (maxHeight <= 0) return null
  return {
    x,
    y: below >= above ? anchor.bottom + gap : anchor.top - gap - maxHeight,
    width,
    maxHeight
  }
}
