import { EMPTY_PUUID } from '@shared/constants/common'
import {
  MemberAnalysisGameSchema,
  type MemberAnalysisPublishedMemberIdentitiesPage
} from '@shared/shards/member-analysis'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'
import { z } from 'zod'

import type { ProfileIconLookup } from './profile-icon-lookup'

export type PublishedIdentityTask = {
  serverId: string
  gameId: number
  checksum: string
  payload: string
  ambiguous: number
  identityFacts?: {
    methodVersion: number
    checksum: string
    summaryDigest: string
    payload: string
  }
}
export type PublishedIdentityMember = { slot: number; serverId: string; puuid: string | null }
export type PublishedIdentityBatch = {
  dataRoot: string
  tasks: PublishedIdentityTask[]
  members: PublishedIdentityMember[]
  profileToken?: string
  /** Main-only publication verification. Never accepted from renderer IPC. */
  verifyFacts?: boolean
}
export type PublishedIdentityGame = MemberAnalysisPublishedMemberIdentitiesPage['games'][number] & {
  lookups?: ProfileIconLookup[]
}
const decompress = promisify(gunzip)
const maximumBytes = 32 * 1024 * 1024
const participantsSchema = z
  .array(
    z.object({
      participantId: z.number().int().min(1).max(10),
      puuid: z
        .string()
        .min(1)
        .refine((value) => value !== EMPTY_PUUID),
      teamId: z.union([z.literal(100), z.literal(200)])
    })
  )
  .length(10)
const identityFactsSchema = z
  .array(
    participantsSchema.element
      .extend({
        profileIconId: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
      })
      .strict()
  )
  .length(10)
const normalizedIcon = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
function contained(root: string, path: string) {
  return path.startsWith(`${root}${sep}`)
}
async function safeRead(root: string, indexedPath: string, serverId: string, gameId: number) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(serverId) || !Number.isSafeInteger(gameId) || gameId <= 0)
    throw new Error('invalid-context')
  const expected = resolve(root, 'raw', serverId, String(gameId), 'summary.json.gz')
  const indexed = resolve(root, indexedPath)
  if (indexed !== expected || !contained(root, indexed)) throw new Error('invalid-context')
  const canonicalRoot = await realpath(root)
  let part = root
  for (const segment of relative(root, expected).split(sep)) {
    part = join(part, segment)
    if ((await lstat(part)).isSymbolicLink()) throw new Error('invalid-context')
  }
  const actual = await realpath(expected)
  if (!contained(canonicalRoot, actual)) throw new Error('invalid-context')
  const before = await lstat(actual)
  if (!before.isFile() || before.size > maximumBytes) throw new Error('invalid-context')
  const handle = await open(actual, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const opened = await handle.stat()
    if (
      !opened.isFile() ||
      // Windows path-based stat may report st_dev=0 (unknown), while fstat
      // reports the volume. Never waive a known, nonzero device mismatch.
      (opened.dev !== before.dev && !(process.platform === 'win32' && before.dev === 0)) ||
      opened.ino !== before.ino ||
      opened.size !== before.size ||
      opened.mtimeMs !== before.mtimeMs ||
      opened.ctimeMs !== before.ctimeMs
    )
      throw new Error('invalid-context')
    const bytes = await handle.readFile()
    const after = await handle.stat()
    if (
      bytes.length > maximumBytes ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new Error('invalid-context')
    return {
      value: JSON.parse(
        (await decompress(bytes, { maxOutputLength: maximumBytes })).toString('utf8')
      ),
      digest: createHash('sha256').update(bytes).digest('hex')
    }
  } finally {
    await handle.close()
  }
}

