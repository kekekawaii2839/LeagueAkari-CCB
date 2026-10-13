import {
  type PlayerRankSnapshot,
  type RankFailure,
  type RankQueue,
  rankLabel
} from '@shared/shards/member-analysis/opponent-ranks'

import { uiText } from '../ui-text'

const reasons: Record<Exclude<RankFailure, 'budget-exhausted'>, string> = {
  disconnected: '客户端未连接',
  'auth-unavailable': '登录凭据不可用',
  'cross-region': '不支持跨区查询',
  unsupported: '当前区服不支持',
  forbidden: '查询被拒绝',
  'rate-limited': '触发限流',
  'not-found': '未找到玩家',
  'network-error': '网络或服务超时失败（已尝试）',
  'network-paused': '连续网络失败后暂停，尚未查询；可重新刷新',
  'invalid-response': '响应格式不兼容',
  'identity-missing': '对手身份不完整'
}
export const rankFailureText = (snapshot: PlayerRankSnapshot) =>
  snapshot.reason === 'budget-exhausted'
    ? uiText('rankNotQueried')
    : snapshot.reason
      ? reasons[snapshot.reason]
      : ''
export function queueRankText(snapshot: PlayerRankSnapshot, queue: RankQueue) {
  const value = snapshot[queue]
  const text =
    value.status === 'ranked'
      ? `${rankLabel(value.rank)}${value.rank.leaguePoints === null ? ' · LP 缺失' : ` · ${value.rank.leaguePoints} LP`}`
      : value.status === 'unranked'
        ? '未定级'
        : value.status === 'provisional'
          ? '定级中'
          : '未获取'
  return snapshot.status === 'stale' ? `${text}（旧快照）` : text
}
export const snapshotTime = (time: string | null) =>
  time ? new Date(time).toLocaleString('zh-CN', { hour12: false }) : '未查询成功'
