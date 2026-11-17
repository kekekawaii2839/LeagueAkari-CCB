import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { parseOfficialPatchNotes } from '../../../../../main/shards/member-analysis/patch-notes-parser'
import { patchChange, sectionChange } from './patch-change'

// Original public Riot article container, retrieved 2026-11-12:
// https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-22-notes/
// Independent ordered review, including paragraph rows and the split Zaahen row.
const reviewed = [
  ['Aurelion Sol', ['buff']],
  ['Corki', ['buff', 'buff']],
  ['Kayle', ['buff', 'buff']],
  ['Locke', ['nerf', 'nerf', 'nerf']],
  ['Maokai', ['buff']],
  [
    'Mel',
    [
      'adjusted',
      'adjusted',
      'buff',
      'nerf',
      'buff',
      'nerf',
      'buff',
      'nerf',
      'buff',
      'adjusted',
      'buff',
      'buff',
      'nerf',
      'adjusted',
      'adjusted',
      'adjusted',
      'adjusted',
      'adjusted',
      'adjusted',
      'adjusted',
      'adjusted',
      'buff',
      'buff'
    ]
  ],
  ['Naafiri', ['buff', 'buff']],
  ['Rumble', ['buff', 'buff']],
  ['Shen', ['buff']],
  ['Smolder', ['buff']],
  ['Thresh', ['nerf', 'nerf']],
  ['Viktor', ['buff', 'buff']],
  ['Yasuo', ['nerf']],
  ['Zaahen', ['buff']],
  ["Doran's Bow", ['nerf']],
  ["Overlord's Bloodmail", ['buff', 'nerf']],
  ['Bugfixes & QoL Changes', Array(7).fill('adjusted')]
] as const
const notes = parseOfficialPatchNotes(
  readFileSync(new URL('./patch-change.26-22.html', import.meta.url), 'utf8')
)!

test('26.22 retains every SR object and reviewed row, excludes alternate modes', () => {
  expect(notes.sections.map((s) => [s.title, s.entries.length])).toEqual(
    reviewed.map(([title, changes]) => [title, changes.length])
  )
  expect(notes.truncated).toBe(false)
  const zaahen = notes.sections.find((s) => s.title === 'Zaahen')!.entries[0]
  expect(zaahen).toMatchObject({
    label: 'Cooldown',
    before: '10 / 9 / 8 / 7 / 6s',
    after: '8 / 7.5 / 7 / 6.5 / 6s'
  })
})

test.each(reviewed)(
  '26.22 %s: every change has its individually reviewed direction',
  (title, expected) => {
    const section = notes.sections.find((s) => s.title === title)!
    expect(section.entries.map((e) => patchChange(e, section.category, section.section))).toEqual(
      expected
    )
  }
)

test('mixed changes are retained, not flattened to official overall intent', () => {
  expect(sectionChange(notes.sections.find((s) => s.title === 'Mel')!)).toBe('buff-nerf-adjusted')
  expect(sectionChange(notes.sections.find((s) => s.title === "Overlord's Bloodmail")!)).toBe(
    'buff-nerf'
  )
  const rumble = notes.sections.find((s) => s.title === 'Rumble')!.entries[0]
  expect(rumble.after).toBe('(+40% AP)') // Never fabricate the omitted base value.
  const rework = notes.sections
    .find((s) => s.title === 'Mel')!
    .entries.filter((e) => e.ability === 'W - Rebuttal - Reworked')
  expect(rework.every((e) => e.before === null && e.after === null)).toBe(true)
  expect(
    patchChange(
      { ...rumble, text: 'Different unsupported formula', after: '(+40% AD)' },
      'champion'
    )
  ).toBe('unknown')
})
