import type { RiotClientMain } from '@main/shards/riot-client'
import type { SgpMain } from '@main/shards/sgp'
import { EMPTY_PUUID } from '@shared/constants/common'
import type { MemberAnalysisCollectionAudit } from '@shared/shards/member-analysis'
import { isAxiosError } from 'axios'
import { setTimeout as delay, setImmediate as yieldToEventLoop } from 'node:timers/promises'

import { OpponentRankLoader, type RankGameTarget } from './opponent-ranks/loader'
import type { GameRankSnapshot } from './opponent-ranks/repository'
import type { CatalogItem, MemberAnalysisRepository } from './repository'

export type MemberTarget = { serverId: string; gameName: string; tagLine: string }

export type CollectionOptions = {
  members: MemberTarget[]
  historyDepth: number | 'all'
  scanLimitPerMember?: number
  historyTag: string
  signal: AbortSignal
  onProgress: (processed: number, total: number, message: string) => void
}

export type CollectionResult = {
  rankSnapshots: GameRankSnapshot[]
  items: CatalogItem[]
  changed: CatalogItem[]
  skipped: number
  memberErrors: number
  audit: MemberAnalysisCollectionAudit
}

type ResolvedMember = { member: number; target: MemberTarget; puuid: string }
type HistoryScan = ResolvedMember & {
  games: any[]
  gameIds: Set<string>
  feedGameIds: Set<string>
  pages: number
  nextIndex: number
  stopReason: 'source-exhausted' | 'safety-limit' | null
}

const HISTORY_PAGE_SIZE = 100
const MAX_HISTORY_GAMES = 5_000
const MAX_HISTORY_REQUESTS = 250
const HISTORY_CONCURRENCY = 3

export class MemberAnalysisCollector {
  constructor(
    private readonly _riotClient: RiotClientMain,
    private readonly _sgp: SgpMain,
    private readonly _repository: MemberAnalysisRepository
  ) {}

