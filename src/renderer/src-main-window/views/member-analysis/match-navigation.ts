import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

export type MatchNavigationTarget =
  { kind: 'found'; game: MemberAnalysisGame } | { kind: 'ambiguous' | 'missing' | 'excluded' }

// gameId is not a global identity. The current renderer contract has no
// authoritative platform key: refuse any collision in the full overview,
// including a collision hidden by filters. Never infer identity from a date,
// roster, display position or optional opponent-rank snapshot.
export function resolveMatchNavigationTarget(
  overview: readonly MemberAnalysisGame[],
  visible: readonly MemberAnalysisGame[],
  gameId: number
): MatchNavigationTarget {
  const records = overview.filter((game) => game.gameId === gameId)
  if (records.length > 1) return { kind: 'ambiguous' }
  if (!records.length) return { kind: 'missing' }
  const game = visible.find((game) => game.gameId === gameId)
  return game ? { kind: 'found', game } : { kind: 'excluded' }
}

interface MatchNavigationOptions<Request> {
  current: (request: Request) => boolean
  resolve: (request: Request) => MatchNavigationTarget
  rendered: () => Promise<void>
  expand: (game: MemberAnalysisGame) => void
  row: (game: MemberAnalysisGame) => HTMLElement | null
  feedback?: () => HTMLElement | null
  settled: (
    request: Request,
    result: MatchNavigationTarget['kind'] | 'unavailable' | 'located'
  ) => void
}

// Owns the one bounded render/frame sequence, not data IO or tab routing.
// Cancellation also releases an awaited frame; no nextTick polling is needed.
export function createMatchNavigation<Request>(options: MatchNavigationOptions<Request>) {
  let sequence = 0
  let frame: number | null = null
  let releaseFrame: (() => void) | null = null
  function cancel() {
    sequence++
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    releaseFrame?.()
    releaseFrame = null
  }
  async function locate(request: Request) {
    cancel()
    const token = sequence
    const current = () => token === sequence && options.current(request)
    await options.rendered()
    if (!current()) return
    const target = options.resolve(request)
    if (target.kind !== 'found') {
      options.settled(request, target.kind)
      await options.rendered()
      if (!current()) return
      const feedback = options.feedback?.()
      feedback?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
      feedback?.focus({ preventScroll: true })
      return
    }
    await new Promise<void>((resolve) => {
      releaseFrame = resolve
      frame = requestAnimationFrame(() => {
        frame = null
        releaseFrame = null
        resolve()
      })
    })
    if (!current()) return
    options.expand(target.game)
    await options.rendered()
    if (!current()) return
    const row = options.row(target.game)
    const button = row?.querySelector<HTMLButtonElement>('button[aria-controls]')
    if (!row?.isConnected || !button) {
      options.settled(request, 'unavailable')
      return
    }
    // Instant for both normal and reduced-motion settings. The native page
    // owns sticky scroll-padding, while the row owns a modest scroll margin.
    row.scrollIntoView({ block: 'start', behavior: 'instant' })
    button.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    button.focus({ preventScroll: true })
    options.settled(request, 'located')
  }
  return { locate, cancel }
}
