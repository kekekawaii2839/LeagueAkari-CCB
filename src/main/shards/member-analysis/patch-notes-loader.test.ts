import {
  PatchNotesRequestSchema,
  patchNotesSources
} from '@shared/shards/member-analysis/patch-notes'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { PatchNotesLoader, parseOfficialPatchNotes } from './patch-notes-loader'

const roots: string[] = []
async function root() {
  const value = await mkdtemp(join(tmpdir(), 'akari-patch-test-'))
  roots.push(value)
  return value
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((value) => rm(value, { recursive: true, force: true })))
})
const html = `<h1>Patch 26.1 Notes</h1><h2>Champions</h2><h3>Synthetic Hero</h3><h4>Q</h4><ul><li>Damage 10 &rArr; 12</li></ul><h2>Items</h2><h3>Synthetic Item</h3><li>Cost 100 &rArr; 90</li><h2>System</h2><h3>Minions</h3><li>Spawn time 30 &rArr; 25</li><h2>ARAM</h2><h3>Not SR</h3><li>Do not include</li><script>alert('no')</script>`
describe('fixed official patch notes adapter', () => {
  test.each([2, 3, 4, 5])(
    'refreshes v%s cache automatically and retains it as stale if offline',
    async (parserVersion) => {
      const directory = await root()
      const first = await new PatchNotesLoader(
        directory,
        async () => html,
        () => 1000
      ).read('16.1')
      await writeFile(
        join(directory, 'patch-notes', '16.1.json'),
        JSON.stringify({ ...first, parserVersion })
      )
      const offline = await new PatchNotesLoader(
        directory,
        async () => {
          throw new Error('offline')
        },
        () => 2000
      ).read('16.1')
      expect(offline).toMatchObject({ parserVersion, stale: true, status: 'available' })
      const fetch = vi.fn(async () => html)
      const current = await new PatchNotesLoader(directory, fetch, () => 3000).read('16.1')
      expect(fetch).toHaveBeenCalled()
      expect(current.parserVersion).toBe(6)
    }
  )
  test('maps every client 15/16 patch to official annual names including seasonal exceptions', () => {
    for (const year of [15, 16])
      for (let minor = 1; minor <= 24; minor++) {
        const sources = patchNotesSources(`${year}.${minor}`)
        expect(
          sources.every((value) => new URL(value).hostname === 'www.leagueoflegends.com')
        ).toBe(true)
        expect(sources.some((value) => value.includes(`${year + 10}-`))).toBe(true)
      }
    expect(patchNotesSources('15.1')[0]).toContain('patch-25-s1-1-notes')
    expect(patchNotesSources('15.3')[0]).toContain('patch-2025-s1-3-notes')
    expect(PatchNotesRequestSchema.safeParse({ patch: '../../secret' }).success).toBe(false)
    expect(
      PatchNotesRequestSchema.safeParse({ patch: '16.1', url: 'https://bad.invalid' }).success
    ).toBe(false)
  })
  test('parses bounded plaintext categories and never executes or returns HTML', () => {
    const result = parseOfficialPatchNotes(html)!
    expect(result.sections.map((entry) => entry.category)).toEqual(['champion', 'item', 'system'])
    expect(result.sections[0].changes).toEqual(['Damage 10 ⇒ 12'])
    expect(result.sections[0].entries[0]).toMatchObject({
      ability: 'Q',
      before: 'Damage 10',
      after: '12'
    })
    expect(JSON.stringify(result)).not.toContain('<script>')
    expect(parseOfficialPatchNotes('<h1>Maintenance</h1>')).toBeNull()
  })
  test('deduplicates reads and caches parsed public metadata under its supplied userData root', async () => {
    const directory = await root(),
      fetch = vi.fn(async () => html)
    const loader = new PatchNotesLoader(directory, fetch, () => 1000)
    const [a, b] = await Promise.all([loader.read('16.1'), loader.read('16.1')])
    expect(a).toEqual(b)
    expect(a.status).toBe('available')
    expect(fetch).toHaveBeenCalledTimes(1)
    const loaded = new PatchNotesLoader(
      directory,
      vi.fn(async () => {
        throw new Error('offline')
      }),
      () => 2000
    )
    expect(await loaded.read('16.1')).toEqual(a)
    expect(
      JSON.parse(await readFile(join(directory, 'patch-notes', '16.1.json'), 'utf8')).patch
    ).toBe('16.1')
  })
  test('absent/future or unrecognized pages are unavailable, not fabricated empty changes', async () => {
    const fetch = vi.fn(async () => '<h1>Not Found</h1>')
    const loader = new PatchNotesLoader(await root(), fetch)
    const value = await loader.read('16.24')
    expect(value.status).toBe('unavailable')
    expect(value.sections).toEqual([])
    const wrong = await new PatchNotesLoader(await root(), async () => html).read('16.24')
    expect(wrong.status).toBe('unavailable')
  })
  test('failed refresh preserves stale real observations', async () => {
    const directory = await root()
    const a = await new PatchNotesLoader(
      directory,
      async () => html,
      () => 1000
    ).read('16.1')
    const b = await new PatchNotesLoader(
      directory,
      async () => {
        throw new Error('offline')
      },
      () => 1000 + 7 * 3600000
    ).read('16.1')
    expect(b).toEqual({ ...a, stale: true })
  })
})

