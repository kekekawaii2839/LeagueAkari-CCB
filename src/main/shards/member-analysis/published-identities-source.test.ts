import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { afterEach, expect, test, vi } from 'vitest'

import {
  type PublishedIdentityBatch,
  projectPublishedIdentityBatch
} from './published-identities-source'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat) }
})

const roots: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    expect(root.startsWith(tmpdir())).toBe(true)
    rmSync(root, { recursive: true, force: true })
  }
})
function syntheticGame(gameId: number, player = 'Player Alpha') {
  return {
    gameId,
    timestamp: gameId,
    date: '2026-01-01',
    patch: '1.1',
    side: 'Blue',
    win: gameId % 2 === 0,
    duration: 1800,
    roster: player,
    dragon15Diff: 0,
    grub15Diff: 0,
    objectiveFight15Diff: 0,
    counterMean: null,
    upperGold15: 0,
    botGold15: 0,
    gold20Diff: 0,
    tower20Diff: 0,
    jungle: null,
    eventDecision: {
      killEpisodes: 0,
      convertedKillEpisodes: 0,
      killToEpicEpisodes: 0,
      killToTowerEpisodes: 0,
      conversionDelayTotalSec: 0,
      conversionDelaySamples: 0,
      deathEpisodes: 0,
      highCostDeathEpisodes: 0,
      deathCostEpics: 0,
      deathCostTowers: 0,
      deathCostPlates: 0,
      deathCostPoints: 0,
      shutdownBountyLost: 0,
      objectivesTaken: 0,
      cleanObjectives: 0,
      wonFightObjectives: 0,
      evenFightObjectives: 0,
      lostFightObjectives: 0,
      objectiveFightSamples: 0,
      objectiveFightWins: 0,
      enemyObjectives: 0,
      tradedEnemyObjectives: 0,
      tradeDelayTotalSec: 0,
      tradeDelaySamples: 0
    },
    players: [
      {
        player,
        role: 'TOP',
        champion: 'Champion A',
        minutes: 30,
        kills: 0,
        deaths: 0,
        assists: 0,
        teamKills: 0,
        teamDeaths: 0,
        damage: 0,
        damageShare: null,
        gold: 0,
        goldShare: null,
        cs: 0,
        vision: 0,
        wardsPlaced: 0,
        wardsKilled: 0,
        controlWards: 0,
        damageTaken: 0,
        takenShare: null,
        damageMitigated: 0,
        objectiveDamage: 0,
        turretDamage: 0,
        healTeammates: 0,
        shieldTeammates: 0,
        ccSeconds: 0,
        soloKills: 0,
        fbPart: false,
        ftPart: false,
        kp: null,
        gd10: null,
        gd15: null,
        csd15: null,
        xpd15: null,
        damageDiff15: null,
        soloDiff15: null,
        counter: null
      }
    ]
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'akari-identity-worker-test-only-'))
  roots.push(root)
  mkdirSync(join(root, 'db'))
  mkdirSync(join(root, 'raw', 'TEST', '1'), { recursive: true })
  const raw = {
    json: {
      gameId: 1,
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1,
        puuid: `SYNTHETIC_TEST_ONLY_${index + 1}`,
        teamId: index < 5 ? 100 : 200
      })),
      teams: []
    }
  }
  const hash = createHash('sha256').update(JSON.stringify(raw)).digest('hex')
  const enriched = structuredClone(raw)
  for (const actor of enriched.json.participants)
    Object.assign(actor, { _target: actor.teamId === 100, _targetName: 'OLD_TEST_ONLY' })
  const path = join(root, 'raw', 'TEST', '1', 'summary.json.gz')
  writeFileSync(path, gzipSync(JSON.stringify(enriched)))
  const database = new DatabaseSync(join(root, 'db', 'catalog.sqlite3'))
  database.exec(
    'CREATE TABLE catalog_games(server_id TEXT,game_id INTEGER,checksum TEXT,summary_path TEXT)'
  )
  database.prepare('INSERT INTO catalog_games VALUES(?,?,?,?)').run('TEST', 1, hash, path)
  database.close()
  const game = syntheticGame(1)
  game.players = Array.from({ length: 5 }, (_, index) => ({
    ...game.players[0],
    player: `OLD_NAME_${index + 1}`,
    participantId: index + 1
  }))
  const batch: PublishedIdentityBatch = {
    dataRoot: root,
    tasks: [
      { serverId: 'TEST', gameId: 1, checksum: hash, payload: JSON.stringify(game), ambiguous: 1 }
    ],
    members: [{ slot: 1, serverId: 'TEST', puuid: 'SYNTHETIC_TEST_ONLY_2' }]
  }
  return { root, path, raw, game, batch }
}
test('async proof preserves exact old label/PID and annotation-independent checksum', async () => {
  const { batch } = fixture()
  const boundary = vi.fn()
  const result = await projectPublishedIdentityBatch(batch, boundary)
  expect(result).toEqual([
    {
      gameId: 1,
      status: 'available',
      members: [{ memberId: 'member-slot-1', player: 'OLD_NAME_2' }]
    }
  ])
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_TEST_ONLY_2')
  expect(boundary).toHaveBeenCalledTimes(1)
})
test('missing, corrupted, changed raw/checksum and legacy without PID never guess identity', async () => {
  const { path, raw, game, batch } = fixture()
  rmSync(path)
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('raw-missing')
  writeFileSync(path, Buffer.from('invalid'))
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  writeFileSync(path, gzipSync(JSON.stringify({ ...raw, extra: 1 })))
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  writeFileSync(path, gzipSync(JSON.stringify(raw)))
  const old = structuredClone(game)
  for (const player of old.players) delete (player as { participantId?: number }).participantId
  batch.tasks[0].payload = JSON.stringify(old)
  expect((await projectPublishedIdentityBatch(batch))[0].members).toEqual([])
})
test('canonical path and symlink outside root are rejected before reading external bytes', async () => {
  const { root, path, batch } = fixture()
  const outside = mkdtempSync(join(tmpdir(), 'akari-identity-outside-test-only-'))
  roots.push(outside)
  const sentinel = join(outside, 'sentinel.gz')
  writeFileSync(sentinel, gzipSync('{}'))
  const database = new DatabaseSync(join(root, 'db', 'catalog.sqlite3'))
  database.prepare('UPDATE catalog_games SET summary_path=?').run(sentinel)
  database.close()
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  expect(existsSync(sentinel)).toBe(true)
  const restore = new DatabaseSync(join(root, 'db', 'catalog.sqlite3'))
  restore.prepare('UPDATE catalog_games SET summary_path=?').run(path)
  restore.close()
  const folder = join(root, 'raw', 'TEST', '1')
  rmSync(folder, { recursive: true })
  symlinkSync(outside, folder, process.platform === 'win32' ? 'junction' : 'dir')
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  expect(readFileSync(sentinel)).toEqual(gzipSync('{}'))
})
test('compressed/decompressed bound, cross-region ambiguity and stale boundary fail closed', async () => {
  const { path, batch } = fixture()
  writeFileSync(path, Buffer.alloc(32 * 1024 * 1024 + 1))
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  writeFileSync(path, gzipSync(Buffer.alloc(32 * 1024 * 1024 + 1, 32)))
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  batch.tasks[0].ambiguous = 2
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('ambiguous-game')
  await expect(
    projectPublishedIdentityBatch(batch, () => {
      throw new Error('Stale published identities request')
    })
  ).rejects.toThrow('Stale published identities request')
  await expect(
    projectPublishedIdentityBatch({
      ...batch,
      tasks: Array.from({ length: 26 }, () => batch.tasks[0])
    })
  ).rejects.toThrow('invalid-context')
})

