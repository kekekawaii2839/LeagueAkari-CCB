import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import { expect, test } from 'vitest'

import { roleMetricMeta } from './metric-defs'
import { teamMetricRows } from './team-metrics'

const game = (patch: Partial<MemberAnalysisGame> = {}): MemberAnalysisGame =>
  ({
    side: 'Blue',
    win: true,
    duration: 1500,
    players: [],
    eventDecision: null,
    teamMetrics: {
      totalKills: 0,
      firstDragonTime: null,
      firstTowerTime: null,
      dragons: 0,
      barons: 0,
      dragonSouls: 0,
      elderDragons: 0
    },
    ...patch
  }) as MemberAnalysisGame
const cell = (games: MemberAnalysisGame[], key: string, side = 0) =>
  teamMetricRows(games).find((row) => row.key === key)!.cells[side]

test('counts matches once, keeps empty side unknown and zero resources observed', () => {
  const games = [game(), game({ teamMetrics: undefined })]
  expect(cell(games, 'games').value).toBe('2')
  expect(cell(games, 'teamDragonsPG')).toEqual({
    value: '0.00',
    sample: '有效 1/2 场 · 部分有效'
  })
  expect(cell(games, 'teamDragonsPG', 2).value).toBe('—')
  expect(cell(games, 'winRate', 2).value).toBe('—')
  expect(() => teamMetricRows([])).not.toThrow()
})
test('uses weighted bloodiness and side-specific match samples', () => {
  const games = [
    game({ duration: 600, teamMetrics: { ...game().teamMetrics!, totalKills: 20 } }),
    game({ side: 'Red', duration: 1200, teamMetrics: { ...game().teamMetrics!, totalKills: 10 } })
  ]
  expect(cell(games, 'bloodiness').value).toBe('1.00')
  expect(cell(games, 'bloodiness', 1).value).toBe('2.00')
  expect(cell(games, 'bloodiness', 2).value).toBe('0.50')
})
test('preserves negative differences, gates timepoints and excludes missing lanes', () => {
  const games = [game({ gold20Diff: -1200 }), game({ duration: 1000, gold20Diff: 9000 })]
  expect(cell(games, 'gold20')).toEqual({
    value: '-1200',
    tone: 'negative',
    sample: '有效 1/2 场 · 部分有效'
  })
  expect(cell(games, 'gold15').value).toBe('—')
})
test('event zero exposure differs from missing and rates use pooled event denominators', () => {
  const eventDecision = { killEpisodes: 0, convertedKillEpisodes: 0 } as NonNullable<
    MemberAnalysisGame['eventDecision']
  >
  expect(cell([game()], 'killConversionRate').sample).toContain('未采集')
  expect(cell([game({ eventDecision })], 'killConversionRate')).toMatchObject({
    value: '—',
    sample: '无击杀窗口'
  })
  const games = [
    game({ eventDecision: { ...eventDecision, killEpisodes: 2, convertedKillEpisodes: 1 } }),
    game({ eventDecision: { ...eventDecision, killEpisodes: 8, convertedKillEpisodes: 1 } })
  ]
  expect(cell(games, 'killConversionRate')).toMatchObject({ value: '20.0%', sample: '2 / 10 次' })
  expect(cell(games, 'killEpisodes').value).toBe('10')
})

test('team clock metrics show only minutes and seconds without a unit suffix', () => {
  const games = [
    game({ teamMetrics: { ...game().teamMetrics!, firstDragonTime: 760, firstTowerTime: 900 } })
  ]
  expect(cell(games, 'firstDragonTime').value).toBe('12:40')
  expect(cell(games, 'firstTowerTime').value).toBe('15:00')
  expect(cell([game()], 'firstDragonTime').value).toBe('—')
})

test('team labels share member timepoint conventions and retain unit definitions without repeated suffixes', () => {
  const rows = teamMetricRows([game({ gold20Diff: 1200 })])
  for (const [team, member] of [
    ['gold15', 'gd15'],
    ['dragon15Diff', 'dragon15'],
    ['grub15Diff', 'grub15'],
    ['objectiveFight15Diff', 'objectiveFight15']
  ]) {
    expect(rows.find((row) => row.key === team)?.label).toBe(roleMetricMeta[member].label)
  }
  expect(rows.find((row) => row.key === 'gold20')).toMatchObject({
    label: '经济差 @ 20',
    definition: expect.stringContaining('金币')
  })
  expect(rows.find((row) => row.key === 'gameDuration')?.label).toContain('分钟')
  expect(rows.find((row) => row.key === 'bloodiness')?.label).toContain('击杀/分钟')
  expect(cell([game({ gold20Diff: 1200 })], 'gold20').value).toBe('+1200')
  expect(cell([game()], 'winRate').value).toBe('100.0%')
  expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
})

test('event counts and delay cells omit unit suffixes', () => {
  const games = [
    game({
      eventDecision: {
        killEpisodes: 2,
        conversionDelayTotalSec: 60,
        conversionDelaySamples: 2,
        tradeDelayTotalSec: -30,
        tradeDelaySamples: 2,
        deathCostTowers: 2
      } as NonNullable<MemberAnalysisGame['eventDecision']>
    })
  ]
  expect(cell(games, 'killEpisodes').value).toBe('2')
  expect(cell(games, 'deathCostTowersPG').value).toBe('2.00')
  expect(cell(games, 'conversionDelaySec').value).toBe('30.00')
  expect(cell(games, 'tradeDelaySec').value).toBe('−15.0')
})

test('only differences carry sign tones, independently for each side', () => {
  const games = [
    game({ side: 'Blue', gold20Diff: 1200, dragon15Diff: 2 }),
    game({ side: 'Red', gold20Diff: -1200, dragon15Diff: -2 })
  ]
  for (const key of ['gold20', 'dragon15Diff']) {
    expect(cell(games, key, 0)).toMatchObject({ value: '0.00', tone: undefined })
    expect(cell(games, key, 1).tone).toBe('positive')
    expect(cell(games, key, 1).value).toMatch(/^\+/)
    expect(cell(games, key, 2).tone).toBe('negative')
    expect(cell(games, key, 2).value).toMatch(/^-/)
    expect(cell([game()], key)).toMatchObject({ value: '—', tone: undefined })
  }
  expect(cell(games, 'winRate').tone).toBeUndefined()
  expect(cell(games, 'games').tone).toBeUndefined()
})

test.each([30, 0, -30])(
  'delay %i retains its original signs and precision without advantage tones',
  (delay) => {
    const games = [
      game({
        eventDecision: {
          conversionDelayTotalSec: Math.abs(delay),
          conversionDelaySamples: 2,
          tradeDelayTotalSec: delay,
          tradeDelaySamples: 2
        } as NonNullable<MemberAnalysisGame['eventDecision']>
      })
    ]
    expect(cell(games, 'tradeDelaySec').value).toBe(
      delay > 0 ? '+15.0' : delay < 0 ? '−15.0' : '0.0'
    )
    expect(cell(games, 'conversionDelaySec').value).toBe((Math.abs(delay) / 2).toFixed(2))
    expect(cell(games, 'tradeDelaySec').tone).toBeUndefined()
  }
)
