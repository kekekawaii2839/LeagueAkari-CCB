import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from './schemas'

/** Native analytics only: never changes the pinned prediction model vector. */
export const nativeMetricDefinitions = {
  damageTakenPerDeath: {
    label: '每死承伤',
    unit: '伤害/死亡',
    fmt: 'num',
    description: '受到总伤害 ÷ 死亡次数；零死亡不适用。汇总仅纳入死亡大于零且承伤已知的对局。'
  },
  gameDuration: {
    label: '对局时长',
    unit: '分钟',
    fmt: 'num',
    description: '对局时长，按对局平均。'
  },
  bloodiness: {
    label: '血腥程度',
    unit: '击杀/分钟',
    fmt: 'num',
    description: '双方总击杀 ÷ 对局分钟数；汇总为有效对局总击杀 ÷ 总分钟数。'
  },
  firstDragonTime: {
    label: '首条小龙时间',
    unit: '秒',
    fmt: 'time',
    description: '己方首次击杀非远古龙的游戏时间；未取得或时间线不完整时缺失。'
  },
  firstTowerTime: {
    label: '首座防御塔时间',
    unit: '秒',
    fmt: 'time',
    description: '己方首次摧毁防御塔的游戏时间；未取得或时间线不完整时缺失。'
  },
  teamDragonsPG: {
    label: '场均小龙',
    unit: '条/场',
    fmt: 'num',
    description: '己方非远古龙击杀数，仅统计完整时间线。'
  },
  teamBaronsPG: {
    label: '场均大龙',
    unit: '条/场',
    fmt: 'num',
    description: '己方纳什男爵击杀数，仅统计完整时间线。'
  },
  teamDragonSoulsPG: {
    label: '场均龙魂',
    unit: '个/场',
    fmt: 'num',
    description: '己方龙魂获取事件数，仅统计完整时间线。'
  },
  teamElderDragonsPG: {
    label: '场均远古龙',
    unit: '条/场',
    fmt: 'num',
    description: '己方远古龙击杀数，仅统计完整时间线。'
  }
} as const
export type NativeMetric = keyof typeof nativeMetricDefinitions
export const nativeMetricKeys = Object.keys(nativeMetricDefinitions) as NativeMetric[]
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)
const ratio = (a: unknown, b: unknown) => (finite(a) && finite(b) && b > 0 ? a / b : null)
export function nativeGameMetrics(
  game: MemberAnalysisGame,
  row?: MemberAnalysisPlayerGame
): Record<NativeMetric, number | null> {
  const metrics = game.teamMetrics
  return {
    damageTakenPerDeath: ratio(row?.damageTaken, row?.deaths),
    gameDuration: game.duration > 0 ? game.duration / 60 : null,
    bloodiness: ratio(metrics?.totalKills, game.duration / 60),
    firstDragonTime: metrics?.firstDragonTime ?? null,
    firstTowerTime: metrics?.firstTowerTime ?? null,
    teamDragonsPG: metrics?.dragons ?? null,
    teamBaronsPG: metrics?.barons ?? null,
    teamDragonSoulsPG: metrics?.dragonSouls ?? null,
    teamElderDragonsPG: metrics?.elderDragons ?? null
  }
}
export function aggregateNativeMetric(
  games: MemberAnalysisGame[],
  key: NativeMetric,
  player = 'all',
  role = 'all'
) {
  let numerator = 0,
    denominator = 0,
    validGames = 0
  for (const game of games) {
    const rows = game.players.filter(
      (row) => (player === 'all' || row.player === player) && (role === 'all' || row.role === role)
    )
    if (key === 'damageTakenPerDeath') {
      const valid = rows.filter(
        (row) => finite(row.damageTaken) && finite(row.deaths) && row.deaths > 0
      )
      if (!valid.length) continue
      numerator += valid.reduce((sum, row) => sum + row.damageTaken!, 0)
      denominator += valid.reduce((sum, row) => sum + row.deaths!, 0)
    } else {
      const value = nativeGameMetrics(game)[key]
      if (!finite(value)) continue
      numerator += key === 'bloodiness' ? game.teamMetrics!.totalKills! : value
      denominator += key === 'bloodiness' ? game.duration / 60 : 1
    }
    validGames++
  }
  return {
    value: denominator > 0 ? numerator / denominator : null,
    validGames,
    numerator: validGames ? numerator : null,
    denominator: validGames ? denominator : null
  }
}
