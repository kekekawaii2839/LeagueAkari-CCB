import { createHash } from 'node:crypto'
import { afterEach, expect, test, vi } from 'vitest'

import type {
  PredictionGameInput,
  PredictionPlayerInput
} from '../../../../../packages/prediction-lab/src/akari-metrics'
import { predictionRoles } from '../../../../../packages/prediction-lab/src/legacy/model'
import { performanceMetricKeys } from '../../../../../packages/prediction-lab/src/metrics'
import {
  buildNativePredictionInitialSnapshot,
  nativePredictionIdentity
} from './native-prediction-loader'

afterEach(() => vi.useRealTimers())

function fixture() {
  const games: PredictionGameInput[] = [1, 2].map((gameId) => ({
    gameId,
    timestamp: gameId * 1000,
    date: '2026-01-01',
    duration: 900,
    win: gameId === 1,
    side: gameId === 1 ? 'Blue' : 'Red',
    dragon15Diff: null,
    grub15Diff: 0,
    objectiveFight15Diff: null,
    laneGankDeaths: {
      status: 'available',
      events: [{ victimPlayer: `old-${gameId}-0`, victimRole: 'TOP' }]
    },
    players: predictionRoles.map((role, i): PredictionPlayerInput => ({
      player: `old-${gameId}-${i}`,
      role,
      minutes: 15,
      kills: 1,
      deaths: 1,
      assists: 1,
      teamKills: 5,
      teamDeaths: 5,
      damage: 100,
      damageShare: null,
      gold: 100,
      goldShare: null,
      cs: 100,
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
      soloDiff15: null
    }))
  }))
  const seed = {
    games,
    queueEntries: games.map((g) => [`${g.timestamp}|${g.gameId}`, 710]),
    receiptSha256: 'a'.repeat(64)
  }
  const sources = games.map((game) => ({
    serverId: 'SYNTHETIC-1',
    summary: {
      json: {
        gameId: game.gameId,
        gameStartTimestamp: game.timestamp,
        gameEndTimestamp: game.timestamp + 900000,
        gameDuration: game.duration,
        queueId: 710,
        teams: [{ teamId: game.side === 'Blue' ? 100 : 200, win: game.win }],
        participants: game.players.map((p, i) => ({
          _target: true,
          _targetName: p.player,
          puuid: `synthetic-puuid-${i}`,
          teamId: game.side === 'Blue' ? 100 : 200,
          teamPosition: p.role as string,
          win: game.win
        }))
      }
    }
  }))
  const readSource = vi.fn(
    async (gameId: number): Promise<(typeof sources)[number] | null> => sources[gameId - 1] ?? null
  )
  const options = {
    selectedMembers: predictionRoles.map((_, i) => ({
      serverId: 'SYNTHETIC-1',
      gameName: `new-${i}`,
      tagLine: 'SYNTHETIC',
      puuid: `synthetic-puuid-${i}`
    })),
    side: 'all' as const,
    dataCutoffMs: 2000000,
    studyObservedAtMs: 2000000,
    readSource
  }
  const run = () => {
    const bytes = Buffer.from(JSON.stringify(seed))
    return buildNativePredictionInitialSnapshot(bytes, options, {
      expectedSeedHash: createHash('sha256').update(bytes).digest('hex'),
      expectedGames: 2
    })
  }
  return { seed, sources, options, run, readSource }
}

test('server-qualified stable identity survives rename, preserves all games/roles/nulls and events', async () => {
  const f = fixture(),
    result = await f.run()
  expect(result.request.observations).toHaveLength(10)
  expect(result.request.observations.every((o) => o.metrics.length === 40)).toBe(true)
  for (const role of predictionRoles) {
    const rows = result.request.observations.filter((o) => o.role === role)
    expect(rows.map((o) => o.player)).toEqual([
      result.request.lineup[role],
      result.request.lineup[role]
    ])
    expect(rows[0].metrics[performanceMetricKeys.indexOf('gd15')]).toBeNull()
    expect(rows[0].metrics[performanceMetricKeys.indexOf('vspm')]).toBe(0)
    expect(rows[0].metrics[performanceMetricKeys.indexOf('laneGankDeathsPG')]).toBe(
      role === 'JUNGLE' ? null : role === 'TOP' ? 1 : 0
    )
  }
  expect(result.provenance.sources.map((s) => s.queueId)).toEqual([710, 710])
  expect(JSON.stringify(result.provenance)).not.toContain('ranked')
  expect(result.provenance.availabilityEvidence).toBe(
    'study-initial-observation-not-original-ingestion'
  )
  expect(result.provenance.studyInitiatedAtMs).toBe(2000000)
  expect(result.provenance.inputReadCompletedAtMs).toBeGreaterThanOrEqual(2000000)
  expect(result.provenance.sourceReadCompletedAtMs).toBeGreaterThanOrEqual(
    result.provenance.inputReadCompletedAtMs
  )
  expect(result.provenance.studyObservedAtMs).toBeGreaterThanOrEqual(
    result.provenance.sourceReadCompletedAtMs
  )
  expect(result.provenance.inputHash).toMatch(/^[a-f0-9]{64}$/)
  expect(result.provenance.requestHash).toBe(
    createHash('sha256').update(JSON.stringify(result.request)).digest('hex')
  )
  expect(f.seed.games[0].players[0].player).toBe('old-1-0')
  expect(
    f.seed.games[0].laneGankDeaths?.status === 'available' &&
      f.seed.games[0].laneGankDeaths.events[0].victimPlayer
  ).toBe('old-1-0')
})

