import { expect, test } from 'vitest'

import { parseOfficialPatchNotes } from '../../../../../main/shards/member-analysis/patch-notes-parser'
import { type PatchChange, type PatchSummary, patchChange, sectionChange } from './patch-change'
import fixtures from './patch-change.official-fixtures.json'

// Public Riot excerpts manually reviewed against 26.20/26.21, not player data.
// Exercise text -> HTML adapter -> structured fields -> directional classification.
const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
for (const fixture of fixtures) {
  test(`${fixture.patch}: ${fixture.title} official excerpts retain semantics`, () => {
    const html =
      `<title>Patch Notes</title><h2>${fixture.category === 'item' ? 'Items' : 'Champions'}</h2><h3>${escape(fixture.title)}</h3>` +
      fixture.entries
        .map(
          (entry) =>
            `${entry.ability ? `<h4>${escape(entry.ability)}</h4>` : ''}<ul><li>${escape(entry.text)}</li></ul>`
        )
        .join('')
    const section = parseOfficialPatchNotes(html)!.sections[0]
    expect(section.entries.map((entry) => entry.text)).toEqual(
      fixture.entries.map((entry) => entry.text)
    )
    expect(section.entries.map((entry) => entry.ability)).toEqual(
      fixture.entries.map((entry) => entry.ability)
    )
    expect(
      section.entries.map((entry) => patchChange(entry, section.category, section.section))
    ).toEqual(fixture.entries.map((entry) => entry.expected))
    const expected = ['buff', 'nerf', 'adjusted']
      .filter((direction) => fixture.entries.some((entry) => entry.expected === direction))
      .join('-')
    expect(sectionChange(section)).toBe(expected)
  })
}

test.each([
  ['Damage', '100 (+60% AP)', '90 (+70% AP)', 'adjusted'],
  ['Damage', '100 (+60% AP)', '110 (+60% AD)', 'unknown'],
  ['Damage', '10% AD per 1% Bonus Crit Damage', '10% AD per 2% Bonus Crit Damage', 'unknown'],
  ['Damage', '100 - 20% AP', '100 - 30% AP', 'unknown'],
  ['Damage', '100 against monsters', '120 against monsters', 'unknown'],
  ['Damage', '-10', '-5', 'unknown'],
  ['Total Cost', '1000g', '1100', 'unknown'],
  ['Damage', '10 (+20% AP)', '10 (+20% AP)', 'unchanged'],
  ['Health', '600 + 100/Level', '620 + 90/Level', 'adjusted']
])('%s: %s -> %s distinguishes mixed, unknown and unchanged', (label, before, after, expected) => {
  expect(patchChange({ text: '', ability: null, label, before, after }, 'champion')).toBe(expected)
})

test.each<[PatchChange[], PatchSummary]>([
  [[], 'adjusted'],
  [['buff'], 'buff'],
  [['nerf', 'nerf'], 'nerf'],
  [['buff', 'buff'], 'buff'],
  [['buff', 'nerf'], 'buff-nerf'],
  [['nerf', 'buff'], 'buff-nerf'],
  [['buff', 'adjusted'], 'buff-adjusted'],
  [['nerf', 'adjusted'], 'nerf-adjusted'],
  [['nerf', 'buff', 'adjusted', 'buff'], 'buff-nerf-adjusted'],
  [['adjusted'], 'adjusted'],
  [['buff', 'unchanged'], 'buff'],
  [['unchanged'], 'unchanged'],
  [['buff', 'unknown'], 'buff-unknown']
])('object summary %j is %s', (directions, expected) => {
  const section = {
    category: 'champion' as const,
    title: '',
    section: '',
    hotfix: false,
    entityKey: null,
    changes: [],
    entries: directions.map((direction) => ({
      text: '',
      ability: null,
      label: 'Damage',
      before: '10 (+10% AP)',
      after:
        direction === 'buff'
          ? '12 (+10% AP)'
          : direction === 'nerf'
            ? '8 (+10% AP)'
            : direction === 'adjusted'
              ? '12 (+5% AP)'
              : direction === 'unchanged'
                ? '10 (+10% AP)'
                : null
    }))
  }
  expect(sectionChange(section)).toBe(expected)
})

