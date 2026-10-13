interface Options {
  active: () => string
  indicator: () => HTMLElement | null
  reduced: () => boolean
  visible: () => boolean
  rendered: () => Promise<void>
}

// Radio updates mark a manual request, not a captured click whose microtasks
// may run before Naive's native input change. External prop changes never mark it.
export function createCombinationMotion(options: Options) {
  let indicatorAnimation: Animation | undefined
  let indicatorStart: string | undefined
  let requested: string | null = null
  let sequence = 0
  function cancel() {
    sequence++
    requested = null
    indicatorAnimation?.cancel()
    indicatorAnimation = undefined
    indicatorStart = undefined
  }
  function request(view: string, update: () => void) {
    if (view === options.active()) return
    const indicator = options.indicator()
    const painted = indicator ? getComputedStyle(indicator).transform : undefined
    cancel()
    indicatorStart = painted
    requested = view
    const token = sequence
    update()
    void options.rendered().then(() => {
      if (token === sequence) requested = null
    })
  }
  async function changed(view: string) {
    const manual = requested === view
    const painted = indicatorStart
    cancel()
    const token = sequence
    if (!manual || options.reduced()) return
    await options.rendered()
    if (token !== sequence || view !== options.active() || !options.visible() || options.reduced())
      return
    const timing = {
      duration: 220,
      easing: 'cubic-bezier(.37, 0, .63, 1)',
      fill: 'forwards' as const
    }
    const indicator = options.indicator()
    if (!indicator || !painted || typeof indicator.animate !== 'function') return
    indicatorAnimation = indicator.animate(
      [{ transform: painted }, { transform: getComputedStyle(indicator).transform }],
      timing
    )
    void indicatorAnimation.finished.then(
      () => {
        if (token === sequence) cancel()
      },
      () => {
        // The next interaction owns cancellation, not this stale completion.
      }
    )
  }
  return { request, changed, cancel }
}
