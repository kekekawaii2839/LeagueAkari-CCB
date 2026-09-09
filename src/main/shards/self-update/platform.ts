/** CCB updates are accepted only from the fork-owned, hash-verified release loader. */
export const CCB_SELF_UPDATE_ENABLED = true

export function shouldRunSelfUpdateLifecycle(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  return CCB_SELF_UPDATE_ENABLED && platform === 'win32' && arch === 'x64'
}

export function shouldDownloadUpdateArchive(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  return shouldRunSelfUpdateLifecycle(platform, arch)
}

export function shouldApplyDownloadedUpdate(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  return shouldRunSelfUpdateLifecycle(platform, arch)
}

export function shouldLaunchUpdaterOnQuit(
  isPackaged: boolean,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  return isPackaged && shouldApplyDownloadedUpdate(platform, arch)
}

export function shouldUninstallWithUpdater(
  _platform: NodeJS.Platform = process.platform,
  _arch: string = process.arch
) {
  // The portable CCB build does not own the official Akari protocol registrations.
  return false
}