  async collect(options: CollectionOptions): Promise<CollectionResult> {
    const { resolved, memberScans } = await this._resolveMembers(options)
    const memberErrors = options.members.length - resolved.length
    if (
      memberErrors === 0 &&
      new Set(resolved.map((member) => member.puuid)).size !== resolved.length
    ) {
      throw new Error('configured members must resolve to distinct identities')
    }
    const automaticScanLimit =
      options.historyDepth === 'all'
        ? MAX_HISTORY_GAMES
        : Math.max(1_000, options.historyDepth * 20)
    const scanLimitPerMember = Math.min(
      MAX_HISTORY_GAMES,
      Math.max(100, options.scanLimitPerMember ?? automaticScanLimit)
    )
    const histories: HistoryScan[] = resolved.map((member) => ({
      ...member,
      games: [],
      gameIds: new Set(),
      feedGameIds: new Set(),
      pages: 0,
      nextIndex: 0,
      stopReason: null
    }))

    let collectionStopReason: MemberAnalysisCollectionAudit['collectionStopReason'] = 'safety-limit'
    if (memberErrors === 0) {
      collectionStopReason = await this._scanHistories(histories, options, scanLimitPerMember)
    }

    for (const history of histories) {
      const scan = memberScans[history.member - 1]
      scan.historyGames = history.gameIds.size
      scan.pages = history.pages
      scan.stopReason = history.stopReason ?? collectionStopReason
    }

    const classified = this._classify(histories, resolved, options.historyTag)
    const eligible = classified.roleEligible.sort(
      (left, right) => this._recency(right.summary) - this._recency(left.summary)
    )
    const selected =
      options.historyDepth === 'all' ? eligible : eligible.slice(0, options.historyDepth)
    const items: CatalogItem[] = []
    const changed: CatalogItem[] = []
    const rankTargets: RankGameTarget[] = []
    let cacheHits = 0
    let processed = 0
    for (const { serverId, summary } of selected) {
      this._throwIfCancelled(options.signal)
      const gameId = summary.json.gameId as number
      const targets = new Map(
        resolved
          .filter((member) => member.target.serverId === serverId)
          .map((member) => [member.puuid, `${member.target.gameName}#${member.target.tagLine}`])
      )
      const teamId = this._configuredTeam(summary, new Set(targets.keys()))
      if (Number(summary.json.gameDuration) >= 900) {
        const normalizeRole = (value: unknown): RankGameTarget['opponents'][number]['role'] => {
          const role = String(value ?? '').toUpperCase()
          if (role === 'MID') return 'MIDDLE'
          if (role === 'SUPPORT') return 'UTILITY'
          return ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'].includes(role)
            ? (role as NonNullable<RankGameTarget['opponents'][number]['role']>)
            : null
        }
        rankTargets.push({
          serverId,
          gameId,
          participants: (() => {
            const players = summary.json.participants ?? []
            if (
              players.length !== 10 ||
              players.some(
                (p: any) =>
                  typeof p.puuid !== 'string' ||
                  !p.puuid ||
                  p.puuid === EMPTY_PUUID ||
                  p.puuid.length > 256 ||
                  p.puuid.trim() !== p.puuid ||
                  ![100, 200].includes(p.teamId)
              ) ||
              new Set(players.map((p: any) => p.puuid)).size !== 10 ||
              players.filter((p: any) => p.teamId === 100).length !== 5 ||
              players.filter((p: any) => p.teamId === 200).length !== 5
            )
              return []
            return players.map((p: any) => ({
              puuid: p.puuid,
              role: normalizeRole(p.teamPosition ?? p.individualPosition ?? p.lane),
              champion:
                typeof p.championName === 'string' &&
                p.championName.length > 0 &&
                p.championName.length <= 64
                  ? p.championName
                  : null
            }))
          })(),
          opponents: (summary.json.participants ?? [])
            .filter((participant: any) => Number(participant.teamId) !== teamId)
            .map((participant: any) => ({
              puuid:
                typeof participant.puuid === 'string' && participant.puuid
                  ? participant.puuid
                  : null,
              role: normalizeRole(
                participant.teamPosition ?? participant.individualPosition ?? participant.lane
              ),
              champion:
                typeof participant.championName === 'string' &&
                participant.championName.length > 0 &&
                participant.championName.length <= 64
                  ? participant.championName
                  : null
            }))
        })
      }
      const normalizedSummary = structuredClone(summary)
      for (const participant of normalizedSummary.json.participants ?? []) {
        const targetName = targets.get(participant.puuid)
        participant._target = Number(participant.teamId) === teamId && Boolean(targetName)
        if (participant._target) participant._targetName = targetName
      }
      const checksum = this._repository.checksum(summary)
      if (this._repository.knownChecksum(serverId, gameId) === checksum) {
        const item = this._repository.catalogItem(serverId, gameId)
        if (!item) throw new Error('catalog watermark exists without a catalog item')
        this._repository.updateRawSummary(item, normalizedSummary)
        items.push(item)
        cacheHits += 1
      } else {
        const details = await this._sgp.api.matchHistoryQuery.getGameDetailsByGameId(gameId, {
          __sgpServerId: serverId,
          signal: options.signal
        })
        const item = this._repository.storeRaw(
          serverId,
          gameId,
          summary.json.queueId,
          checksum,
          normalizedSummary,
          details.data
        )
        changed.push(item)
        items.push(item)
      }
      processed += 1
      options.onProgress(processed, selected.length, 'loading-details')
      // Cached items have no network await. Yield after the complete atomic
      // item so a warm refresh cannot monopolize main's event loop.
      await yieldToEventLoop(undefined, { signal: options.signal })
      this._throwIfCancelled(options.signal)
    }

    const ranks = await new OpponentRankLoader(this._sgp, this._repository.opponentRanks).load(
      rankTargets,
      options.signal,
      options.onProgress
    )
    this._throwIfCancelled(options.signal)

    const audit: MemberAnalysisCollectionAudit = {
      requestedMembers: options.members.length,
      resolvedMembers: resolved.length,
      memberScans,
      targetHistoryDepth: options.historyDepth,
      scanLimitPerMember,
      collectionStopReason,
      sourceUnion: classified.sourceUnion,
      sourceIntersection: classified.sourceIntersection,
      fivePresent: classified.fivePresent,
      fiveSameTeam: classified.fiveSameTeam,
      mapEligible: classified.mapEligible,
      queueEligible: classified.queueEligible,
      roleEligible: classified.roleEligible.length,
      targetSelected: selected.length,
      detailSucceeded: items.length,
      detailFetched: changed.length,
      cacheHits,
      rawCatalog: items.length,
      workerReceived: 0,
      stagingGames: 0,
      publishedGames: 0
    }
    return {
      rankSnapshots: ranks,
      items,
      changed,
      skipped: classified.sourceUnion - selected.length,
      memberErrors,
      audit
    }
  }

