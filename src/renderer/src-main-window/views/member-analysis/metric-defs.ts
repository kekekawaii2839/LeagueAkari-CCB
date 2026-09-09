export type MetricFormat = 'num' | 'pct' | 'int' | 'text' | 'time'
export const formatMetric = (value: unknown, format: MetricFormat = 'num') => {
  if (format === 'text')
    return value === null || value === undefined || value === '' ? '—' : String(value)
  if (value === null || value === undefined) return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return '—'
  if (format === 'pct') return `${(number * 100).toFixed(1)}%`
  if (format === 'int') return Math.round(number).toLocaleString('zh-CN')
  if (format === 'time') {
    const seconds = Math.round(number)
    return `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`
  }
  return Math.abs(number) >= 100 ? number.toFixed(0) : number.toFixed(2)
}

export const roleMetricGroups = {
  core: {
    label: '核心表现',
    columns: ['games', 'winRate', 'kda', 'kp', 'gd15']
  },
  combat: {
    label: '击杀与死亡',
    columns: ['games', 'killsPG', 'deathsPG', 'assistsPG', 'killShare', 'deathShare']
  },
  efficiency: {
    label: '输出与经济',
    columns: [
      'games',
      'dpm',
      'damageShare',
      'gpm',
      'goldShare',
      'damageConversion',
      'damagePerGold',
      'cspm'
    ]
  },
  vision: { label: '视野', columns: ['games', 'vspm', 'wpm', 'wcpm', 'cwpm'] },
  utility: {
    label: '承伤与功能',
    columns: [
      'games',
      'takenShare',
      'damageTakenPM',
      'mitigatedPM',
      'objectiveDamagePM',
      'turretDamagePM',
      'healPM',
      'shieldPM',
      'ccPM',
      'soloKillsPG',
      'fbRate',
      'ftRate'
    ]
  },
  lane: {
    label: '对线与资源',
    columns: [
      'games',
      'gd10',
      'gd15',
      'csd15',
      'xpd15',
      'damageDiff15',
      'soloDiff15',
      'counter',
      'dragon15',
      'grub15',
      'objectiveFight15'
    ]
  },
  gankDeaths: {
    label: '被抓统计',
    columns: [
      'games',
      'laneGankEligibleGames',
      'laneGankDeaths',
      'laneGankDeathsPG',
      'laneGankBefore3',
      'laneGankMinute3',
      'laneGankMinute4',
      'laneGankMinute5To10',
      'laneGankMinute10To14',
      'laneGankAffectedGames',
      'laneGankAffectedRate'
    ]
  }
} as const

export const roleMetricMeta: Record<
  string,
  { label: string; fmt: MetricFormat; description?: string }