test('profile proof covers historical extras, icon zero and publication/server/PUUID isolation without names', async () => {
  const f = fixture()
  const save = () => {
    const checksum = createHash('sha256').update(JSON.stringify(f.raw)).digest('hex')
    writeFileSync(f.path, gzipSync(JSON.stringify(f.raw)))
    const db = new DatabaseSync(join(f.root, 'db', 'catalog.sqlite3'))
    db.prepare('UPDATE catalog_games SET checksum=?').run(checksum)
    db.close()
    f.batch.tasks[0].checksum = checksum
  }
  Object.assign(f.raw.json.participants[0], { profileIcon: 0 })
  Object.assign(f.raw.json.participants[1], { profileIcon: -1 })
  save()
  f.batch.profileToken = 'A'.repeat(32)
  f.batch.members = []
  const first = (await projectPublishedIdentityBatch(f.batch))[0]
  expect(first.profiles).toHaveLength(5)
  expect(first.profiles?.[0].profileIconId).toBe(0)
  expect(first.profiles?.[1].profileIconId).toBeNull()
  expect(first.profiles?.[2].profileIconId).toBeNull()
  expect(JSON.stringify(first.profiles)).not.toContain('SYNTHETIC_TEST_ONLY')
  expect(first.lookups?.[0]).toMatchObject({ serverId: 'TEST', puuid: 'SYNTHETIC_TEST_ONLY_1' })
  // participantId is reused in another match: the immutable identity is PUUID,
  // never the position/label or numeric ID. Same-name/different-tag also differs.
  f.raw.json.participants[0].puuid = 'SAME_NAME_DIFFERENT_TAG_PUUID'
  save()
  const other = (await projectPublishedIdentityBatch(f.batch))[0]
  expect(other.profiles?.[0].identity).not.toBe(first.profiles?.[0].identity)
  f.batch.profileToken = 'B'.repeat(32)
  expect((await projectPublishedIdentityBatch(f.batch))[0].profiles?.[0].identity).not.toBe(
    other.profiles?.[0].identity
  )
  // Identical PUUID strings on different servers must remain distinct.
  f.batch.profileToken = 'A'.repeat(32)
  const serverPath = join(f.root, 'raw', 'OTHER', '1', 'summary.json.gz')
  mkdirSync(join(f.root, 'raw', 'OTHER', '1'), { recursive: true })
  writeFileSync(serverPath, gzipSync(JSON.stringify(f.raw)))
  const db = new DatabaseSync(join(f.root, 'db', 'catalog.sqlite3'))
  db.prepare('UPDATE catalog_games SET server_id=?,summary_path=?').run('OTHER', serverPath)
  db.close()
  f.batch.tasks[0].serverId = 'OTHER'
  expect((await projectPublishedIdentityBatch(f.batch))[0].profiles?.[0].identity).not.toBe(
    other.profiles?.[0].identity
  )
})