  private async _resolveMembers(options: CollectionOptions) {
    const resolved: ResolvedMember[] = []
    const memberScans: MemberAnalysisCollectionAudit['memberScans'] = []
    for (const [index, target] of options.members.entries()) {
      this._throwIfCancelled(options.signal)
      let status: 'RESOLVED' | 'IDENTITY_LOOKUP_FAILED' = 'IDENTITY_LOOKUP_FAILED'
      try {
        const aliases = await this._riotClient.api.playerAccount.getPlayerAccountAlias(
          target.gameName,
          target.tagLine,
          { signal: options.signal }
        )
        const match = aliases.data.find(
          (alias) =>
            alias.alias.game_name.trim().toLocaleLowerCase() ===
              target.gameName.trim().toLocaleLowerCase() &&
            alias.alias.tag_line.trim().toLocaleLowerCase() ===
              target.tagLine.trim().toLocaleLowerCase()
        )
        if (!match) throw new Error('identity not found')
        status = 'RESOLVED'
        resolved.push({ member: index + 1, target, puuid: match.puuid })
        this._repository.recordMember(
          target.serverId,
          target.gameName,
          target.tagLine,
          match.puuid,
          null
        )
      } catch (error) {
        if (options.signal.aborted) throw error
        this._repository.recordMember(
          target.serverId,
          target.gameName,
          target.tagLine,
          null,
          'IDENTITY_LOOKUP_FAILED'
        )
      }
      memberScans.push({
        member: index + 1,
        status,
        historyGames: 0,
        pages: 0,
        stopReason: 'not-started'
      })
    }
    return { resolved, memberScans }
  }

  private async _scanHistories(
    histories: HistoryScan[],
    options: CollectionOptions,
    scanLimitPerMember: number
  ): Promise<MemberAnalysisCollectionAudit['collectionStopReason']> {
    for (let request = 0; request < MAX_HISTORY_REQUESTS; request += 1) {
      this._throwIfCancelled(options.signal)
      for (let offset = 0; offset < histories.length; offset += HISTORY_CONCURRENCY) {
        this._throwIfCancelled(options.signal)
        await Promise.all(
          histories.slice(offset, offset + HISTORY_CONCURRENCY).map(async (history) => {
            if (history.stopReason) return
            const remaining = scanLimitPerMember - history.gameIds.size
            if (remaining <= 0) {
              history.stopReason = 'safety-limit'
              return
            }
            const response = await this._retryHistoryRead(
              () =>
                this._sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(history.puuid, {
                  __sgpServerId: history.target.serverId,
                  startIndex: history.nextIndex,
                  count: Math.min(HISTORY_PAGE_SIZE, remaining),
                  tag: options.historyTag,
                  tagsQueryType: 'AND' as const,
                  signal: options.signal
                }),
              options.signal
            )
            const rawGames = response.data.games
            const games = rawGames.filter((game) => game?.json)
            history.pages += 1
            if (rawGames.length === 0) {
              history.stopReason = 'source-exhausted'
              return
            }
            const unseenInFeed = games.filter(
              (game) => !history.feedGameIds.has(`${history.target.serverId}:${game.json.gameId}`)
            )
            if (games.length > 0 && unseenInFeed.length === 0) {
              throw new Error(
                `history pagination repeated a page for anonymous member ${history.member}`
              )
            }
            history.nextIndex += rawGames.length
            for (const game of unseenInFeed) {
              const key = `${history.target.serverId}:${game.json.gameId}`
              history.feedGameIds.add(key)
              if (history.gameIds.has(key)) continue
              history.gameIds.add(key)
              history.games.push(game)
            }
            if (history.gameIds.size >= scanLimitPerMember) history.stopReason = 'safety-limit'
          })
        )
      }
      options.onProgress(
        histories.reduce((total, history) => total + history.gameIds.size, 0),
        scanLimitPerMember * histories.length,
        'scanning-history'
      )
      if (
        options.historyDepth !== 'all' &&
        this._classify(histories, histories, options.historyTag).roleEligible.length >=
          options.historyDepth
      )
        return 'target-reached'
      if (histories.every((history) => history.stopReason)) {
        return histories.some((history) => history.stopReason === 'safety-limit')
          ? 'safety-limit'
          : 'source-exhausted'
      }
    }
    for (const history of histories) history.stopReason ??= 'safety-limit'
    return 'safety-limit'
  }