test('explicit refresh bypasses a fresh parsed cache', async () => {
  const directory = await root(),
    fetch = vi.fn(async (_url: string) => html)
  const loader = new PatchNotesLoader(directory, fetch)
  await loader.read('16.1')
  await loader.read('16.1')
  expect(fetch).toHaveBeenCalledTimes(1)
  await loader.read('16.1', true)
  expect(fetch.mock.calls.filter(([url]) => url === patchNotesSources('16.1')[0])).toHaveLength(2)
})

test('future options require fetched published notes and survive restart; refresh discovers new releases', async () => {
  const directory = await root()
  let published = false
  const fetch = vi.fn(async (url: string) => {
    if (url === patchNotesSources('16.21')[0]) return html.replace('26.1', '26.21')
    if (published && url === patchNotesSources('16.22')[0]) return html.replace('26.1', '26.22')
    return '<h1>Not Found</h1>'
  })
  const loader = new PatchNotesLoader(directory, fetch)
  expect((await loader.read('16.21')).availablePatches).not.toContain('16.22')
  expect((await loader.read('16.21', true)).availablePatches).not.toContain('16.22')
  published = true
  const refreshed = await loader.read('16.21', true)
  expect(refreshed.availablePatches?.slice(0, 2)).toEqual(['16.22', '16.21'])
  expect(refreshed.availablePatches).not.toContain('16.23')
  const offline = new PatchNotesLoader(directory, async () => {
    throw new Error('offline')
  })
  expect((await offline.read('16.21')).availablePatches).toContain('16.22')
})

test('unpublished and mismatched cached announcements never extend the dropdown', async () => {
  const directory = await root()
  const loader = new PatchNotesLoader(
    directory,
    async () => html.replace('26.1', '26.22'),
    () => 1000
  )
  const notes = await loader.read('16.22')
  expect(notes.availablePatches).toContain('16.22')
  const path = join(directory, 'patch-notes', '16.22.json')
  for (const invalid of [
    { ...notes, publishedAt: '2099-01-01T00:00:00Z' },
    { ...notes, patch: '16.23' },
    { ...notes, status: 'unavailable' }
  ]) {
    await writeFile(path, JSON.stringify(invalid))
    const current = new PatchNotesLoader(
      directory,
      async () => html.replace('26.1', '26.21'),
      () => 1000
    )
    expect((await current.read('16.21')).availablePatches).not.toContain('16.22')
  }
})