test('cross-server PUUID is different; unknown selected identity remains cold, never guessed from alias', async () => {
  const f = fixture()
  f.options.selectedMembers[0].serverId = 'SYNTHETIC-2'
  f.options.selectedMembers[0].gameName = 'old-1-0'
  const result = await f.run()
  expect(result.request.lineup.TOP).not.toBe(result.request.observations[0].player)
  expect(result.request.observations.some((o) => o.player === result.request.lineup.TOP)).toBe(
    false
  )
  expect(nativePredictionIdentity('SYNTHETIC-1', 'id')).not.toBe(
    nativePredictionIdentity('SYNTHETIC-2', 'id')
  )
})

test('seed mismatch is rejected before JSON/source inspection', async () => {
  const f = fixture()
  await expect(
    buildNativePredictionInitialSnapshot(Buffer.from('not-json'), f.options, {
      expectedSeedHash: 'b'.repeat(64),
      expectedGames: 2
    })
  ).rejects.toThrow('rejected')
  expect(f.readSource).not.toHaveBeenCalled()
})

test('missing population, duplicate games/queues/roles and short games are rejected before source reads', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => f.seed.games.pop(),
    (f: ReturnType<typeof fixture>) => {
      f.seed.games[1].gameId = 1
    },
    (f: ReturnType<typeof fixture>) => {
      f.seed.queueEntries[1] = f.seed.queueEntries[0]
    },
    (f: ReturnType<typeof fixture>) => {
      f.seed.games[0].players[0].role = 'JUNGLE'
    },
    (f: ReturnType<typeof fixture>) => {
      f.seed.games[0].duration = 899
    }
  ]) {
    const f = fixture()
    change(f)
    await expect(f.run()).rejects.toThrow()
    expect(f.readSource).not.toHaveBeenCalled()
  }
})

test('explicit source end must exist, follow start and be strictly before cutoff including ties', async () => {
  for (const end of [undefined, 1000, 2000000, 2000001, Number.NaN]) {
    const f = fixture()
    f.sources[0].summary.json.gameEndTimestamp = end as number
    await expect(f.run()).rejects.toThrow('rejected')
    expect(f.readSource).toHaveBeenCalledTimes(1)
  }
  const f = fixture()
  f.sources[0].summary.json.gameEndTimestamp = f.options.dataCutoffMs - 1
  expect((await f.run()).request.observations).toHaveLength(10)
})

test('timestamp ties to cutoff and future declared cutoff cannot enter source loading', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.seed.games[0].timestamp = f.options.dataCutoffMs
    },
    (f: ReturnType<typeof fixture>) => {
      f.options.dataCutoffMs = f.options.studyObservedAtMs + 1
    }
  ]) {
    const f = fixture()
    change(f)
    await expect(f.run()).rejects.toThrow('rejected')
    expect(f.readSource).not.toHaveBeenCalled()
  }
})

test('source game/start/duration/side/win/queue/role/PUUID conflicts reject whole snapshot', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.gameId = 9
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.gameStartTimestamp++
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.gameDuration++
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.teams[0].teamId = 200
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.teams[0].win = false
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.queueId = 440
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.participants[0].teamPosition = 'JUNGLE'
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.participants[0].win = false
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.participants[0].puuid = ''
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.participants[0].puuid = 'synthetic-puuid-1'
    },
    (f: ReturnType<typeof fixture>) => {
      f.sources[0].summary.json.participants.push(f.sources[0].summary.json.participants[0])
    }
  ]) {
    const f = fixture()
    change(f)
    await expect(f.run()).rejects.toThrow('rejected')
  }
})