  private async _retryHistoryRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      this._throwIfCancelled(signal)
      try {
        return await read()
      } catch (error) {
        this._throwIfCancelled(signal)
        const retryable =
          isAxiosError(error) &&
          ([429, 500, 502, 503, 504].includes(error.response?.status ?? 0) ||
            ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code ?? ''))
        // Retry the same read-only page, never advance the cursor or convert
        // a failed source into an empty feed. Authentication/validation errors fail immediately.
        if (!retryable || attempt >= 2) throw error
        await delay(500 * 2 ** attempt, undefined, { signal })
      }
    }
  }

  private _classify(histories: HistoryScan[], resolved: ResolvedMember[], historyTag: string) {
    const queueIdMatch = /^q_([1-9][0-9]{0,5})$/.exec(historyTag)
    const selectedQueueId = queueIdMatch ? Number(queueIdMatch[1]) : null
    const candidates = new Map<string, { serverId: string; summary: any }>()
    for (const history of histories)
      for (const summary of history.games)
        candidates.set(`${history.target.serverId}:${summary.json.gameId}`, {
          serverId: history.target.serverId,
          summary
        })
    const intersection = histories.length
      ? [...histories[0].gameIds].filter((gameId) =>
          histories.every((history) => history.gameIds.has(gameId))
        ).length
      : 0
    let fivePresent = 0
    let fiveSameTeam = 0
    let mapEligible = 0
    let queueEligible = 0
    const roleEligible: { serverId: string; summary: any }[] = []
    for (const candidate of candidates.values()) {
      const targetPuuids = new Set(
        resolved
          .filter((member) => member.target.serverId === candidate.serverId)
          .map((member) => member.puuid)
      )
      const present = new Set(
        (candidate.summary.json.participants ?? [])
          .filter((participant: any) => targetPuuids.has(participant.puuid))
          .map((participant: any) => participant.puuid)
      )
      if (present.size < 5) continue
      fivePresent += 1
      if (this._configuredTeam(candidate.summary, targetPuuids) === null) continue
      fiveSameTeam += 1
      if (candidate.summary.json.mapId !== 11) continue
      mapEligible += 1
      if (selectedQueueId !== null && candidate.summary.json.queueId !== selectedQueueId) continue
      queueEligible += 1
      const teamId = this._configuredTeam(candidate.summary, targetPuuids)
      if (teamId !== null && this._hasResolvedRoles(candidate.summary, teamId, targetPuuids))
        roleEligible.push(candidate)
    }
    return {
      sourceUnion: candidates.size,
      sourceIntersection: intersection,
      fivePresent,
      fiveSameTeam,
      mapEligible,
      queueEligible,
      roleEligible
    }
  }

  private _configuredTeam(summary: any, targetPuuids: Set<string>): number | null {
    const teams = new Map<number, Set<string>>()
    for (const participant of summary.json.participants ?? []) {
      if (!targetPuuids.has(participant.puuid)) continue
      const teamId = Number(participant.teamId)
      const members = teams.get(teamId) ?? new Set<string>()
      members.add(participant.puuid)
      teams.set(teamId, members)
    }
    const matches = [...teams.entries()].filter(([, members]) => members.size === 5)
    return matches.length === 1 ? matches[0][0] : null
  }

  private _hasResolvedRoles(summary: any, teamId: number, targetPuuids: Set<string>) {
    const aliases = new Map([
      ['MID', 'MIDDLE'],
      ['SUPPORT', 'UTILITY']
    ])
    const expected = new Set(['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'])
    const roles = new Set<string>()
    for (const participant of summary.json.participants ?? []) {
      if (Number(participant.teamId) !== teamId || !targetPuuids.has(participant.puuid)) continue
      const raw = String(
        participant.teamPosition ?? participant.individualPosition ?? participant.lane ?? ''
      ).toUpperCase()
      const role = aliases.get(raw) ?? raw
      if (expected.has(role)) roles.add(role)
    }
    return roles.size === expected.size
  }

  private _recency(summary: any) {
    return Number(summary.json.gameEndTimestamp ?? summary.json.gameCreation ?? summary.json.gameId)
  }

  private _throwIfCancelled(signal: AbortSignal) {
    if (signal.aborted) throw signal.reason ?? new Error('cancelled')
  }
}
