import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import {
  type TrendIdentity,
  type TrendInput,
  type TrendRequest,
  type TrendResult,
  buildVersionTrend,
  trendRequestKey
} from './domain'

export type TrendWorkerMessage =
  | {
      type: 'start'
      jobId: number
      generation: number
      configuredMemberIds: string[]
      request: TrendRequest
    }
  | { type: 'chunk'; jobId: number; games: MemberAnalysisGame[]; identities: TrendIdentity[] }
  | { type: 'finish'; jobId: number }
export type TrendWorkerReply =
  | { type: 'done'; jobId: number; requestKey: string; result: TrendResult }
  | { type: 'failed'; jobId: number; reason: 'invalid-input' }

/** Feature-local worker protocol. No renderer globals or IO inside aggregation. */
export function createTrendWorkerHandler(reply: (message: TrendWorkerReply) => void) {
  let active: { jobId: number; input: TrendInput; request: TrendRequest } | null = null
  return (message: TrendWorkerMessage) => {
    if (message.type === 'start') {
      active = {
        jobId: message.jobId,
        input: {
          generation: message.generation,
          identitiesGeneration: message.generation,
          configuredMemberIds: message.configuredMemberIds,
          games: [],
          identities: []
        },
        request: message.request
      }
      return
    }
    if (!active || active.jobId !== message.jobId) return
    if (message.type === 'chunk') {
      // Producer sends bounded chunks; reject oversized accidental payloads.
      if (message.games.length > 25 || message.identities.length > 25) {
        reply({ type: 'failed', jobId: active.jobId, reason: 'invalid-input' })
        active = null
        return
      }
      active.input.games.push(...message.games)
      active.input.identities.push(...message.identities)
      return
    }
    const job = active
    active = null
    try {
      reply({
        type: 'done',
        jobId: job.jobId,
        requestKey: trendRequestKey(job.request),
        result: buildVersionTrend(job.input, job.request)
      })
    } catch {
      reply({ type: 'failed', jobId: job.jobId, reason: 'invalid-input' })
    }
  }
}
