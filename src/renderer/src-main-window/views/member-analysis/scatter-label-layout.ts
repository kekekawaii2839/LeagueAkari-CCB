export type ScatterLabelRequest = {
  x: number
  y: number
  text: string
  suffix?: string
  visible: boolean
}
export type ScatterLabelPlacement = {
  x: number
  y: number
  anchor: 'start'
  text: string
  left: number
  right: number
  top: number
  bottom: number
  leader: { x1: number; y1: number; x2: number; y2: number } | null
}

// Deliberately approximate system-font advances, not a measurement of rendered ink.
export function scatterLabelWidth(text: string) {
  return Array.from(text).reduce(
    (width, character) =>
      width +
      (/[^\u0000-\u00ff]/u.test(character)
        ? 13
        : /[ilI1.,' ]/.test(character)
          ? 4
          : /[MW@]/.test(character)
            ? 10
            : 7),
    0
  )
}
function fitLabel(text: string, width: number, suffix = '') {
  if (scatterLabelWidth(text) <= width) return text
  let tail = suffix
  if (scatterLabelWidth(`…${tail}`) > width / 2) {
    let ending = ''
    for (const character of Array.from(tail).reverse()) {
      if (scatterLabelWidth(`#…${character}${ending}`) > width / 2) break
      ending = character + ending
    }
    tail = ending ? `#…${ending}` : ''
  }
  let head = ''
  for (const character of Array.from(text)) {
    if (scatterLabelWidth(`${head}${character}…${tail}`) > width) break
    head += character
  }
  return `${head}…${tail}`
}
export function layoutNearbyScatterLabels(
  requests: ScatterLabelRequest[],
  plot: { left: number; top: number; width: number; height: number }
): ScatterLabelPlacement[] {
  const right = plot.left + plot.width,
    bottom = plot.top + plot.height
  const placed: ScatterLabelPlacement[] = []
  for (const point of requests) {
    if (!point.visible) {
      placed.push({
        x: point.x,
        y: point.y,
        anchor: 'start',
        text: '',
        left: Infinity,
        right: Infinity,
        top: Infinity,
        bottom: Infinity,
        leader: null
      })
      continue
    }
    const text = fitLabel(point.text, Math.max(1, Math.min(220, plot.width - 8)), point.suffix)
    const width = scatterLabelWidth(text),
      height = 17
    // Candidate rectangles stay near the anchor even when the text itself is long.
    const candidates = [
      [point.x + 13, point.y - height / 2],
      [point.x - width - 13, point.y - height / 2],
      [point.x - width / 2, point.y - height - 14],
      [point.x - width / 2, point.y + 14],
      [point.x + 13, point.y - height - 17],
      [point.x - width - 13, point.y - height - 17],
      [point.x + 13, point.y + 17],
      [point.x - width - 13, point.y + 17]
    ].map(([left, top]) => {
      left = Math.max(plot.left + 2, Math.min(right - width - 2, left))
      top = Math.max(plot.top + 2, Math.min(bottom - height - 2, top))
      const nearX = Math.max(left, Math.min(left + width, point.x))
      const nearY = Math.max(top, Math.min(top + height, point.y))
      const distance = Math.hypot(nearX - point.x, nearY - point.y)
      const overlap = placed.reduce(
        (sum, label) =>
          sum +
          Math.max(0, Math.min(left + width, label.right) - Math.max(left, label.left)) *
            Math.max(0, Math.min(top + height, label.bottom) - Math.max(top, label.top)),
        0
      )
      const obscures = requests.filter(
        (other) =>
          other.visible &&
          other.x > left - 10 &&
          other.x < left + width + 10 &&
          other.y > top - 10 &&
          other.y < top + height + 10
      ).length
      return { left, top, nearX, nearY, distance, score: overlap + obscures * 1000 + distance * 2 }
    })
    const candidate = candidates
      .filter((item) => item.distance >= 11 && item.distance <= 32)
      .sort((a, b) => a.score - b.score)[0]
    // Below the physical space needed for a label plus its point, keep the
    // closest clamped rectangle (possibly overlapping), never a remote corner.
    const chosen = candidate ?? candidates.sort((a, b) => a.distance - b.distance)[0]
    const dx = chosen.nearX - point.x,
      dy = chosen.nearY - point.y
    placed.push({
      x: chosen.left,
      y: chosen.top + 13,
      anchor: 'start',
      text,
      left: chosen.left,
      right: chosen.left + width,
      top: chosen.top,
      bottom: chosen.top + height,
      leader:
        chosen.distance > 0
          ? {
              x1: point.x + (dx * 11) / chosen.distance,
              y1: point.y + (dy * 11) / chosen.distance,
              x2: chosen.nearX,
              y2: chosen.nearY
            }
          : null
    })
  }
  return placed
}
