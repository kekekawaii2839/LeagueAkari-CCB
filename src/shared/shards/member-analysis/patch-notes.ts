import { z } from 'zod'

/** Client game versions 15/16 correspond to Riot's public 25/26 annual naming. */
export const PatchNotesRequestSchema = z
  .object({
    patch: z.string().regex(/^(?:15|16)\.(?:[1-9]|1[0-9]|2[0-4])$/),
    refresh: z.boolean().optional()
  })
  .strict()
export type PatchNotesRequest = z.infer<typeof PatchNotesRequestSchema>
// Confirmed released baseline, not a schedule. Later patches require a fetched announcement.
export const releasedPatchNotes = [16, 15].flatMap((year) =>
  Array.from(
    { length: year === 16 ? 21 : 24 },
    (_, index) => `${year}.${(year === 16 ? 21 : 24) - index}`
  )
)
// Only public Riot raster assets, never arbitrary renderer URLs or executable content.
export const PatchNoteImageSchema = z
  .string()
  .max(1000)
  .url()
  .refine((value) => {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      ['ddragon.leagueoflegends.com', 'cmsassets.rgpub.io'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash &&
      /\.(?:png|jpe?g|webp)$/i.test(url.pathname)
    )
  })
export const PatchNotesSchema = z
  .object({
    patch: PatchNotesRequestSchema.shape.patch,
    publicPatch: z.string(),
    availablePatches: z.array(PatchNotesRequestSchema.shape.patch).max(48).optional(),
    source: z.literal('Riot Games · en-US'),
    sourceUrl: z
      .string()
      .url()
      .refine((value) => {
        const url = new URL(value)
        return (
          url.protocol === 'https:' &&
          url.hostname === 'www.leagueoflegends.com' &&
          url.pathname.startsWith('/en-us/news/game-updates/') &&
          !url.search &&
          !url.hash
        )
      }),
    fetchedAt: z.number().finite().nonnegative(),
    publishedAt: z.string().nullable(),
    status: z.enum(['available', 'unavailable']),
    stale: z.boolean(),
    parserVersion: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
    truncated: z.boolean(),
    sections: z
      .array(
        z.object({
          category: z.enum(['champion', 'item', 'system']),
          title: z.string().max(200),
          changes: z.array(z.string().max(2400)).max(300),
          section: z.string().max(200),
          hotfix: z.boolean(),
          entityKey: z.string().max(200).nullable(),
          imageUrl: PatchNoteImageSchema.nullable().optional(),
          entries: z
            .array(
              z.object({
                text: z.string().max(2400),
                label: z.string().max(180).nullable(),
                before: z.string().max(2400).nullable(),
                after: z.string().max(2400).nullable(),
                ability: z.string().max(200).nullable(),
                abilityImageUrl: PatchNoteImageSchema.nullable().optional()
              })
            )
            .max(300)
        })
      )
      .max(240)
  })
  .strict()
export type PatchNotes = z.infer<typeof PatchNotesSchema>

export function patchNotesSources(patch: string) {
  const parsed = PatchNotesRequestSchema.parse({ patch })
  const [year, minor] = parsed.patch.split('.').map(Number)
  const publicYear = year + 10
  const special =
    year === 15 && minor <= 3
      ? [minor === 3 ? 'patch-2025-s1-3-notes' : `patch-25-s1-${minor}-notes`]
      : []
  const preferred =
    year === 15 && minor >= 4 && minor < 10
      ? `patch-25-${String(minor).padStart(2, '0')}-notes`
      : year === 16 && minor >= 4
        ? `league-of-legends-patch-26-${minor}-notes`
        : `patch-${publicYear}-${minor}-notes`
  return [
    ...new Set([
      ...special,
      preferred,
      `patch-${publicYear}-${minor}-notes`,
      `patch-${publicYear}-${String(minor).padStart(2, '0')}-notes`,
      `league-of-legends-patch-${publicYear}-${minor}-notes`
    ])
  ].map((slug) => `https://www.leagueoflegends.com/en-us/news/game-updates/${slug}/`)
}
