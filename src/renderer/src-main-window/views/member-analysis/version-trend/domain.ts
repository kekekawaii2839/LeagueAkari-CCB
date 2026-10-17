import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'

import { aggregateConversion, aggregateJungle, aggregateRoles } from '../analytics'
import { eventSections } from '../event-results'
import { memberRoleEvidenceGames } from '../evidence-selection'
import {
  type MetricFormat,
  jungleGroups,
  jungleMeta,
  roleMetricGroups,
  roleMetricMeta
} from '../metric-defs'
import { wilsonInterval } from '../visualization'

type Role = MemberAnalysisPlayerGame['role']
type PlayerField = keyof MemberAnalysisPlayerGame
type Jungle = NonNullable<MemberAnalysisGame['jungle']>
type Event = NonNullable<MemberAnalysisGame['eventDecision']>
export type TrendMetric = {
  key: string
  scope: 'player' | 'jungle' | 'team'
  teamContext: boolean
  label: string
  unit: string
  format: MetricFormat
}
export const trendMetrics: TrendMetric[] = [
  ...[...new Set(Object.values(roleMetricGroups).flatMap((group) => [...group.columns]))].map(
    (key) => ({
      key: `player:${key}`,
      scope: 'player' as const,
      teamContext: ['dragon15', 'grub15', 'objectiveFight15'].includes(key),
      label: roleMetricMeta[key].label,
      unit:
        roleMetricMeta[key].unit ??
        (roleMetricMeta[key].fmt === 'pct'
          ? '%'
          : key === 'kda'
            ? 'ratio'
            : key === 'games' || key.includes('Games')
              ? 'games'
              : key.endsWith('PG')
                ? 'count/game'
                : 'count'),
      format: roleMetricMeta[key].fmt
    })
  ),
  ...[...new Set(Object.values(jungleGroups).flatMap((group) => [...group.columns]))]
    .filter((key) => key !== 'startDistribution')
    .map((key) => ({
      key: `jungle:${key}`,
      scope: 'jungle' as const,
      teamContext: ['dragon15', 'grub15', 'objectiveFight15'].includes(key),
      label: jungleMeta[key].label,
      unit:
        jungleMeta[key].unit ??
        (jungleMeta[key].fmt === 'pct'
          ? '%'
          : key === 'games'
            ? 'games'
            : key === 'firstDragonTime'
              ? 'seconds'
              : 'count/game'),
      format: jungleMeta[key].fmt
    })),
  ...eventSections
    .flatMap((section) => [...section.metrics, ...section.extra])
    .map((metric) => ({
      key: `team:${metric.key}`,
      scope: 'team' as const,
      teamContext: true,
      label: metric.label,
      unit: metric.unit ?? '%',
      format: metric.format ?? 'num'
    }))
]

export type TrendRequest = {
  axis: 'patch' | 'time'
  timeBucket: 'day' | 'week' | 'month'
  memberId: string
  role: Role
  metric: string
  champion: string | null
  side: 'all' | 'Blue' | 'Red'
  outcome: 'all' | 'win' | 'loss'
  patchFrom: string
  patchTo: string
  dateFrom: string
  dateTo: string
  durationMin: number | null
  durationMax: number | null
  includeMemberIds: string[]
  excludeMemberIds: string[]
  completeness: 'all' | 'metric-known'
}
/** Main supplies associations from server-scoped PUUID + teamId, not UI names,
 * roster strings, champions or role guesses. Associations and games must belong
 * to the same published generation. A historical renamed label stays per-game. */
export type TrendIdentity = {
  gameId: number
  members: { memberId: string; player: string }[]
}
export type TrendInput = {
  generation: number
  identitiesGeneration: number
  configuredMemberIds: string[]
  identities: TrendIdentity[]
  games: MemberAnalysisGame[]
}
export type TrendPoint = {
  bucketKey: string
  label: string
  patch: string | null
  patches: string[]
  bucketStartMs: number | null
  bucketEndMs: number | null
  observedFromMs: number | null
  observedToMs: number | null
  value: number | null
  games: number
  validGames: number
  gameIds: number[]
  validGameIds: number[]
  numerator: number | null
  denominator: number | null
  denominatorUnit: 'games' | 'minutes' | 'count' | 'gold' | 'weight' | 'share'
  wins: number
  interval: { low: number; high: number } | null
  connectPrevious: boolean
}
export type TrendResult = {
  generation: number
  requestKey: string
  metric: TrendMetric
  axis: TrendRequest['axis']
  timeBucket: TrendRequest['timeBucket']
  points: TrendPoint[]
  unknownPatchGames: number
  unknownTimestampGames: number
  unresolvedIdentityGames: number
  legacyGames: number
  selectedGames: number
}

