import {
  MEMBER_ANALYSIS_DATA_VERSION,
  type MemberAnalysisGame
} from '@shared/shards/member-analysis'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { getCurrentInstance, h, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

import { useMemberAnalysisStore } from '@main-window/shards/member-analysis/store'

import MemberAnalysis from '../MemberAnalysis.vue'
import MemberAnalysisDesignSample from './MemberAnalysisDesignSample.vue'

// Only generated synthetic observations. No main-process service or player data is accessed.
const roles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
function games(): MemberAnalysisGame[] {
  return Array.from({ length: 30 }, (_, index) => {
    const players = roles.map((role, slot) => ({
      player: `Member ${((index + slot) % 5) + 1}#TEST`,
      role,
      champion: [
        ['Garen', 'Shen', 'Ornn'],
        ['Vi', 'LeeSin', 'JarvanIV'],
        ['Ahri', 'Viktor', 'Orianna'],
        ['Ashe', 'Jinx', 'Caitlyn'],
        ['Lulu', 'Nami', 'Thresh']
      ][slot][[0, 0, 0, 1, 1, 2][Math.floor(index / 5)]],
      minutes: 30,
      kills: slot + 1,
      deaths: index % 4,
      assists: 6,
      teamKills: 15,
      teamDeaths: (index % 4) * 5,
      damage: 10000 + slot * 1000,
      damageShare: 0.2,
      gold: 12000,
      goldShare: 0.2,
      cs: 100 + slot * 20,
      vision: 20,
      wardsPlaced: 6,
      wardsKilled: 2,
      controlWards: 2,
      damageTaken: 15000,
      takenShare: 0.2,
      damageMitigated: 10000,
      objectiveDamage: 3000,
      turretDamage: 1500,
      healTeammates: 0,
      shieldTeammates: 0,
      ccSeconds: 10,
      soloKills: 0,
      fbPart: false,
      ftPart: false,
      kp: 0.4,
      gd10: ((index % 7) - 3) * 100,
      gd15: index % 6 === 0 ? null : ((index % 7) - 3) * 200,
      csd15: (index % 8) - 4,
      xpd15: 150,
      damageDiff15: 250,
      soloDiff15: 0,
      counter: null
    }))
    return {
      gameId: index + 1,
      timestamp: Date.UTC(2026, 0, 1 + index),
      date: `2026-01-${String(index + 1).padStart(2, '0')}`,
      patch: '26.1',
      side: index % 2 ? 'Red' : 'Blue',
      win: index % 3 !== 0,
      duration: 1800,
      roster: players.map((p) => p.player).join(' + '),
      players,
      dragon15Diff: 0,
      grub15Diff: 1,
      objectiveFight15Diff: 0,
      counterMean: null,
      upperGold15: 500,
      botGold15: 0,
      gold20Diff: ((index % 7) - 3) * 300,
      tower20Diff: 0,
      jungle: {
        player: players[1].player,
        champion: players[1].champion,
        startCamp: index % 3 ? 'blue' : 'red',
        startCampSide: 'blue',
        startCampOwn: true,
        level3Gank: false,
        level4Gank: true,
        topGanks: 0,
        midGanks: 1,
        botGanks: 2,
        topZoneWeight: 2,
        midZoneWeight: 3,
        botZoneWeight: 5,
        totalZoneWeight: 10,
        gotFirstDragon: true,
        dragons: 2,
        soloDragons: 0,
        firstDragonTimeSec: 390,
        voidgrubs: 3,
        firstVoidgrubTimeSec: 430,
        heralds: 1,
        firstHeraldTimeSec: 930,
        barons: 0,
        firstBaronTimeSec: null
      },
      laneGankDeaths:
        index % 5 === 0
          ? { methodVersion: 1, status: 'unavailable', reason: 'timeline-incomplete' }
          : {
              methodVersion: 1,
              status: 'available',
              events:
                index % 3 === 0
                  ? []
                  : [
                      {
                        victimPlayer: players[0].player,
                        victimRole: 'TOP',
                        victimChampion: 'Garen',
                        enemyJunglerChampion: 'Vi',
                        timestampSec: 210,
                        lane: 'top',
                        involvement: 'assist'
                      }
                    ]
            },
      eventDecision: {
        killEpisodes: 4,
        convertedKillEpisodes: 2,
        killToEpicEpisodes: 1,
        killToTowerEpisodes: 1,
        conversionDelayTotalSec: 60,
        conversionDelaySamples: 2,
        deathEpisodes: 2,
        highCostDeathEpisodes: 1,
        deathCostEpics: 1,
        deathCostTowers: 0,
        deathCostPlates: 0,
        deathCostPoints: 2,
        shutdownBountyLost: 0,
        objectivesTaken: 4,
        cleanObjectives: 2,
        wonFightObjectives: 1,
        evenFightObjectives: 0,
        lostFightObjectives: 0,
        objectiveFightSamples: 1,
        objectiveFightWins: 1,
        enemyObjectives: 2,
        tradedEnemyObjectives: 1,
        tradeDelayTotalSec: 40,
        tradeDelaySamples: 1
      }
    }
  })
}

const meta: Meta = {
  title: 'Member Analysis/Audit',
  parameters: { akariStoryPanelMaxWidth: '100%' },
  render: (args) => ({
    setup() {
      const instance = getCurrentInstance()!
      const store = useMemberAnalysisStore()
      store.loading = false
      store.error = null
      store.job = null
      store.settingsDrawerVisible = false
      store.resetFilters()
      store.sampleSize = 50
      store.analysisSide = 'all'
      store.sideBreakdown = false
      store.settings = {
        enabled: true,
        members: Array.from({ length: 5 }, (_, i) => ({
          serverId: 'TEST',
          gameName: `Member ${i + 1}`,
          tagLine: 'TEST'
        })),
        historyDepth: 100,
        scanLimitPerMember: 2000,
        historyTag: 'ranked',
        storageLimitGiB: 10,
        opggEnabled: false
      }
      store.capabilities = {
        contractVersion: 1,
        dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
        featureEnabled: true,
        workerAvailable: false,
        methods: []
      }
      store.overview = {
        contractVersion: 1,
        dataVersion: MEMBER_ANALYSIS_DATA_VERSION,
        firstRun: false,
        source: '合成测试数据',
        generatedAt: '2026-01-31T00:00:00Z',
        gameCount: 30,
        playerCount: 5,
        collectionAudit: {
          requestedMembers: 5,
          resolvedMembers: 5,
          memberScans: [],
          targetHistoryDepth: 100,
          scanLimitPerMember: 2000,
          collectionStopReason: 'source-exhausted',
          sourceUnion: 30,
          sourceIntersection: 30,
          fivePresent: 30,
          fiveSameTeam: 30,
          mapEligible: 30,
          queueEligible: 30,
          roleEligible: 30,
          targetSelected: 30,
          detailSucceeded: 30,
          detailFetched: 30,
          cacheHits: 0,
          rawCatalog: 30,
          workerReceived: 30,
          stagingGames: 30,
          publishedGames: 30
        },
        games: games(),
        pagination: { nextCursor: null }
      }
      if (args.sampleState === 'boundary') {
        const longName = '合成成员五号用于测试完整长名称'
        store.settings.members[4].gameName = longName
        for (const game of store.overview.games) {
          for (const player of game.players) {
            const slot = Number(player.player.match(/Member (\d)/)?.[1])
            player.gd15 =
              slot === 1
                ? null
                : slot === 2
                  ? 0
                  : slot === 3
                    ? -2400
                    : slot === 4
                      ? 4000
                      : game.gameId <= 5
                        ? 120
                        : null
            player.kp =
              slot === 1 ? null : slot === 2 ? 0 : slot === 3 ? 0.25 : slot === 4 ? 1 : 0.5
            if (slot === 5) player.player = `${longName}#TEST`
          }
          game.roster = game.players.map((player) => player.player).join(' + ')
        }
      }
      if (args.sampleState === 'manyHeroes') {
        for (const game of store.overview.games) {
          if (game.gameId <= 10) continue
          for (const player of game.players) {
            if (player.role === 'TOP')
              player.champion = ['Garen', 'Shen', 'Ornn', 'Darius', 'Sett'][
                Math.floor((game.gameId - 1) / 5) % 5
              ]
          }
        }
      }
      if (args.sampleState === 'unevenHeroes') {
        const names = [
          'Member 1',
          '合成成员名称较长用于排版检查',
          'Member 3',
          'Member 4',
          'Member 5'
        ]
        store.settings.members.forEach((member, index) => {
          member.gameName = names[index]
        })
        const choices = ['Garen', 'Shen', 'Ornn', 'Darius', 'Sett', 'Ashe', 'Ahri', 'Vi']
        store.overview.games.forEach((game, index) => {
          game.players.forEach((player, slot) => {
            const member = store.settings!.members[slot]
            player.player = `${member.gameName}#${member.tagLine}`
            // Mostly fixed lanes; occasional swaps and uneven hero pools.
            player.role = roles[index % 7 === 0 && slot < 2 ? 1 - slot : slot]
            player.champion =
              choices[slot === 0 ? 0 : slot === 1 ? index % choices.length : index % (slot + 1)]
          })
          game.roster = game.players.map((player) => player.player).join(' + ')
        })
      }
      if (args.sampleState === 'mixed') {
        const substitute = { serverId: 'TEST', gameName: 'Member 6', tagLine: 'TEST' }
        store.settings.members.push(substitute)
        for (const game of store.overview.games) {
          if (game.gameId % 3 !== 0) continue
          const player = game.players.find(
            (player) => player.player.split('#')[0] === store.settings!.members[4].gameName
          )!
          player.player = `${substitute.gameName}#${substitute.tagLine}`
          game.roster = game.players.map((player) => player.player).join(' + ')
        }
      }
      if (args.sampleState === 'empty') store.filters.query = 'synthetic-no-match'
      if (args.sampleState === 'settingsSuccess') {
        store.settings.storageLimitGiB = 2
        store.storageStatus = {
          totalBytes: 3 * 1024 ** 3,
          rawBytes: 2 * 1024 ** 3,
          limitBytes: 2 * 1024 ** 3,
          overLimit: true,
          catalogGames: 30
        }
      }
      if (['refresh', 'refreshFailure'].includes(args.sampleState))
        store.capabilities.workerAvailable = true
      const syntheticJob = (status: 'collecting' | 'cancelled' | 'failed') => ({
        jobId: 'synthetic-ui-job',
        status,
        progress: status === 'collecting' ? 0.35 : 0,
        message: 'Synthetic UI state',
        startedAt: '2026-01-31T00:00:00Z',
        finishedAt: null,
        checkpointAt: null,
        error:
          status === 'failed' ? { code: 'PIPELINE_FAILED', message: 'Synthetic failure' } : null
      })
      const unavailable = async () => ({
        ok: false,
        error: { code: 'WORKER_UNAVAILABLE', retryable: false, message: 'Synthetic preview only' }
      })
      instance.appContext.config.globalProperties.$akariManager = {
        getInstance: () => ({
          reload: unavailable,
          startRefresh: async () => {
            if (!['refresh', 'refreshFailure'].includes(args.sampleState)) return unavailable()
            store.job = syntheticJob(
              args.sampleState === 'refreshFailure' ? 'failed' : 'collecting'
            )
            return { ok: true, value: store.job }
          },
          cancelRefresh: async () => {
            if (args.sampleState !== 'refresh') return unavailable()
            store.job = syntheticJob('cancelled')
            return { ok: true, value: store.job }
          },
          // UI-only success fixtures: never invoke IPC, storage or a real cleanup.
          updateSettings: async (settings: NonNullable<typeof store.settings>) => {
            if (args.sampleState !== 'settingsSuccess') return unavailable()
            store.settings = {
              ...settings,
              members: settings.members.map((member) => ({ ...member }))
            }
            return { ok: true, value: store.settings }
          },
          previewCleanup: async () => {
            if (args.sampleState !== 'settingsSuccess') return unavailable()
            store.cleanupPreview = {
              previewId: '0'.repeat(64),
              createdAt: '2026-01-31T00:00:00Z',
              currentBytes: 3 * 1024 ** 3,
              limitBytes: 2 * 1024 ** 3,
              reclaimableBytes: 1024 ** 3,
              gameCount: 10
            }
            return { ok: true, value: store.cleanupPreview }
          },
          confirmCleanup: async () => {
            if (args.sampleState !== 'settingsSuccess') return unavailable()
            store.cleanupPreview = null
            store.storageStatus = {
              totalBytes: 2 * 1024 ** 3,
              rawBytes: 1024 ** 3,
              limitBytes: 2 * 1024 ** 3,
              overLimit: false,
              catalogGames: 20
            }
            return { ok: true, value: store.storageStatus }
          }
        })
      } as any
      const router = createRouter({
        history: createMemoryHistory(),
        routes: [
          {
            path: '/member-analysis/:section?',
            name: 'member-analysis',
            component: { render: () => null }
          }
        ]
      })
      instance.appContext.app.use(router)
      const ready = ref(false)
      void router.push('/member-analysis/roles').then(() => {
        ready.value = true
      })
      return () =>
        ready.value
          ? h('div', { style: 'height: calc(100vh - 48px); min-height: 400px' }, [
              h(args.designSample ? MemberAnalysisDesignSample : MemberAnalysis)
            ])
          : null
    }
  })
}
export default meta
export const Populated: StoryObj = {}

export const DesignSample: StoryObj = { args: { designSample: true } }

export const DesignSampleBoundary: StoryObj = {
  args: { designSample: true, sampleState: 'boundary' }
}
export const DesignSampleEmpty: StoryObj = { args: { designSample: true, sampleState: 'empty' } }

export const PopulatedBoundary: StoryObj = { args: { sampleState: 'boundary' } }
export const FilteredEmpty: StoryObj = { args: { sampleState: 'empty' } }

export const MixedRoster: StoryObj = { args: { sampleState: 'mixed' } }

export const ManyHeroes: StoryObj = { args: { sampleState: 'manyHeroes' } }

export const SettingsSuccess: StoryObj = { args: { sampleState: 'settingsSuccess' } }

export const RefreshLifecycle: StoryObj = { args: { sampleState: 'refresh' } }
export const RefreshFailure: StoryObj = { args: { sampleState: 'refreshFailure' } }

export const UnevenHeroes: StoryObj = { args: { sampleState: 'unevenHeroes' } }
