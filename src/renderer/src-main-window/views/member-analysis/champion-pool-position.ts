export type PoolBounds = { left: number; top: number; right: number; bottom: number }

/** Bounds already exclude native navigation, sticky headings and the edge gutter. */
export function resolveChampionPoolPosition(
  bounds: PoolBounds,
  anchor: PoolBounds,
  measuredHeight?: number
) {
  const width = Math.min(560, bounds.right - bounds.left)
  const maxHeight = Math.min(544, bounds.bottom - bounds.top)
  if (
    width <= 0 ||
    maxHeight <= 24 ||
    anchor.bottom <= bounds.top ||
    anchor.top >= bounds.bottom ||
    anchor.right <= bounds.left ||
    anchor.left >= bounds.right
  )
    return null

  const height = Math.min(measuredHeight ?? maxHeight, maxHeight)
  const below = anchor.bottom + 6
  const above = anchor.top - 6 - height
  const preferred = below + height <= bounds.bottom ? below : above >= bounds.top ? above : below
  return {
    x: Math.max(bounds.left, Math.min(anchor.left, bounds.right - width)),
    y: Math.max(bounds.top, Math.min(preferred, bounds.bottom - height)),
    width,
    maxHeight,
    panelMaxHeight: maxHeight - 24
  }
}
