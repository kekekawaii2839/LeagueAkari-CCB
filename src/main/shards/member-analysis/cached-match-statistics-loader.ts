import { type MemberAnalysisGame, MemberAnalysisGameSchema } from '@shared/shards/member-analysis'
import { createHash } from 'node:crypto'

import { readCachedPublishedSummary } from './published-identities-source'
import type { MemberAnalysisRepository } from './repository'

type Statistics = Pick<MemberAnalysisGame, 'bans' | 'teamMetrics'>
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null

/** Derived only from exact, checksum-verified cached summary. No timeline guesses. */
export function cachedSummaryStatistics(summary: any, game: MemberAnalysisGame): Statistics | null {
  if (
    summary?.json?.gameId !== game.gameId ||
    !Array.isArray(summary.json.participants) ||
    summary.json.participants.length !== 10 ||
    !Array.isArray(summary.json.teams)
  )
    return null
  const source = summary.json
  const ownTeam = game.side === 'Blue' ? 100 : 200
  const team = source.teams.find((row: any) => row.teamId === ownTeam)
  if (!team || source.teams.filter((row: any) => row.teamId === ownTeam).length !== 1) return null
  const bans = (teamId: number): number[] | null => {
    const rows = source.teams.filter((row: any) => row.teamId === teamId)
    if (rows.length !== 1 || !Array.isArray(rows[0].bans) || rows[0].bans.length > 5) return null
    if (
      rows[0].bans.some(
        (ban: any) => !ban || !Number.isSafeInteger(ban.championId) || ban.championId < -1
      )
    )
      return null
    return rows[0].bans.map((ban: any) => ban.championId).filter((id: number) => id > 0)
  }
  const kills = source.participants.map((row: any) => count(row.kills))
  const result = {
    bans: { own: bans(ownTeam), enemy: bans(300 - ownTeam) },
    teamMetrics: {
      totalKills: kills.every((value: number | null) => value !== null)
        ? kills.reduce((sum: number, value: number) => sum + value, 0)
        : null,
      firstDragonTime: null,
      firstTowerTime: null,
      dragons: null,
      barons: count(team.objectives?.baron?.kills),
      dragonSouls: null,
      elderDragons: null
    }
  }
  const parsed = MemberAnalysisGameSchema.pick({ bans: true, teamMetrics: true }).safeParse(result)
  return parsed.success ? parsed.data : null
}

/** Bounded optional read enrichment; never changes published data or forces collection. */
export class CachedMatchStatisticsLoader {
  private _token: string | null = null
  private _disposed = false
  private readonly _cache = new Map<number, Promise<Statistics | null>>()
  private _activeReads = 0
  private readonly _waiting: (() => void)[] = []
  constructor(private readonly _repository: MemberAnalysisRepository) {}
  dispose() {
    this._disposed = true
    this._cache.clear()
    for (const release of this._waiting.splice(0)) release()
  }
  private async _read(operation: () => Promise<Statistics | null>) {
    // Bound work across simultaneous overview requests, not only within one page.
    if (this._waiting.length >= 100 || this._disposed) return null
    if (this._activeReads >= 2) await new Promise<void>((resolve) => this._waiting.push(resolve))
    else this._activeReads++
    if (this._disposed) return null
    try {
      return await operation()
    } finally {
      const next = this._waiting.shift()
      if (next) next()
      else this._activeReads--
    }
  }
  async enrich(games: MemberAnalysisGame[], token: string): Promise<MemberAnalysisGame[]> {
    const assertCurrent = () => {
      if (this._disposed || this._repository.publicationToken() !== token)
        throw new Error('Stale cached statistics request')
    }
    assertCurrent()
    if (games.length > 100) throw new Error('Invalid cached statistics page')
    if (this._token !== token) {
      this._token = token
      this._cache.clear()
    }
    const missing = games.filter((game) => !game.bans || !game.teamMetrics)
    if (!missing.length) return games
    const rows = this._repository.readPublishedProfileRows(missing.map((game) => game.gameId))
    let index = 0
    const output = new Map<number, Statistics | null>()
    const read = async () => {
      while (index < missing.length) {
        const game = missing[index++]
        assertCurrent()
        let pending = this._cache.get(game.gameId)
        if (!pending) {
          const matches = rows.filter((row) => row.game_id === game.gameId && row.ambiguous === 1)
          pending = this._read(async () => {
            if (matches.length !== 1) return null
            const row = matches[0],
              item = this._repository.catalogItem(row.server_id, row.game_id)
            if (!item || item.checksum !== row.checksum) return null
            try {
              const { value } = await readCachedPublishedSummary(
                this._repository.dataRoot,
                item.summaryPath,
                row.server_id,
                row.game_id
              )
              if (!Array.isArray(value?.json?.participants)) return null
              for (const actor of value.json.participants) {
                delete actor._target
                delete actor._targetName
              }
              if (createHash('sha256').update(JSON.stringify(value)).digest('hex') !== row.checksum)
                return null
              return cachedSummaryStatistics(value, game)
            } catch {
              return null
            }
          })
          while (this._cache.size >= 1000) this._cache.delete(this._cache.keys().next().value!)
          this._cache.set(game.gameId, pending)
        }
        output.set(game.gameId, await pending)
        assertCurrent()
      }
    }
    await Promise.all([read(), read()])
    assertCurrent()
    return games.map((game) => {
      const extra = output.get(game.gameId)
      return extra
        ? {
            ...game,
            bans: game.bans ?? extra.bans,
            teamMetrics: game.teamMetrics ?? extra.teamMetrics
          }
        : game
    })
  }
}
