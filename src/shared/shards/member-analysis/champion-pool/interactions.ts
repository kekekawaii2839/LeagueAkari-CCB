import { expectedPairWinRate } from '../blindability'
import {
  DRAFT_ROLES,
  type DraftRole,
  type InteractionBlock,
  type InteractionMode,
  type ScopedInteractionBlock
} from './scoring'

export interface MatchParticipant {
  champion: string
  role: DraftRole
  team: 100 | 200
  win: boolean
}
export interface ChampionPoolMatch {
  matchId: string
  patch: string
  region: string
  queueId: number
  population: string // caller-verified rank/population, not inferred from match-v5
  participants: MatchParticipant[]
}
export interface InteractionPopulation {
  patch: string
  region: string
  queueId: number
  population: string
}
interface Counts {
  games: number
  wins: number
}
export interface InteractionEstimate extends Counts {
  mode: InteractionMode
  ownRole: DraftRole
  otherRole: DraftRole
  champion: string
  target: string
  observedWinRate: number
  expectedWinRate: number | null
  deltaPp: number | null
}
const slot = (p: Pick<MatchParticipant, 'champion' | 'role'>) =>
  JSON.stringify([p.role, p.champion])

/** In-memory only. IO/credentials must remain in main; player data must stay in userData.
 * Does not pool patches, infer ranks, treat remakes as full matches, or fill absent pairs.
 */
export class InteractionAccumulator {
  readonly scope: Readonly<InteractionPopulation>
  private readonly _seen = new Set<string>()
  private readonly _champions = new Map<string, Counts & { champion: string; role: DraftRole }>()
  private readonly _pairs = new Map<
    string,
    Counts & {
      mode: InteractionMode
      ownRole: DraftRole
      otherRole: DraftRole
      champion: string
      target: string
    }
  >()
  constructor(scope: InteractionPopulation) {
    if (
      !/^\d+\.\d+$/.test(scope.patch) ||
      !scope.region.trim() ||
      !scope.population.trim() ||
      !Number.isSafeInteger(scope.queueId)
    )
      throw new Error('Explicit sampling scope required')
    this.scope = Object.freeze({ ...scope })
  }

  add(match: ChampionPoolMatch): 'added' | 'duplicate' | 'outside-scope' {
    if (
      match.patch !== this.scope.patch ||
      match.region !== this.scope.region ||
      match.queueId !== this.scope.queueId ||
      match.population !== this.scope.population
    )
      return 'outside-scope'
    if (this._seen.has(match.matchId)) return 'duplicate'
    const p = match.participants
    if (
      !match.matchId ||
      p.length !== 10 ||
      new Set(p.map((x) => `${x.team}:${x.role}`)).size !== 10 ||
      new Set(p.map((x) => x.champion)).size !== 10 ||
      p.some(
        (x) =>
          !x.champion ||
          !DRAFT_ROLES.includes(x.role) ||
          (x.team !== 100 && x.team !== 200) ||
          typeof x.win !== 'boolean'
      ) ||
      DRAFT_ROLES.some((role) => p.filter((x) => x.role === role).length !== 2) ||
      p.some((x) => x.win !== p.find((y) => y.team === x.team)!.win) ||
      p.find((x) => x.team === 100)!.win === p.find((x) => x.team === 200)!.win
    )
      throw new Error('Invalid complete ranked match')
    // Validate before mutating: an invalid match must not poison deduplication/counts.
    this._seen.add(match.matchId)
    for (const own of p) {
      const key = slot(own)
      const count = this._champions.get(key) ?? {
        champion: own.champion,
        role: own.role,
        games: 0,
        wins: 0
      }
      count.games++
      count.wins += Number(own.win)
      this._champions.set(key, count)
      for (const other of p) {
        if (own === other) continue
        const mode = own.team === other.team ? 'synergy' : 'matchup'
        const pairKey = JSON.stringify([mode, slot(own), slot(other)])
        const pair = this._pairs.get(pairKey) ?? {
          mode,
          ownRole: own.role,
          otherRole: other.role,
          champion: own.champion,
          target: other.champion,
          games: 0,
          wins: 0
        }
        pair.games++
        pair.wins += Number(own.win)
        this._pairs.set(pairKey, pair)
      }
    }
    return 'added'
  }

  get matchCount() {
    return this._seen.size
  }

  estimates(): InteractionEstimate[] {
    return [...this._pairs.values()].map((pair) => {
      const a = this._champions.get(JSON.stringify([pair.ownRole, pair.champion]))!
      const b = this._champions.get(JSON.stringify([pair.otherRole, pair.target]))!
      const rateA = a.wins / a.games
      const rateB = b.wins / b.games
      // No invented prior at 0/100%: baseline is unavailable until estimable.
      const expectedWinRate =
        rateA > 0 && rateA < 1 && rateB > 0 && rateB < 1
          ? expectedPairWinRate(rateA, rateB, pair.mode)
          : null
      const observedWinRate = pair.wins / pair.games
      return {
        ...pair,
        expectedWinRate,
        observedWinRate,
        deltaPp: expectedWinRate === null ? null : 100 * (observedWinRate - expectedWinRate)
      }
    })
  }

  /** Alpha=0 is reproducible from counts; shrunk values are deliberately NOT invented.
   * A source-verified shrinkage estimator must be added before using alpha>0.
   */
  rawBlocks(ownRole: DraftRole): InteractionBlock[] {
    const estimates = this.estimates()
    const champions = [...this._champions.values()]
      .filter((c) => c.role === ownRole)
      .map((c) => c.champion)
      .sort()
    return (['matchup', 'synergy'] as const).flatMap((mode) =>
      DRAFT_ROLES.flatMap((otherRole) => {
        if (mode === 'synergy' && ownRole === otherRole) return []
        const population = [...this._champions.values()]
          .filter((c) => c.role === otherRole)
          .sort((a, b) => a.champion.localeCompare(b.champion))
        const denominator = population.reduce((sum, c) => sum + c.games, 0)
        const lookup = new Map(
          estimates
            .filter((e) => e.mode === mode && e.ownRole === ownRole && e.otherRole === otherRole)
            .map((e) => [JSON.stringify([e.champion, e.target]), e.deltaPp])
        )
        return [
          {
            mode,
            ownRole,
            otherRole,
            champions: [...champions],
            championPickRates: champions.map(
              (champion) =>
                this._champions.get(JSON.stringify([ownRole, champion]))!.games /
                (2 * this.matchCount)
            ),
            targets: population.map((c) => c.champion),
            targetPickRates: population.map((c) => c.games / denominator),
            rawPp: champions.map((c) =>
              population.map((p) => lookup.get(JSON.stringify([c, p.champion])) ?? null)
            ),
            shrunkPp: champions.map(() => population.map(() => null))
          }
        ]
      })
    )
  }

  scopedRawBlocks(ownRole: DraftRole, source: string): ScopedInteractionBlock[] {
    return this.rawBlocks(ownRole).map((block) => ({
      ...block,
      scope: {
        source,
        interactionPatch: this.scope.patch,
        playRatePatch: this.scope.patch,
        region: this.scope.region,
        queueId: this.scope.queueId,
        population: this.scope.population
      }
    }))
  }
}
