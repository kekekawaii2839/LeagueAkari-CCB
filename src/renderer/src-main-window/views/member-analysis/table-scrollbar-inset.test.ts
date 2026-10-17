import { afterEach, expect, test, vi } from 'vitest'

import { observeTableScrollbarInsets } from './table-scrollbar-inset'

function fixture() {
  let next = 0
  const frames = new Map<number, FrameRequestCallback>(),
    resizes: any[] = [],
    mutations: any[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<any>()
      constructor(public callback: () => void) {
        resizes.push(this)
      }
      observe(n: any) {
        this.targets.add(n)
      }
      unobserve(n: any) {
        this.targets.delete(n)
      }
      disconnect() {
        this.targets.clear()
      }
    }
  )
  vi.stubGlobal(
    'MutationObserver',
    class {
      targets = new Map<any, MutationObserverInit>()
      constructor(public callback: (records: any[]) => void) {
        mutations.push(this)
      }
      observe(n: any, o: MutationObserverInit) {
        this.targets.set(n, o)
      }
      disconnect() {
        this.targets.clear()
      }
    }
  )
  const element = (tag = 'div', top = 100, bottom = 140): any => ({
    nodeType: 1,
    tag,
    dataset: {},
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    parentElement: null,
    clientTop: 0,
    clientHeight: 300,
    scrollHeight: 600,
    css: { position: 'static', overflowY: 'visible' },
    naive: false,
    primary: false,
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getClientRects: () => [{}],
    getBoundingClientRect: vi.fn(() => ({ top, bottom })),
    classList: { contains: (name: string) => name === 'member-analysis-scroll' && false },
    matches: (selector: string) => selector.split(',').includes(tag),
    closest(selector: string) {
      if (selector === '.n-data-table') return this.naive ? {} : null
      if (selector === '[data-member-pane]') return this.pane ?? null
      if (selector === 'table') return this.table ?? this
    },
    querySelectorAll: () => []
  })
  vi.stubGlobal('getComputedStyle', (n: any) => n.css)
  const root = element('main'),
    owner = element(),
    table = element('table'),
    header = element('thead'),
    dense = element('svg')
  dense.namespaceURI = 'http://www.w3.org/2000/svg'
  owner.parentElement = root
  owner.css.overflowY = 'auto'
  table.parentElement = owner
  header.table = table
  header.css.position = 'sticky'
  const headers = [header],
    structure = [owner, table]
  root.querySelectorAll = vi.fn((selector: string) => (selector === 'thead' ? headers : structure))
  const stop = observeTableScrollbarInsets(root)
  const flush = () => {
    const tasks = [...frames.values()]
    frames.clear()
    tasks.forEach((callback) => callback(0))
  }
  return {
    root,
    owner,
    table,
    header,
    dense,
    headers,
    structure,
    element,
    frames,
    resizes,
    mutations,
    stop,
    flush
  }
}
afterEach(() => vi.unstubAllGlobals())
test('native rail follows real fixed header height and resize/wrap, without changing scroll or focus', () => {
  const f = fixture()
  f.flush()
  expect(f.owner.style.setProperty).toHaveBeenLastCalledWith('--ma-table-header-inset', '40px')
  f.header.getBoundingClientRect.mockReturnValue({ top: 100, bottom: 174 })
  f.resizes[0].callback()
  f.flush()
  expect(f.owner.style.setProperty).toHaveBeenLastCalledWith('--ma-table-header-inset', '74px')
  expect(f.owner.setAttribute).toHaveBeenCalledWith('data-ma-table-scroll', '')
  expect(f.owner).not.toHaveProperty('scrollTop')
  expect(f.owner).not.toHaveProperty('focus')
  f.stop()
})
test('initial and repeated ResizeObserver deliveries reuse ownership instead of repeating discovery/style scans', () => {
  const f = fixture()
  f.flush()
  const queries = f.root.querySelectorAll.mock.calls.length
  f.resizes[0].callback()
  f.resizes[0].callback()
  f.flush()
  expect(f.root.querySelectorAll).toHaveBeenCalledTimes(queries)
  expect(f.owner.style.setProperty).toHaveBeenCalledTimes(1)
  f.stop()
})
test('native scrolling measures only its owner; SVG/text changes cause no discovery or geometry flush', () => {
  const f = fixture()
  f.flush()
  const other = f.element(),
    table = f.element('table'),
    header = f.element('thead')
  other.parentElement = f.root
  other.css.overflowY = 'auto'
  table.parentElement = other
  header.table = table
  header.css.position = 'sticky'
  f.headers.push(header)
  f.structure.push(other, table)
  f.mutations[0].callback([{ target: f.root, addedNodes: [table], removedNodes: [] }])
  f.flush()
  other.getBoundingClientRect.mockClear()
  header.getBoundingClientRect.mockClear()
  const scroll = f.owner.addEventListener.mock.calls.find((c: any[]) => c[0] === 'scroll')[1]
  scroll({ currentTarget: f.owner })
  scroll({ currentTarget: f.owner })
  expect(f.frames.size).toBe(1)
  f.flush()
  expect(other.getBoundingClientRect).not.toHaveBeenCalled()
  expect(header.getBoundingClientRect).not.toHaveBeenCalled()
  f.mutations[0].callback([
    { target: f.root, addedNodes: [f.dense, { nodeType: 3 }], removedNodes: [] }
  ])
  expect(f.frames.size).toBe(0)
  expect(
    [...f.mutations[0].targets].every(
      ([target, o]: any) => !o.subtree && (!o.attributes || target === f.root)
    )
  ).toBe(true)
  expect(f.mutations[0].targets.has(f.dense)).toBe(false)
  f.stop()
})
test('split Naive headers, multi-table workspaces without sticky headers and main navigation owner are not offset twice', () => {
  const f = fixture()
  f.header.naive = true
  f.flush()
  expect(f.owner.style.setProperty).not.toHaveBeenCalled()
  f.header.naive = false
  f.header.css.position = 'static'
  f.resizes[0].callback()
  f.flush()
  expect(f.owner.style.setProperty).not.toHaveBeenCalled()
  f.header.css.position = 'sticky'
  f.owner.classList.contains = (name: string) => name === 'member-analysis-scroll'
  f.resizes[0].callback()
  f.flush()
  expect(f.owner.style.setProperty).not.toHaveBeenCalled()
  f.stop()
})
test('a formerly unbounded table acquires a rail after resizing; removal/disposal clears all observers and frames', () => {
  const f = fixture()
  f.owner.scrollHeight = 300
  f.flush()
  expect(f.owner.style.setProperty).not.toHaveBeenCalled()
  expect(f.resizes[0].targets.has(f.owner)).toBe(true)
  f.owner.scrollHeight = 600
  f.resizes[0].callback()
  f.flush()
  expect(f.owner.style.setProperty).toHaveBeenLastCalledWith('--ma-table-header-inset', '40px')
  f.headers.splice(0)
  f.structure.splice(0)
  f.mutations[0].callback([{ target: f.root, addedNodes: [], removedNodes: [f.table] }])
  f.flush()
  expect(f.owner.removeAttribute).toHaveBeenCalledWith('data-ma-table-scroll')
  expect(f.owner.style.removeProperty).toHaveBeenCalledWith('--ma-table-header-inset')
  f.resizes[0].callback()
  expect(f.frames.size).toBe(1)
  f.stop()
  expect(f.frames.size).toBe(0)
  expect(f.resizes[0].targets.size).toBe(0)
  expect(f.mutations[0].targets.size).toBe(0)
})