export function trendRequestKey(request: TrendRequest) {
  return JSON.stringify({
    ...request,
    includeMemberIds: [...new Set(request.includeMemberIds)].sort(),
    excludeMemberIds: [...new Set(request.excludeMemberIds)].sort()
  })
}

export function parsePatch(value: string): readonly [number, number] | null {
  const match = /^(\d{1,4})\.(\d{1,4})(?:\.\d+)*$/.exec(value)
  return match ? [Number(match[1]), Number(match[2])] : null
}
export function comparePatch(left: string, right: string) {
  const a = parsePatch(left),
    b = parsePatch(right)
  if (!a || !b) throw new Error('invalid-patch')
  return a[0] - b[0] || a[1] - b[1]
}
export type TimeBucket = { key: string; startMs: number; endMs: number }
/** All boundaries are UTC. Week starts Monday. These are bin boundaries, not
 * fabricated match observations. timestamp=0 is the existing missing sentinel. */
export function utcTimeBucket(
  timestamp: number,
  grain: TrendRequest['timeBucket']
): TimeBucket | null {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > 8640000000000000)
    return null
  const date = new Date(timestamp)
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  let startMs = day,
    endMs = day + 86400000
  if (grain === 'week') {
    startMs = day - ((date.getUTCDay() + 6) % 7) * 86400000
    endMs = startMs + 7 * 86400000
  } else if (grain === 'month') {
    startMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
    endMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)
  }
  if (!Number.isFinite(endMs) || endMs > 8640000000000000) return null
  return {
    key: new Date(startMs).toISOString().slice(0, grain === 'month' ? 7 : 10),
    startMs,
    endMs
  }
}
const number = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const total = (values: number[]) => values.reduce((sum, value) => sum + value, 0)
const playerExposure: Record<string, PlayerField> = {
  dpm: 'damage',
  gpm: 'gold',
  cspm: 'cs',
  vspm: 'vision',
  wpm: 'wardsPlaced',
  wcpm: 'wardsKilled',
  cwpm: 'controlWards',
  damageTakenPM: 'damageTaken',
  mitigatedPM: 'damageMitigated',
  objectiveDamagePM: 'objectiveDamage',
  turretDamagePM: 'turretDamage',
  healPM: 'healTeammates',
  shieldPM: 'shieldTeammates',
  ccPM: 'ccSeconds'
}
const jungleFields: Record<string, keyof Jungle> = {
  level3GankRate: 'level3Gank',
  level4GankRate: 'level4Gank',
  topGanksPG: 'topGanks',
  midGanksPG: 'midGanks',
  botGanksPG: 'botGanks',
  firstDragonRate: 'gotFirstDragon',
  firstDragonTime: 'firstDragonTimeSec',
  dragonsPG: 'dragons',
  soloDragonsPG: 'soloDragons',
  voidgrubsPG: 'voidgrubs',
  heraldsPG: 'heralds',
  baronsPG: 'barons'
}
const camps: Record<string, string> = {
  redStartRate: 'red',
  blueStartRate: 'blue',
  grompStartRate: 'gromp',
  raptorsStartRate: 'raptors',
  wolvesStartRate: 'wolves',
  krugsStartRate: 'krugs'
}

