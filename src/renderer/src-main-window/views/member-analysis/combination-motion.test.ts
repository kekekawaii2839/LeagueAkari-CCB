import { afterEach, expect, test, vi } from 'vitest'

import { createCombinationMotion } from './combination-motion'

afterEach(() => vi.unstubAllGlobals())
function fixture() {
  let active = 'pairs',
    reduced = false,
    visible = true
  const animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = []
  const animate = vi.fn(() => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const animation = { finished, finish, cancel: vi.fn() }
    animations.push(animation)
    return animation
  })
  vi.stubGlobal('getComputedStyle', () => ({
    transform: active === 'synergy' ? 'matrix(1, 0, 0, 1, 112, 0)' : 'matrix(1, 0, 0, 1, 0, 0)'
  }))
  const element = { animate } as unknown as HTMLElement
  const motion = createCombinationMotion({
    active: () => active,
    reduced: () => reduced,
    visible: () => visible,
    indicator: () => element,
    rendered: async () => {}
  })
  return {
    motion,
    animate,
    animations,
    select: (view: string) => {
      motion.request(view, () => {
        active = view
        void motion.changed(view)
      })
    },
    external: (view: string) => {
      active = view
      return motion.changed(view)
    },
    reduce: () => {
      reduced = true
      motion.cancel()
    },
    hide: () => {
      visible = false
      motion.cancel()
    }
  }
}
test('manual change animates only the indicator at 220ms', async () => {
  const f = fixture()
  f.select('synergy')
  await Promise.resolve()
  expect(f.animate).toHaveBeenCalledWith(
    [{ transform: 'matrix(1, 0, 0, 1, 0, 0)' }, { transform: 'matrix(1, 0, 0, 1, 112, 0)' }],
    {
      duration: 220,
      easing: 'cubic-bezier(.37, 0, .63, 1)',
      fill: 'forwards'
    }
  )
  f.animations[0].finish()
  await Promise.resolve()
  expect(f.animations[0].cancel).toHaveBeenCalledOnce()
})
test('returning to left option moves only the indicator', async () => {
  const f = fixture()
  await f.external('synergy')
  f.select('pairs')
  await Promise.resolve()
  expect(f.animate.mock.calls[0]).toEqual([
    [{ transform: 'matrix(1, 0, 0, 1, 112, 0)' }, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }],
    { duration: 220, easing: 'cubic-bezier(.37, 0, .63, 1)', fill: 'forwards' }
  ])
})
test('indicator reversal samples painted transform before cancellation', async () => {
  let active = 'pairs',
    painted = 'matrix(1, 0, 0, 1, 40, 0)'
  const cancels: ReturnType<typeof vi.fn>[] = []
  const animate = vi.fn(() => {
    const cancel = vi.fn(() => {
      painted = 'matrix(1, 0, 0, 1, 0, 0)'
    })
    cancels.push(cancel)
    return { cancel, finished: new Promise(() => {}) }
  })
  const indicator = { animate } as unknown as HTMLElement
  vi.stubGlobal('getComputedStyle', () => ({ transform: painted, getPropertyValue: () => '' }))
  const motion = createCombinationMotion({
    active: () => active,
    indicator: () => indicator,
    reduced: () => false,
    visible: () => true,
    rendered: async () => {}
  })
  motion.request('synergy', () => {
    active = 'synergy'
    void motion.changed(active)
  })
  await Promise.resolve()
  painted = 'matrix(1, 0, 0, 1, 63, 0)'
  motion.request('pairs', () => {
    active = 'pairs'
    void motion.changed(active)
  })
  await Promise.resolve()
  expect(animate.mock.calls[1]).toEqual([
    [{ transform: 'matrix(1, 0, 0, 1, 63, 0)' }, { transform: 'matrix(1, 0, 0, 1, 0, 0)' }],
    { duration: 220, easing: 'cubic-bezier(.37, 0, .63, 1)', fill: 'forwards' }
  ])
  motion.cancel()
  expect(cancels.every((cancel) => cancel.mock.calls.length === 1)).toBe(true)
})
test('first entry and external route changes do not animate', async () => {
  const f = fixture()
  await f.external('pairs')
  await f.external('synergy')
  expect(f.animate).not.toHaveBeenCalled()
})
test('a refused or same-view request cannot leak into a later route change', async () => {
  const f = fixture()
  f.select('pairs')
  const update = vi.fn()
  f.motion.request('synergy', update)
  await Promise.resolve()
  await f.external('synergy')
  expect(update).toHaveBeenCalledOnce()
  expect(f.animate).not.toHaveBeenCalled()
})
test('rapid changes cancel stale scheduled and active effects', async () => {
  const f = fixture()
  f.select('synergy')
  f.select('pairs')
  await Promise.resolve()
  expect(f.animate).toHaveBeenCalledOnce()
  f.select('synergy')
  await Promise.resolve()
  expect(f.animations[0].cancel).toHaveBeenCalledOnce()
  f.animations[0].finish()
  await Promise.resolve()
  expect(f.animations[1].cancel).not.toHaveBeenCalled()
})
test.each(['reduce', 'hide'] as const)('%s cancels an in-flight entry', async (mode) => {
  const f = fixture()
  f.select('synergy')
  await Promise.resolve()
  f[mode]()
  expect(f.animations[0].cancel).toHaveBeenCalledOnce()
  f.select('pairs')
  await Promise.resolve()
  expect(f.animate).toHaveBeenCalledOnce()
})
