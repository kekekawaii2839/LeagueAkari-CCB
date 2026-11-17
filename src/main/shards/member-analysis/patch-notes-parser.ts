import type { PatchNotes } from '@shared/shards/member-analysis/patch-notes'
import { PatchNoteImageSchema } from '@shared/shards/member-analysis/patch-notes'

function patchImage(html: string): string | null {
  for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    let source = match[1].replace(/&amp;/g, '&')
    // Riot's article image wrapper is not a product proxy. Extract only its
    // allowlisted CDN asset; never forward arbitrary wrapper destinations.
    try {
      const url = new URL(source)
      if (
        url.protocol === 'https:' &&
        url.hostname === 'am-a.akamaihd.net' &&
        url.pathname === '/image' &&
        !url.username &&
        !url.password &&
        !url.port &&
        [...url.searchParams.keys()].every((key) => key === 'f')
      ) {
        source = url.searchParams.get('f') ?? ''
      }
    } catch {
      /* Invalid image data stays unavailable. */
    }
    const parsed = PatchNoteImageSchema.safeParse(source)
    if (parsed.success) return parsed.data
  }
  return null
}

export const PATCH_NOTES_PARSER_VERSION = 7
export const plainPatchText = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(?:p|div|li|ul|ol|br|hr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&#(x[0-9a-f]+|[0-9]+);?/gi, (_, entity: string) => {
      const value = entity[0].toLowerCase() === 'x' ? parseInt(entity.slice(1), 16) : Number(entity)
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''
    })
    .replace(
      /&(amp|lt|gt|quot|apos|nbsp|rarr|rArr|mdash|ndash|rsquo|lsquo|rdquo|ldquo);/g,
      (_, key: string) =>
        (
          ({
            amp: '&',
            lt: '<',
            gt: '>',
            quot: '"',
            apos: "'",
            nbsp: ' ',
            rarr: '→',
            rArr: '⇒',
            mdash: '—',
            ndash: '–',
            rsquo: "'",
            lsquo: "'",
            rdquo: '"',
            ldquo: '"'
          }) as Record<string, string>
        )[key] ?? ''
    )
    .replace(/\s+/g, ' ')
    .trim()

export function officialPatchMetadata(html: string) {
  const title = plainPatchText(
    /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ??
      /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1] ??
      ''
  )
  let publishedAt: string | null = null
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const json = JSON.parse(match[1])
      const articles = (Array.isArray(json['@graph']) ? json['@graph'] : [json]) as Record<
        string,
        unknown
      >[]
      const article = articles.find(
        (entry) =>
          /^(TechArticle|NewsArticle|Article)$/.test(String(entry['@type'])) &&
          typeof entry.datePublished === 'string'
      )
      if (article && Number.isFinite(Date.parse(String(article.datePublished)))) {
        publishedAt = String(article.datePublished)
        break
      }
    } catch {
      /* JSON metadata is data, not executable script. */
    }
  }
  publishedAt ??= /(?:datetime|content)=["'](\d{4}-\d{2}-\d{2}T[^"']+)["']/i.exec(html)?.[1] ?? null
  return { title, publishedAt }
}

const excludedMode =
  /aram|arurf|arena|swiftplay|\bclassic\b|\bbrawl\b|doom bots|hall of legends|\bskins\b|cosmetic|mythic shop|tft|teamfight|highlight|known issue|chroma|related articles/i

// These standalone system announcements use paragraphs rather than change lists.
// Do not ingest every champion's design rationale as another gameplay change.
const paragraphSystemHeading =
  /^(?:Normal Draft Queue Availability|Honor in Social Panel|Last Hit Indicators|Reporting Direct Messages|Ranked 5s|SR Ranked Season 2 End|Parental Controls|Updated System Requirements|Team Voice|Replay Download Limits|Minimum System Requirements)$/i
/** Bounded, non-executing Riot article adapter. Matches real SSR patch containers,
 * including articles whose page heading is a div rather than an h1. */
