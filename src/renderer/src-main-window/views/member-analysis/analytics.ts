import type {
  MemberAnalysisFilters,
  MemberAnalysisGame,
  MemberAnalysisLaneGankDeathEvent,
  MemberAnalysisPlayerGame
} from '@shared/shards/member-analysis'

export type SideLabel = '总计' | '蓝方' | '红方'
export type RoleAggregate = {
  player: string
  role: MemberAnalysisPlayerGame['role']
  sideLabel?: SideLabel
  games: number
  wins: number
  winRate: number
  kda: number
  kp: number | null
  killsPG: number
  deathsPG: number
  assistsPG: number
  killShare: number | null
  deathShare: number | null
  dpm: number | null
  damageShare: number | null
  gpm: number | null
  goldShare: number | null
  damageConversion: number | null
  damagePerGold: number | null
  cspm: number | null
  vspm: number | null
  wpm: number | null
  wcpm: number | null
  cwpm: number | null
  takenShare: number | null
  damageTakenPM: number | null
  mitigatedPM: number | null
  objectiveDamagePM: number | null
  turretDamagePM: number | null
  healPM: number | null
  shieldPM: number | null
  ccPM: number | null
  soloKillsPG: number
  fbRate: number
  ftRate: number
  gd10: number | null
  gd15: number | null
  csd15: number | null
  xpd15: number | null
  damageDiff15: number | null
  soloDiff15: number | null
  counter: number | null
  dragon15: number
  grub15: number
  objectiveFight15: number
  laneGankEligibleGames: number | null
  laneGankDeaths: number | null
  laneGankDeathsPG: number | null
  laneGankBefore3: number | null
  laneGankMinute3: number | null
  laneGankMinute4: number | null
  laneGankMinute5To10: number | null
  laneGankMinute10To14: number | null
  laneGankAffectedGames: number | null
  laneGankAffectedRate: number | null
  champions: string
}
export type ChampionAggregate = {
  player: string
  role: MemberAnalysisPlayerGame['role']
  champion: string
  games: number
  wins: number
  winRate: number
  pickRate: number
  blueGames: number
  blueWins: number
  redGames: number
  redWins: number
  performance: RoleAggregate
}
export type PairAggregate = {
  pairType: 'upper_pair' | 'mid_jg_pair' | 'bot_pair'
  pair: string
  sideLabel: SideLabel
  games: number
  wins: number
  winRate: number
  counterMean: number | null
  upperGold15: number
  botGold15: number
  dragon15Diff: number
  grub15Diff: number
  objectiveFight15Diff: number
  gold20Diff: number
  tower20Diff: number
}
export type JungleAggregate = Record<string, number | string | null> & {
  player: string
  sideLabel: SideLabel
  games: number
  wins: number
  winRate: number
  startDistribution: string
}
export type ConversionAggregate = {
  sideLabel: SideLabel
  games: number
  wins: number
  winRate: number
  killEpisodes: number
  convertedKillEpisodes: number
  killToEpicEpisodes: number
  killToTowerEpisodes: number
  killConversionRate: number | null
  killToEpicRate: number | null
  killToTowerRate: number | null
  conversionDelaySec: number | null
  deathEpisodes: number
  highCostDeathEpisodes: number
  highCostDeathRate: number | null
  deathCostPointsPG: number
  deathCostEpicsPG: number
  deathCostTowersPG: number
  shutdownBountyLostPG: number
  objectivesTaken: number
  cleanObjectives: number
  cleanObjectiveRate: number | null
  objectiveFightSamples: number
  objectiveFightWins: number
  objectiveFightWinRate: number | null
  enemyObjectives: number
  tradedEnemyObjectives: number
  crossMapTradeRate: number | null
  tradeDelaySec: number | null
}
export type EarlyBucket = { label: string; games: number; wins: number; winRate: number | null }
export type SynergyAggregate = {
  key: string
  playerA: string
  playerB: string
  games: number
  wins: number
  winRate: number
  baseline: number
  observedDifference: number
  shrinkageWeight: number
  adjustedDifference: number
  gamesList: MemberAnalysisGame[]
}

const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
const ratio = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : 0
const ratioNullable = (numerator: number, denominator: number) =>
  denominator ? numerator / denominator : null
