import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import assert from 'node:assert/strict'
import { afterEach, test, vi } from 'vitest'

import { createMatchNavigation, resolveMatchNavigationTarget } from './match-navigation'

afterEach(() => vi.unstubAllGlobals())

const games = Array.from({ length: 205 }, (_, i) => ({ gameId: 900001 + i }) as MemberAnalysisGame)
test('first, middle, last and >100 records resolve by unique ID, not position', () => {
  for (const i of [0, 104, 204]) {
    const result = resolveMatchNavigationTarget(games, [...games].reverse(), games[i].gameId)
    assert.equal(result.kind, 'found')
    if (result.kind === 'found') assert.equal(result.game, games[i])
  }
  assert.equal(resolveMatchNavigationTarget(games, games, 404).kind, 'missing')
  assert.equal(
    resolveMatchNavigationTarget(games, games.slice(0, 50), games[104].gameId).kind,
    'excluded'
  )
  assert.equal(
    resolveMatchNavigationTarget([...games, { ...games[104] }], [games[104]], games[104].gameId)
      .kind,
    'ambiguous'
  )
})
function fixture() {
  let active = true,
    request: { gameId: number } | null = null,
    render = async () => {},
    frames = new Map<number, FrameRequestCallback>(),
    next = 0
  const expanded = new Set([900003]),
    effects: any[] = [],
    rows = new Map<number, any>()
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++next, fn)
    return next
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
  for (const game of games) {
    const button = {
      scrollIntoView: (o: unknown) => effects.push(['button', game.gameId, o]),
      focus: (o: unknown) => effects.push(['focus', game.gameId, o])
    }
    rows.set(game.gameId, {
      isConnected: true,
      querySelector: () => button,
      scrollIntoView: (o: unknown) => effects.push(['row', game.gameId, o])
    })
  }
  const nav = createMatchNavigation<{ gameId: number }>({
    current: (r) => active && r === request,
    resolve: (r) => resolveMatchNavigationTarget(games, games, r.gameId),
    rendered: () => render(),
    expand: (g) => expanded.add(g.gameId),
    row: (g) => rows.get(g.gameId),
    settled: (r, result) => effects.push(['settled', r.gameId, result])
  })
  return {
    nav,
    expanded,
    effects,
    frames,
    rows,
    locate(id: number) {
      request = { gameId: id }
      return nav.locate(request)
    },
    stop() {
      active = false
      nav.cancel()
    },
    delay() {
      const releases: (() => void)[] = []
      render = () => new Promise((r) => releases.push(r))
      return () => {
        render = async () => {}
        releases.forEach((r) => r())
      }
    },
    flush() {
      for (const [id, fn] of [...frames]) {
        frames.delete(id)
        fn(0)
      }
    }
  }
}
const ticks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}
test('locates, opens without toggling existing rows, focuses exact target and repeats idempotently', async () => {
  const f = fixture()
  for (let i = 0; i < 2; i++) {
    const p = f.locate(900205)
    await ticks()
    f.flush()
    await p
  }
  assert.deepEqual([...f.expanded], [900003, 900205])
  assert.equal(f.effects.filter((e) => e[0] === 'focus' && e[1] === 900205).length, 2)
  assert.equal(f.effects.find((e) => e[0] === 'row')[2].behavior, 'instant')
})
test('new click defeats old render, latest identity alone is opened', async () => {
  const f = fixture(),
    release = f.delay(),
    old = f.locate(900001)
  const fresh = f.locate(900205)
  release()
  await ticks()
  f.flush()
  await Promise.all([old, fresh])
  assert(!f.expanded.has(900001))
  assert(f.expanded.has(900205))
})
test('deactivation, filter/refresh invalidation cancel queued frame without late focus', async () => {
  const f = fixture(),
    p = f.locate(900105)
  await ticks()
  assert.equal(f.frames.size, 1)
  f.stop()
  await p
  f.flush()
  assert.equal(f.frames.size, 0)
  assert.equal(f.effects.length, 0)
  assert(!f.expanded.has(900105))
})
test('unmounted row reports unavailable and does not invent arrival', async () => {
  const f = fixture()
  f.rows.get(900001).isConnected = false
  const p = f.locate(900001)
  await ticks()
  f.flush()
  await p
  assert.deepEqual(f.effects, [['settled', 900001, 'unavailable']])
})
