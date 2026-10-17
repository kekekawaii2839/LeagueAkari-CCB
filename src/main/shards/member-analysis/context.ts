import type { AkariIpcMain } from '@main/shards/ipc'
import type { AkariLogger } from '@main/shards/logger-factory'
import type { SetterSettingService } from '@main/shards/setting-factory/setter-setting-service'
import type { WindowManagerMain } from '@main/shards/window-manager'

import type { CurrentProfileIcons } from './current-profile-icons'
import type { CurrentRankRefresh } from './current-rank-refresh'
import type { MemberAnalysisPipeline } from './execution'
import type { MemberAnalysisRepository } from './repository'
import type { MemberAnalysisRuntimeState, MemberAnalysisSettingsState } from './state'

export const MEMBER_ANALYSIS_MAIN_NAMESPACE = 'member-analysis-main'

export interface MemberAnalysisMainContext {
  namespace: string
  ipc: AkariIpcMain
  logger: AkariLogger
  windowManager: WindowManagerMain
  settings: MemberAnalysisSettingsState
  runtime: MemberAnalysisRuntimeState
  settingService: SetterSettingService<MemberAnalysisSettingsState>
  pipeline: MemberAnalysisPipeline
  repository: MemberAnalysisRepository
  currentProfileIcons?: CurrentProfileIcons
  currentRankRefresh?: CurrentRankRefresh
}