const average = (values: (number | null | undefined)[]) => {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  return valid.length ? sum(valid) / valid.length : 0
}
const averageNullable = (values: (number | null | undefined)[]) => {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  )
  return valid.length ? sum(valid) / valid.length : null
}

export type MemberLaneGankDeathEvidence = MemberAnalysisLaneGankDeathEvent & {
  gameId: number
  date: string
  side: MemberAnalysisGame['side']
}

export function laneGankDeathEvidence(
  games: MemberAnalysisGame[],
  player: string,
  role: MemberAnalysisPlayerGame['role']
): MemberLaneGankDeathEvidence[] {
  if (role === 'JUNGLE') return []
  return games
    .flatMap((game) =>
      game.laneGankDeaths?.status === 'available'
        ? game.laneGankDeaths.events
            .filter((event) => event.victimPlayer === player && event.victimRole === role)
            .map((event) => ({ ...event, gameId: game.gameId, date: game.date, side: game.side }))
        : []
    )
    .sort(
      (left, right) => right.date.localeCompare(left.date) || left.timestampSec - right.timestampSec
    )
}

export function filterMemberAnalysisGames(
  games: MemberAnalysisGame[],
  filters: MemberAnalysisFilters
) {
  const query = filters.query.toLocaleLowerCase('zh-CN')
  return games.filter((game) => {
    if (filters.outcome === 'win' && !game.win) return false
    if (filters.outcome === 'loss' && game.win) return false
    if (filters.patch !== 'all' && game.patch !== filters.patch) return false
    if (filters.dateFrom && game.date < filters.dateFrom) return false
    if (filters.dateTo && game.date > filters.dateTo) return false
    const duration = game.duration / 60
    if (filters.durationMin !== null && duration < filters.durationMin) return false
    if (filters.durationMax !== null && duration > filters.durationMax) return false
    if (
      (filters.participant !== 'all' ||
        filters.matchRole !== 'all' ||
        filters.champion !== 'all') &&
      !game.players.some(
        (row) =>
          (filters.participant === 'all' || row.player === filters.participant) &&
          (filters.matchRole === 'all' || row.role === filters.matchRole) &&
          (filters.champion === 'all' || row.champion === filters.champion)
      )
    )
      return false
    if (!query) return true
    return [
      game.gameId,
      game.roster,
      ...game.players.flatMap((row) => [row.player, row.player.split('#')[0], row.champion])
    ]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
      .includes(query)
  })
}

export function selectMemberAnalysisSample(
  games: MemberAnalysisGame[],
  filters: MemberAnalysisFilters,
  side: 'all' | 'Blue' | 'Red',
  sampleSize: 20 | 50 | 100 | 'all'
) {
  const globallyFiltered = filterMemberAnalysisGames(games, filters)
    .filter((game) => side === 'all' || game.side === side)
    .sort((left, right) => right.timestamp - left.timestamp || right.gameId - left.gameId)
  return {
    globallyFiltered,
    sample: sampleSize === 'all' ? globallyFiltered : globallyFiltered.slice(0, sampleSize)
  }
}

