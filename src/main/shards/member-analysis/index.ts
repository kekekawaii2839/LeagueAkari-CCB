import { AkariIpcMain } from '@main/shards/ipc'
import { LeagueClientMain } from '@main/shards/league-client'
import { type AkariLogger, LoggerFactoryMain } from '@main/shards/logger-factory'
import { RiotClientMain } from '@main/shards/riot-client'
import { SettingFactoryMain } from '@main/shards/setting-factory'
import { SgpMain } from '@main/shards/sgp'
import { WindowManagerMain } from '@main/shards/window-manager'
import { IAkariShardInitDispose, Shard } from '@shared/akari-shard'
import {
  MEMBER_ANALYSIS_DEFAULT_HISTORY_TAG,
  MemberAnalysisHistoryDepthSchema,
  MemberAnalysisHistoryTagSchema,
  MemberAnalysisSettingsSchema
} from '@shared/shards/member-analysis'
import { formatError } from '@shared/utils/errors'
import { app } from 'electron'
import { type IReactionDisposer, reaction } from 'mobx'
import { join } from 'node:path'

import { createOpportunityLedger } from '../../../../packages/prediction-lab/runner/opportunity-ledger.mjs'
import { MemberAnalysisCollector } from './collector'
import { MEMBER_ANALYSIS_MAIN_NAMESPACE, type MemberAnalysisMainContext } from './context'
import {
  MemberAnalysisPipeline,
  MemberAnalysisWorkerSupervisor,
  resolveWorkerLaunch
} from './execution'
import { MemberAnalysisIpcHandlers } from './ipc-handlers'
import { initializeMemberAnalysisSafely } from './lifecycle'
import { MemberAnalysisController } from './member-analysis-controller'
import { OpponentRankLiveController } from './opponent-ranks/live-controller'
import { NativePredictionController } from './prediction/native-prediction-controller'
import { NativePredictionExecutor } from './prediction/native-prediction-executor'
import {
  type NativePredictionMember,
  loadNativePredictionInitialSnapshot
} from './prediction/native-prediction-loader'
import { NativePredictionSnapshotStore } from './prediction/native-prediction-snapshot-executor'
import { nativePredictionFingerprint } from './prediction/native-prediction-source-loader'
import { MemberAnalysisRepository } from './repository'
import { MemberAnalysisRuntimeState, MemberAnalysisSettingsState } from './state'

declare const __NATIVE_PREDICTION_BUILD_FINGERPRINT__: { code: string; protocol: string }

@Shard(MemberAnalysisMain.id)
export class MemberAnalysisMain implements IAkariShardInitDispose {
  static readonly id = MEMBER_ANALYSIS_MAIN_NAMESPACE

  public readonly settings = new MemberAnalysisSettingsState()
  public readonly runtime = new MemberAnalysisRuntimeState()

