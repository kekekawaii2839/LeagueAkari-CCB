interface PrimaryTabMotionOptions {
  root: () => HTMLElement | null
  active: () => string
  reduced: () => boolean
  rendered: () => Promise<void>
}

// Presentation only. Route selection, cached components and scroll belong to
// the page; only a pointer-originated primary tab change can start this effect.
export function createPrimaryTabMotion(options: PrimaryTabMotionOptions) {
  let pointerSection: string | null = null
  let pointerEvent: MouseEvent | null = null
  let sequence = 0
  let animation: Animation | undefined

  function capture(event: MouseEvent) {
    const tab = event.target instanceof Element ? event.target.closest('[data-name]') : null
    const nav = options.root()?.querySelector('.n-tabs-nav')
    pointerSection =
      event.detail > 0 && tab && nav?.contains(tab) ? tab.getAttribute('data-name') : null
    pointerEvent = pointerSection ? event : null
  }

  function cancel() {
    sequence++
    pointerSection = null
    pointerEvent = null
    animation?.cancel()
    animation = undefined
  }

  async function enter(section: string) {
    // Native events run microtasks between capture and target listeners. The
    // actual dispatch phase, not a timer, scopes intent to this click alone.
    const pointerChange =
      pointerSection === section &&
      (pointerEvent?.eventPhase === Event.AT_TARGET ||
        pointerEvent?.eventPhase === Event.BUBBLING_PHASE)
    cancel()
    const token = sequence
    if (!pointerChange || options.reduced()) return
    await options.rendered()
    if (token !== sequence || options.active() !== section || options.reduced()) return
    const element = [
      ...(options.root()?.querySelectorAll<HTMLElement>('[data-member-pane]') ?? [])
    ].find((pane) => pane.dataset.memberPane === section)
    if (!element || typeof element.animate !== 'function') return
    animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 200,
      easing: 'ease',
      fill: 'forwards'
    })
    void animation.finished.then(
      () => {
        if (token === sequence) cancel()
      },
      () => {
        /* A later interaction or lifecycle owns cancellation. */
      }
    )
  }

  return { capture, enter, cancel }
}