test('inactive cached panes never force table geometry during a dense page entry, and activation discovers them', () => {
  const f = fixture()
  f.root.dataset.activeSection = 'scatter'
  f.header.pane = { dataset: { memberPane: 'pairs' } }
  f.flush()
  expect(f.owner.getBoundingClientRect).not.toHaveBeenCalled()
  expect(f.header.getBoundingClientRect).not.toHaveBeenCalled()
  f.root.dataset.activeSection = 'pairs'
  f.mutations[0].callback([
    { type: 'attributes', target: f.root, addedNodes: [], removedNodes: [] }
  ])
  f.flush()
  expect(f.owner.style.setProperty).toHaveBeenLastCalledWith('--ma-table-header-inset', '40px')
  f.owner.getBoundingClientRect.mockClear()
  f.header.getBoundingClientRect.mockClear()
  f.root.dataset.activeSection = 'scatter'
  f.mutations[0].callback([
    { type: 'attributes', target: f.root, addedNodes: [], removedNodes: [] }
  ])
  f.flush()
  expect(f.owner.getBoundingClientRect).not.toHaveBeenCalled()
  expect(f.header.getBoundingClientRect).not.toHaveBeenCalled()
  expect(f.owner.removeAttribute).toHaveBeenCalledWith('data-ma-table-scroll')
  f.stop()
})
