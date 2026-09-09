import { MEMBER_ANALYSIS_DEFAULT_HISTORY_TAG } from '@shared/shards/member-analysis'
import { makeAutoObservable } from 'mobx'

export class MemberAnalysisSettingsState {
  enabled = false
  members: { serverId: string; gameName: string; tagLine: string }[] = []
  historyDepth: 20 | 50 | 100 | 200 | 500 | 1000 | 'all' = 100
  scanLimitPerMember = 2000
  historyTag = MEMBER_ANALYSIS_DEFAULT_HISTORY_TAG
  storageLimitGiB = 10
  opggEnabled = false

  constructor() {
    makeAutoObservable(this)
  }
}

export class MemberAnalysisRuntimeState {
  initialized = false
  degradedReason: string | null = null

  constructor() {
    makeAutoObservable(this)
  }

  setInitialized() {
    this.initialized = true
    this.degradedReason = null
  }

  setDegraded(reason: string) {
    this.initialized = false
    this.degradedReason = reason
  }
}
