import { InteractionAccumulator } from '../../../../shared/shards/member-analysis/champion-pool/interactions'
import type { ChampionPoolMatch } from '../../../../shared/shards/member-analysis/champion-pool/interactions'
import { normalizeRiotMatch } from '../../../../shared/shards/member-analysis/champion-pool/riot-match'
import type { RiotResearchClient } from './riot-client'

type PilotClient = Pick<RiotResearchClient, 'getLeagueEntries' | 'getMatchIds' | 'getMatch'>
export interface RiotPilotOptions {
  patch: string
  maximumDetails: number
  maximumSeeds: number
  minimumDurationSeconds: number
}

/** Small transport/admission smoke test, not a statistically representative sample.
 * Current EUW Diamond-I seed membership does NOT establish historical ranks of
 * all participants. No names or PUUIDs are returned; caller persists only under
 * Electron userData. IO is deliberately not exposed through renderer IPC.
 */
export async function runRiotPilot(
  client: PilotClient,
  options: RiotPilotOptions,
  signal?: AbortSignal
) {
  if (
    !/^\d+\.\d+$/.test(options.patch) ||
    !Number.isSafeInteger(options.maximumDetails) ||
    options.maximumDetails < 1 ||
    options.maximumDetails > 25 ||
    !Number.isSafeInteger(options.maximumSeeds) ||
    options.maximumSeeds < 1 ||
    options.maximumSeeds > 5 ||
    !Number.isFinite(options.minimumDurationSeconds) ||
    options.minimumDurationSeconds < 0
  )
    throw new Error('Invalid bounded pilot plan')
  const scope = {
    patch: options.patch,
    region: 'euw1',
    queueId: 420,
    population: 'current EUW Diamond I seed histories; participant historical ranks unverified'
  }
  const accumulator = new InteractionAccumulator(scope)
  const requests = { league: 0, history: 0, details: 0 }
  const excluded: Record<string, number> = {}
  const uniqueIds = new Set<string>()
  const matches: ChampionPoolMatch[] = []
  const versionsObserved: Record<string, number> = {}
  const checkCancelled = () => {
    if (signal?.aborted) throw new Error('Pilot cancelled')
  }
  checkCancelled()
  const entries = await client.getLeagueEntries(
    'euw1',
    { tier: 'DIAMOND', division: 'I', page: 1 },
    signal
  )
  checkCancelled()
  requests.league++
  const seeds = entries
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return []
      const puuid = (entry as Record<string, unknown>).puuid
      return typeof puuid === 'string' && puuid.trim() ? [puuid] : []
    })
    .slice(0, options.maximumSeeds)
  for (const seed of seeds) {
    if (requests.details >= options.maximumDetails) break
    checkCancelled()
    const ids = await client.getMatchIds(
      'europe',
      seed,
      { start: 0, count: Math.min(100, options.maximumDetails * 2) },
      signal
    )
    checkCancelled()
    requests.history++
    for (const id of ids) {
      if (requests.details >= options.maximumDetails) break
      if (uniqueIds.has(id)) {
        excluded.duplicate = (excluded.duplicate ?? 0) + 1
        continue
      }
      uniqueIds.add(id)
      checkCancelled()
      const payload = await client.getMatch('europe', id, signal)
      checkCancelled()
      requests.details++
      const metadata = payload.metadata
      if (
        metadata &&
        typeof metadata === 'object' &&
        typeof (metadata as Record<string, unknown>).matchId === 'string' &&
        (metadata as Record<string, unknown>).matchId !== id
      ) {
        excluded['identity-mismatch'] = (excluded['identity-mismatch'] ?? 0) + 1
        continue
      }
      const info = payload.info
      if (
        info &&
        typeof info === 'object' &&
        typeof (info as Record<string, unknown>).gameVersion === 'string'
      ) {
        const match = /^(\d+)\.(\d+)(?:\.|$)/.exec(
          String((info as Record<string, unknown>).gameVersion)
        )
        if (match) {
          const patch = `${Number(match[1])}.${Number(match[2])}`
          versionsObserved[patch] = (versionsObserved[patch] ?? 0) + 1
        }
      }
      const result = normalizeRiotMatch(payload, scope, options.minimumDurationSeconds)
      if (result.status === 'excluded') {
        excluded[result.reason] = (excluded[result.reason] ?? 0) + 1
        continue
      }
      const status = accumulator.add(result.match)
      if (status === 'added') matches.push(result.match)
      else excluded[status] = (excluded[status] ?? 0) + 1
    }
  }
  checkCancelled()
  return {
    source: 'riot-match-v5' as const,
    purpose: 'bounded transport and counting validation; not a champion ranking sample' as const,
    scope,
    plan: { ...options },
    requests,
    seedAvailability:
      seeds.length > 0 ? ('available' as const) : ('no-puuid-in-league-response' as const),
    acceptedMatches: matches.length,
    excluded,
    versionsObserved,
    matches,
    interactionCells: accumulator.estimates().length,
    rawBlocks: accumulator.scopedRawBlocks('SUP', 'riot-match-v5')
  }
}