export function aggregateRoles(
  games: MemberAnalysisGame[],
  role = 'all',
  player = 'all'
): RoleAggregate[] {
  const groups = new Map<
    string,
    { games: MemberAnalysisGame[]; rows: MemberAnalysisPlayerGame[] }
  >()
  for (const game of games)
    for (const row of game.players) {
      if (role !== 'all' && row.role !== role) continue
      if (player !== 'all' && row.player !== player) continue
      const key = `${row.role}|${row.player}`
      const group = groups.get(key) ?? { games: [], rows: [] }
      group.games.push(game)
      group.rows.push(row)
      groups.set(key, group)
    }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [groupRole, groupPlayer] = key.split('|') as [MemberAnalysisPlayerGame['role'], string]
      const r = group.rows
      const g = group.games
      const minutes = sum(r.map((x) => x.minutes))
      const kills = sum(r.map((x) => x.kills))
      const deaths = sum(r.map((x) => x.deaths))
      const assists = sum(r.map((x) => x.assists))
      const damageShare = averageNullable(r.map((x) => x.damageShare))
      const goldShare = averageNullable(r.map((x) => x.goldShare))
      const eligibleLaneGankGames =
        groupRole === 'JUNGLE'
          ? []
          : g.filter((game) => game.laneGankDeaths?.status === 'available')
      const laneGankEvents = laneGankDeathEvidence(eligibleLaneGankGames, groupPlayer, groupRole)
      const laneGankCount = (from: number, to: number) =>
        laneGankEvents.filter((event) => event.timestampSec >= from && event.timestampSec < to)
          .length
      const laneGankAffectedGames = new Set(laneGankEvents.map((event) => event.gameId)).size
      const laneGankAvailable = groupRole !== 'JUNGLE' && eligibleLaneGankGames.length > 0
      const champions = new Map<string, { games: number; wins: number }>()
      r.forEach((x, index) => {
        const stats = champions.get(x.champion) ?? { games: 0, wins: 0 }
        stats.games += 1
        stats.wins += Number(g[index]?.win)
        champions.set(x.champion, stats)
      })
      return {
        player: groupPlayer,
        role: groupRole,
        games: r.length,
        wins: g.filter((x) => x.win).length,
        winRate: ratio(g.filter((x) => x.win).length, r.length),
        kda: ratio(kills + assists, Math.max(1, deaths)),
        kp: averageNullable(r.map((x) => x.kp)),
        killsPG: ratio(kills, r.length),
        deathsPG: ratio(deaths, r.length),
        assistsPG: ratio(assists, r.length),
        killShare: ratioNullable(kills, sum(r.map((x) => x.teamKills))),
        deathShare: ratioNullable(deaths, sum(r.map((x) => x.teamDeaths))),
        dpm: ratioNullable(sum(r.map((x) => x.damage)), minutes),
        damageShare,
        gpm: ratioNullable(sum(r.map((x) => x.gold)), minutes),
        goldShare,
        damageConversion:
          damageShare === null || goldShare === null ? null : ratioNullable(damageShare, goldShare),
        damagePerGold: ratioNullable(sum(r.map((x) => x.damage)), sum(r.map((x) => x.gold))),
        cspm: ratioNullable(sum(r.map((x) => x.cs)), minutes),
        vspm: ratioNullable(sum(r.map((x) => x.vision)), minutes),
        wpm: ratioNullable(sum(r.map((x) => x.wardsPlaced)), minutes),
        wcpm: ratioNullable(sum(r.map((x) => x.wardsKilled)), minutes),
        cwpm: ratioNullable(sum(r.map((x) => x.controlWards)), minutes),
        takenShare: averageNullable(r.map((x) => x.takenShare)),
        damageTakenPM: ratioNullable(sum(r.map((x) => x.damageTaken)), minutes),
        mitigatedPM: ratioNullable(sum(r.map((x) => x.damageMitigated)), minutes),
        objectiveDamagePM: ratioNullable(sum(r.map((x) => x.objectiveDamage)), minutes),
        turretDamagePM: ratioNullable(sum(r.map((x) => x.turretDamage)), minutes),
        healPM: ratioNullable(sum(r.map((x) => x.healTeammates)), minutes),
        shieldPM: ratioNullable(sum(r.map((x) => x.shieldTeammates)), minutes),
        ccPM: ratioNullable(sum(r.map((x) => x.ccSeconds)), minutes),
        soloKillsPG: ratio(sum(r.map((x) => x.soloKills)), r.length),
        fbRate: ratio(r.filter((x) => x.fbPart).length, r.length),
        ftRate: ratio(r.filter((x) => x.ftPart).length, r.length),
        gd10: averageNullable(r.map((x) => x.gd10)),
        gd15: averageNullable(r.map((x) => x.gd15)),
        csd15: averageNullable(r.map((x) => x.csd15)),
        xpd15: averageNullable(r.map((x) => x.xpd15)),
        damageDiff15: averageNullable(r.map((x) => x.damageDiff15)),
        soloDiff15: averageNullable(r.map((x) => x.soloDiff15)),
        counter: averageNullable(r.map((x) => x.counter)),
        dragon15: average(g.map((x) => x.dragon15Diff)),
        grub15: average(g.map((x) => x.grub15Diff)),
        objectiveFight15: average(g.map((x) => x.objectiveFight15Diff)),
        laneGankEligibleGames: laneGankAvailable ? eligibleLaneGankGames.length : null,
        laneGankDeaths: laneGankAvailable ? laneGankEvents.length : null,
        laneGankDeathsPG: laneGankAvailable
          ? ratioNullable(laneGankEvents.length, eligibleLaneGankGames.length)
          : null,
        laneGankBefore3: laneGankAvailable ? laneGankCount(0, 3 * 60) : null,
        laneGankMinute3: laneGankAvailable ? laneGankCount(3 * 60, 4 * 60) : null,
        laneGankMinute4: laneGankAvailable ? laneGankCount(4 * 60, 5 * 60) : null,
        laneGankMinute5To10: laneGankAvailable ? laneGankCount(5 * 60, 10 * 60) : null,
        laneGankMinute10To14: laneGankAvailable ? laneGankCount(10 * 60, 14 * 60) : null,
        laneGankAffectedGames: laneGankAvailable ? laneGankAffectedGames : null,
        laneGankAffectedRate: laneGankAvailable
          ? ratioNullable(laneGankAffectedGames, eligibleLaneGankGames.length)
          : null,
        champions: [...champions.entries()]
          .sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins)
          .map(
            ([name, stats]) =>
              `${name} · ${stats.games}场 · ${(ratio(stats.wins, stats.games) * 100).toFixed(1)}%`
          )
          .join(' / ')
      }
    })
    .sort(
      (a, b) =>
        roles.indexOf(a.role) - roles.indexOf(b.role) || a.player.localeCompare(b.player, 'zh-CN')
    )
}