test('Windows unknown path device zero is tolerated, but a known device mismatch still fails closed', async () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const actualLstat = (await vi.importActual<typeof fsPromises>('node:fs/promises')).lstat
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const f = fixture()
    let device = 0
    vi.spyOn(fsPromises, 'lstat').mockImplementation((async (...args: any[]) => {
      const value = await (actualLstat as any)(...args)
      if (String(args[0]).endsWith('summary.json.gz')) value.dev = device
      return value
    }) as any)
    expect((await projectPublishedIdentityBatch(f.batch))[0].status).toBe('available')
    device = 123456789
    expect((await projectPublishedIdentityBatch(f.batch))[0].status).toBe('identity-unavailable')
    device = 0
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    expect((await projectPublishedIdentityBatch(f.batch))[0].status).toBe('identity-unavailable')
  } finally {
    Object.defineProperty(process, 'platform', originalPlatform)
  }
})

function withFacts(value: ReturnType<typeof fixture>) {
  value.batch.tasks[0].identityFacts = {
    methodVersion: 1,
    checksum: value.batch.tasks[0].checksum,
    summaryDigest: createHash('sha256').update(readFileSync(value.path)).digest('hex'),
    payload: JSON.stringify(
      value.raw.json.participants.map((actor) => ({ ...actor, profileIconId: null }))
    )
  }
  return value
}
test('published facts remain usable without raw or catalog and remap current slots by identity', async () => {
  const { root, path, batch } = withFacts(fixture())
  rmSync(path)
  rmSync(join(root, 'db', 'catalog.sqlite3'))
  batch.members = [{ slot: 3, serverId: 'TEST', puuid: 'SYNTHETIC_TEST_ONLY_4' }]
  expect(await projectPublishedIdentityBatch(batch)).toEqual([
    {
      gameId: 1,
      status: 'available',
      members: [{ memberId: 'member-slot-3', player: 'OLD_NAME_4' }]
    }
  ])
  batch.tasks[0].ambiguous = 2
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('ambiguous-game')
})
test('new malformed facts fail closed rather than silently using valid raw', async () => {
  for (const mutation of [
    (fact: NonNullable<PublishedIdentityBatch['tasks'][number]['identityFacts']>) => {
      fact.methodVersion = 2
    },
    (fact: NonNullable<PublishedIdentityBatch['tasks'][number]['identityFacts']>) => {
      fact.checksum = 'a'.repeat(64)
    },
    (fact: NonNullable<PublishedIdentityBatch['tasks'][number]['identityFacts']>) => {
      const rows = JSON.parse(fact.payload)
      rows[1].puuid = rows[0].puuid
      fact.payload = JSON.stringify(rows)
    },
    (fact: NonNullable<PublishedIdentityBatch['tasks'][number]['identityFacts']>) => {
      const rows = JSON.parse(fact.payload)
      rows[1].teamId = 200
      fact.payload = JSON.stringify(rows)
    }
  ]) {
    const { batch } = withFacts(fixture())
    mutation(batch.tasks[0].identityFacts!)
    expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  }
})
test('publication verification requires both exact raw checksum and same Python source bytes', async () => {
  const { batch, path } = withFacts(fixture())
  batch.verifyFacts = true
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('available')
  batch.tasks[0].identityFacts!.summaryDigest = 'a'.repeat(64)
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  batch.tasks[0].identityFacts!.summaryDigest = createHash('sha256')
    .update(readFileSync(path))
    .digest('hex')
  const rows = JSON.parse(batch.tasks[0].identityFacts!.payload)
  rows[0].puuid = 'FORGED_TEST_ONLY'
  batch.tasks[0].identityFacts!.payload = JSON.stringify(rows)
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('identity-unavailable')
  rmSync(path)
  expect((await projectPublishedIdentityBatch(batch))[0].status).toBe('raw-missing')
})
