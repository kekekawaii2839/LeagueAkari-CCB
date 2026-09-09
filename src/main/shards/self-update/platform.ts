/**
 * This checkout is a fork and must never consume official League Akari artifacts.
 * Keep this compile-time guard closed until a separately identified, signed and
 * hash-verified fork update channel exists.
 */
export const OFFICIAL_SELF_UPDATE_ALLOWED_IN_FORK = false

export function shouldRunSelfUpdateLifecycle(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  return OFFICIAL_SELF_UPDATE_ALLOWED_IN_FORK && platform === 'win32' && arch === 'x64'
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
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
) {
  return shouldRunSelfUpdateLifecycle(platform, arch)
}
