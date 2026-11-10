import { PatchNoteImageSchema } from '@shared/shards/member-analysis/patch-notes'
import { describe, expect, test } from 'vitest'

import { officialPatchMetadata, parseOfficialPatchNotes } from './patch-notes-parser'

// Synthetic content in the observed Riot SSR structure. No real article copy.
const page = `<html><head><title>Patch 26.1 Notes</title><script type="application/ld+json">{"@graph":[{"@type":"TechArticle","headline":"Patch 26.1 Notes","datePublished":"2026-01-07T19:00:00.000Z"}]}</script></head><body><div data-testid="title">Patch 26.1 Notes</div><div id="patch-notes-container">
<h2 id="patch-large-changes">Mid-Patch Updates</h2><h3><img src="https://ddragon.leagueoflegends.com/cdn/16.1.1/img/champion/SyntheticHero.png">Synthetic Hero</h3><h4>Q - Synthetic Skill</h4><ul><li><strong>Damage</strong>: 10 / 20 ⇒ <strong>12 / 24</strong></li></ul>
<h2 id="patch-new-items">New Items</h2><h4><img src="https://cmsassets.rgpub.io/synthetic.png">Synthetic Item</h4><li>Build Path: Component A + Component B</li><li>Health: 200 ⇒ 250</li>
<h2 id="patch-minions">Minions</h2><h4>Spawn timing</h4><li>Delay: 30 seconds &rArr; 25 seconds</li>
<h2 id="patch-aram">ARAM</h2><h3>Excluded Hero</h3><li>Damage: 100 ⇒ 95</li>
</div><script id="__NEXT_DATA__" type="application/json">{"unrelated":"<h2>Fake</h2><li>Not a change</li>"}</script></body></html>`