export function aggregateRolesBySide(
  games: MemberAnalysisGame[],
  side: 'all' | 'Blue' | 'Red',
  role = 'all',
  player = 'all',
  breakdown = true
): RoleAggregate[] {
  if (side !== 'all' || !breakdown)
    return aggregateRoles(
      side === 'all' ? games : games.filter((g) => g.side === side),
      role,
      player
    ).map((row) => ({
      ...row,
      sideLabel: side === 'Blue' ? '蓝方' : side === 'Red' ? '红方' : '总计'
    }))
  const totals = aggregateRoles(games, role, player)
  const blue = new Map(
    aggregateRoles(
      games.filter((g) => g.side === 'Blue'),
      role,
      player
    ).map((row) => [`${row.role}|${row.player}`, row])
  )
  const red = new Map(
    aggregateRoles(
      games.filter((g) => g.side === 'Red'),
      role,
      player
    ).map((row) => [`${row.role}|${row.player}`, row])
  )
  return totals.flatMap((total) => {
    const key = `${total.role}|${total.player}`
    const result: RoleAggregate[] = [{ ...total, sideLabel: '总计' }]
    if (blue.has(key)) result.push({ ...blue.get(key)!, sideLabel: '蓝方' })
    if (red.has(key)) result.push({ ...red.get(key)!, sideLabel: '红方' })
    return result
  })
}

export function aggregateChampions(
  games: MemberAnalysisGame[],
  role = 'all',
  player = 'all'
): ChampionAggregate[] {
  const roleTotals = new Map<string, number>()
  const picks = new Map<string, Omit<ChampionAggregate, 'winRate' | 'pickRate' | 'performance'>>()
  for (const game of games)
    for (const row of game.players) {
      if ((role !== 'all' && row.role !== role) || (player !== 'all' && row.player !== player))
        continue
      const roleKey = `${row.role}|${row.player}`
      roleTotals.set(roleKey, (roleTotals.get(roleKey) ?? 0) + 1)
      const key = `${roleKey}|${row.champion}`
      const pick = picks.get(key) ?? {
        player: row.player,
        role: row.role,
        champion: row.champion,
        games: 0,
        wins: 0,
        blueGames: 0,
        blueWins: 0,
        redGames: 0,
        redWins: 0
      }
      pick.games += 1
      pick.wins += Number(game.win)
      if (game.side === 'Blue') {
        pick.blueGames += 1
        pick.blueWins += Number(game.win)
      } else {
        pick.redGames += 1
        pick.redWins += Number(game.win)
      }
      picks.set(key, pick)
    }
  return [...picks.values()]
    .map((pick) => {
      const selected = games.filter((game) =>
        game.players.some(
          (row) =>
            row.player === pick.player && row.role === pick.role && row.champion === pick.champion
        )
      )
      return {
        ...pick,
        winRate: ratio(pick.wins, pick.games),
        pickRate: ratio(pick.games, roleTotals.get(`${pick.role}|${pick.player}`) ?? 0),
        performance: aggregateRoles(selected, pick.role, pick.player)[0]
      }
    })
    .sort(
      (a, b) =>
        roles.indexOf(a.role) - roles.indexOf(b.role) ||
        a.player.localeCompare(b.player, 'zh-CN') ||
        b.games - a.games ||
        b.winRate - a.winRate
    )
}

