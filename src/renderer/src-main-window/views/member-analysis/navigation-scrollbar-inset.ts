// Only geometry above the navigation can change this inset. Pane contents and
// their visibility classes must not synchronously flush a dense chart's layout.
export function observeNavigationScrollbarInset(owner: HTMLElement, navigation: HTMLElement) {
  let frame = 0
  let disposed = false
  let lastInset: number | undefined
  const measure = () => {
    frame = 0
    if (disposed) return
    const inset = Math.max(
      0,
      navigation.getBoundingClientRect().bottom - owner.getBoundingClientRect().top
    )
    if (inset !== lastInset) {
      owner.style.setProperty('--member-navigation-scrollbar-inset', `${inset}px`)
      lastInset = inset
    }
  }
  const queue = () => {
    if (disposed || frame) return
    if (typeof requestAnimationFrame === 'undefined') measure()
    else frame = requestAnimationFrame(measure)
  }
  const resize = new ResizeObserver(queue)
  const mutations =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          observeAboveNavigation()
          queue()
        })
  function observeAboveNavigation() {
    resize.disconnect()
    mutations?.disconnect()
    resize.observe(owner)
    resize.observe(navigation)
    // Track inserted/removed notices and their actual size, but never recurse
    // into the tab panes beneath the navigation.
    for (
      let child = navigation;
      child !== owner && child.parentElement;
      child = child.parentElement
    ) {
      const parent = child.parentElement
      mutations?.observe(parent, { childList: true })
      for (const sibling of parent.children) {
        if (sibling === child) break
        resize.observe(sibling)
        mutations?.observe(sibling, { attributes: true, attributeFilter: ['class', 'hidden'] })
      }
    }
  }
  observeAboveNavigation()
  owner.addEventListener('scroll', queue, { passive: true })
  queue()
  return () => {
    disposed = true
    resize.disconnect()
    mutations?.disconnect()
    if (frame) cancelAnimationFrame(frame)
    owner.removeEventListener('scroll', queue)
    owner.style.removeProperty('--member-navigation-scrollbar-inset')
  }
}
