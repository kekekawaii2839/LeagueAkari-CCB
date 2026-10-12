// Opacity only: positioning, scrolling and data changes remain synchronous.
export function createChampionPoolMotion(reducedMotion: () => boolean) {
  let animation: Animation | undefined
  let completion: (() => void) | undefined
  let sequence = 0

  function cancel() {
    sequence++
    completion = undefined
    animation?.cancel()
    animation = undefined
  }

  function finish() {
    const done = completion
    cancel()
    done?.()
  }

  function run(element: HTMLElement | null | undefined, entering: boolean, done?: () => void) {
    // Sample the currently painted opacity before canceling an interrupted entry.
    // Otherwise an early close would jump to fully opaque before fading out.
    const shouldAnimate = element && !reducedMotion() && typeof element.animate === 'function'
    const style = shouldAnimate ? getComputedStyle(element) : undefined
    const startOpacity = entering ? 0 : style?.opacity
    const easing = style?.getPropertyValue(entering ? '--n-bezier-ease-out' : '--n-bezier-ease-in')
    cancel()
    if (!element || !shouldAnimate) {
      done?.()
      return
    }
    const token = sequence
    completion = done
    animation = element.animate([{ opacity: startOpacity }, { opacity: entering ? 1 : 0 }], {
      duration: 150,
      easing:
        easing?.trim() || (entering ? 'cubic-bezier(0, 0, .2, 1)' : 'cubic-bezier(.4, 0, 1, 1)'),
      fill: 'forwards'
    })
    void animation.finished.then(
      () => {
        if (token === sequence) finish()
      },
      () => {
        // Cancellation belongs to the new interaction, never the old completion.
      }
    )
  }

  return {
    enter: (element: HTMLElement | null | undefined) => run(element, true),
    leave: (element: HTMLElement | null | undefined, done: () => void) => run(element, false, done),
    cancel,
    finish
  }
}
