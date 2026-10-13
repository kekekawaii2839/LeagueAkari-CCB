import { afterEach, expect, test, vi } from 'vitest'

import { createPrimaryTabMotion } from './primary-tab-motion'

afterEach(() => vi.unstubAllGlobals())

function fixture() {
  class Tab {
    constructor(readonly name: string) {}
    closest() {
      return this
    }
    getAttribute() {
      return this.name
    }
  }
  vi.stubGlobal('Element', Tab)
  const animations: { finish: () => void; cancel: ReturnType<typeof vi.fn> }[] = []
  const animate = vi.fn((_frames: Keyframe[], _options: KeyframeAnimationOptions) => {
    let finish!: () => void
    const finished = new Promise<void>((resolve) => {
      finish = resolve
    })
    const animation = { finished, finish, cancel: vi.fn() }
    animations.push(animation)
    return animation
  })
  const panes = ['roles', 'champions', 'pairs'].map((name) => ({
    dataset: { memberPane: name },
    animate
  }))
  let active = 'roles',
    reduced = false,
    present = true
  let rendered = async () => {}
  let event: MouseEvent | null = null
  const root = {
    querySelector: () => ({ contains: () => true }),
    querySelectorAll: () => panes
  }
  const motion = createPrimaryTabMotion({
    root: () => (present ? (root as unknown as HTMLElement) : null),
    active: () => active,
    reduced: () => reduced,
    rendered: () => rendered()
  })
  return {
    motion,
    animate,
    animations,
    captureOnly(name: string) {
      event = {
        target: new Tab(name),
        detail: 1,
        eventPhase: Event.CAPTURING_PHASE
      } as unknown as MouseEvent
      motion.capture(event)
    },
    activateOnly(name: string) {
      if (event) Object.assign(event, { eventPhase: Event.AT_TARGET })
      active = name
      return motion.enter(name)
    },
    finishDispatch() {
      if (event) Object.assign(event, { eventPhase: Event.NONE })
      event = null
    },
    select(name: string, detail = 1) {
      motion.capture({
        target: new Tab(name),
        detail,
        eventPhase: Event.AT_TARGET
      } as unknown as MouseEvent)
      active = name
      return motion.enter(name)
    },
    route(name: string) {
      active = name
      motion.cancel()
    },
    reduce() {
      reduced = true
      motion.cancel()
    },
    hide() {
      present = false
      motion.cancel()
    },
    delayRender() {
      let resolve!: () => void
      rendered = () =>
        new Promise<void>((r) => {
          resolve = r
        })
      return () => resolve()
    }
  }
}

test('pointer change only fades the requested pane and frees effect on completion', async () => {
  const f = fixture()
  await f.select('champions')
  expect(f.animate).toHaveBeenCalledWith([{ opacity: 0 }, { opacity: 1 }], {
    duration: 200,
    easing: 'ease',
    fill: 'forwards'
  })
  f.animations[0].finish()
  await Promise.resolve()
  expect(f.animations[0].cancel).toHaveBeenCalledOnce()
})

test('pointer source survives a native microtask checkpoint before the target handler', async () => {
  const f = fixture()
  f.captureOnly('champions')
  await Promise.resolve()
  await f.activateOnly('champions')
  expect(f.animate).toHaveBeenCalledOnce()
})

test('finished event dispatch cannot animate an unrelated later activation', async () => {
  const f = fixture()
  f.captureOnly('champions')
  f.finishDispatch()
  await Promise.resolve()
  await f.activateOnly('champions')
  expect(f.animate).not.toHaveBeenCalled()
})

test('keyboard and route-driven changes never start a fade', async () => {
  const f = fixture()
  await f.select('champions', 0)
  f.route('pairs')
  await f.motion.enter('pairs')
  expect(f.animate).not.toHaveBeenCalled()
})

test('a later click cancels the previous effect without canceling the new one', async () => {
  const f = fixture()
  await f.select('champions')
  await f.select('pairs')
  expect(f.animations[0].cancel).toHaveBeenCalledOnce()
  f.animations[0].finish()
  await Promise.resolve()
  expect(f.animations[1].cancel).not.toHaveBeenCalled()
})

test('hidden/deactivated page cancels even before rendering has finished', async () => {
  const f = fixture(),
    render = f.delayRender()
  const pending = f.select('champions')
  f.hide()
  render()
  await pending
  expect(f.animate).not.toHaveBeenCalled()
})

test('reduced motion settles active animation and suppresses later entry', async () => {
  const f = fixture()
  await f.select('champions')
  f.reduce()
  expect(f.animations[0].cancel).toHaveBeenCalledOnce()
  await f.select('pairs')
  expect(f.animate).toHaveBeenCalledOnce()
})

test('route redirection wins over a pending pointer entry', async () => {
  const f = fixture(),
    render = f.delayRender()
  const pending = f.select('champions')
  f.route('roles')
  render()
  await pending
  expect(f.animate).not.toHaveBeenCalled()
})
