import { afterEach, expect, test, vi } from 'vitest'

import { createAdvancedFilterMotion } from './advanced-filter-motion'

afterEach(() => vi.unstubAllGlobals())
function fixture() {
  const animations: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[] = []
  const animate = vi.fn(() => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const result = { finished, cancel: vi.fn(), finish }
    animations.push(result)
    return result
  })
  vi.stubGlobal('getComputedStyle', () => ({ opacity: '0.4', marginTop: '-3px' }))
  const element = {
    animate,
    style: { overflow: '' },
    getBoundingClientRect: () => ({ height: 24 })
  } as unknown as HTMLElement
  const content = { getBoundingClientRect: () => ({ height: 80 }) } as HTMLElement
  return { element, content, animate, animations }
}
test('fresh expansion folds height, opacity and external gap together', () => {
  const { element, content, animate } = fixture()
  createAdvancedFilterMotion(() => false).run(element, content, true, true, vi.fn())
  expect(animate).toHaveBeenCalledWith(
    [
      { height: '0px', opacity: '0', marginTop: '-7px' },
      { height: '80px', opacity: 1, marginTop: '0px' }
    ],
    { duration: 200, easing: 'cubic-bezier(0, 0, .2, 1)', fill: 'forwards' }
  )
  expect(element.style.overflow).toBe('hidden')
})
test('rapid reverse samples painted state and invalidates stale completion', async () => {
  const { element, content, animate, animations } = fixture()
  const motion = createAdvancedFilterMotion(() => false)
  const oldDone = vi.fn(),
    done = vi.fn()
  motion.run(element, content, true, true, oldDone)
  motion.run(element, content, false, false, done)
  expect(animate.mock.calls[1]).toEqual([
    [
      { height: '24px', opacity: '0.4', marginTop: '-3px' },
      { height: '0px', opacity: 0, marginTop: '-7px' }
    ],
    { duration: 160, easing: 'cubic-bezier(0, 0, .2, 1)', fill: 'forwards' }
  ])
  animations[0].finish()
  await Promise.resolve()
  expect(oldDone).not.toHaveBeenCalled()
  animations[1].finish()
  await Promise.resolve()
  expect(done).toHaveBeenCalledOnce()
  expect(element.style.overflow).toBe('')
})
test('cancel on hide or unmount removes clipping and stale callbacks', async () => {
  const { element, content, animations } = fixture()
  const motion = createAdvancedFilterMotion(() => false),
    done = vi.fn()
  motion.run(element, content, false, false, done)
  motion.cancel()
  animations[0].finish()
  await Promise.resolve()
  expect(done).not.toHaveBeenCalled()
  expect(element.style.overflow).toBe('')
})
test('reduce and missing animation support settle synchronously', () => {
  const { element, content, animate } = fixture(),
    done = vi.fn()
  createAdvancedFilterMotion(() => true).run(element, content, true, true, done)
  createAdvancedFilterMotion(() => false).run(null, null, false, false, done)
  expect(done).toHaveBeenCalledTimes(2)
  expect(animate).not.toHaveBeenCalled()
})