test('dated hotfix h4 champions are not system entries or ability names', () => {
  const html = `<title>Patch 26.21 Notes</title><h2>Mid-Patch Updates</h2><h3>October 22, 2026 Updates</h3><h4>Varus</h4><ul><li>Passive Bonus AD and AP on Kill/Takedown: (1.1 per 10% AS) as bonus AD and AP ⇒ 1.4 per 10% AS</li><li>Q Minimum Damage: 50 - 230 ⇒ 50 - 250</li></ul><h4>Synthetic Second Hero</h4><li>Damage: 10 ⇒ 12</li><h2>Champions</h2><h3>Synthetic Hero</h3><h4>Q - Skill</h4><li>Damage: 10 ⇒ 12</li>`
  const sections = parseOfficialPatchNotes(html)!.sections
  expect(sections.map((s) => [s.title, s.category, s.hotfix])).toEqual([
    ['Varus', 'champion', true],
    ['Synthetic Second Hero', 'champion', true],
    ['Synthetic Hero', 'champion', false]
  ])
  expect(sections[0].entries.map((entry) => entry.ability)).toEqual([null, null])
  expect(sections[0].entries.map((entry) => patchChange(entry, 'champion'))).toEqual([
    'buff',
    'buff'
  ])
  expect(sectionChange(sections[0])).toBe('buff')
  expect(sections[2].entries[0].ability).toBe('Q - Skill')
})

test.each([
  [
    'Attack Speed Scaling',
    '1% per 5% bonus Attack Speed from permanent sources',
    '1% per 4% bonus Attack Speed from permanent sources',
    'buff'
  ],
  [
    'Attack Speed Scaling',
    '1% per 4% bonus Attack Speed from permanent sources',
    '1% per 5% bonus Attack Speed from permanent sources',
    'nerf'
  ],
  [
    'Attack Speed Scaling',
    '1% per 4% bonus Attack Speed from permanent sources',
    '2% per 8% bonus Attack Speed from permanent sources',
    'unchanged'
  ],
  [
    'Attack Speed Scaling',
    '1% per 4% bonus Attack Speed from permanent sources',
    '2% per 0% bonus Attack Speed from permanent sources',
    'unknown'
  ],
  [
    'Passive Bonus AD and AP on Kill/Takedown',
    '(1.1 per 10% AS) as bonus AD and AP',
    '1.4 per 10% AS',
    'buff'
  ],
  ['Shield', '40 - 140 (based on level) (+25% AP)', '30 - 130 (+20% AP)', 'nerf'],
  ['Shield', '40 - 140 (based on missing health) (+25% AP)', '30 - 130 (+20% AP)', 'unknown'],
  ['Bugfix', '10', '20', 'adjusted']
])('ratio/annotation %s: %s -> %s is %s', (label, before, after, expected) => {
  expect(patchChange({ text: '', label, before, after, ability: null }, 'champion')).toBe(expected)
})

test.each([
  'Grey Health Store Based on Current Health',
  'Gray Health Store Based on Current Health'
])('gray-health early reduction is a nerf: %s', (label) => {
  expect(
    patchChange(
      { text: '', label, before: '40 - 200 (both level based)', after: '20 - 200', ability: 'W' },
      'champion'
    )
  ).toBe('nerf')
})

test.each([
  ['Up to 50%', 'Up to 70%', 'buff'],
  ['Up to 70%', 'Up to 50%', 'nerf'],
  ['Up to 50%', 'Up to 50%', 'unchanged'],
  ['Up to 50%', 'Up to 70', 'unknown']
])('channel damage increase %s -> %s is %s', (before, after, expected) => {
  expect(
    patchChange(
      { text: '', label: 'Damage Increase over Channel Time', before, after, ability: 'Q' },
      'champion'
    )
  ).toBe(expected)
})
