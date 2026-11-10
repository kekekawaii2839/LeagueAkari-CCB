export const analysisGroups = [
  { key: 'personal', label: '个人分析', sections: ['roles', 'champions', 'jungle', 'lp-trend'] },
  { key: 'combination', label: '组合分析', sections: ['pairs', 'synergy'] },
  {
    key: 'team',
    label: '团队分析',
    sections: ['team-metrics', 'early', 'prediction', 'opponent-ranks', 'bans', 'champion-tier']
  },
  { key: 'metrics', label: '指标分析', sections: ['scatter', 'version-trend'] },
  { key: 'matches', label: '对局列表', sections: ['matches'] }
] as const
export function analysisGroupFor(section: string) {
  return (
    analysisGroups.find((group) => (group.sections as readonly string[]).includes(section))?.key ??
    'personal'
  )
}
export function analysisGroupDestination(
  groupKey: string,
  available: string[],
  remembered?: string
) {
  const group = analysisGroups.find((group) => group.key === groupKey)
  if (!group) return null
  const candidates = (group.sections as readonly string[]).filter((section) =>
    available.includes(section)
  )
  return remembered && candidates.includes(remembered) ? remembered : (candidates[0] ?? null)
}