test('missing source and unresolved/role-mismatched event victims never silently drop games', async () => {
  const missing = fixture()
  missing.readSource.mockResolvedValueOnce(null)
  await expect(missing.run()).rejects.toThrow('rejected')
  for (const event of [
    { victimPlayer: 'unknown', victimRole: 'TOP' },
    { victimPlayer: 'old-1-0', victimRole: 'MIDDLE' }
  ]) {
    const f = fixture()
    if (f.seed.games[0].laneGankDeaths?.status === 'available')
      f.seed.games[0].laneGankDeaths.events[0] = event
    await expect(f.run()).rejects.toThrow('rejected')
  }
})

test('authoritative role aliases and creation fallback are allowed without guessing identity/end', async () => {
  const f = fixture()
  f.sources[0].summary.json.participants[2].teamPosition = 'MID'
  f.sources[0].summary.json.participants[4].teamPosition = 'SUPPORT'
  const raw = f.sources[0].summary.json as Record<string, unknown>
  raw.gameCreation = raw.gameStartTimestamp
  delete raw.gameStartTimestamp
  expect((await f.run()).request.observations).toHaveLength(10)
})

test('duplicate selected PUUID and absent member fields fail before any source read', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.options.selectedMembers[1].puuid = f.options.selectedMembers[0].puuid
    },
    (f: ReturnType<typeof fixture>) => {
      f.options.selectedMembers[0].tagLine = ''
    }
  ]) {
    const f = fixture()
    change(f)
    await expect(f.run()).rejects.toThrow('rejected')
    expect(f.readSource).not.toHaveBeenCalled()
  }
})

test('malformed bytes, excessive population contract and future observation time never read sources', async () => {
  const f = fixture()
  const bytes = Buffer.from('not-json')
  const hash = createHash('sha256').update(bytes).digest('hex')
  await expect(
    buildNativePredictionInitialSnapshot(bytes, f.options, {
      expectedSeedHash: hash,
      expectedGames: 2
    })
  ).rejects.toThrow('rejected')
  await expect(
    buildNativePredictionInitialSnapshot(bytes, f.options, {
      expectedSeedHash: hash,
      expectedGames: 334
    })
  ).rejects.toThrow('rejected')
  f.options.studyObservedAtMs = Date.now() + 60000
  await expect(f.run()).rejects.toThrow('rejected')
  expect(f.readSource).not.toHaveBeenCalled()
})

test('source reader exceptions are anonymized and never produce a partial snapshot', async () => {
  const f = fixture()
  f.readSource.mockRejectedValueOnce(Error('private raw source path'))
  await expect(f.run()).rejects.toThrow(/^Initial prediction snapshot rejected$/)
  expect(f.readSource).toHaveBeenCalledTimes(1)
})

test('authoritative receipt time follows all source reads and never backdates to caller initiation', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(3000000)
  const f = fixture()
  f.readSource.mockImplementation(async (gameId) => {
    vi.setSystemTime(Date.now() + 100)
    return f.sources[gameId - 1]
  })
  const result = await f.run()
  expect(result.provenance.studyInitiatedAtMs).toBe(2000000)
  expect(result.provenance.inputReadCompletedAtMs).toBe(3000000)
  expect(result.provenance.sourceReadCompletedAtMs).toBe(3000200)
  expect(result.provenance.studyObservedAtMs).toBe(3000200)
  expect(result.request.dataCutoffMs).toBe(2000000)
})

test('wall-clock rollback across source reads rejects rather than inventing an observation time', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(3000000)
  const f = fixture()
  f.readSource.mockImplementation(async (gameId) => {
    vi.setSystemTime(Date.now() - 1)
    return f.sources[gameId - 1]
  })
  await expect(f.run()).rejects.toThrow('rejected')
  expect(f.readSource).toHaveBeenCalledTimes(1)
})
function futureFixture() {
  const f = fixture()
  const game = structuredClone(f.seed.games[0])
  game.gameId = 3
  game.timestamp = 1000000
  const source = structuredClone(f.sources[0])
  source.summary.json.gameId = 3
  source.summary.json.gameStartTimestamp = game.timestamp
  source.summary.json.gameEndTimestamp = 1900000
  f.sources.push(source)
  const additional = {
    games: [game] as unknown[],
    queueEntries: [[`${game.timestamp}|3`, 710]] as [string, number][],
    studyCreatedAtMs: 1000000,
    observedAtMs: 1950000
  }
  Object.assign(f.options, { additional })
  return { ...f, additional, game, source }
}

