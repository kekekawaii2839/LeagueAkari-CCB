interface RevealExactRowOptions {
  indexOnPage: number
  heights: () => number[]
  scrollTo: (top: number) => void
  findTarget: () => Pick<HTMLElement, 'scrollIntoView'> | null
  revealAll: () => void
  settled: () => Promise<void>
  current: () => boolean
}

// The fast estimate is based on actual mounted rows, never a guessed row size.
// Naive's public scrollTo takes pixel offsets. If variable/unmeasured rows make
// that estimate unreliable, fall back to the original bounded 25-row page.
export async function revealScatterExactRow(options: RevealExactRowOptions) {
  if (!options.current()) return 'cancelled'
  const heights = options.heights()
  const uniform =
    heights.length > 0 &&
    heights.every((height) => Number.isFinite(height) && height > 0) &&
    Math.max(...heights) - Math.min(...heights) < 0.5
  if (uniform) {
    options.scrollTo(options.indexOnPage * heights[0])
    await options.settled()
    if (!options.current()) return 'cancelled'
    if (!options.findTarget()) {
      options.revealAll()
      await options.settled()
    }
  } else {
    options.revealAll()
    options.scrollTo(0)
    await options.settled()
  }
  if (!options.current()) return 'cancelled'
  const target = options.findTarget()
  target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return target ? 'revealed' : 'missing'
}