function metricKnown(game: MemberAnalysisGame, request: TrendRequest, player: string) {
  const [scope, key] = request.metric.split(':')
  if (scope === 'team') return game.eventDecision !== null
  if (scope === 'jungle') {
    const jungle = game.jungle
    if (request.role !== 'JUNGLE' || !jungle || jungle.player !== player) return false
    if (key in camps) return jungle.startCamp !== null
    if (key === 'ownStartRate' || key === 'invadeStartRate')
      return jungle.startCamp !== null && jungle.startCampOwn !== null
    if (key in jungleFields) return jungle[jungleFields[key]] !== null
    if (key.endsWith('ZoneRate')) {
      const field = `${key.slice(0, -4)}Weight` as keyof Jungle
      return number(jungle[field]) && number(jungle.totalZoneWeight)
    }
  }
  if (key.startsWith('laneGank'))
    return request.role !== 'JUNGLE' && game.laneGankDeaths?.status === 'available'
  return (
    memberRoleEvidenceGames([game], {
      player,
      role: request.role,
      metric: key as Parameters<typeof memberRoleEvidenceGames>[1]['metric']
    }).length > 0
  )
}

/** Reuses the existing aggregate value. This only records its support/exposure;
 * it never replaces weighted aggregate ratios with mean single-game vectors. */
function aggregatePoint(
  games: MemberAnalysisGame[],
  request: TrendRequest,
  bucketKey: string
): TrendPoint {
  const [scope, key] = request.metric.split(':')
  // Identity labels were normalized only within this private, immutable subset.
  const player = request.memberId
  const valid = games.filter((game) => metricKnown(game, request, player))
  const rows = valid.map((game) =>
    game.players.find((row) => row.player === player && row.role === request.role)!
  )
  const aggregate =
    scope === 'team'
      ? aggregateConversion(games)[0]
      : scope === 'jungle'
        ? aggregateJungle(games, 'all', player)[0]
        : aggregateRoles(games, request.role, player)[0]
  const raw = aggregate ? (aggregate as unknown as Record<string, unknown>)[key] : null
  const value = number(raw) && valid.length > 0 ? raw : null
  let denominator: number | null = valid.length || null
  let denominatorUnit: TrendPoint['denominatorUnit'] = 'games'
  let numerator: number | null = value === null || denominator === null ? null : value * denominator
  if (key in playerExposure && scope !== 'team') {
    denominator = total(rows.map((row) => row.minutes))
    denominatorUnit = 'minutes'
    numerator = total(rows.map((row) => row[playerExposure[key]] as number))
  } else if (
    scope === 'player' &&
    ['kda', 'killShare', 'deathShare', 'damagePerGold', 'damageConversion'].includes(key)
  ) {
    const denominatorField: PlayerField =
      key === 'kda'
        ? 'deaths'
        : key === 'killShare'
          ? 'teamKills'
          : key === 'deathShare'
            ? 'teamDeaths'
            : key === 'damagePerGold'
              ? 'gold'
              : 'goldShare'
    denominator = valid.length ? total(rows.map((row) => row[denominatorField] as number)) : null
    if (key === 'kda' && denominator !== null) denominator = Math.max(1, denominator)
    denominatorUnit =
      key === 'damagePerGold' ? 'gold' : key === 'damageConversion' ? 'share' : 'count'
    numerator = value === null || denominator === null ? null : value * denominator
  } else if (scope === 'jungle' && key.endsWith('ZoneRate')) {
    denominator = valid.length ? total(valid.map((game) => game.jungle!.totalZoneWeight!)) : null
    denominatorUnit = 'weight'
    numerator = value === null || denominator === null ? null : value * denominator
  } else if (scope === 'team') {
    const definition = eventSections
      .flatMap((section) => [...section.metrics, ...section.extra])
      .find((metric) => metric.key === key)!
    const sum = (field: keyof Event) =>
      valid.length ? total(valid.map((game) => game.eventDecision![field])) : null
    if (definition.counts) {
      numerator = sum(definition.counts[0])
      denominator = sum(definition.counts[1])
      denominatorUnit = 'count'
    } else if (definition.samples) {
      numerator = sum(definition.fields[0])
      denominator = sum(definition.samples)
      denominatorUnit = 'count'
    } else {
      numerator = sum(definition.fields[0])
      if (key === 'objectivesTaken' || key === 'enemyObjectives') denominator = null
    }
  } else if (
    key === 'games' ||
    key === 'laneGankEligibleGames' ||
    key === 'laneGankDeaths' ||
    key === 'laneGankAffectedGames' ||
    (key.startsWith('laneGank') && key !== 'laneGankDeathsPG' && key !== 'laneGankAffectedRate')
  ) {
    numerator = value
    denominator = null
  }
  const wins = games.filter((game) => game.win).length
  const bucket =
    request.axis === 'time' ? utcTimeBucket(games[0].timestamp, request.timeBucket) : null
  const timestamps = games
    .map((game) => game.timestamp)
    .filter((timestamp) => utcTimeBucket(timestamp, 'day') !== null)
  const patches = [
    ...new Set(
      games.map((game) => {
        const patch = parsePatch(game.patch)!
        return `${patch[0]}.${patch[1]}`
      })
    )
  ].sort(comparePatch)
  return {
    bucketKey,
    label: bucketKey,
    patch: request.axis === 'patch' ? bucketKey : null,
    patches,
    bucketStartMs: bucket?.startMs ?? null,
    bucketEndMs: bucket?.endMs ?? null,
    observedFromMs: timestamps.length ? Math.min(...timestamps) : null,
    observedToMs: timestamps.length ? Math.max(...timestamps) : null,
    value,
    games: games.length,
    validGames: valid.length,
    gameIds: games.map((game) => game.gameId),
    validGameIds: valid.map((game) => game.gameId),
    numerator,
    denominator,
    denominatorUnit,
    wins,
    interval: key === 'winRate' && games.length ? wilsonInterval(wins, games.length) : null,
    connectPrevious: false
  }
}

