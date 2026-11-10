import { expect, test } from 'vitest'

import { parseOfficialPatchNotes } from '../../../../../main/shards/member-analysis/patch-notes-parser'
import { patchChange, sectionChange } from './patch-change'
import corpus from './patch-change.reviewed-fixtures.json'
import inventory from './patch-notes.source-inventory.json'

// Ten independently reviewed patches. Fixtures retain actual Riot SSR heading /
// list markup, not HTML reconstructed from the parser's own output. Source URL
// is stored per patch. Public patch text only; no accounts or player data.
for (const fixture of corpus) {
  test(`${fixture.patch}: independent original-article inventory has no omitted or invented rows`, () => {
    const source = inventory.patches.find((p) => p.patch === fixture.patch)!
    const actual = parseOfficialPatchNotes(fixture.html)!.sections.flatMap((s) =>
      s.entries.map((e) => `${s.section}\n${e.text}`)
    )
    expect(actual.sort()).toEqual(source.rows.map((r) => `${r.sourceHeading}\n${r.text}`).sort())
  })
  test(`${fixture.patch}: source markup -> fields -> every reviewed direction`, () => {
    const sections = parseOfficialPatchNotes(fixture.html)!.sections
    expect(
      sections.map((s) => ({
        title: s.title,
        category: s.category,
        hotfix: s.hotfix,
        entries: s.entries.map((e) => ({
          text: e.text,
          ability: e.ability,
          label: e.label,
          before: e.before,
          after: e.after
        }))
      }))
    ).toEqual(
      fixture.sections.map((s) => ({
        title: s.title,
        category: s.category,
        hotfix: s.hotfix,
        entries: s.entries.map(({ expected, ...e }) => e)
      }))
    )
    sections.forEach((section, i) => {
      expect(
        section.entries.map((e) => patchChange(e, section.category, section.section)),
        section.title
      ).toEqual(fixture.sections[i].entries.map((e) => e.expected))
      const expected =
        ['buff', 'nerf', 'adjusted', 'introduced', 'unknown']
          .filter((d) => fixture.sections[i].entries.some((e) => e.expected === d))
          .join('-') ||
        (fixture.sections[i].entries.some((e) => e.expected === 'unchanged')
          ? 'unchanged'
          : 'adjusted')
      expect(sectionChange(section), section.title).toBe(expected)
    })
  })
}

test('26.21 Varus hotfix retains the falloff fix alongside both compensation buffs', () => {
  const fixture = corpus.find((f) => f.patch === '16.21')!
  const section = parseOfficialPatchNotes(fixture.html)!.sections.find(
    (s) => s.title === 'Varus' && s.hotfix
  )!
  expect(section.entries).toHaveLength(3)
  expect(section.entries[0].text).toContain('no longer deal reduced damage to subsequent targets')
  expect(section.entries.map((e) => patchChange(e, section.category, section.section))).toEqual([
    'adjusted',
    'buff',
    'buff'
  ])
  expect(sectionChange(section)).toBe('buff-adjusted')
})

test('26.13 keeps the final non-Ranked last-hit policy, not a Spotlight navigation entry', () => {
  const fixture = corpus.find((f) => f.patch === '16.13')!
  const sections = parseOfficialPatchNotes(fixture.html)!.sections
  const indicators = sections.find((s) => s.title === 'Last Hit Indicators')!
  expect(indicators.entries[0].text).toContain('non-Ranked SR queues only')
  expect(indicators.entries[0].text).toContain('off by default')
  const introduction = sections.find((s) => s.title === 'Locke')!
  expect(introduction.category).toBe('champion')
  expect(introduction.entries).toHaveLength(5)
  expect(introduction.entries.every((e) => e.before === null && e.after === null)).toBe(true)
  expect(sectionChange(introduction)).toBe('introduced')
  expect(sections.flatMap((s) => s.entries).some((e) => /Champion Spotlight/.test(e.text))).toBe(
    false
  )
})

test('26.19 system role-quest teleports are buffs; unchanged comparison does not pollute summary', () => {
  const fixture = corpus.find((f) => f.patch === '16.19')!
  const section = parseOfficialPatchNotes(fixture.html)!.sections.find(
    (s) => s.title === 'Systems'
  )!
  expect(section.entries.map((e) => patchChange(e, section.category, section.section))).toEqual([
    'buff',
    'buff',
    'unchanged'
  ])
  expect(sectionChange(section)).toBe('buff')
})

test('26.18 Viego passive is a reviewed buff without fabricating the omitted old formula', () => {
  const fixture = corpus.find((f) => f.patch === '16.18')!
  const section = parseOfficialPatchNotes(fixture.html)!.sections.find((s) => s.title === 'Viego')!
  const passive = section.entries.find((e) => e.ability === "Passive - Sovereign's Domination")!
  expect(passive.before).toBe('2% (+…. )')
  expect(patchChange(passive, section.category)).toBe('buff')
  expect(sectionChange(section)).toBe('buff')
})

test('user-selected neutral policy resolves all four previously unverified entries without inventing values', () => {
  const cases = [
    ['16.16', 'Locke (R) execution'],
    ['16.18', 'Critical Strike: 150% (+15% IE)'],
    ['16.19', "Taliyah's W terrain"],
    ['16.20', "Orianna's (R) VFX"]
  ]
  for (const [patch, text] of cases) {
    const notes = parseOfficialPatchNotes(corpus.find((p) => p.patch === patch)!.html)!
    const section = notes.sections.find((s) => s.entries.some((e) => e.text.includes(text)))!
    const entry = section.entries.find((e) => e.text.includes(text))!
    expect(patchChange(entry, section.category, section.section), text).toBe('adjusted')
    expect(entry.before).toBeNull()
    expect(entry.after).toBeNull()
  }
  for (const fixture of corpus) {
    for (const section of parseOfficialPatchNotes(fixture.html)!.sections) {
      if (!/bugfix/i.test(section.section)) continue
      expect(
        section.entries.every(
          (e) => patchChange(e, section.category, section.section) === 'adjusted'
        )
      ).toBe(true)
      expect(sectionChange(section)).toBe('adjusted')
    }
  }
})
