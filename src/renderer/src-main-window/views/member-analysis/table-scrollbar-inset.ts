/** Native sticky-table rails start at the first data row, while Naive's split
 * header/body tables keep their own rail geometry. One observer owns the page;
 * dense SVG/text updates never trigger table discovery or layout measurement. */
export function observeTableScrollbarInsets(root: HTMLElement) {
  let disposed = false
  let frame = 0
  let discover = true
  const owners = new Map<HTMLElement, HTMLElement[]>()
  const observed = new Set<Element>()
  const dirty = new Set<HTMLElement>()
  const insets = new Map<HTMLElement, number>()
  const activePane = (element: Element) => {
    const section = root.dataset.activeSection
    const pane = element.closest<HTMLElement>('[data-member-pane]')
    return (
      !section || !pane || pane.dataset.memberPane === (section === 'synergy' ? 'pairs' : section)
    )
  }
  const clear = (owner: HTMLElement) => {
    owner.removeAttribute('data-ma-table-scroll')
    owner.style.removeProperty('--ma-table-header-inset')
    insets.delete(owner)
    owner.removeEventListener('scroll', onScroll)
  }
  const queue = () => {
    if (disposed || frame) return
    frame = requestAnimationFrame(measure)
  }
  function onScroll(event: Event) {
    dirty.add(event.currentTarget as HTMLElement)
    queue()
  }
  const resize = new ResizeObserver(() => {
    // Geometry changes do not change table ownership. In particular, the
    // initial RO delivery must not repeat HTML discovery/style resolution.
    for (const owner of owners.keys()) dirty.add(owner)
    queue()
  })
  function refresh() {
    mutations.disconnect()
    mutations.observe(root, {
      childList: true,
      attributes: true,
      attributeFilter: ['data-active-section']
    })
    // Observe only direct HTML structure changes. In particular, no observer
    // recurses into a chart's dense SVG tree or a table's changing body cells.
    for (const container of root.querySelectorAll('div,section,article,main,aside,table')) {
      if (
        container.namespaceURI !== 'http://www.w3.org/1999/xhtml' ||
        container.closest('.n-data-table')
      )
        continue
      mutations.observe(container, { childList: true })
    }
    const next = new Map<HTMLElement, HTMLElement[]>()
    const targets = new Set<Element>()
    for (const header of root.querySelectorAll<HTMLElement>('thead')) {
      if (!activePane(header) || header.closest('.n-data-table')) continue
      const cells =
        getComputedStyle(header).position === 'sticky'
          ? [header]
          : [...header.querySelectorAll<HTMLElement>('th')].filter(
              (cell) => getComputedStyle(cell).position === 'sticky'
            )
      if (!cells.length) continue
      const table = header.closest('table')!
      targets.add(table)
      targets.add(header)
      for (let owner = table.parentElement; owner && owner !== root; owner = owner.parentElement) {
        if (
          owner.classList.contains('member-analysis-scroll') ||
          owner.classList.contains('n-scrollbar-container')
        )
          break
        if (!/^(auto|scroll)$/.test(getComputedStyle(owner).overflowY)) continue
        targets.add(owner)
        // Only a bounded, vertically overflowing native table owns a rail.
        // Keep an unbounded/hidden candidate observed: a later resize may
        // create overflow without any new DOM structure to rediscover.
        next.set(owner, [...(next.get(owner) ?? []), ...cells])
        // A horizontal-only scroll wrapper is still the sticky containing
        // block. Its surrounding workspace must not impersonate table body.
        break
      }
    }
    for (const owner of owners.keys()) if (!next.has(owner)) clear(owner)
    for (const [owner, cells] of next) {
      if (!owners.has(owner)) owner.addEventListener('scroll', onScroll, { passive: true })
      owners.set(owner, cells)
      dirty.add(owner)
    }
    for (const owner of [...owners.keys()]) if (!next.has(owner)) owners.delete(owner)
    for (const target of observed)
      if (!targets.has(target)) {
        resize.unobserve(target)
        observed.delete(target)
      }
    for (const target of targets)
      if (!observed.has(target)) {
        resize.observe(target)
        observed.add(target)
      }
  }
  function measure() {
    frame = 0
    if (disposed) return
    if (discover) {
      discover = false
      refresh()
    }
    for (const owner of dirty) {
      const cells = owners.get(owner)
      if (!cells?.length || !owner.getClientRects().length) continue
      if (owner.scrollHeight <= owner.clientHeight + 1) {
        owner.removeAttribute('data-ma-table-scroll')
        owner.style.removeProperty('--ma-table-header-inset')
        insets.delete(owner)
        continue
      }
      const top = owner.getBoundingClientRect().top + owner.clientTop
      const inset = Math.max(0, ...cells.map((cell) => cell.getBoundingClientRect().bottom - top))
      if (insets.get(owner) !== inset) {
        owner.setAttribute('data-ma-table-scroll', '')
        owner.style.setProperty('--ma-table-header-inset', `${inset}px`)
        insets.set(owner, inset)
      }
    }
    dirty.clear()
  }
  const changesStructure = (node: Node) =>
    node.nodeType === 1 &&
    (node as Element).namespaceURI === 'http://www.w3.org/1999/xhtml' &&
    (node as Element).matches('div,section,article,main,aside,table,thead')
  const mutations = new MutationObserver((records) => {
    if (
      !records.some(
        (record) =>
          record.type === 'attributes' ||
          (activePane(record.target as Element) &&
            [...record.addedNodes, ...record.removedNodes].some(changesStructure))
      )
    )
      return
    discover = true
    queue()
  })
  queue()
  return () => {
    disposed = true
    if (frame) cancelAnimationFrame(frame)
    resize.disconnect()
    mutations.disconnect()
    for (const owner of owners.keys()) clear(owner)
    owners.clear()
    observed.clear()
    dirty.clear()
  }
}