describe('observed Riot SSR patch structure', () => {
  test('reads current linked portraits before h3 and unwraps only Riot CDN skill images', () => {
    const html = `<title>Patch 26.21 Notes</title><h2>Champions</h2>
      <div><p><a class="reference-link"><img src="https://am-a.akamaihd.net/image?f=https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/SyntheticHero.png"></a></p><h3>Synthetic Hero</h3>
      <h4><img src="https://am-a.akamaihd.net/image?f=https://ddragon.leagueoflegends.com/cdn/16.18.1/img/spell/SyntheticQ.png">Q - Synthetic</h4><li>Damage: 10 ⇒ 12</li></div>
      <h3>No Portrait</h3><li>Health: 100 ⇒ 120</li>
      <h2>Items</h2><p><a><img src="https://cmsassets.rgpub.io/synthetic.png"></a></p><h3>Synthetic Item</h3><li>Cost: 100 ⇒ 90</li>`
    const sections = parseOfficialPatchNotes(html)!.sections
    expect(sections[0]).toMatchObject({
      entityKey: 'SyntheticHero',
      imageUrl: 'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/champion/SyntheticHero.png'
    })
    expect(sections[0].entries[0].abilityImageUrl).toBe(
      'https://ddragon.leagueoflegends.com/cdn/16.18.1/img/spell/SyntheticQ.png'
    )
    expect(sections[1].imageUrl).toBeNull()
    expect(sections[1].entries[0].abilityImageUrl).toBeUndefined()
    expect(sections[2].imageUrl).toBe('https://cmsassets.rgpub.io/synthetic.png')
    const unsafe = parseOfficialPatchNotes(
      html.replaceAll('https://ddragon.leagueoflegends.com', 'https://untrusted.invalid')
    )!.sections[0]
    expect(unsafe.imageUrl).toBeNull()
    expect(unsafe.entries[0].abilityImageUrl).toBeUndefined()
  })
  test.each([
    'javascript:alert(1)',
    'file:///synthetic.png',
    'https://ddragon.leagueoflegends.com.evil.invalid/icon.png',
    'https://user@ddragon.leagueoflegends.com/icon.png',
    'https://cmsassets.rgpub.io/icon.svg',
    'https://cmsassets.rgpub.io/icon.png?target=other'
  ])('rejects unsafe image source %s', (url) => {
    expect(PatchNoteImageSchema.safeParse(url).success).toBe(false)
  })
  test('keeps allowlisted entity and ability images, rejecting external or executable sources', () => {
    const html = page.replace(
      '<h4>Q - Synthetic Skill</h4>',
      '<h4><img src="https://ddragon.leagueoflegends.com/cdn/16.1.1/img/spell/SyntheticQ.png">Q - Synthetic Skill</h4>'
    )
    const sections = parseOfficialPatchNotes(html)!.sections
    expect(sections[0].imageUrl).toContain('/champion/SyntheticHero.png')
    expect(sections[0].entries[0].abilityImageUrl).toContain('/spell/SyntheticQ.png')
    expect(sections[1].imageUrl).toBe('https://cmsassets.rgpub.io/synthetic.png')
    const bad = parseOfficialPatchNotes(
      html.replaceAll('https://ddragon.leagueoflegends.com', 'https://untrusted.invalid')
    )!.sections[0]
    expect(bad.imageUrl).toBeNull()
    expect(bad.entries[0].abilityImageUrl).toBeUndefined()
  })
  test('reads metadata without requiring an h1 and does not execute embedded JSON or script', () => {
    expect(officialPatchMetadata(page)).toEqual({
      title: 'Patch 26.1 Notes',
      publishedAt: '2026-01-07T19:00:00.000Z'
    })
    const result = parseOfficialPatchNotes(page)!
    expect(result.parserVersion).toBe(6)
    expect(result.truncated).toBe(false)
    expect(result.sections.map((section) => section.category)).toEqual([
      'champion',
      'item',
      'system'
    ])
    expect(result.sections[0]).toMatchObject({
      title: 'Synthetic Hero',
      entityKey: 'SyntheticHero',
      hotfix: true
    })
    expect(result.sections[0].entries).toEqual([
      {
        text: 'Damage: 10 / 20 ⇒ 12 / 24',
        label: 'Damage',
        before: '10 / 20',
        after: '12 / 24',
        ability: 'Q - Synthetic Skill'
      }
    ])
    expect(result.sections[1]).toMatchObject({ title: 'Synthetic Item', hotfix: false })
    expect(result.sections[1].entries[0]).toMatchObject({
      text: 'Build Path: Component A + Component B',
      before: null,
      after: null
    })
    expect(result.sections[2].entries[0]).toMatchObject({
      label: 'Delay',
      before: '30 seconds',
      after: '25 seconds',
      ability: 'Spawn timing'
    })
    expect(JSON.stringify(result)).not.toContain('Excluded Hero')
    expect(JSON.stringify(result)).not.toContain('Not a change')
  })

  test('missing metadata or unknown structure remains unavailable, not an empty official change list', () => {
    expect(parseOfficialPatchNotes('<title>Not found</title>')).toBeNull()
    expect(
      parseOfficialPatchNotes('<title>Patch 26.1 Notes</title><p>Temporarily unavailable</p>')
    ).toBeNull()
  })
})

test('ability named Stone Skin is not confused with the skins section', () => {
  const sections = parseOfficialPatchNotes(
    `<title>Patch Notes</title><h2>Champions</h2><h3>Synthetic Hero</h3><h4>Passive - Stone Skin</h4><li>Armor: 10 ⇒ 9</li><h2>Skins</h2><h3>Not a gameplay change</h3><li>Skin: 1 ⇒ 2</li>`
  )!.sections
  expect(sections).toHaveLength(1)
  expect(sections[0].entries[0]).toMatchObject({ ability: 'Passive - Stone Skin', label: 'Armor' })
})

test('item system cleanup does not pollute the preceding balance object', () => {
  const sections = parseOfficialPatchNotes(
    `<title>Patch Notes</title><h2>Items</h2><h3>Runaan's Hurricane</h3><li>Attack Damage per Bolt: 65% ⇒ 60%</li><h4>Scoreboard Cleanup</h4><li>Synthetic Item</li><h2>Classic</h2><h4>Champions</h4><li>Damage: 10 ⇒ 20</li>`
  )!.sections
  expect(sections.map((s) => [s.title, s.category, s.entries.length])).toEqual([
    ["Runaan's Hurricane", 'item', 1],
    ['Scoreboard Cleanup', 'system', 1]
  ])
})

