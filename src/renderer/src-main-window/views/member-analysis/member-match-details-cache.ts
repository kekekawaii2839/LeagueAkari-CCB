import type {
  MemberAnalysisMatchDetails,
  MemberAnalysisMatchOverview,
  MemberAnalysisResult
} from '@shared/shards/member-analysis'

export type MatchRead<T> =
  { status: 'ready'; value: T } | { status: 'unavailable' | 'error' | 'cancelled'; value: null }
export type MatchLease<T> = {
  promise: Promise<MatchRead<T>>
  settled?: MatchRead<T>
  release: () => void
}
export type MatchDetailsRead = MatchRead<MemberAnalysisMatchDetails>
export type MatchDetailsLease = MatchLease<MemberAnalysisMatchDetails>
type Kind = 'full' | 'overview'
type OverviewRead = MatchRead<MemberAnalysisMatchOverview>
type Lane = {
  refs: number
  pending: boolean
  settled?: OverviewRead
  promise: Promise<OverviewRead>
  resolve: (result: OverviewRead) => void
  listeners: Set<(result: OverviewRead) => void>
}
type Entry = {
  id: number
  generation: number
  running: boolean
  lanes: Partial<Record<Kind, Lane>>
}
type Task = { entry: Entry; kind: Kind; lane: Lane }

const overviewProjections = new WeakMap<MemberAnalysisMatchDetails, MemberAnalysisMatchOverview>()
/** A summary reader never pins a full timeline, even when a full cache hit serves it. */
export function matchOverviewProjection(
  full: MemberAnalysisMatchDetails
): MemberAnalysisMatchOverview {
  let value = overviewProjections.get(full)
  if (!value) {
    value = {
      serverId: full.serverId,
      summary: full.summary,
      ...(full.participantRanks ? { participantRanks: full.participantRanks } : {})
    }
    overviewProjections.set(full, value)
  }
  return value
}

/** One publication-bound LRU and scheduler for both readiness tiers. Full results
 * can serve summaries, but a summary cannot claim a missing/full timeline. */
export class MemberMatchDetailsCache {
  private generation = -1
  private active = 0
  private entries = new Map<number, Entry>()
  private queue: Task[] = []
  private pageOrder = new Map<number, number>()
  private drainScheduled = false

  constructor(
    private readonly read: (
      gameId: number
    ) => Promise<MemberAnalysisResult<MemberAnalysisMatchDetails | null>>,
    private readonly readOverview?: (
      gameId: number
    ) => Promise<MemberAnalysisResult<MemberAnalysisMatchOverview | null>>
  ) {}

  setGeneration(generation: number) {
    if (generation === this.generation) return
    this.generation = generation
    for (const entry of this.entries.values())
      for (const lane of Object.values(entry.lanes)) this.cancel(lane)
    this.entries.clear()
    this.queue = []
    this.pageOrder.clear()
  }

  setPageOrder(ids: readonly number[]) {
    this.pageOrder = new Map(ids.slice(0, 25).map((id, index) => [id, index]))
    this.scheduleDrain()
  }

  acquire(
    generation: number,
    id: number,
    retry = false,
    listener?: (result: MatchDetailsRead) => void
  ): MatchDetailsLease {
    return this.acquireLane<MemberAnalysisMatchDetails>('full', generation, id, retry, listener)
  }

  acquireOverview(
    generation: number,
    id: number,
    retry = false,
    listener?: (result: OverviewRead) => void
  ): MatchLease<MemberAnalysisMatchOverview> {
    return this.acquireLane<MemberAnalysisMatchOverview>(
      'overview',
      generation,
      id,
      retry,
      listener
    )
  }