  private _liveRanks: OpponentRankLiveController | null = null
  private _logger: AkariLogger | null = null
  private _pipeline: MemberAnalysisPipeline | null = null
  private _repository: MemberAnalysisRepository | null = null
  private _prediction: NativePredictionController | null = null
  private _predictionLedger: ReturnType<typeof createOpportunityLedger> | null = null
  private _predictionWatch: IReactionDisposer | null = null

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _loggerFactory: LoggerFactoryMain,
    private readonly _settingFactory: SettingFactoryMain,
    private readonly _windowManager: WindowManagerMain,
    private readonly _riotClient: RiotClientMain,
    private readonly _sgp: SgpMain,
    private readonly _leagueClient: LeagueClientMain
  ) {}

  async onInit() {
    await initializeMemberAnalysisSafely(
      async () => {
        this._logger = this._loggerFactory.create(MemberAnalysisMain.id)
        const settingService = this._settingFactory.register(
          MemberAnalysisMain.id,
          {
            enabled: {
              default: false,
              restore: ({ value, defaultValue }) =>
                typeof value === 'boolean' ? value : defaultValue
            },
            members: {
              default: [],
              restore: ({ value, defaultValue }) => {
                const parsed = MemberAnalysisSettingsSchema.shape.members.safeParse(value)
                return parsed.success ? parsed.data : defaultValue
              }
            },
            historyDepth: {
              default: 100,
              restore: ({ value, defaultValue }) => {
                const parsed = MemberAnalysisHistoryDepthSchema.safeParse(value)
                return parsed.success ? parsed.data : defaultValue
              }
            },
            scanLimitPerMember: {
              default: 2000,
              restore: ({ value, defaultValue }) =>
                Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 5000
                  ? Number(value)
                  : defaultValue
            },
            historyTag: {
              default: MEMBER_ANALYSIS_DEFAULT_HISTORY_TAG,
              restore: ({ value, defaultValue }) =>
                MemberAnalysisHistoryTagSchema.safeParse(value).success
                  ? String(value)
                  : defaultValue
            },
            storageLimitGiB: {
              default: 10,
              restore: ({ value, defaultValue }) =>
                Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1000
                  ? Number(value)
                  : defaultValue
            },
            experimentalPredictionEnabled: {
              default: false,
              restore: ({ value, defaultValue }) =>
                typeof value === 'boolean' ? value : defaultValue
            },
            opggEnabled: {
              default: false,
              restore: ({ value, defaultValue }) =>
                typeof value === 'boolean' ? value : defaultValue
            }
          },
          this.settings
        )
        const repository = new MemberAnalysisRepository(
          join(app.getPath('userData'), 'member-analysis')
        )
        repository.initialize()
        const launch = resolveWorkerLaunch({
          packaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          developmentPython: app.isPackaged ? undefined : process.env.MEMBER_ANALYSIS_PYTHON,
          sourceRoot: process.cwd()
        })
        const worker = new MemberAnalysisWorkerSupervisor(launch, null)
        const collector = new MemberAnalysisCollector(this._riotClient, this._sgp, repository)
        const pipeline = new MemberAnalysisPipeline(
          collector,
          repository,
          worker,
          this.settings,
          (job) => {
            const webContents = this._windowManager.mainWindow.window?.webContents
            if (webContents)
              this._ipc.sendEventToWebContents(
                webContents,
                MemberAnalysisMain.id,
                'job-progress',
                job
              )
          }
        )
        this._repository = repository
        this._pipeline = pipeline
        const context: MemberAnalysisMainContext = {
          namespace: MemberAnalysisMain.id,
          ipc: this._ipc,
          logger: this._logger,
          windowManager: this._windowManager,
          settings: this.settings,
          runtime: this.runtime,
          settingService,
          pipeline,
          repository
        }
        const controller = new MemberAnalysisController(context)
        if (!app.isPackaged) {
          const userDataPath = app.getPath('userData')
          const ledger = createOpportunityLedger(userDataPath)
          const executor = new NativePredictionExecutor()
          const snapshots = new NativePredictionSnapshotStore(userDataPath)
          this._predictionLedger = ledger
          this._prediction = new NativePredictionController({
            ledger,
            userDataPath,
            fingerprint: () => {
              const actual = nativePredictionFingerprint(app.getAppPath())
              if (
                typeof __NATIVE_PREDICTION_BUILD_FINGERPRINT__ === 'undefined' ||
                actual.code !== __NATIVE_PREDICTION_BUILD_FINGERPRINT__.code ||
                actual.protocol !== __NATIVE_PREDICTION_BUILD_FINGERPRINT__.protocol
              )
                throw Error('Loaded prediction bundle does not match source')
              return actual
            },
            runtime: () => {
              const self = this._leagueClient.data.summoner.me?.puuid ?? null
              const serverId = this._sgp.state.availability.sgpServerId
              const phase = this._leagueClient.data.gameflow.phase
              const session = this._leagueClient.data.gameflow.session
              const localGame =
                session &&
                self &&
                [...session.gameData.teamOne, ...session.gameData.teamTwo].some(
                  (player) => player.puuid === self
                ) &&
                [
                  'GameStart',
                  'InProgress',
                  'Reconnect',
                  'WaitingForStats',
                  'EndOfGame',
                  'PreEndOfGame'
                ].includes(phase ?? '') &&
                Number.isSafeInteger(session.gameData.gameId) &&
                session.gameData.gameId > 0
              return {
                self,
                serverId,
                phase,
                connected:
                  this._leagueClient.state.connectionState === 'connected' &&
                  this._sgp.state.isTokenReady,
                game: localGame ? { serverId, gameId: session.gameData.gameId } : null
              }
            },
            resolve: async (request, signal) => {
              const members: NativePredictionMember[] = []
              for (const member of request.members) {
                const aliases = await this._riotClient.api.playerAccount.getPlayerAccountAlias(
                  member.gameName,
                  member.tagLine,
                  { signal }
                )
                const matches = aliases.data.filter(
                  (alias) =>
                    alias.alias.game_name.trim().toLocaleLowerCase() ===
                      member.gameName.trim().toLocaleLowerCase() &&
                    alias.alias.tag_line.trim().toLocaleLowerCase() ===
                      member.tagLine.trim().toLocaleLowerCase()
                )
                if (matches.length !== 1) throw Error('Prediction identity unavailable')
                members.push({ ...member, puuid: matches[0].puuid })
              }
              return members
            },
            capture: async (selectedMembers, studyCreatedAtMs) => {
              const additional = repository.readFuturePredictionGames(studyCreatedAtMs, Date.now())
              return loadNativePredictionInitialSnapshot(userDataPath, {
                selectedMembers,
                additional,
                side: 'all',
                dataCutoffMs: Date.now(),
                studyObservedAtMs: Date.now(),
                readSource: async (gameId) => repository.readPredictionSource(gameId)
              })
            },
            freeze: (input) => snapshots.freeze(input),
            execute: (request, signal) => executor.execute(request, { signal }),
            readResult: async (serverId, gameId) =>
              (
                await this._sgp.api.matchHistoryQuery.getGameSummaryByGameId(gameId, {
                  __sgpServerId: serverId,
                  signal: AbortSignal.timeout(15000)
                })
              ).data
          })
          this._prediction.watch()
          this._predictionWatch = reaction(
            () => [
              this._leagueClient.state.connectionState,
              this._sgp.state.isTokenReady,
              this._sgp.state.availability.sgpServerId,
              this._leagueClient.data.summoner.me?.puuid,
              this._leagueClient.data.gameflow.phase,
              this._leagueClient.data.gameflow.session?.gameData.gameId
            ],
            () => this._prediction?.runtimeChanged()
          )
        }
        new MemberAnalysisIpcHandlers(context, controller, this._prediction).register()
        await settingService.applyToState()
        this._liveRanks = new OpponentRankLiveController(
          this._leagueClient,
          this._sgp,
          this.settings,
          repository.opponentRanks,
          this._logger
        )
        this._liveRanks.watch()
      },
      () => this.runtime.setInitialized(),
      (error) => {
        const reason = formatError(error)
        this.runtime.setDegraded(reason)
        this._logger?.error(
          'Member analysis initialization degraded; core startup will continue',
          reason
        )
      }
    )
  }

  async onDispose() {
    this._predictionWatch?.()
    this._predictionWatch = null
    await this._prediction?.dispose()
    this._prediction = null
    this._predictionLedger?.close()
    this._predictionLedger = null
    await this._liveRanks?.dispose()
    this._liveRanks = null
    await this._pipeline?.dispose()
    this._repository?.close()
    this._pipeline = null
    this._repository = null
  }
}