function pairGroup(
  pairType: PairAggregate['pairType'],
  pair: string,
  games: MemberAnalysisGame[],
  sideLabel: SideLabel
): PairAggregate {
  const wins = games.filter((g) => g.win).length
  return {
    pairType,
    pair,
    sideLabel,
    games: games.length,
    wins,
    winRate: ratio(wins, games.length),
    counterMean: averageNullable(games.map((g) => g.counterMean)),
    upperGold15: average(games.map((g) => g.upperGold15)),
    botGold15: average(games.map((g) => g.botGold15)),
    dragon15Diff: average(games.map((g) => g.dragon15Diff)),
    grub15Diff: average(games.map((g) => g.grub15Diff)),
    objectiveFight15Diff: average(games.map((g) => g.objectiveFight15Diff)),
    gold20Diff: average(games.map((g) => g.gold20Diff)),
    tower20Diff: average(games.map((g) => g.tower20Diff))
  }
}
export function aggregatePairs(
  games: MemberAnalysisGame[],
  minimumGames = 1,
  side: 'all' | 'Blue' | 'Red' = 'all',
  role = 'all',
  player = 'all'
): PairAggregate[] {
  const definitions = [
    ['upper_pair', 'TOP', 'JUNGLE'],
    ['mid_jg_pair', 'MIDDLE', 'JUNGLE'],
    ['bot_pair', 'BOTTOM', 'UTILITY']
  ] as const
  const groups = new Map<
    string,
    { type: PairAggregate['pairType']; pair: string; games: MemberAnalysisGame[] }
  >()
  for (const game of games)
    for (const [type, firstRole, secondRole] of definitions) {
      if (role !== 'all' && role !== firstRole && role !== secondRole) continue
      const first = game.players.find((x) => x.role === firstRole)
      const second = game.players.find((x) => x.role === secondRole)
      if (
        !first ||
        !second ||
        (player !== 'all' && first.player !== player && second.player !== player)
      )
        continue
      const pair = `${first.player} + ${second.player}`
      const key = `${type}|${pair}`
      const group = groups.get(key) ?? { type, pair, games: [] }
      group.games.push(game)
      groups.set(key, group)
    }
  return [...groups.values()]
    .filter((g) => g.games.length >= minimumGames)
    .sort(
      (a, b) =>
        definitions.findIndex((x) => x[0] === a.type) -
          definitions.findIndex((x) => x[0] === b.type) ||
        b.games.length - a.games.length ||
        a.pair.localeCompare(b.pair, 'zh-CN')
    )
    .flatMap((group) => {
      if (side !== 'all') {
        const selected = group.games.filter((g) => g.side === side)
        return selected.length
          ? [pairGroup(group.type, group.pair, selected, side === 'Blue' ? '蓝方' : '红方')]
          : []
      }
      const result = [pairGroup(group.type, group.pair, group.games, '总计')]
      const blue = group.games.filter((g) => g.side === 'Blue')
      const red = group.games.filter((g) => g.side === 'Red')
      if (blue.length) result.push(pairGroup(group.type, group.pair, blue, '蓝方'))
      if (red.length) result.push(pairGroup(group.type, group.pair, red, '红方'))
      return result
    })
}