export function parseOfficialPatchNotes(
  html: string
): Pick<PatchNotes, 'sections' | 'publishedAt' | 'parserVersion' | 'truncated'> | null {
  if (html.length > 10_000_000) return null
  const metadata = officialPatchMetadata(html)
  if (!/(?:patch|notes)/i.test(metadata.title)) return null
  html = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  const container = /<div\b[^>]*\bid=["']patch-notes-container["'][^>]*>/i.exec(html)
  if (container) html = html.slice(container.index + container[0].length)
  const sections: PatchNotes['sections'] = []
  const hasPrimaryHeaders = /<header\b[^>]*class=["'][^"']*\bheader-primary\b/i.test(html)
  let heading = '',
    category: 'champion' | 'item' | 'system' = 'system'
  const cursor: { active: PatchNotes['sections'][number] | null } = { active: null }
  let ability: string | null = null,
    abilityImageUrl: string | null = null,
    excluded = false,
    excludedSubsection = false,
    hotfix = false,
    datedHotfix = false,
    truncated = false
  let previousEnd = 0
  for (const match of html.matchAll(
    /<(h2|h3|h4)\b([^>]*)>([\s\S]*?)<\/\1>|<(li|p)\b[^>]*>((?:(?!<(?:li|h[234])\b)[\s\S])*?)<\/\4>/gi
  )) {
    const tag = (match[1] ?? match[4]).toLowerCase(),
      raw = match[3] ?? match[5],
      value = plainPatchText(raw)
    const gap = html.slice(Math.max(previousEnd, match.index! - 5000), match.index)
    // Current Riot SSR puts the object portrait in a linked paragraph directly
    // before h3, not inside it. Do not borrow a preceding object's skill image.
    const precedingPortrait =
      tag === 'h3' ? (/(<img\b[^>]*>)\s*<\/a>\s*<\/p>\s*$/i.exec(gap)?.[1] ?? '') : ''
    const headingImage = patchImage(raw) ?? patchImage(precedingPortrait)
    if (!value) continue
    if (tag === 'p') {
      const scoreboardContext = cursor.active?.title === 'Scoreboard Cleanup'
      const hotfixMechanic =
        hotfix &&
        cursor.active?.title === 'Varus' &&
        /no longer deal reduced damage to subsequent targets/i.test(value) &&
        /fixing that bug/i.test(value)
      // Some official change rows are paragraphs adjacent to the list, not li.
      // Require a labelled arrow (or a split-arrow continuation), never rationale.
      const changeParagraph = cursor.active && /^(?:.{1,180}?:\s+.+|\s*)[⇒→]/.test(value)
      if (
        !paragraphSystemHeading.test(heading) &&
        !scoreboardContext &&
        !hotfixMechanic &&
        !changeParagraph
      )
        continue
    }
    previousEnd = match.index! + match[0].length
    if (tag === 'h2' && /^Related Articles$/i.test(value)) break
    const primaryHeading =
      !hasPrimaryHeaders ||
      /<header\b[^>]*class=["'][^"']*\bheader-primary\b[^"']*["'][^>]*>\s*$/i.test(gap)
    // Riot sometimes uses h2 inside a mode's content (even "Champions").
    // It must not escape the excluded top-level scope or reset its category.
    if (tag === 'h2' && primaryHeading) {
      heading = value
      // Some historical articles title a mode block merely "Champions";
      // its heading id, e.g. patch-swiftplay, carries the missing scope.
      const headingId = /\bid=["']([^"']*)["']/i.exec(match[2] ?? '')?.[1] ?? ''
      excluded = excludedMode.test(value) || excludedMode.test(headingId)
      excludedSubsection = false
      hotfix = /mid.patch|hotfix/i.test(value)
      datedHotfix = false
      const bodyStart = match.index! + match[0].length
      const following = html.slice(bodyStart, bodyStart + 50_000)
      const nextPrimary = following.search(
        hasPrimaryHeaders ? /<header\b[^>]*class=["'][^"']*\bheader-primary\b/i : /<h2\b/i
      )
      const body = nextPrimary < 0 ? following : following.slice(0, nextPrimary)
      const championIntroduction =
        /Champion Spotlight/i.test(body) &&
        /<h4\b/i.test(body) &&
        /(?:Passive|[QWER])\s*[-–—]/i.test(plainPatchText(body))
      category =
        /champion/i.test(value) || championIntroduction
          ? 'champion'
          : /item/i.test(value)
            ? 'item'
            : 'system'
      cursor.active = null
      ability = null
    }
    if (excluded) continue
    if (tag === 'h3') {
      datedHotfix = hotfix && /\b\d{4}\s+Updates?$/i.test(value)
      excludedSubsection = excludedMode.test(value)
      ability = null
    }
    if (tag === 'h4' && excludedMode.test(value)) {
      excludedSubsection = true
      ability = null
      continue
    }
    if (excludedSubsection) continue
    const entity = /\/(champion|item)\/([^/?"<>]+)\.(?:png|jpg|webp)/i.exec(headingImage ?? '')
    // A standalone item-system heading must not become the last item's ability.
    const itemSystemHeading = tag === 'h4' && category === 'item' && value === 'Scoreboard Cleanup'
    const entityHeading =
      tag === 'h4' &&
      ((datedHotfix && !/^(?:Base Stats|Passive\b|[QWER]\s*[-–—])/i.test(value)) ||
        entity !== null ||
        (category === 'item' &&
          (/<img\b/i.test(raw) ||
            (cursor.active?.title === heading && !cursor.active.entries.length))))
    if (tag === 'h2' || tag === 'h3' || entityHeading || itemSystemHeading) {
      ability = null
      abilityImageUrl = null
      const targetCategory = itemSystemHeading
        ? 'system'
        : entity
          ? entity[1].toLowerCase() === 'champion'
            ? 'champion'
            : 'item'
          : datedHotfix && entityHeading
            ? 'champion'
            : category
      cursor.active = {
        category: targetCategory,
        title: value.slice(0, 200),
        changes: [],
        entries: [],
        section: heading.slice(0, 200),
        hotfix,
        entityKey: entity?.[2] ?? null,
        imageUrl: headingImage
      }
      if (sections.length < 240) sections.push(cursor.active)
      else {
        cursor.active = null
        truncated = true
      }
    } else if (tag === 'h4') {
      ability = value.slice(0, 200)
      abilityImageUrl = patchImage(raw)
    } else {
      if (!cursor.active) continue
      // A champion spotlight link is navigation, not a sixth ability change.
      if (/^[\w'’ -]+ Champion Spotlight\s*here!?$/i.test(value)) continue
      // The shared QoL section also contains fixes exclusive to other modes.
      if (
        /bugfix|qol/i.test(heading) &&
        /\b(?:aram|arurf|arena|swiftplay|classic|brawl|tft|teamfight tactics)\b|doom bots/i.test(
          value
        ) &&
        !/\bnon-classic\b/i.test(value)
      )
        continue
      if (cursor.active.entries.length >= 300) {
        truncated = true
        continue
      }
      let text = value.slice(0, 2400)
      const previous = cursor.active.entries.at(-1)
      // Riot may put the old value and the arrow/new value in separate rows.
      // Merge only adjacent rows in the same ability with an explicit old label.
      if (
        /^[⇒→]/.test(text) &&
        previous &&
        previous.ability === ability &&
        previous.before === null &&
        /^.{1,180}?:\s+\d/.test(previous.text)
      ) {
        const combined = `${previous.text} ${text}`
        if (combined.length > 2400) truncated = true
        text = combined.slice(0, 2400)
        cursor.active.entries.pop()
        cursor.active.changes.pop()
      }
      if (value.length > 2400) truncated = true
      const arrow = /\s*(?:⇒|→|⟶|->)\s*/.exec(text)
      let label: string | null = null,
        before: string | null = null,
        after: string | null = null
      if (arrow) {
        const left = text.slice(0, arrow.index).trim()
        const labelled = /^(.{1,180}?):\s+(.+)$/.exec(left)
        label = labelled?.[1].trim() ?? null
        before = labelled?.[2] ?? left
        after = text.slice(arrow.index + arrow[0].length).trim()
      }
      cursor.active.changes.push(text)
      cursor.active.entries.push({
        text,
        label,
        before,
        after,
        ability,
        ...(abilityImageUrl ? { abilityImageUrl } : {})
      })
    }
  }
  const populated = sections.filter((entry) => entry.entries.length)
  if (!populated.length) return null
  return {
    sections: populated,
    publishedAt: metadata.publishedAt,
    parserVersion: PATCH_NOTES_PARSER_VERSION,
    truncated
  }
}