test('nested h2 Champions/Items cannot escape an excluded Riot primary mode scope', () => {
  const html = `<title>Patch Notes</title><header class="header-primary"><h2>Champions</h2></header><h3>SR Hero</h3><li>Damage: 10 ⇒ 12</li><header class="header-primary"><h2>ARAM Balance Changes</h2></header><h2>Champions</h2><h3>ARAM Hero</h3><li>Damage: 10 ⇒ 12</li><h2>Items</h2><li>Cost: 10 ⇒ 12</li><header class="header-primary"><h2>Items</h2></header><h4>Combined Starter Items</h4><li>Health: 10 ⇒ 12</li><header class="header-primary"><h2>Hall of Legends</h2></header><li>Skin Bundle</li><h2>Related Articles</h2><li>Not patch content</li>`
  const sections = parseOfficialPatchNotes(html)!.sections
  expect(sections.map((s) => [s.title, s.category, s.entries.length])).toEqual([
    ['SR Hero', 'champion', 1],
    ['Combined Starter Items', 'item', 1]
  ])
  expect(sections[1].entries[0].ability).toBeNull()
})

test('a generic Champions title with a mode id still belongs to that mode', () => {
  const sections = parseOfficialPatchNotes(
    `<title>Patch Notes</title><header class="header-primary"><h2 id="patch-champions">Champions</h2></header><h3>SR Hero</h3><li>Health: 10 ⇒ 12</li><header class="header-primary"><h2 id="patch-swiftplay">Champions</h2></header><h3>Excluded Hero</h3><li>Health: 10 ⇒ 12</li>`
  )!.sections
  expect(sections.map((s) => s.title)).toEqual(['SR Hero'])
})

test('keeps standalone fixes and system paragraphs without ingesting design prose or mode-only fixes', () => {
  const result = parseOfficialPatchNotes(`<title>Patch Notes</title>
    <h2>Champions</h2><h3>Synthetic Hero</h3><p>We want this hero to feel stronger.</p>
    <h4>Q - Synthetic</h4><li>Damage: 10 ⇒ 12</li>
    <h2>Last Hit Indicators</h2><p>Enabled only outside Ranked, off by default.</p>
    <h2>Bugfixes &amp; QoL Changes</h2>
    <li>Fixed a bug where Synthetic Hero's shield did not block spells.</li>
    <li>Fixed an Arena-only effect.</li><li>Fixed a Classic item.</li>
    <h2>Upcoming Skins</h2><p>Marketing announcement.</p><li>Not a gameplay change.</li>`)
  expect(result!.sections.map((s) => [s.title, s.entries.map((e) => e.text)])).toEqual([
    ['Synthetic Hero', ['Damage: 10 ⇒ 12']],
    ['Last Hit Indicators', ['Enabled only outside Ranked, off by default.']],
    ['Bugfixes & QoL Changes', ["Fixed a bug where Synthetic Hero's shield did not block spells."]]
  ])
})

test('cross-mode client fixes are not discarded merely for mentioning Classic', () => {
  const parsed =
    parseOfficialPatchNotes(`<title>Patch Notes</title><h2>Bugfixes &amp; QoL Changes</h2>
    <li>Fixed Classic-only item icons.</li>
    <li>Fixed Classic assets appearing on a non-Classic tab.</li>`)
  expect(parsed!.sections[0].entries.map((e) => e.text)).toEqual([
    'Fixed Classic assets appearing on a non-Classic tab.'
  ])
})

test('new champion introduction does not leak backward into a legacy standalone system heading', () => {
  const parsed = parseOfficialPatchNotes(`<title>Patch Notes</title>
    <h2>Last Hit Indicators</h2><p>Enabled outside ranked.</p>
    <h2>New Hero</h2><h4>Passive - Synthetic</h4><li>A new ability.</li>
    <li>New Hero Champion Spotlight here!</li>`)
  expect(parsed!.sections.map((s) => [s.title, s.category])).toEqual([
    ['Last Hit Indicators', 'system'],
    ['New Hero', 'champion']
  ])
})