function jungleGroup(
  games: MemberAnalysisGame[],
  player: string,
  sideLabel: SideLabel
): JungleAggregate[] {
  const groups = new Map<string, MemberAnalysisGame[]>()
  for (const game of games)
    if (game.jungle && (player === 'all' || game.jungle.player === player)) {
      const list = groups.get(game.jungle.player) ?? []
      list.push(game)
      groups.set(game.jungle.player, list)
    }
  const campNames: Record<string, string> = {
    red: '红BUFF',
    blue: '蓝BUFF',
    gromp: '魔沼蛙',
    raptors: 'F6',
    wolves: '三狼',
    krugs: '石甲虫'
  }
  return [...groups.entries()]
    .map(([jungler, groupGames]) => {
      const jungles = groupGames
        .map((g) => g.jungle)
        .filter((x): x is NonNullable<MemberAnalysisGame['jungle']> => x !== null)
      const rows = groupGames
        .map((g) => g.players.find((x) => x.role === 'JUNGLE' && x.player === jungler))
        .filter((x): x is MemberAnalysisPlayerGame => Boolean(x))
      const starts = jungles.filter((x) => x.startCamp)
      const ownershipStarts = starts.filter((x) => x.startCampOwn !== null)
      const campCounts = new Map<string, number>()
      starts.forEach((x) => campCounts.set(x.startCamp!, (campCounts.get(x.startCamp!) ?? 0) + 1))
      const firstDragonSamples = jungles.filter((x) => x.gotFirstDragon !== null)
      const minutes = sum(rows.map((x) => x.minutes))
      return {
        player: jungler,
        sideLabel,
        games: groupGames.length,
        wins: groupGames.filter((g) => g.win).length,
        winRate: ratio(groupGames.filter((g) => g.win).length, groupGames.length),
        startDistribution:
          [...campCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(
              ([camp, count]) =>
                `${campNames[camp]} ${count}场/${(ratio(count, starts.length) * 100).toFixed(1)}%`
            )
            .join(' · ') || '—',
        startSamples: starts.length,
        ownershipSamples: ownershipStarts.length,
        ownStartRate: ratioNullable(
          ownershipStarts.filter((x) => x.startCampOwn === true).length,
          ownershipStarts.length
        ),
        invadeStartRate: ratioNullable(
          ownershipStarts.filter((x) => x.startCampOwn === false).length,
          ownershipStarts.length
        ),
        redStartRate: ratioNullable(
          starts.filter((x) => x.startCamp === 'red').length,
          starts.length
        ),
        blueStartRate: ratioNullable(
          starts.filter((x) => x.startCamp === 'blue').length,
          starts.length
        ),
        grompStartRate: ratioNullable(
          starts.filter((x) => x.startCamp === 'gromp').length,
          starts.length
        ),
        raptorsStartRate: ratioNullable(
          starts.filter((x) => x.startCamp === 'raptors').length,
          starts.length
        ),
        wolvesStartRate: ratioNullable(
          starts.filter((x) => x.startCamp === 'wolves').length,
          starts.length
        ),
        krugsStartRate: ratioNullable(
          starts.filter((x) => x.startCamp === 'krugs').length,
          starts.length
        ),
        level3GankRate: ratio(jungles.filter((x) => x.level3Gank).length, jungles.length),
        level4GankRate: ratio(jungles.filter((x) => x.level4Gank).length, jungles.length),
        topGanksPG: ratio(sum(jungles.map((x) => x.topGanks)), jungles.length),
        midGanksPG: ratio(sum(jungles.map((x) => x.midGanks)), jungles.length),
        botGanksPG: ratio(sum(jungles.map((x) => x.botGanks)), jungles.length),
        topZoneRate: ratioNullable(
          sum(jungles.map((x) => x.topZoneWeight)),
          sum(jungles.map((x) => x.totalZoneWeight))
        ),
        midZoneRate: ratioNullable(
          sum(jungles.map((x) => x.midZoneWeight)),
          sum(jungles.map((x) => x.totalZoneWeight))
        ),
        botZoneRate: ratioNullable(
          sum(jungles.map((x) => x.botZoneWeight)),
          sum(jungles.map((x) => x.totalZoneWeight))
        ),
        firstDragonRate: ratioNullable(
          firstDragonSamples.filter((x) => x.gotFirstDragon).length,
          firstDragonSamples.length
        ),
        firstDragonSamples: firstDragonSamples.length,
        firstDragonTime: averageNullable(jungles.map((x) => x.firstDragonTimeSec)),
        dragonsPG: ratio(sum(jungles.map((x) => x.dragons)), jungles.length),
        soloDragonsPG: ratio(sum(jungles.map((x) => x.soloDragons)), jungles.length),
        voidgrubsPG: ratio(sum(jungles.map((x) => x.voidgrubs)), jungles.length),
        heraldsPG: ratio(sum(jungles.map((x) => x.heralds)), jungles.length),
        baronsPG: ratio(sum(jungles.map((x) => x.barons)), jungles.length),
        dragon15: average(groupGames.map((g) => g.dragon15Diff)),
        grub15: average(groupGames.map((g) => g.grub15Diff)),
        objectiveFight15: average(groupGames.map((g) => g.objectiveFight15Diff)),
        gd10: averageNullable(rows.map((x) => x.gd10)),
        gd15: averageNullable(rows.map((x) => x.gd15)),
        xpd15: averageNullable(rows.map((x) => x.xpd15)),
        cspm: ratioNullable(sum(rows.map((x) => x.cs)), minutes),
        gpm: ratioNullable(sum(rows.map((x) => x.gold)), minutes),
        objectiveDamagePM: ratioNullable(sum(rows.map((x) => x.objectiveDamage)), minutes)
      }
    })
    .sort((a, b) => Number(b.games) - Number(a.games) || a.player.localeCompare(b.player, 'zh-CN'))
}
export function aggregateJungle(
  games: MemberAnalysisGame[],
  side: 'all' | 'Blue' | 'Red' = 'all',
  player = 'all'
): JungleAggregate[] {
  if (side !== 'all')
    return jungleGroup(
      games.filter((g) => g.side === side),
      player,
      side === 'Blue' ? '蓝方' : '红方'
    )
  const total = jungleGroup(games, player, '总计')
  const blue = new Map(
    jungleGroup(
      games.filter((g) => g.side === 'Blue'),
      player,
      '蓝方'
    ).map((x) => [x.player, x])
  )
  const red = new Map(
    jungleGroup(
      games.filter((g) => g.side === 'Red'),
      player,
      '红方'
    ).map((x) => [x.player, x])
  )
  return total.flatMap((x) =>
    [x, blue.get(x.player), red.get(x.player)].filter((row): row is JungleAggregate => Boolean(row))
  )
}

function conversionGroup(games: MemberAnalysisGame[], sideLabel: SideLabel): ConversionAggregate {
  const total = (key: keyof MemberAnalysisGame['eventDecision']) =>
    sum(games.map((game) => Number(game.eventDecision[key]) || 0))
  const wins = games.filter((g) => g.win).length
  return {
    sideLabel,
    games: games.length,
    wins,
    winRate: ratio(wins, games.length),
    killEpisodes: total('killEpisodes'),
    convertedKillEpisodes: total('convertedKillEpisodes'),
    killToEpicEpisodes: total('killToEpicEpisodes'),
    killToTowerEpisodes: total('killToTowerEpisodes'),
    killConversionRate: ratioNullable(total('convertedKillEpisodes'), total('killEpisodes')),
    killToEpicRate: ratioNullable(total('killToEpicEpisodes'), total('killEpisodes')),
    killToTowerRate: ratioNullable(total('killToTowerEpisodes'), total('killEpisodes')),
    conversionDelaySec: ratioNullable(
      total('conversionDelayTotalSec'),
      total('conversionDelaySamples')
    ),
    deathEpisodes: total('deathEpisodes'),
    highCostDeathEpisodes: total('highCostDeathEpisodes'),
    highCostDeathRate: ratioNullable(total('highCostDeathEpisodes'), total('deathEpisodes')),
    deathCostPointsPG: ratio(total('deathCostPoints'), games.length),
    deathCostEpicsPG: ratio(total('deathCostEpics'), games.length),
    deathCostTowersPG: ratio(total('deathCostTowers'), games.length),
    shutdownBountyLostPG: ratio(total('shutdownBountyLost'), games.length),
    objectivesTaken: total('objectivesTaken'),
    cleanObjectives: total('cleanObjectives'),
    cleanObjectiveRate: ratioNullable(total('cleanObjectives'), total('objectivesTaken')),
    objectiveFightSamples: total('objectiveFightSamples'),
    objectiveFightWins: total('objectiveFightWins'),
    objectiveFightWinRate: ratioNullable(
      total('objectiveFightWins'),
      total('objectiveFightSamples')
    ),
    enemyObjectives: total('enemyObjectives'),
    tradedEnemyObjectives: total('tradedEnemyObjectives'),
    crossMapTradeRate: ratioNullable(total('tradedEnemyObjectives'), total('enemyObjectives')),
    tradeDelaySec: ratioNullable(total('tradeDelayTotalSec'), total('tradeDelaySamples'))
  }
}
export function aggregateConversion(games: MemberAnalysisGame[]): ConversionAggregate[] {
  if (!games.length) return []
  const rows = [conversionGroup(games, '总计')]
  const blue = games.filter((g) => g.side === 'Blue')
  const red = games.filter((g) => g.side === 'Red')
  if (blue.length) rows.push(conversionGroup(blue, '蓝方'))
  if (red.length) rows.push(conversionGroup(red, '红方'))
  return rows
}

export function earlyGoldDiff(game: MemberAnalysisGame, timing: '15' | '20'): number | null {
  if (timing === '20')
    return game.duration >= 1200 && Number.isFinite(game.gold20Diff) ? game.gold20Diff : null
  if (game.duration < 900) return null
  const values = roles.map((role) => game.players.find((row) => row.role === role)?.gd15 ?? null)
  return values.every((value): value is number => value !== null && Number.isFinite(value))
    ? sum(values)
    : null
}
export function aggregateEarlyBuckets(
  rows: { game: MemberAnalysisGame; diff: number }[]
): EarlyBucket[] {
  const definitions = [
    { label: '< −3000', min: -Infinity, max: -3000 },
    { label: '−3000 ~ −1500', min: -3000, max: -1500 },
    { label: '−1500 ~ −500', min: -1500, max: -500 },
    { label: '−500 ~ +500', min: -500, max: 500 },
    { label: '+500 ~ +1500', min: 500, max: 1500 },
    { label: '+1500 ~ +3000', min: 1500, max: 3000 },
    { label: '≥ +3000', min: 3000, max: Infinity }
  ]
  return definitions.map((d, index) => {
    const selected = rows.filter(
      (x) =>
        x.diff >= d.min && (index === definitions.length - 1 ? x.diff <= d.max : x.diff < d.max)
    )
    const wins = selected.filter((x) => x.game.win).length
    return {
      label: d.label,
      games: selected.length,
      wins,
      winRate: ratioNullable(wins, selected.length)
    }
  })
}

export function aggregateSynergy(games: MemberAnalysisGame[]): SynergyAggregate[] {
  const appearances = new Map<string, { games: number; wins: number }>()
  const pairs = new Map<string, { playerA: string; playerB: string; games: MemberAnalysisGame[] }>()
  for (const game of games) {
    const names = [...new Set(game.players.map((x) => x.player))].sort((a, b) =>
      a.localeCompare(b, 'zh-CN')
    )
    for (const name of names) {
      const value = appearances.get(name) ?? { games: 0, wins: 0 }
      value.games += 1
      value.wins += Number(game.win)
      appearances.set(name, value)
    }
    for (let a = 0; a < names.length; a += 1)
      for (let b = a + 1; b < names.length; b += 1) {
        const key = `${names[a]}|${names[b]}`
        const pair = pairs.get(key) ?? { playerA: names[a], playerB: names[b], games: [] }
        pair.games.push(game)
        pairs.set(key, pair)
      }
  }
  return [...pairs.entries()]
    .map(([key, pair]) => {
      const wins = pair.games.filter((g) => g.win).length
      const a = appearances.get(pair.playerA)!
      const b = appearances.get(pair.playerB)!
      const winRate = ratio(wins, pair.games.length)
      const baseline = (ratio(a.wins, a.games) + ratio(b.wins, b.games)) / 2
      const observedDifference = winRate - baseline
      const shrinkageWeight = ratio(pair.games.length, pair.games.length + 8)
      return {
        key,
        playerA: pair.playerA,
        playerB: pair.playerB,
        games: pair.games.length,
        wins,
        winRate,
        baseline,
        observedDifference,
        shrinkageWeight,
        adjustedDifference: observedDifference * shrinkageWeight,
        gamesList: pair.games
      }
    })
    .sort((a, b) => b.adjustedDifference - a.adjustedDifference || b.games - a.games)
}

export function buildGameSearchIndex(games: MemberAnalysisGame[]) {
  return games.map((game) => ({
    game,
    search: [game.gameId, game.roster, ...game.players.flatMap((row) => [row.player, row.champion])]
      .join(' ')
      .toLocaleLowerCase('zh-CN')
  }))
}
