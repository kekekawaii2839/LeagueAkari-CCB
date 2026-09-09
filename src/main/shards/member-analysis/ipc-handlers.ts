import {
  MemberAnalysisConfirmCleanupRequestSchema,
  type MemberAnalysisError,
  MemberAnalysisJobRequestSchema,
  MemberAnalysisOverviewRequestSchema,
  type MemberAnalysisResult,
  MemberAnalysisStartRefreshRequestSchema,
  MemberAnalysisUpdateSettingsRequestSchema
} from '@shared/shards/member-analysis'
import type { IpcMainInvokeEvent } from 'electron'
import { type ZodType, z } from 'zod'

import type { MemberAnalysisMainContext } from './context'
import type { MemberAnalysisController } from './member-analysis-controller'

export class MemberAnalysisIpcHandlers {
  constructor(
    private readonly _context: MemberAnalysisMainContext,
    private readonly _controller: MemberAnalysisController
  ) {}

  register() {
    this._context.ipc.onCall(this._context.namespace, 'getCapabilities', (event, ...args) => {
      const invalid = this._validateNoArgs(event, args)
      return invalid ?? this._controller.getCapabilities()
    })
    this._context.ipc.onCall(this._context.namespace, 'getSettings', (event, ...args) => {
      const invalid = this._validateNoArgs(event, args)
      return invalid ?? this._controller.getSettings()
    })
    this._context.ipc.onCall(this._context.namespace, 'getOverview', (event, ...args) => {
      const invalid = this._validateArgs(
        event,
        z.union([z.tuple([]), z.tuple([MemberAnalysisOverviewRequestSchema])]),
        args
      )
      if (invalid) return invalid
      const request =
        args[0] === undefined ? undefined : MemberAnalysisOverviewRequestSchema.parse(args[0])
      return this._controller.getOverview(request)
    })
    this._context.ipc.onCall(this._context.namespace, 'updateSettings', (event, ...args) => {
      const parsed = this._parseArgs(
        event,
        z.tuple([MemberAnalysisUpdateSettingsRequestSchema]),
        args
      )
      if (!parsed.ok) return parsed.result
      return this._controller.updateSettings(parsed.value[0])
    })
    this._context.ipc.onCall(this._context.namespace, 'startRefresh', (event, ...args) => {
      const parsed = this._parseArgs(
        event,
        z.union([z.tuple([]), z.tuple([MemberAnalysisStartRefreshRequestSchema])]),
        args
      )
      if (!parsed.ok) return parsed.result
      return this._controller.startRefresh()
    })
    this._context.ipc.onCall(this._context.namespace, 'getJob', (event, ...args) => {
      const parsed = this._parseArgs(
        event,
        z.union([z.tuple([]), z.tuple([MemberAnalysisJobRequestSchema])]),
        args
      )
      if (!parsed.ok) return parsed.result
      return this._controller.getJob(parsed.value[0]?.jobId)
    })
    this._context.ipc.onCall(this._context.namespace, 'cancelJob', (event, ...args) => {
      const parsed = this._parseArgs(
        event,
        z.union([z.tuple([]), z.tuple([MemberAnalysisJobRequestSchema])]),
        args
      )
      if (!parsed.ok) return parsed.result
      return this._controller.cancelJob(parsed.value[0]?.jobId)
    })
    this._context.ipc.onCall(this._context.namespace, 'getStorageStatus', (event, ...args) => {
      const invalid = this._validateNoArgs(event, args)
      return invalid ?? this._controller.getStorageStatus()
    })
    this._context.ipc.onCall(this._context.namespace, 'previewCleanup', (event, ...args) => {
      const invalid = this._validateNoArgs(event, args)
      return invalid ?? this._controller.previewCleanup()
    })
    this._context.ipc.onCall(this._context.namespace, 'confirmCleanup', (event, ...args) => {
      const parsed = this._parseArgs(
        event,
        z.tuple([MemberAnalysisConfirmCleanupRequestSchema]),
        args
      )
      if (!parsed.ok) return parsed.result
      return this._controller.confirmCleanup(parsed.value[0].previewId)
    })
  }

  private _validateNoArgs(event: IpcMainInvokeEvent, args: unknown[]) {
    const sourceError = this._validateSource(event)
    if (sourceError) return sourceError
    return args.length === 0 ? null : this._invalidArgument('This method accepts no arguments')
  }

  private _validateArgs(event: IpcMainInvokeEvent, schema: ZodType, args: unknown[]) {
    const parsed = this._parseArgs(event, schema, args)
    return parsed.ok ? null : parsed.result
  }

  private _parseArgs<T>(event: IpcMainInvokeEvent, schema: ZodType<T>, args: unknown[]) {
    const sourceError = this._validateSource(event)
    if (sourceError) return { ok: false as const, result: sourceError }
    const parsed = schema.safeParse(args)
    if (!parsed.success) {
      return { ok: false as const, result: this._invalidArgument('Invalid IPC arguments') }
    }
    return { ok: true as const, value: parsed.data }
  }

  private _validateSource(event: IpcMainInvokeEvent): MemberAnalysisResult<never> | null {
    const mainWebContents = this._context.windowManager.mainWindow.window?.webContents
    if (!mainWebContents || event.sender !== mainWebContents) {
      this._context.logger.warn('Rejected member analysis IPC call from a non-main renderer')
      return this._invalidArgument('IPC caller is not the main window')
    }
    return null
  }

  private _invalidArgument(message: string): MemberAnalysisResult<never> {
    const error: MemberAnalysisError = { code: 'INVALID_ARGUMENT', message, retryable: false }
    return { ok: false, error }
  }
}