export function buildVersionTrend(input: TrendInput, request: TrendRequest): TrendResult {
  const metric = trendMetrics.find((entry) => entry.key === request.metric)
  const configured = new Set(input.configuredMemberIds)
  const included = new Set([request.memberId, ...request.includeMemberIds])
  const excluded = new Set(request.excludeMemberIds)
  if (
    !metric ||
    !configured.has(request.memberId) ||
    !['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(request.role) ||
    [...included, ...excluded].some((id) => !configured.has(id)) ||
    [...included].some((id) => excluded.has(id))
  )
    throw new Error('invalid-selection')
  if (
    !['all', 'Blue', 'Red'].includes(request.side) ||
    !['all', 'win', 'loss'].includes(request.outcome) ||
    !['all', 'metric-known'].includes(request.completeness)
  )
    throw new Error('invalid-filter')
  if (
    !['patch', 'time'].includes(request.axis) ||
    !['day', 'week', 'month'].includes(request.timeBucket)
  )
    throw new Error('invalid-axis')
  if (input.generation !== input.identitiesGeneration) throw new Error('stale-identities')
  if (
    (request.patchFrom && !parsePatch(request.patchFrom)) ||
    (request.patchTo && !parsePatch(request.patchTo)) ||
    (request.patchFrom && request.patchTo && comparePatch(request.patchFrom, request.patchTo) > 0)
  )
    throw new Error('invalid-patch-range')
  if (
    [request.durationMin, request.durationMax].some(
      (value) => value !== null && (!number(value) || value < 0 || value > 180)
    ) ||
    (request.durationMin !== null &&
      request.durationMax !== null &&
      request.durationMin > request.durationMax)
  )
    throw new Error('invalid-duration-range')
  if (
    (request.dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(request.dateFrom)) ||
    (request.dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(request.dateTo)) ||
    (request.dateFrom && request.dateTo && request.dateFrom > request.dateTo)
  )
    throw new Error('invalid-date-range')
  const identities = new Map(input.identities.map((identity) => [identity.gameId, identity]))
  // Identity messages must remain unique. Repeated game IDs, however, can be
  // legitimate cross-region collisions in the published overview: exclude every
  // row sharing that ID rather than discarding unrelated reliable observations.
  if (identities.size !== input.identities.length) throw new Error('ambiguous-game')
  const gameCounts = new Map<number, number>()
  for (const game of input.games)
    gameCounts.set(game.gameId, (gameCounts.get(game.gameId) ?? 0) + 1)
  const buckets = new Map<string, MemberAnalysisGame[]>()
  let unknownPatchGames = 0,
    unknownTimestampGames = 0,
    unresolvedIdentityGames = 0,
    legacyGames = 0,
    selectedGames = 0
  for (const game of input.games) {
    if (game.duration < 900) continue
    if ((gameCounts.get(game.gameId) ?? 0) > 1) {
      unresolvedIdentityGames++
      continue
    }
    const identity = identities.get(game.gameId)
    if (
      !identity ||
      new Set(identity.members.map((member) => member.memberId)).size !== identity.members.length ||
      new Set(identity.members.map((member) => member.player)).size !== identity.members.length ||
      identity.members.some(
        (member) =>
          !configured.has(member.memberId) ||
          game.players.filter((row) => row.player === member.player).length !== 1
      )
    ) {
      unresolvedIdentityGames++
      continue
    }
    const membership = new Set(identity.members.map((member) => member.memberId))
    if (
      [...included].some((id) => !membership.has(id)) ||
      [...excluded].some((id) => membership.has(id))
    )
      continue
    const subject = identity.members.find((member) => member.memberId === request.memberId)!
    const matches = game.players.filter((row) => row.player === subject.player)
    if (matches.length !== 1) {
      unresolvedIdentityGames++
      continue
    }
    const row = matches[0]
    if (
      row.role !== request.role ||
      (request.champion !== null && row.champion !== request.champion) ||
      (request.side !== 'all' && game.side !== request.side) ||
      (request.outcome !== 'all' && game.win !== (request.outcome === 'win')) ||
      (request.dateFrom && game.date < request.dateFrom) ||
      (request.dateTo && game.date > request.dateTo) ||
      (request.durationMin !== null && game.duration < request.durationMin * 60) ||
      (request.durationMax !== null && game.duration > request.durationMax * 60)
    )
      continue
    // Legacy-unknown values cannot be pooled into current-v5 denominators.
    if (game.metricSemantics !== 'current-v5') {
      legacyGames++
      continue
    }
    const patch = parsePatch(game.patch)
    if (!patch) {
      unknownPatchGames++
      continue
    }
    const key = `${patch[0]}.${patch[1]}`
    if (
      (request.patchFrom && comparePatch(key, request.patchFrom) < 0) ||
      (request.patchTo && comparePatch(key, request.patchTo) > 0)
    )
      continue
    const normalized = {
      ...game,
      players: [{ ...row, player: request.memberId }],
      jungle:
        game.jungle?.player === subject.player
          ? { ...game.jungle, player: request.memberId }
          : null,
      laneGankDeaths:
        game.laneGankDeaths?.status === 'available'
          ? {
              ...game.laneGankDeaths,
              events: game.laneGankDeaths.events
                .filter((event) => event.victimPlayer === subject.player)
                .map((event) => ({ ...event, victimPlayer: request.memberId }))
            }
          : game.laneGankDeaths
    }
    if (
      request.completeness === 'metric-known' &&
      !metricKnown(normalized, request, request.memberId)
    )
      continue
    const time = utcTimeBucket(game.timestamp, request.timeBucket)
    if (!time) {
      unknownTimestampGames++
      if (request.axis === 'time') continue
    }
    selectedGames++
    const bucketKey = request.axis === 'time' ? time!.key : key
    const existing = buckets.get(bucketKey)
    if (existing) existing.push(normalized)
    else buckets.set(bucketKey, [normalized])
  }
  const points = [...buckets]
    .sort(([a], [b]) => (request.axis === 'patch' ? comparePatch(a, b) : a.localeCompare(b)))
    .map(([key, games]) => aggregatePoint(games, request, key))
  points.forEach((point, index) => {
    const previous = points[index - 1]
    if (!previous || point.value === null || previous.value === null) return
    if (request.axis === 'time') {
      point.connectPrevious = previous.bucketEndMs === point.bucketStartMs
    } else {
      const a = parsePatch(previous.patch!)!,
        b = parsePatch(point.patch!)!
      point.connectPrevious = a[0] === b[0] && b[1] === a[1] + 1
    }
  })
  return {
    generation: input.generation,
    requestKey: trendRequestKey(request),
    metric,
    axis: request.axis,
    timeBucket: request.timeBucket,
    points,
    unknownPatchGames,
    unknownTimestampGames,
    unresolvedIdentityGames,
    legacyGames,
    selectedGames
  }
}
