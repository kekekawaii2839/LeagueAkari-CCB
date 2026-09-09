import type { AkariRelease, AkariReleaseArtifact } from '@shared/shards/akari-api'
import type { SelfUpdateReleaseInfo } from '@shared/shards/self-update'
import { gt } from 'semver'

import { shouldRunSelfUpdateLifecycle } from './platform'

export interface SelfUpdateTarget {
  platform: NodeJS.Platform
  arch: string
}

export function isSupportedWin32X64Artifact(artifact: AkariReleaseArtifact) {
  if (artifact.platform !== 'win32' || artifact.arch !== 'x64') {
    return false
  }

  if (!/^League\.Akari\.CCB-.+-x64\.7z$/i.test(artifact.fileName)) return false
  if (!/^[a-f\d]{64}$/i.test(artifact.sha256 ?? '')) return false

  return ['application/x-7z-compressed', 'application/octet-stream'].includes(artifact.contentType)
}

export function resolveSelfUpdateReleaseInfo(
  release: AkariRelease | null,
  currentVersion: string,
  target: SelfUpdateTarget
): SelfUpdateReleaseInfo | null {
  if (!release) {
    return null
  }

  const expectedFileName = `League.Akari.CCB-${release.version}-x64.7z`
  const artifact = shouldRunSelfUpdateLifecycle(target.platform, target.arch)
    ? (release.artifacts.find(
        (candidate) =>
          candidate.fileName === expectedFileName && isSupportedWin32X64Artifact(candidate)
      ) ?? null)
    : null

  return {
    version: release.version,
    currentVersion,
    publishedAt: release.publishedAt,
    description: release.description,
    isNew: gt(release.version, currentVersion),
    isUpdateSupported: artifact !== null,
    artifact
  }
}