> = {
  games: { label: '场次', fmt: 'int' },
  winRate: {
    label: '胜率',
    fmt: 'pct',
    description: '胜场数 ÷ 场次；点为样本胜率，横线为 Wilson 95% 区间'
  },
  kda: { label: 'KDA', fmt: 'num', description: '（击杀 + 助攻）÷ max（1，死亡）' },
  kp: { label: '参团率', fmt: 'pct', description: '参与击杀数 ÷ 团队击杀数，按对局平均' },
  killsPG: { label: '场均击杀', fmt: 'num' },
  deathsPG: { label: '场均死亡', fmt: 'num' },
  assistsPG: { label: '场均助攻', fmt: 'num' },
  killShare: { label: '击杀占比', fmt: 'pct', description: '个人击杀数 ÷ 团队击杀数' },
  deathShare: { label: '死亡占比', fmt: 'pct', description: '个人死亡数 ÷ 团队死亡数' },
  dpm: { label: 'DPM', fmt: 'num', description: 'Damage Per Minute：每分钟对英雄造成的伤害' },
  damageShare: {
    label: '伤害占比',
    fmt: 'pct',
    description: '个人英雄伤害 ÷ 团队英雄伤害，按对局平均'
  },
  gpm: { label: 'GPM', fmt: 'num', description: 'Gold Per Minute：每分钟获得经济' },
  goldShare: { label: '经济占比', fmt: 'pct', description: '个人经济 ÷ 团队经济，按对局平均' },
  damageConversion: {
    label: '伤害转化率',
    fmt: 'pct',
    description: '伤害占比 ÷ 经济占比；100% 表示伤害占比与经济占比相同'
  },
  damagePerGold: { label: '单位经济伤害', fmt: 'num', description: '对英雄造成的伤害 ÷ 获得经济' },
  cspm: { label: 'CSPM', fmt: 'num', description: 'Creep Score Per Minute：每分钟补刀数' },
  vspm: { label: 'VSPM', fmt: 'num', description: 'Vision Score Per Minute：每分钟视野得分' },
  wpm: { label: 'WPM', fmt: 'num', description: 'Wards Placed Per Minute：每分钟放置守卫数' },
  wcpm: { label: 'WCPM', fmt: 'num', description: 'Wards Cleared Per Minute：每分钟排除守卫数' },
  cwpm: {
    label: 'CWPM',
    fmt: 'num',
    description: 'Control Wards Per Minute：每分钟购买控制守卫数'
  },
  takenShare: {
    label: '承伤占比',
    fmt: 'pct',
    description: '个人承受伤害 ÷ 团队承受伤害，按对局平均'
  },
  damageTakenPM: { label: '分均承伤', fmt: 'num' },
  mitigatedPM: { label: '分均减伤', fmt: 'num' },
  objectiveDamagePM: { label: '分均目标伤害', fmt: 'num' },
  turretDamagePM: { label: '分均塔伤', fmt: 'num' },
  healPM: { label: '分均队友治疗', fmt: 'num' },
  shieldPM: { label: '分均队友护盾', fmt: 'num' },
  ccPM: { label: '分均控制秒数', fmt: 'num', description: '每分钟对敌方英雄造成的控制时长' },
  soloKillsPG: { label: '场均单杀', fmt: 'num' },
  fbRate: { label: '一血参与率', fmt: 'pct', description: '参与本方一血击杀的对局占比' },
  ftRate: { label: '一塔参与率', fmt: 'pct', description: '参与摧毁本方第一座防御塔的对局占比' },
  gd10: {
    label: '10 分钟经济差（金币）',
    fmt: 'num',
    description: 'Gold Difference at 10：10 分钟相对同位置对手的经济差'
  },
  gd15: {
    label: '15 分钟经济差（金币）',
    fmt: 'num',
    description: 'Gold Difference at 15：15 分钟相对同位置对手的经济差'
  },
  csd15: {
    label: '15 分钟补刀差',
    fmt: 'num',
    description: 'Creep Score Difference at 15：15 分钟相对同位置对手的补刀差'
  },
  xpd15: {
    label: '15 分钟经验差',
    fmt: 'num',
    description: 'Experience Difference at 15：15 分钟相对同位置对手的经验差'
  },
  damageDiff15: {
    label: '伤害差@15',
    fmt: 'num',
    description: '15 分钟前对英雄伤害相对同位置对手的差值'
  },
  soloDiff15: {
    label: '单杀差@15',
    fmt: 'num',
    description: '15 分钟前对同位置对手的单杀数减去被单杀数'
  },
  counter: {
    label: 'OP.GG线杀率优势',
    fmt: 'pct',
    description: '基于 OP.GG 对位数据的线杀率差；数据不可用时显示 —'
  },
  dragon15: {
    label: '小龙差@15',
    fmt: 'num',
    description: '15 分钟前本方取得的小龙数减去对方小龙数'
  },
  grub15: {
    label: '巢虫差@15',
    fmt: 'num',
    description: '15 分钟前本方取得的虚空巢虫数减去对方巢虫数'
  },
  objectiveFight15: {
    label: '资源团净击杀@15',
    fmt: 'num',
    description: '15 分钟前资源事件附近本方击杀数减去死亡数'
  },
  laneGankEligibleGames: {
    label: '有效场次',
    fmt: 'int',
    description: '能够识别敌方打野并读取完整时间线的该成员非打野对局数'
  },
  laneGankDeaths: {
    label: '被抓死亡',
    fmt: 'int',
    description: '14:00 前在成员对应分路死亡，且敌方打野是击杀者或助攻者的次数'
  },
  laneGankDeathsPG: {
    label: '场均被抓',
    fmt: 'num',
    description: '被抓死亡次数 ÷ 有效场次'
  },
  laneGankBefore3: { label: '3分钟前', fmt: 'int', description: '0:00（含）至 3:00（不含）' },
  laneGankMinute3: { label: '3分钟', fmt: 'int', description: '3:00（含）至 4:00（不含）' },
  laneGankMinute4: { label: '4分钟', fmt: 'int', description: '4:00（含）至 5:00（不含）' },
  laneGankMinute5To10: {
    label: '5–10分钟',
    fmt: 'int',
    description: '5:00（含）至 10:00（不含）'
  },
  laneGankMinute10To14: {
    label: '10–14分钟',
    fmt: 'int',
    description: '10:00（含）至 14:00（不含）'
  },
  laneGankAffectedRate: {
    label: '涉及率',
    fmt: 'pct',
    description: '至少发生一次被抓死亡的对局数 ÷ 有效场次'
  },
  laneGankAffectedGames: {
    label: '涉及场次',
    fmt: 'int',
    description: '至少发生一次被抓死亡的对局数；同一局发生多次仍只计一场'
  }
}

