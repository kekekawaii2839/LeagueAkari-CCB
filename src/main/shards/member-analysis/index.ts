import { AkariIpcMain } from '@main/shards/ipc'
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
import { join } from 'node:path'

import { MemberAnalysisCollector } from './collector'
import { MEMBER_ANALYSIS_MAIN_NAMESPACE, type MemberAnalysisMainContext } from './context'
import { MemberAnalysisIpcHandlers } from './ipc-handlers'
import { initializeMemberAnalysisSafely } from './lifecycle'
import { MemberAnalysisController } from './member-analysis-controller'
import { MemberAnalysisPipeline } from './pipeline'
import { MemberAnalysisRepository } from './repository'
import { MemberAnalysisRuntimeState, MemberAnalysisSettingsState } from './state'
import { MemberAnalysisWorkerSupervisor, resolveWorkerLaunch } from './worker-supervisor'

@Shard(MemberAnalysisMain.id)
export class MemberAnalysisMain implements IAkariShardInitDispose {
  static readonly id = MEMBER_ANALYSIS_MAIN_NAMESPACE

  public readonly settings = new MemberAnalysisSettingsState()
  public readonly runtime = new MemberAnalysisRuntimeState()

  private _logger: AkariLogger | null = null
  private _pipeline: MemberAnalysisPipeline | null = null
  private _repository: MemberAnalysisRepository | null = null

  constructor(
    private readonly _ipc: AkariIpcMain,
    private readonly _loggerFactory: LoggerFactoryMain,
    private readonly _settingFactory: SettingFactoryMain,
    private readonly _windowManager: WindowManagerMain,
    private readonly _riotClient: RiotClientMain,
    private readonly _sgp: SgpMain
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
        new MemberAnalysisIpcHandlers(context, controller).register()
        await settingService.applyToState()
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
    await this._pipeline?.dispose()
    this._repository?.close()
    this._pipeline = null
    this._repository = null
  }
}
