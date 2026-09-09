import {
  type AkariApiLanguage,
  type AkariRelease,
  AkariReleaseSchema
} from '@shared/shards/akari-api'
import type { AxiosInstance } from 'axios'
import { valid } from 'semver'
import { z } from 'zod'

import type { AkariApiMainContext } from './context'

export const CCB_RELEASE_REPOSITORY = 'kekekawaii2839/LeagueAkari-CCB'
export const CCB_LATEST_RELEASE_API_URL = `https://api.github.com/repos/${CCB_RELEASE_REPOSITORY}/releases/latest`

const GitHubAssetSchema = z.object({
  name: z.string(),
  size: z.number().int().nonnegative(),
  content_type: z.string(),
  browser_download_url: z.url()
})

const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.iso.datetime({ offset: true }),
  body: z.string().nullable(),
  assets: z.array(GitHubAssetSchema)
})

function isExpectedReleaseAssetUrl(url: string, tag: string, fileName: string) {
  try {
    const parsed = new URL(url)
    return (
      parsed.origin === 'https://github.com' &&
      decodeURIComponent(parsed.pathname) ===
        `/${CCB_RELEASE_REPOSITORY}/releases/download/${tag}/${fileName}`
    )
  } catch {
    return false
  }
}

function parseChecksum(value: string, expectedFileName: string) {
  const match = value.trim().match(/^([a-f\d]{64})\s+\*?(.+)$/i)
  if (!match || match[2] !== expectedFileName) {
    throw new Error(`Invalid checksum manifest for ${expectedFileName}`)
  }

  return match[1].toLowerCase()
}

export class AkariApiReleaseLoader {
  private _updatePromise: Promise<AkariRelease> | null = null

  constructor(
    private readonly _context: AkariApiMainContext,
    private readonly _releaseHttp: AxiosInstance
  ) {}

  updateLatestRelease(language: AkariApiLanguage) {
    if (this._updatePromise) {
      return this._updatePromise
    }

    this._context.state.setUpdatingLatestRelease(true)

    const updatePromise = this._fetchLatestRelease(language)
      .then((release) => {
        this._context.state.setLatestRelease(release)
        this._context.logger.info('Updated latest release')
        return release
      })
      .catch((error) => {
        this._context.logger.warn('Update latest release failed', error)
        throw error
      })
      .finally(() => {
        this._context.state.setUpdatingLatestRelease(false)
        if (this._updatePromise === updatePromise) {
          this._updatePromise = null
        }
      })

    this._updatePromise = updatePromise
    return updatePromise
  }

  private async _fetchLatestRelease(_language: AkariApiLanguage): Promise<AkariRelease> {
    const response = await this._releaseHttp.get(CCB_LATEST_RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' }
    })
    const release = GitHubReleaseSchema.parse(response.data)
    if (release.draft || release.prerelease || !release.tag_name.startsWith('v')) {
      throw new Error('Latest CCB release is not a stable tagged release')
    }

    const version = valid(release.tag_name.slice(1))
    if (!version || version.includes('-')) {
      throw new Error(`Invalid stable CCB release tag: ${release.tag_name}`)
    }

    const fileName = `League Akari CCB-${version}-x64.7z`
    const checksumFileName = `${fileName}.sha256`
    const archive = release.assets.find((asset) => asset.name === fileName)
    const checksum = release.assets.find((asset) => asset.name === checksumFileName)

    if (!archive || !checksum) {
      throw new Error(`CCB release ${release.tag_name} is missing its archive or checksum`)
    }
    if (
      !isExpectedReleaseAssetUrl(archive.browser_download_url, release.tag_name, fileName) ||
      !isExpectedReleaseAssetUrl(checksum.browser_download_url, release.tag_name, checksumFileName)
    ) {
      throw new Error(`CCB release ${release.tag_name} contains an unexpected download URL`)
    }

    const checksumResponse = await this._releaseHttp.get<string>(checksum.browser_download_url, {
      responseType: 'text',
      headers: { Accept: 'application/octet-stream' }
    })

    return AkariReleaseSchema.parse({
      version,
      publishedAt: release.published_at,
      description: release.body ?? '',
      artifacts: [
        {
          platform: 'win32',
          arch: 'x64',
          fileName,
          size: archive.size,
          contentType: archive.content_type,
          sha256: parseChecksum(checksumResponse.data, fileName),
          downloadUrl: archive.browser_download_url
        }
      ]
    })
  }
}
