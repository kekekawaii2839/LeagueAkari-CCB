import { expect, test, vi } from 'vitest'

import { revealScatterExactRow } from './scatter-exact-reveal'

function fixture(heights = [36.8, 36.8]) {
  const target = { scrollIntoView: vi.fn() }
  const state = { live: true, mounted: false }
  const options = {
    indexOnPage: 24,
    heights: () => heights,
    scrollTo: vi.fn(),
    findTarget: () => (state.mounted ? target : null),
    revealAll: vi.fn(() => {
      state.mounted = true
    }),
    settled: vi.fn(async () => {}),
    current: () => state.live
  }
  return { target, state, options }
}
test('uses measured real row height with the public pixel scroll API, then locates the mounted target', async () => {
  const f = fixture([38.4, 38.4])
  f.options.settled.mockImplementation(async () => {
    f.state.mounted = true
  })
  expect(await revealScatterExactRow(f.options)).toBe('revealed')
  expect(f.options.scrollTo).toHaveBeenCalledWith(24 * 38.4)
  expect(f.options.revealAll).not.toHaveBeenCalled()
  expect(f.target.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
})
test.each([[36.8, 51], [], [0, NaN], [36.8, 0]])(
  'variable or unavailable row geometry falls back to a complete bounded page: %j',
  async (...heights) => {
    const f = fixture(heights as number[])
    expect(await revealScatterExactRow(f.options)).toBe('revealed')
    expect(f.options.revealAll).toHaveBeenCalledOnce()
    expect(f.options.scrollTo).toHaveBeenCalledWith(0)
    expect(f.target.scrollIntoView).toHaveBeenCalledOnce()
  }
)
test('unmeasured variable rows that defeat the estimate still reveal the real target through fallback', async () => {
  const f = fixture()
  expect(await revealScatterExactRow(f.options)).toBe('revealed')
  expect(f.options.scrollTo).toHaveBeenCalledWith(24 * 36.8)
  expect(f.options.revealAll).toHaveBeenCalledOnce()
  expect(f.target.scrollIntoView).toHaveBeenCalledOnce()
})
test('a hidden/replaced selection cancels pending positioning without mounting a full hidden page', async () => {
  const f = fixture()
  f.options.settled.mockImplementation(async () => {
    f.state.live = false
  })
  expect(await revealScatterExactRow(f.options)).toBe('cancelled')
  expect(f.options.revealAll).not.toHaveBeenCalled()
  expect(f.target.scrollIntoView).not.toHaveBeenCalled()
})
test('a short final page scrolls its actual index zero and never invents more data', async () => {
  const f = fixture([36.8])
  f.options.indexOnPage = 0
  f.options.settled.mockImplementation(async () => {
    f.state.mounted = true
  })
  expect(await revealScatterExactRow(f.options)).toBe('revealed')
  expect(f.options.scrollTo).toHaveBeenCalledWith(0)
  expect(f.options.revealAll).not.toHaveBeenCalled()
})
