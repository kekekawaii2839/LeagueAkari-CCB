import { afterEach, expect, test, vi } from 'vitest'

import { createChampionPoolMotion } from './champion-pool-motion'

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  const animations: { cancel: ReturnType<typeof vi.fn>; finish: () => void }[] = []
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const animation = { finished, cancel: vi.fn(), finish }
    animations.push(animation)
    return animation
  })
  vi.stubGlobal('getComputedStyle', () => ({
    opacity: '0.7',
    getPropertyValue: () => 'cubic-bezier(0, 0, .2, 1)'
  }))
  return { element: { animate } as unknown as HTMLElement, animate, animations }
}

test('entry completes without holding opacity or delaying content', async () => {
  const { element, animations } = fixture()
  const motion = createChampionPoolMotion(() => false)
  motion.enter(element)
  animations[0].finish()
  await Promise.resolve()
  expect(animations[0].cancel).toHaveBeenCalledOnce()
})

test('close waits for its own completion, while reopen cancels old removal', async () => {
  const { element, animations } = fixture()
  const motion = createChampionPoolMotion(() => false)
  const remove = vi.fn()
  motion.leave(element, remove)
  expect(remove).not.toHaveBeenCalled()
  motion.enter(element)
  animations[0].finish()
  await Promise.resolve()
  expect(remove).not.toHaveBeenCalled()
  expect(animations[0].cancel).toHaveBeenCalledOnce()
})

test('finished close removes the retained surface exactly once', async () => {
  const { element, animations } = fixture()
  const motion = createChampionPoolMotion(() => false)
  const remove = vi.fn()
  motion.leave(element, remove)
  animations[0].finish()
  await Promise.resolve()
  motion.finish()
  expect(remove).toHaveBeenCalledOnce()
})

test('early close starts at painted opacity before canceling the entry', () => {
  const { element, animate, animations } = fixture()
  const motion = createChampionPoolMotion(() => false)
  motion.enter(element)
  let paintedOpacity = '0.25'
  vi.stubGlobal('getComputedStyle', () => ({
    get opacity() {
      return paintedOpacity
    },
    getPropertyValue: () => ''
  }))
  animations[0].cancel.mockImplementation(() => {
    paintedOpacity = '1'
  })
  motion.leave(element, vi.fn())
  expect(animate.mock.calls[1]?.[0]).toEqual([{ opacity: '0.25' }, { opacity: 0 }])
})

test('switching to reduced motion finishes an in-flight close immediately', async () => {
  const { element, animations, animate } = fixture()
  let reduced = false
  const motion = createChampionPoolMotion(() => reduced)
  const remove = vi.fn()
  motion.leave(element, remove)
  reduced = true
  motion.finish()
  expect(remove).toHaveBeenCalledOnce()
  expect(animations[0].cancel).toHaveBeenCalledOnce()
  motion.enter(element)
  expect(animate).toHaveBeenCalledOnce()
})

test('invalidated or unmounted content cancels pending completion', async () => {
  const { element, animations } = fixture()
  const motion = createChampionPoolMotion(() => false)
  const remove = vi.fn()
  motion.leave(element, remove)
  motion.cancel()
  animations[0].finish()
  await Promise.resolve()
  expect(remove).not.toHaveBeenCalled()
})

test('reduced motion and missing browser animation support close synchronously', () => {
  const remove = vi.fn()
  createChampionPoolMotion(() => true).leave(null, remove)
  createChampionPoolMotion(() => false).leave({} as HTMLElement, remove)
  expect(remove).toHaveBeenCalledTimes(2)
})