  private acquireLane<T extends MemberAnalysisMatchOverview>(
    kind: Kind,
    generation: number,
    id: number,
    retry: boolean,
    listener?: (result: MatchRead<T>) => void
  ): MatchLease<T> {
    this.setGeneration(generation)
    let entry = this.entries.get(id)
    let lane = entry?.lanes[kind]
    const full = entry?.lanes.full?.settled
    const fromFull = kind === 'overview' && !retry && full?.status === 'ready'
    if (
      (!lane || (retry && !lane.pending)) &&
      !fromFull &&
      (!Number.isSafeInteger(id) ||
        id <= 0 ||
        (!this.pending(entry) &&
          [...this.entries.values()].filter((item) => this.pending(item)).length >= 25))
    )
      return { promise: Promise.resolve({ status: 'cancelled', value: null }), release() {} }
    if (!entry) {
      entry = { id, generation, running: false, lanes: {} }
      this.entries.set(id, entry)
    } else {
      this.entries.delete(id)
      this.entries.set(id, entry)
    }
    if (!lane) {
      lane = this.newLane()
      entry.lanes[kind] = lane
      if (fromFull)
        this.settle(lane, {
          status: 'ready',
          value: matchOverviewProjection(full.value as MemberAnalysisMatchDetails)
        })
      else this.queue.push({ entry, kind, lane })
    } else if (retry && !lane.pending) {
      this.reset(lane)
      this.queue.push({ entry, kind, lane })
    }
    lane.refs++
    // The private kind selects the only reader allowed to publish this lane.
    // Public full/overview methods expose their respective typed values.
    const deliver = listener ? (value: OverviewRead) => listener(value as MatchRead<T>) : undefined
    if (deliver) lane.listeners.add(deliver)
    const ownedEntry = entry,
      ownedLane = lane
    let released = false
    this.scheduleDrain()
    this.prune()
    return {
      promise: lane.promise as Promise<MatchRead<T>>,
      settled: lane.settled as MatchRead<T> | undefined,
      release: () => {
        if (released) return
        released = true
        ownedLane.refs--
        if (deliver) ownedLane.listeners.delete(deliver)
        if (!ownedLane.refs && ownedLane.pending) {
          this.cancel(ownedLane)
          if (ownedEntry.lanes[kind] === ownedLane) delete ownedEntry.lanes[kind]
          this.queue = this.queue.filter((task) => task.lane !== ownedLane)
          if (!Object.keys(ownedEntry.lanes).length && this.entries.get(id) === ownedEntry)
            this.entries.delete(id)
        }
        this.prune()
      }
    }
  }

  private pending(entry?: Entry) {
    return !!entry && Object.values(entry.lanes).some((lane) => lane.pending)
  }
  private newLane(): Lane {
    const lane = { refs: 0, pending: true, listeners: new Set() } as Lane
    this.reset(lane)
    return lane
  }
  private reset(lane: Lane) {
    lane.pending = true
    lane.settled = undefined
    lane.promise = new Promise((resolve) => {
      lane.resolve = resolve
    })
  }
  private cancel(lane: Lane) {
    if (lane.pending) this.settle(lane, { status: 'cancelled', value: null })
  }
  private settle(lane: Lane, result: OverviewRead) {
    if (lane.pending) lane.resolve(result)
    else lane.promise = Promise.resolve(result)
    lane.pending = false
    lane.settled = result
    for (const listener of lane.listeners) listener(result)
  }
  private prune() {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= 50) break
      if (!Object.values(entry.lanes).some((lane) => lane.refs || lane.pending))
        this.entries.delete(id)
    }
  }
  private scheduleDrain() {
    if (this.drainScheduled) return
    this.drainScheduled = true
    queueMicrotask(() => {
      this.drainScheduled = false
      this.drain()
    })
  }
  private drain() {
    this.queue.sort(
      (a, b) =>
        (this.pageOrder.get(a.entry.id) ?? Number.MAX_SAFE_INTEGER) -
        (this.pageOrder.get(b.entry.id) ?? Number.MAX_SAFE_INTEGER)
    )
    while (this.active < 2) {
      this.queue = this.queue.filter(
        (task) => task.lane.pending && task.lane.refs && task.entry.lanes[task.kind] === task.lane
      )
      const index = this.queue.findIndex(
        (task) =>
          !task.entry.running &&
          // Promote an unstarted summary to a full read when expansion needs it.
          !(
            task.kind === 'overview' &&
            task.entry.lanes.full?.pending &&
            task.entry.lanes.full.refs
          )
      )
      if (index < 0) break
      const task = this.queue.splice(index, 1)[0]
      const { entry, kind, lane } = task
      entry.running = true
      this.active++
      void Promise.resolve()
        .then(() =>
          lane.pending
            ? kind === 'full'
              ? this.read(entry.id)
              : this.readOverview?.(entry.id)
            : null
        )
        .then(
          (result) => {
            if (!lane.pending || entry.generation !== this.generation || entry.lanes[kind] !== lane)
              return
            this.settle(
              lane,
              result?.ok
                ? result.value
                  ? { status: 'ready', value: result.value }
                  : { status: 'unavailable', value: null }
                : { status: 'error', value: null }
            )
            if (kind === 'full' && result?.ok && result.value) {
              const summary = entry.lanes.overview
              if (summary)
                this.settle(summary, {
                  status: 'ready',
                  value: matchOverviewProjection(result.value as MemberAnalysisMatchDetails)
                })
            }
          },
          () => {
            if (lane.pending && entry.generation === this.generation)
              this.settle(lane, { status: 'error', value: null })
          }
        )
        .finally(() => {
          entry.running = false
          this.active--
          this.prune()
          this.scheduleDrain()
        })
    }
  }
}
