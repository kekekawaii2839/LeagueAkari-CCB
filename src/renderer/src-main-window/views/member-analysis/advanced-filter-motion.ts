// Keep controls mounted; only the advanced region's layout participates in the fold.
export function createAdvancedFilterMotion(reducedMotion: () => boolean) {
  let animation: Animation | undefined
  let shell: HTMLElement | undefined
  let sequence = 0

  function cancel() {
    sequence++
    animation?.cancel()
    animation = undefined
    if (shell) shell.style.overflow = ''
    shell = undefined
  }

  function run(
    element: HTMLElement | null,
    content: HTMLElement | null,
    open: boolean,
    fresh: boolean,
    done: () => void
  ) {
    // A sync Vue watcher can precede v-show's DOM patch on trusted input.
    // Reveal for measurement in this same task, before the zero-height first frame.
    if (element && open) element.style.display = ''
    // Sample painted geometry BEFORE cancellation so a reversal has no reset frame.
    const style = element ? getComputedStyle(element) : undefined
    const start = {
      height: fresh ? '0px' : `${element?.getBoundingClientRect().height ?? 0}px`,
      opacity: fresh ? '0' : (style?.opacity ?? '1'),
      marginTop: fresh ? '-7px' : (style?.marginTop ?? '0px')
    }
    const height = content?.getBoundingClientRect().height ?? 0
    cancel()
    if (!element || !content || reducedMotion() || typeof element.animate !== 'function') {
      done()
      return
    }
    shell = element
    element.style.overflow = 'hidden'
    const token = sequence
    animation = element.animate(
      [
        start,
        {
          height: open ? `${height}px` : '0px',
          opacity: open ? 1 : 0,
          marginTop: open ? '0px' : '-7px'
        }
      ],
      { duration: open ? 200 : 160, easing: 'cubic-bezier(0, 0, .2, 1)', fill: 'forwards' }
    )
    void animation.finished.then(
      () => {
        if (token !== sequence) return
        // Apply hidden state before dropping the final height, in the same render turn.
        done()
        cancel()
      },
      () => {}
    )
  }

  return { run, cancel }
}