export const jungleGroups = {
  opening: {
    label: '开野与首轮',
    columns: [
      'games',
      'winRate',
      'startDistribution',
      'ownStartRate',
      'invadeStartRate',
      'redStartRate',
      'blueStartRate',
      'grompStartRate',
      'raptorsStartRate',
      'wolvesStartRate',
      'krugsStartRate'
    ]
  },
  gank: {
    label: '早期抓人与方向',
    columns: [
      'games',
      'winRate',
      'level3GankRate',
      'level4GankRate',
      'topGanksPG',
      'midGanksPG',
      'botGanksPG',
      'topZoneRate',
      'midZoneRate',
      'botZoneRate'
    ]
  },
  objectives: {
    label: '资源控制',
    columns: [
      'games',
      'winRate',
      'firstDragonRate',
      'firstDragonTime',
      'dragonsPG',
      'soloDragonsPG',
      'voidgrubsPG',
      'heraldsPG',
      'baronsPG',
      'dragon15',
      'grub15',
      'objectiveFight15'
    ]
  },
  development: {
    label: '发育与对位',
    columns: ['games', 'winRate', 'gd10', 'gd15', 'xpd15', 'cspm', 'gpm', 'objectiveDamagePM']
  }
} as const
export const jungleMeta: Record<string, { label: string; fmt: MetricFormat }> = {
  games: { label: '场次', fmt: 'int' },
  winRate: { label: '胜率', fmt: 'pct' },
  startDistribution: { label: '开野分布', fmt: 'text' },
  ownStartRate: { label: '己方野区开率', fmt: 'pct' },
  invadeStartRate: { label: '入侵开野率', fmt: 'pct' },
  redStartRate: { label: '红开率', fmt: 'pct' },
  blueStartRate: { label: '蓝开率', fmt: 'pct' },
  grompStartRate: { label: '魔沼蛙开率', fmt: 'pct' },
  raptorsStartRate: { label: 'F6开率', fmt: 'pct' },
  wolvesStartRate: { label: '三狼开率', fmt: 'pct' },
  krugsStartRate: { label: '石甲虫开率', fmt: 'pct' },
  level3GankRate: { label: '3级抓人率', fmt: 'pct' },
  level4GankRate: { label: '4级抓人率', fmt: 'pct' },
  topGanksPG: { label: '场均上路抓人', fmt: 'num' },
  midGanksPG: { label: '场均中路抓人', fmt: 'num' },
  botGanksPG: { label: '场均下路抓人', fmt: 'num' },
  topZoneRate: { label: '上半区亲和度', fmt: 'pct' },
  midZoneRate: { label: '中路亲和度', fmt: 'pct' },
  botZoneRate: { label: '下半区亲和度', fmt: 'pct' },
  firstDragonRate: { label: '首龙控制率', fmt: 'pct' },
  firstDragonTime: { label: '我方首龙时间', fmt: 'time' },
  dragonsPG: { label: '场均小龙', fmt: 'num' },
  soloDragonsPG: { label: '场均独控小龙', fmt: 'num' },
  voidgrubsPG: { label: '场均巢虫', fmt: 'num' },
  heraldsPG: { label: '场均先锋', fmt: 'num' },
  baronsPG: { label: '场均大龙', fmt: 'num' },
  dragon15: { label: '小龙差@15', fmt: 'num' },
  grub15: { label: '巢虫差@15', fmt: 'num' },
  objectiveFight15: { label: '资源团净击杀@15', fmt: 'num' },
  gd10: { label: '10 分钟经济差（金币）', fmt: 'num' },
  gd15: { label: '15 分钟经济差（金币）', fmt: 'num' },
  xpd15: { label: '15 分钟经验差', fmt: 'num' },
  cspm: { label: 'CSPM', fmt: 'num' },
  gpm: { label: 'GPM', fmt: 'num' },
  objectiveDamagePM: { label: '分均目标伤害', fmt: 'num' }
}
