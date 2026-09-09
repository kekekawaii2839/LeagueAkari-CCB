import { describe, expect, it, vi } from 'vitest'

import type { AkariApiMainContext } from './context'
import { AkariApiReleaseLoader, CCB_LATEST_RELEASE_API_URL } from './release-loader'
import { AkariApiState } from './state'

const version = '0.2.0'
const fileName = `League Akari CCB-${version}-x64.7z`
const checksum = 'a'.repeat(64)
const archiveUrl =
  'https://github.com/kekekawaii2839/LeagueAkari-CCB/releases/download/v0.2.0/League%20Akari%20CCB-0.2.0-x64.7z'
const checksumUrl = `${archiveUrl}.sha256`

function createGitHubRelease(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    published_at: '2026-09-09T00:00:00.000Z',
    body: 'Release notes',
    assets: [
      {
        name: fileName,
        size: 2048,
        content_type: 'application/x-7z-compressed',
        browser_download_url: archiveUrl
      },
      {
        name: `${fileName}.sha256`,
        size: 100,
        content_type: 'application/octet-stream',
        browser_download_url: checksumUrl
      }
    ],
    ...overrides
  }
}

function createHarness(
  release = createGitHubRelease(),
  checksumBody = `${checksum}  ${fileName}\n`
) {
  const state = new AkariApiState()
  const http = {
    get: vi.fn(async (url: string) =>
      url === CCB_LATEST_RELEASE_API_URL ? { data: release } : { data: checksumBody }
    )
  }
  const context = {
    state,
    logger: { info: vi.fn(), warn: vi.fn() }
  } as unknown as AkariApiMainContext

  return { context, http, loader: new AkariApiReleaseLoader(context, http as never) }
}

describe('CCB GitHub release loader', () => {
  it('maps the stable fork release and its checksum to the native release contract', async () => {
    const { context, http, loader } = createHarness()

    await expect(loader.updateLatestRelease('zh-CN')).resolves.toEqual({
      version,
      publishedAt: '2026-09-09T00:00:00.000Z',
      description: 'Release notes',
      artifacts: [
        {
          platform: 'win32',
          arch: 'x64',
          fileName,
          size: 2048,
          contentType: 'application/x-7z-compressed',
          sha256: checksum,
          downloadUrl: archiveUrl
        }
      ]
    })
    expect(context.state.latestRelease?.version).toBe(version)
    expect(http.get).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['a prerelease', createGitHubRelease({ prerelease: true }), `${checksum}  ${fileName}\n`],
    [
      'an official asset URL',
      createGitHubRelease({
        assets: [
          {
            ...createGitHubRelease().assets[0],
            browser_download_url:
              'https://github.com/Hanxven/LeagueAkari/releases/download/v0.2.0/official.7z'
          },
          createGitHubRelease().assets[1]
        ]
      }),
      `${checksum}  ${fileName}\n`
    ],
    ['a mismatched checksum filename', createGitHubRelease(), `${checksum}  official.7z\n`]
  ])('rejects %s', async (_name, release, checksumBody) => {
    const { loader } = createHarness(release, checksumBody)
    await expect(loader.updateLatestRelease('en')).rejects.toThrow()
  })
})