/** Dedicated worker only: exact proof, no timeline, network, mutable catalog or renderer IO. */
export async function projectPublishedIdentity(
  batch: PublishedIdentityBatch,
  task: PublishedIdentityTask,
  database: DatabaseSync | null
): Promise<PublishedIdentityGame> {
  const result: PublishedIdentityGame = {
    gameId: task.gameId,
    status: 'identity-unavailable',
    members: []
  }
  if (task.ambiguous !== 1 && !batch.verifyFacts) return { ...result, status: 'ambiguous-game' }
  try {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(task.serverId) ||
      !Number.isSafeInteger(task.gameId) ||
      task.gameId <= 0
    )
      throw new Error('invalid-context')
    const stored = task.identityFacts
    if (batch.verifyFacts && !stored) throw new Error('invalid-context')
    const facts = stored ? identityFactsSchema.parse(JSON.parse(stored.payload)) : null
    if (
      stored &&
      (stored.methodVersion !== 1 ||
        stored.checksum !== task.checksum ||
        !/^[a-f0-9]{64}$/.test(stored.checksum) ||
        !/^[a-f0-9]{64}$/.test(stored.summaryDigest))
    )
      throw new Error('invalid-context')
    let actors: z.infer<typeof identityFactsSchema>
    if (facts && !batch.verifyFacts) {
      actors = facts
    } else {
      if (!database) throw new Error('invalid-context')
      const rows = database
        .prepare(
          batch.verifyFacts
            ? 'SELECT server_id,checksum,summary_path FROM catalog_games WHERE game_id=? AND server_id=? LIMIT 2'
            : 'SELECT server_id,checksum,summary_path FROM catalog_games WHERE game_id=? LIMIT 2'
        )
        .all(...(batch.verifyFacts ? [task.gameId, task.serverId] : [task.gameId])) as {
        server_id: string
        checksum: string
        summary_path: string
      }[]
      if (rows.length === 0) return { ...result, status: 'raw-missing' }
      if (
        rows.length !== 1 ||
        rows[0].server_id !== task.serverId ||
        rows[0].checksum !== task.checksum
      )
        throw new Error('invalid-context')
      const read = await safeRead(batch.dataRoot, rows[0].summary_path, task.serverId, task.gameId)
      const summary = read.value
      if (stored && read.digest !== stored.summaryDigest) throw new Error('invalid-context')
      if (summary?.json?.gameId !== task.gameId || !Array.isArray(summary?.json?.teams))
        throw new Error('invalid-context')
      const rawActors = participantsSchema.parse(summary?.json?.participants)
      // Only these two main-owned annotations are excluded; original JSON order is retained.
      for (const actor of summary.json.participants) {
        delete actor._target
        delete actor._targetName
      }
      if (createHash('sha256').update(JSON.stringify(summary)).digest('hex') !== task.checksum)
        throw new Error('invalid-context')
      actors = rawActors.map((actor) => ({
        ...actor,
        profileIconId: normalizedIcon(
          summary.json.participants.find((raw: any) => raw.participantId === actor.participantId)
            ?.profileIcon
        )
      }))
      if (
        facts &&
        JSON.stringify([...facts].sort((a, b) => a.participantId - b.participantId)) !==
          JSON.stringify([...actors].sort((a, b) => a.participantId - b.participantId))
      )
        throw new Error('invalid-context')
    }
    if (
      new Set(actors.map((actor) => actor.puuid)).size !== 10 ||
      new Set(actors.map((actor) => actor.participantId)).size !== 10 ||
      actors.filter((actor) => actor.teamId === 100).length !== 5
    )
      throw new Error('invalid-context')
    const derived = MemberAnalysisGameSchema.parse(JSON.parse(task.payload))
    const own = actors.filter((actor) => actor.teamId === (derived.side === 'Blue' ? 100 : 200))
    if (
      derived.gameId !== task.gameId ||
      derived.players.length !== 5 ||
      new Set(derived.players.map((player) => player.participantId)).size !== 5 ||
      derived.players.some(
        (player) =>
          player.participantId === undefined ||
          !own.some((actor) => actor.participantId === player.participantId)
      ) ||
      new Set(derived.players.map((player) => player.player)).size !== 5
    )
      throw new Error('invalid-context')
    if (batch.profileToken) {
      if (!/^[A-Za-z0-9_-]{32}$/.test(batch.profileToken)) throw new Error('invalid-context')
      result.profiles = derived.players.map((player) => {
        const actor = own.find((actor) => actor.participantId === player.participantId)!
        return {
          player: player.player,
          identity: createHash('sha256')
            .update(JSON.stringify([batch.profileToken, task.serverId, actor.puuid]))
            .digest('hex'),
          profileIconId: actor.profileIconId
        }
      })
      result.lookups = derived.players.map((player) => {
        const actor = own.find((actor) => actor.participantId === player.participantId)!
        return {
          identity: result.profiles!.find((profile) => profile.player === player.player)!.identity,
          serverId: task.serverId,
          puuid: actor.puuid
        }
      })
    }
    for (const member of batch.members) {
      if (!member.puuid || member.serverId !== task.serverId) continue
      const actor = own.find((actor) => actor.puuid === member.puuid)
      const player =
        actor && derived.players.find((player) => player.participantId === actor.participantId)
      if (player)
        result.members.push({ memberId: `member-slot-${member.slot}`, player: player.player })
    }
    if (new Set(result.members.map((member) => member.player)).size !== result.members.length)
      throw new Error('invalid-context')
    result.status = 'available'
    return result
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return { ...result, status: 'raw-missing', members: [] }
    return { ...result, status: 'identity-unavailable', members: [] }
  }
}
export async function projectPublishedIdentityBatch(
  batch: PublishedIdentityBatch,
  boundary: () => void = () => {}
): Promise<PublishedIdentityGame[]> {
  if (!isAbsolute(batch.dataRoot) || batch.tasks.length > 25 || batch.members.length > 20)
    throw new Error('invalid-context')
  let database: DatabaseSync | null = null
  if (batch.verifyFacts || batch.tasks.some((task) => !task.identityFacts)) {
    const catalog = join(batch.dataRoot, 'db', 'catalog.sqlite3')
    const catalogStat = await lstat(catalog)
    if (!catalogStat.isFile() || catalogStat.isSymbolicLink()) throw new Error('invalid-context')
    const catalogActual = await realpath(catalog)
    if (!contained(await realpath(batch.dataRoot), catalogActual))
      throw new Error('invalid-context')
    database = new DatabaseSync(catalogActual, { readOnly: true })
  }
  const results: PublishedIdentityGame[] = new Array(batch.tasks.length)
  let index = 0
  try {
    const run = async () => {
      while (index < batch.tasks.length) {
        const current = index++
        results[current] = await projectPublishedIdentity(batch, batch.tasks[current], database)
        boundary()
      }
    }
    const completed = await Promise.allSettled([run(), run()])
    const failed = completed.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
    return results
  } finally {
    database?.close()
  }
}
