import type { RiotClientMain } from '@main/shards/riot-client'
import type { SgpMain } from '@main/shards/sgp'
import type { MemberAnalysisCollectionAudit } from '@shared/shards/member-analysis'

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
    }

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
      await Promise.all(
        histories.map(async (history) => {
          if (history.stopReason) return
          const remaining = scanLimitPerMember - history.gameIds.size
          if (remaining <= 0) {
            history.stopReason = 'safety-limit'
            return
          }
          const response =
            await this._sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(
              history.puuid,
              {
                __sgpServerId: history.target.serverId,
                startIndex: history.nextIndex,
                count: Math.min(HISTORY_PAGE_SIZE, remaining),
                tag: options.historyTag,
                tagsQueryType: 'AND' as const,
                signal: options.signal
              }
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
