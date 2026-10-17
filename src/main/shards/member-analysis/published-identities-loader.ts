import {
  type MemberAnalysisPublishedMemberIdentitiesPage,
  MemberAnalysisPublishedMemberIdentitiesPageSchema,
  type MemberAnalysisPublishedMemberIdentitiesRequest,
  type MemberAnalysisSettings
} from '@shared/shards/member-analysis'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { randomBytes } from 'node:crypto'

import type { CurrentProfileIcons } from './current-profile-icons'
import {
  PublishedIdentitiesExecutor,
  type PublishedIdentityReader
} from './published-identities-executor'
import type { PublishedIdentityGame } from './published-identities-source'
import type { MemberAnalysisRepository } from './repository'

/** Only identity projection and bounded local IO; no metric aggregation. */
export class PublishedIdentitiesLoader {
  private _disposed = false
  private _configuration: { scope: string; token: string } | null = null
  private _profileToken: string | null = null
  private readonly _profiles = new Map<number, Promise<PublishedIdentityGame | null>>()
  private readonly _cursors = new Map<
    string,
    { scope: string; cursor: string; expiresAt: number }
  >()
  constructor(
    private readonly _repository: MemberAnalysisRepository,
    private readonly _currentMembers: () => MemberAnalysisSettings['members'],
    private readonly _reader: PublishedIdentityReader = new PublishedIdentitiesExecutor(),
    private readonly _currentProfiles?: CurrentProfileIcons
  ) {}

  async dispose() {
    this._disposed = true
    await this._reader.dispose?.()
    this._cursors.clear()
    this._profiles.clear()
  }

  /** Per-publication, per-game proof cache. Repeated overview pages never re-read raw. */
  async enrichProfiles(games: MemberAnalysisGame[], token: string) {
    const assertCurrent = () => {
      if (this._disposed) throw new Error('Stale published identities request')
      this._currentMembers() // also verifies service lifecycle/enable state
      if (this._repository.publicationToken() !== token)
        throw new Error('Stale published identities request')
    }
    assertCurrent()
    if (this._profileToken !== token) {
      this._profileToken = token
      this._profiles.clear()
    }
    const cache = this._profiles
    const missing = [...new Set(games.map((game) => game.gameId))].filter((id) => !cache.has(id))
    for (let offset = 0; offset < missing.length; offset += 25) {
      const ids = missing.slice(offset, offset + 25).filter((id) => !cache.has(id))
      if (!ids.length) continue
      const rows = this._repository.readPublishedProfileRows(ids)
      // Ambiguous numeric IDs must not be joined across servers.
      const tasks = rows
        .filter((row) => row.ambiguous === 1)
        .map((row) => ({
          serverId: row.server_id,
          gameId: row.game_id,
          checksum: row.checksum,
          payload: row.payload_json,
          ambiguous: row.ambiguous,
          identityFacts: row.identityFacts
        }))
      const pending = tasks.length
        ? this._reader.execute(
            {
              dataRoot: this._repository.dataRoot,
              tasks,
              members: [],
              profileToken: token
            },
            assertCurrent
          )
        : Promise.resolve([])
      for (const id of ids) {
        const entry: Promise<PublishedIdentityGame | null> = pending.then(
          (results) => results.find((result) => result.gameId === id) ?? null,
          () => {
            // Operational failure is retryable. An old rejection must not erase
            // a newer publication's proof or another request's cache entry.
            if (this._profileToken === token && cache.get(id) === entry) cache.delete(id)
            return null
          }
        )
        cache.set(id, entry)
      }
      // Bound queued workers as well as raw IO; do not schedule an entire history.
      await pending
      assertCurrent()
    }
    const result = await Promise.all(
      games.map(async (game) => {
        const proof = await cache.get(game.gameId)
        return {
          ...game,
          players: game.players.map((player) => {
            const profile =
              proof?.status === 'available'
                ? proof.profiles?.find((row) => row.player === player.player)
                : undefined
            return {
              ...player,
              profileIdentity: profile?.identity ?? null,
              profileIconId: profile?.profileIconId ?? null
            }
          })
        }
      })
    )
    const proofs = await Promise.all(games.map((game) => cache.get(game.gameId)))
    const current = await this._currentProfiles?.resolve(
      proofs.flatMap((proof) => (proof?.status === 'available' ? (proof.lookups ?? []) : [])),
      assertCurrent
    )
    if (current?.size)
      for (const game of result)
        for (const player of game.players)
          if (player.profileIdentity && current.has(player.profileIdentity))
            player.profileIconId = current.get(player.profileIdentity)!
    assertCurrent()
    return result
  }

  async read(
    request: Required<MemberAnalysisPublishedMemberIdentitiesRequest>
  ): Promise<MemberAnalysisPublishedMemberIdentitiesPage> {
    const configuration = () => {
      const members = this._currentMembers()
      const resolved = this._repository.resolveConfiguredMembers(members)
      return { members, resolved, scope: JSON.stringify([members, resolved]) }
    }
    const initial = configuration()
    if (request.memberSlots.some((slot) => !initial.members[slot - 1]))
      throw new Error('Invalid published identities request')
    if (this._configuration?.scope !== initial.scope)
      this._configuration = { scope: initial.scope, token: randomBytes(24).toString('base64url') }
    const configurationToken = this._configuration.token
    const scope = JSON.stringify([
      request.publicationToken,
      initial.scope,
      request.memberSlots,
      request.pageSize
    ])
    const assertCurrent = () => {
      if (
        this._disposed ||
        this._repository.publicationToken() !== request.publicationToken ||
        configuration().scope !== initial.scope
      )
        throw new Error('Stale published identities request')
    }
    assertCurrent()
    const now = Date.now()
    for (const [key, value] of this._cursors)
      if (value.expiresAt <= now || value.expiresAt > now + 30 * 60_000) this._cursors.delete(key)
    const previous = request.cursor ? this._cursors.get(request.cursor) : null
    if (request.cursor && (!previous || previous.scope !== scope))
      throw new Error('Invalid published identities request')
    const rows = this._repository.readPublishedIdentityRows(
      previous?.cursor ?? null,
      request.pageSize
    )
    const tasks = rows.slice(0, request.pageSize).map((row) => ({
      serverId: row.server_id,
      gameId: row.game_id,
      checksum: row.checksum,
      payload: row.payload_json,
      ambiguous: row.ambiguous,
      identityFacts: row.identityFacts
    }))
    const games = await this._reader.execute(
      {
        dataRoot: this._repository.dataRoot,
        tasks,
        members: request.memberSlots.map((slot) => ({
          slot,
          serverId: initial.members[slot - 1].serverId,
          puuid: initial.resolved[slot - 1]?.puuid ?? null
        }))
      },
      assertCurrent
    )
    assertCurrent()
    let nextCursor: string | null = null
    if (rows.length > request.pageSize) {
      nextCursor = randomBytes(24).toString('base64url')
      while (this._cursors.size >= 128) this._cursors.delete(this._cursors.keys().next().value!)
      const last = rows[request.pageSize - 1]
      this._cursors.set(nextCursor, {
        scope,
        cursor: this._repository.publishedIdentityCursor(last.game_id, last.server_id),
        expiresAt: now + 30 * 60_000
      })
    }
    assertCurrent()
    return MemberAnalysisPublishedMemberIdentitiesPageSchema.parse({
      publicationToken: request.publicationToken,
      configurationToken,
      configuredMemberIds: request.memberSlots.map((slot) => `member-slot-${slot}`),
      games: games.map(({ lookups: _privateLookups, ...game }) => game),
      pagination: { nextCursor }
    })
  }
}