test('future expansion preserves immutable seed population and same identity/metrics normalization', async () => {
  const f = futureFixture()
  const before = structuredClone(f.additional)
  const result = await f.run()
  expect(result.request.observations).toHaveLength(15)
  expect(result.provenance.sources.map((s) => s.gameId)).toEqual([1, 2, 3])
  expect(result.request.observations.filter((o) => o.role === 'TOP').map((o) => o.player)).toEqual(
    Array(3).fill(result.request.lineup.TOP)
  )
  expect(f.additional).toEqual(before)
  expect(result.provenance.scope).toBe('immutable-development-seed-plus-observed-future')
  expect(result.provenance.futureInput).toMatchObject({
    gameCount: 1,
    observedAtMs: 1950000,
    studyCreatedAtMs: 1000000,
    availabilityEvidence: 'study-observation-not-original-ingestion'
  })
  expect(result.provenance.futureInput?.inputHash).toMatch(/^[a-f0-9]{64}$/)
})

test('future input cannot import old tail, duplicate seed, mismatch queues, or post-initiation observation', async () => {
  for (const mutate of [
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.studyCreatedAtMs++
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.game.gameId = 1
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.queueEntries = []
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.queueEntries[0][0] = 'unknown'
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.observedAtMs = 2000001
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.observedAtMs = 999999
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.game.duration = 899
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.games = Array(1)
    }
  ]) {
    const f = futureFixture()
    mutate(f)
    Object.assign(f.options, { additional: f.additional })
    await expect(f.run()).rejects.toThrow('rejected')
    expect(f.readSource).not.toHaveBeenCalled()
  }
})

test('future source disagreement, missing raw, source end ties and impossible observation all fail whole snapshot', async () => {
  for (const mutate of [
    (f: ReturnType<typeof futureFixture>) => {
      f.source.summary.json.gameEndTimestamp = 2000000
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.source.summary.json.gameStartTimestamp--
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.source.summary.json.participants[0]._target = false
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.source.summary.json.participants[0].puuid = ''
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.additional.observedAtMs = 1800000
    },
    (f: ReturnType<typeof futureFixture>) => {
      f.sources.pop()
    }
  ]) {
    const f = futureFixture()
    mutate(f)
    await expect(f.run()).rejects.toThrow('rejected')
  }
})

test('entire seed plus future population has hard 500 game bound without truncation', async () => {
  const f = futureFixture()
  f.additional.games = Array(499).fill(f.game)
  f.additional.queueEntries = Array(499).fill(f.additional.queueEntries[0])
  await expect(f.run()).rejects.toThrow('rejected')
  expect(f.readSource).not.toHaveBeenCalled()
})

test('exactly 500 games retain every future observation and source without truncation', async () => {
  const f = futureFixture()
  const templateGame = structuredClone(f.game)
  const templateSource = structuredClone(f.source)
  f.additional.games = []
  f.additional.queueEntries = []
  f.sources.splice(2)
  for (let gameId = 3; gameId <= 500; gameId++) {
    const game = structuredClone(templateGame)
    game.gameId = gameId
    game.timestamp += gameId
    const source = structuredClone(templateSource)
    source.summary.json.gameId = gameId
    source.summary.json.gameStartTimestamp = game.timestamp
    source.summary.json.gameEndTimestamp += gameId
    f.additional.games.push(game)
    f.additional.queueEntries.push([`${game.timestamp}|${gameId}`, 710])
    f.sources.push(source)
  }
  const result = await f.run()
  expect(result.request.observations).toHaveLength(2500)
  expect(result.provenance.sources).toHaveLength(500)
  expect(f.readSource).toHaveBeenCalledTimes(500)
  expect(result.provenance.futureInput?.gameCount).toBe(498)
})

test('validated native nullable future input maps absent facts to null without altering Lab seed', async () => {
  const f = futureFixture()
  const native = {
    ...f.game,
    patch: '26.1',
    roster: 'synthetic',
    metricSemantics: 'current-v5',
    counterMean: null,
    upperGold15: null,
    botGold15: null,
    gold20Diff: null,
    tower20Diff: null,
    jungle: null,
    laneGankDeaths: null,
    eventDecision: null,
    players: f.game.players.map((row, i) => ({
      ...row,
      champion: `Synthetic${i}`,
      counter: null,
      damage: i === 0 ? null : 0,
      shieldTeammates: null,
      fbPart: null
    }))
  }
  f.additional.games = [native]
  const result = await f.run()
  const rows = result.request.observations.filter((row) => row.gameId === 3)
  expect(rows).toHaveLength(5)
  expect(rows[0].metrics[performanceMetricKeys.indexOf('dpm')]).toBeNull()
  expect(rows[1].metrics[performanceMetricKeys.indexOf('dpm')]).toBe(0)
  expect(rows.every((row) => row.metrics[performanceMetricKeys.indexOf('shieldPM')] === null)).toBe(
    true
  )
  expect(rows.every((row) => row.metrics[performanceMetricKeys.indexOf('fbRate')] === null)).toBe(
    true
  )
  expect(f.additional.games[0]).toEqual(native)
})
