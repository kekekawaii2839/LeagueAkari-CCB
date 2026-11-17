export const MEMBER_ANALYSIS_ROUTE = {
  name: 'member-analysis',
  path: '/member-analysis/:section?'
} as const

export const MEMBER_ANALYSIS_NAVIGATION = {
  key: MEMBER_ANALYSIS_ROUTE.name,
  label: '五排分析'
} as const
