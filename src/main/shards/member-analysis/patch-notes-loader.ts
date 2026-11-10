import {
  type PatchNotes,
  PatchNotesRequestSchema,
  PatchNotesSchema,
  patchNotesSources,
  releasedPatchNotes
} from '@shared/shards/member-analysis/patch-notes'
import axios from 'axios'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  PATCH_NOTES_PARSER_VERSION,
  officialPatchMetadata,
  parseOfficialPatchNotes
} from './patch-notes-parser'

export { parseOfficialPatchNotes } from './patch-notes-parser'

type FetchHtml = (url: string, signal: AbortSignal) => Promise<string>
const fetchHtml: FetchHtml = async (url, signal) =>
  (
    await axios.get<string>(url, {
      signal,
      timeout: 8000,
      maxRedirects: 0,
      responseType: 'text',
      maxContentLength: 10_000_000,
      headers: { Accept: 'text/html' }
    })
  ).data

/** Fixed Riot source adapter; accepts a client patch, never a URL or path. */
export class PatchNotesLoader {
  private readonly pending = new Map<string, Promise<PatchNotes>>()
  private readonly controllers = new Set<AbortController>()
  private disposed = false
  constructor(
    private readonly root: string,
    private readonly fetch: FetchHtml = fetchHtml,
    private readonly now = Date.now
  ) {}
  dispose() {
    this.disposed = true
    for (const controller of this.controllers) controller.abort()
  }
  async read(patch: string, refresh = false): Promise<PatchNotes> {
    PatchNotesRequestSchema.parse({ patch })
    if (this.disposed) throw new Error('disposed')
    const pending = this.pending.get(patch)
    if (pending) return pending
    if (this.pending.size >= 2) throw new Error('busy')
    const promise = this.load(patch, refresh)
      .then(async (notes) => ({ ...notes, availablePatches: await this.catalog(refresh) }))
      .finally(() => this.pending.delete(patch))
    this.pending.set(patch, promise)
    return promise
  }
  private async catalog(refresh: boolean): Promise<string[]> {
    const available = [...releasedPatchNotes]
    for (let minor = 22; minor <= 24; minor++) {
      const patch = `16.${minor}`
      let cached: PatchNotes | null = null
      try {
        const text = await readFile(join(this.root, 'patch-notes', `${patch}.json`), 'utf8')
        if (text.length <= 3_000_000) cached = PatchNotesSchema.parse(JSON.parse(text))
      } catch {
        /* Only validated public announcement caches extend the baseline. */
      }
      const published = (notes: PatchNotes | null) =>
        notes?.patch === patch &&
        notes.status === 'available' &&
        patchNotesSources(patch).includes(notes.sourceUrl) &&
        (notes.publishedAt === null || Date.parse(notes.publishedAt) <= this.now())
      if (!published(cached) && refresh && !this.disposed) cached = await this.load(patch, true)
      if (published(cached)) available.unshift(patch)
      else if (refresh) break
    }
    return available
  }
  private async load(patch: string, refresh: boolean): Promise<PatchNotes> {
    const urls = patchNotesSources(patch),
      path = join(this.root, 'patch-notes', `${patch}.json`)
    const fallback: PatchNotes = {
      patch,
      publicPatch: `${Number(patch.split('.')[0]) + 10}.${patch.split('.')[1]}`,
      source: 'Riot Games · en-US',
      sourceUrl: urls[0],
      fetchedAt: this.now(),
      publishedAt: null,
      status: 'unavailable',
      stale: false,
      parserVersion: PATCH_NOTES_PARSER_VERSION,
      truncated: false,
      sections: []
    }
    let cached: PatchNotes | null = null
    try {
      const text = await readFile(path, 'utf8')
      if (text.length <= 3_000_000) {
        const value = PatchNotesSchema.parse(JSON.parse(text))
        if (value.patch === patch && urls.includes(value.sourceUrl)) cached = value
      }
    } catch {
      /* Missing or invalid public cache is fetched again. */
    }
    if (
      !refresh &&
      cached &&
      cached.parserVersion === PATCH_NOTES_PARSER_VERSION &&
      this.now() - cached.fetchedAt >= 0 &&
      this.now() - cached.fetchedAt < (cached.status === 'available' ? 6 * 3600000 : 15 * 60000)
    )
      return cached
    const controller = new AbortController()
    this.controllers.add(controller)
    const timer = setTimeout(() => controller.abort(), 20000)
    try {
      for (const url of urls) {
        if (controller.signal.aborted || this.disposed) break
        try {
          const html = await this.fetch(url, controller.signal)
          const { title } = officialPatchMetadata(html)
          const [year, minor] = patch.split('.').map(Number)
          const official = year + 10
          const titlePattern =
            year === 15 && minor <= 3
              ? new RegExp(`(?:25|2025)[.\\s]+S1[.\\s]+0?${minor}(?:\\D|$)`, 'i')
              : new RegExp(`(?:${official}|20${official})[.\\s]+0?${minor}(?:\\D|$)`, 'i')
          if (!titlePattern.test(title)) continue
          const parsed = parseOfficialPatchNotes(html)
          if (
            !parsed ||
            (parsed.publishedAt !== null && Date.parse(parsed.publishedAt) > this.now())
          )
            continue
          const value = PatchNotesSchema.parse({
            ...fallback,
            ...parsed,
            status: 'available',
            sourceUrl: url,
            fetchedAt: this.now()
          })
          if (this.disposed || controller.signal.aborted) throw new Error('cancelled')
          await this.save(path, value).catch(() => {})
          return value
        } catch {
          /* A changed slug or unavailable page is not an empty changelog. */
        }
      }
      if (cached?.status === 'available') return { ...cached, stale: true }
      if (!this.disposed) await this.save(path, fallback).catch(() => {})
      return fallback
    } finally {
      clearTimeout(timer)
      this.controllers.delete(controller)
    }
  }
  private async save(path: string, value: PatchNotes) {
    await mkdir(join(this.root, 'patch-notes'), { recursive: true })
    const temp = `${path}.tmp`
    await writeFile(temp, JSON.stringify(value), 'utf8')
    await rename(temp, path)
  }
}
