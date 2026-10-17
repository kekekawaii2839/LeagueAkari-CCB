import { afterEach, describe, expect, test, vi } from 'vitest'

import { observeNavigationScrollbarInset } from './navigation-scrollbar-inset'

function fixture() {
  let next = 0
  const frames = new Map<number, FrameRequestCallback>()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++next, fn)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  const resizes: any[] = [],
    mutations: any[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      targets = new Set<any>()
      constructor(public callback: () => void) {
        resizes.push(this)
      }
      observe(target: any) {
        this.targets.add(target)
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
      constructor(public callback: () => void) {
        mutations.push(this)
      }
      observe(target: any, options: MutationObserverInit) {
        this.targets.set(target, options)
      }
      disconnect() {
        this.targets.clear()
      }
    }
  )
  const element = (top = 0, bottom = 0): any => ({
    parentElement: null,
    children: [],
    style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getBoundingClientRect: vi.fn(() => ({ top, bottom }))
  })
  const owner = element(100, 800),
    notice = element(),
    content = element(),
    ready = element(),
    tabs = element(),
    navigation = element(100, 150),
    panes = element(),
    dense = element()
  const append = (parent: any, ...children: any[]) => {
    parent.children.push(...children)
    for (const child of children) child.parentElement = parent
  }
  append(owner, notice, content)
  append(content, ready)
  append(ready, tabs)
  append(tabs, navigation, panes)
  append(panes, dense)
  const dispose = observeNavigationScrollbarInset(owner, navigation)
  const flush = () => {
    const callbacks = [...frames.values()]
    frames.clear()
    callbacks.forEach((fn) => fn(0))
  }
  return {
    owner,
    notice,
    content,
    navigation,
    panes,
    dense,
    append,
    element,
    dispose,
    flush,
    frames,
    resizes,
    mutations
  }
}
afterEach(() => vi.unstubAllGlobals())
describe('navigation scrollbar inset observation', () => {
  test('coalesces measurements and ignores dense pane mutations and unchanged writes', () => {
    const f = fixture()
    try {
      expect(f.owner.getBoundingClientRect).not.toHaveBeenCalled()
      f.resizes[0].callback()
      f.resizes[0].callback()
      expect(f.frames.size).toBe(1)
      f.flush()
      expect(f.owner.style.setProperty).toHaveBeenCalledWith(
        '--member-navigation-scrollbar-inset',
        '50px'
      )
      const watched = f.mutations[0].targets
      expect(watched.has(f.dense)).toBe(false)
      expect(watched.has(f.panes)).toBe(false)
      expect([...watched.values()].some((o: any) => o.subtree)).toBe(false)
      f.resizes[0].callback()
      f.flush()
      expect(f.owner.style.setProperty).toHaveBeenCalledTimes(1)
      expect(f.resizes[0].targets.has(f.notice)).toBe(true)
      expect(f.resizes[0].targets.has(f.panes)).toBe(false)
    } finally {
      f.dispose()
    }
  })
  test('tracks newly inserted notices, scroll geometry and cancels queued work on disposal', () => {
    const f = fixture()
    f.flush()
    const added = f.element()
    added.parentElement = f.content
    f.content.children.unshift(added)
    f.mutations[0].callback()
    expect(f.resizes[0].targets.has(added)).toBe(true)
    f.navigation.getBoundingClientRect.mockReturnValue({ bottom: 180 })
    f.flush()
    expect(f.owner.style.setProperty).toHaveBeenLastCalledWith(
      '--member-navigation-scrollbar-inset',
      '80px'
    )
    const scroll = f.owner.addEventListener.mock.calls.find((c: any[]) => c[0] === 'scroll')[1]
    scroll()
    scroll()
    expect(f.frames.size).toBe(1)
    f.dispose()
    expect(f.frames.size).toBe(0)
    expect(f.resizes[0].targets.size).toBe(0)
    expect(f.mutations[0].targets.size).toBe(0)
    expect(f.owner.removeEventListener).toHaveBeenCalledWith('scroll', scroll)
    expect(f.owner.style.removeProperty).toHaveBeenCalledWith('--member-navigation-scrollbar-inset')
  })
})
