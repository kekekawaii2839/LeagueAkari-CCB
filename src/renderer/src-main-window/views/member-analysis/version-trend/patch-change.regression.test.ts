import { expect, test } from 'vitest'

import { patchChange } from './patch-change'

test.each([
  ['AR', '+4/Level', '+5/Level', 'Base Stats', 'buff'],
  ['AS', '3%/Level', '2%/Level', 'Base Stats', 'nerf'],
  ['First Stack Damage Against Minions', '50% Less', '40% Less', 'Passive - Synthetic', 'buff'],
  ['Slow Amount', '30%', '20 / 30 / 40%', 'E - Synthetic', 'adjusted'],
  ['Explosion Damage', '10 (+30% AP)', '20 (+20% AP)', 'W - Synthetic', 'adjusted'],
  ['Total Magic Damage', '10 (+20% AP) over 5s', '20 (+20% AP) over 5s', 'E - Synthetic', 'buff'],
  [
    'Total Magic Damage',
    '10 (+20% AP) over 5s',
    '20 (+20% AP) over 3s',
    'E - Synthetic',
    'unknown'
  ],
  ['AR', '10', '20', 'Q - Synthetic', 'unknown']
])('reviewed metric normalization: %s %s -> %s', (label, before, after, ability, expected) => {
  expect(patchChange({ text: '', label, before, after, ability }, 'champion')).toBe(expected)
})

test.each([
  ['Mana', '60 / 65 / 70 / 75 / 80', '50 / 55 / 60 / 65 / 70', 'E - Nevermove', 'buff'],
  ['Mana', '30 / 35 / 40 / 45 / 50', '15 / 20 / 25 / 30 / 35', 'Q - Rapid Fire', 'buff'],
  ['Mana', '65 / 70 / 75 / 80 / 85', '75 / 80 / 85 / 90 / 95', 'W - Soul Furnace', 'nerf'],
  ['Mana', '300', '350', 'Base Stats', 'buff'],
  ['Damage', '100 (+ 60% AP)', '100 (+ 70% AP)', 'Q - Synthetic', 'buff'],
  ['Cooldown', '9', '8 seconds', 'Q - Synthetic', 'buff'],
  ['Cooldown', '120 / 100 / 80', '130 / 115 / 100 seconds', 'R - Synthetic', 'nerf'],
  ['Mana Cost', '45 / 50 / 55 / 60 / 65', '50', 'Q - Synthetic', 'adjusted'],
  ['Damage', '10 (+20% AP)', '12 (+10% AP)', 'Q - Synthetic', 'adjusted'],
  ['Duration', '2.5s', '2.5 / 2.75 / 3s', 'Self Stun', 'unknown'],
  [
    'Slow Stacking',
    'Stacks with other slows',
    'No longer stacks with other slows',
    'W - Arc of Judgement',
    'nerf'
  ],
  [
    'Slow Stacking',
    'No longer stacks with other slows',
    'Stacks with other slows',
    'W - Arc of Judgement',
    'buff'
  ],
  [
    'Slow Stacking',
    'Stacks with other slows',
    'Removed under some conditions',
    'W - Arc of Judgement',
    'unknown'
  ],
  ['Passive On Hit Damage', '5 / 10 (+20% AP)', '3 / 8 (+25% AP)', 'Q - Synthetic', 'adjusted'],
  [
    'Ranged Mod',
    '70% of Value (35% Attack Speed, 14% Move Speed)',
    '50% of Value (25% Attack Speed, 20% Move Speed)',
    null,
    'adjusted'
  ]
])('%s: %s -> %s (%s) is %s', (label, before, after, ability, expected) => {
  const entry = { text: '', label, before, after, ability }
  expect(patchChange(entry, 'champion')).toBe(expected)
})

test('bare Mana needs skill context; item Mana remains a resource', () => {
  const entry = { text: '', label: 'Mana', before: '100', after: '80', ability: null }
  expect(patchChange(entry, 'item')).toBe('nerf')
  expect(patchChange({ ...entry, ability: 'W - Soul Furnace' }, 'champion')).toBe('buff')
})

test.each([
  ['100', '100 (+0% AP)'],
  ['100', '100 (+-20% AP)'],
  ['100 (+20% AP)', '100 (+30% AP - 40% AD)'],
  ['100', '100 (+20% AP / 40 AD)'],
  ['100 (+20% AP)', '100 (+20% AD)'],
  ['100', '100 against monsters'],
  ['100 (+20% AP)', '100 (+20% AP) (+0% AD)']
])('rejects unsupported/zero added terms %s -> %s', (before, after) => {
  expect(patchChange({ text: '', label: 'Damage', ability: null, before, after }, 'champion')).toBe(
    'unknown'
  )
})

test.each([
  ['100 (+20% AP / 2)', '100 (+20% AP / 3)'],
  ['100 (+20% AP) / 2', '100 (+20% AP) / 3']
])('changed divisors are not rank outputs: %s -> %s', (before, after) => {
  expect(patchChange({ text: '', label: 'Damage', ability: null, before, after }, 'champion')).toBe(
    'unknown'
  )
})

test('self damage is a cost, unlike self healing', () => {
  const entry = { text: '', before: '10', after: '20', ability: null, label: 'Self Damage' }
  expect(patchChange(entry, 'champion')).toBe('nerf')
  expect(patchChange({ ...entry, label: 'Self Heal' }, 'champion')).toBe('buff')
})

test('a changed level horizon is not a beneficial output coefficient', () => {
  expect(
    patchChange(
      {
        text: '',
        label: 'Damage',
        ability: null,
        before: '10 - 100 (Level 1 - 10)',
        after: '10 - 100 (Level 1 - 18)'
      },
      'champion'
    )
  ).toBe('unknown')
})

test('removing an already full minion multiplier does not add power', () => {
  expect(
    patchChange(
      {
        text: '',
        label: 'Minion Damage Modifier',
        ability: null,
        before: '100%',
        after: 'Removed'
      },
      'champion'
    )
  ).toBe('unchanged')
})

test('bugfix display policy precedes numeric comparison and reviewed directional mechanics', () => {
  const entry = {
    text: 'Bugfix: Damage: 10 ⇒ 20',
    label: 'Damage',
    before: '10',
    after: '20',
    ability: null
  }
  expect(patchChange(entry, 'champion')).toBe('adjusted')
  expect(
    patchChange({ ...entry, text: 'Damage: 10 ⇒ 20' }, 'system', 'Bugfixes & QoL Changes')
  ).toBe('adjusted')
  expect(patchChange({ ...entry, text: 'Damage: 10 ⇒ 20', label: 'Bugfix' }, 'champion')).toBe(
    'adjusted'
  )
  expect(patchChange({ ...entry, text: 'Damage: 10 ⇒ 20' }, 'champion', 'Champions')).toBe('buff')
})
