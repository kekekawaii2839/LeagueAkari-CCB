import { describe, expect, test } from 'vitest'

import {
  OFFICIAL_SELF_UPDATE_ALLOWED_IN_FORK,
  shouldApplyDownloadedUpdate,
  shouldDownloadUpdateArchive,
  shouldLaunchUpdaterOnQuit,
  shouldRunSelfUpdateLifecycle,
  shouldUninstallWithUpdater
} from './platform'

describe('self-update platform guards', () => {
  test('hard-disables official updater capabilities in the fork on every platform', () => {
    expect(OFFICIAL_SELF_UPDATE_ALLOWED_IN_FORK).toBe(false)
    expect(shouldDownloadUpdateArchive('win32', 'x64')).toBe(false)
    expect(shouldApplyDownloadedUpdate('win32', 'x64')).toBe(false)
    expect(shouldRunSelfUpdateLifecycle('win32', 'x64')).toBe(false)
    expect(shouldUninstallWithUpdater('win32', 'x64')).toBe(false)

    expect(shouldDownloadUpdateArchive('win32', 'arm64')).toBe(false)
    expect(shouldApplyDownloadedUpdate('darwin', 'x64')).toBe(false)
    expect(shouldRunSelfUpdateLifecycle('darwin', 'arm64')).toBe(false)
    expect(shouldUninstallWithUpdater('darwin', 'x64')).toBe(false)

    expect(shouldDownloadUpdateArchive('linux', 'x64')).toBe(false)
    expect(shouldApplyDownloadedUpdate('linux', 'x64')).toBe(false)
    expect(shouldRunSelfUpdateLifecycle('linux', 'x64')).toBe(false)
    expect(shouldUninstallWithUpdater('linux', 'x64')).toBe(false)
  })

  test('never launches the official updater on quit, including packaged Windows builds', () => {
    expect(shouldLaunchUpdaterOnQuit(true, 'win32', 'x64')).toBe(false)
    expect(shouldLaunchUpdaterOnQuit(false, 'win32', 'x64')).toBe(false)
    expect(shouldLaunchUpdaterOnQuit(true, 'win32', 'arm64')).toBe(false)
    expect(shouldLaunchUpdaterOnQuit(true, 'darwin', 'x64')).toBe(false)
    expect(shouldLaunchUpdaterOnQuit(true, 'linux', 'x64')).toBe(false)
  })
})
