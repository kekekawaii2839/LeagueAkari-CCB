import { expect, test } from 'vitest'

import { patchChange } from './patch-change'

test.each([
  ['+0 - 200%', 'buff'],
  ['+0 - 90%', 'nerf'],
  ['+0 - 150%', 'adjusted'],
  ['+0 - 200', 'unknown'],
  ['+0 - 200% Base Damage', 'unknown'],
  ['+200 - 0%', 'unknown'],
  ['+0 - 200% after 4s', 'unknown'],
  ['+0 - 200% Base Damage, 0 - 90% Ratio Damage', 'adjusted'],
  ['+0 - 166.67% Base Damage, 0 - 100% Ratio Damage', 'unchanged']
])('Sion channel amplification preserves both components: %s is %s', (after, expected) => {
  const entry = {
    text: '',
    ability: 'R - Unstoppable Onslaught',
    label: 'Damage Increase over the First 3s of Channeling',
    before: '+0 - 166.67% Base Damage, 0 - 100% Ratio Damage',
    after
  }
  expect(patchChange(entry, 'champion')).toBe(expected)
})

test.each([
  ['40 Melee + 1.5/Lethality / 20 Ranged + 0.75/Lethality', 'nerf'],
  ['60 Melee + 1.5/Lethality / 30 Ranged + 0.75/Lethality', 'buff'],
  ['40 Melee + 2/Lethality / 20 Ranged + 0.75/Lethality', 'adjusted'],
  ['40 Melee + 1.5/Lethality / 30 Ranged + 0.75/Lethality', 'adjusted'],
  ['40 Melee + 1.5/Armor / 20 Ranged + 0.75/Armor', 'unknown'],
  ['40 Ranged + 1.5/Lethality / 20 Melee + 0.75/Lethality', 'unknown'],
  ['50 Melee + 1.5/Lethality / 25 Ranged + 0.75/Lethality', 'unchanged']
])('shaped charge curves: %s is %s', (after, expected) => {
  expect(
    patchChange(
      {
        text: '',
        ability: null,
        label: 'Shaped Charge Damage',
        before: '50 Melee + 1.5/Lethality / 25 Ranged + 0.75/Lethality',
        after
      },
      'item'
    )
  ).toBe(expected)
})

test.each([
  ['Damage', '10 / 20', '12 / 24', 'buff'],
  ['Damage', '10 / 20', '12 / 18', 'adjusted'],
  ['Cooldown', '10', '8', 'buff'],
  ['Cooldown', '9 / 8 / 7 / 6 / 5s', '9 / 8.7 / 7.6 / 6 / 5s', 'nerf'],
  ['Mana Growth', '40/Level', '50/Level', 'buff'],
  ['Lethality', '22', '18', 'nerf'],
  ['Cooldown (seconds)', '10', '8', 'buff'],
  ['Total cost (gold)', '3000', '2800', 'buff'],
  ['Mana Cost', '40', '50', 'nerf'],
  ['Armor', '30', '28', 'nerf'],
  ['Health', '0', '0', 'unchanged'],
  ['Damage', '10%', '12', 'unknown'],
  ['Damage', '10 (+20% AP)', '12 (+10% AP)', 'adjusted'],
  ['Enemy damage reduction', '10', '20', 'unknown'],
  ['Damage', '10', '12 / 24', 'unknown']
])('%s: %s → %s is %s', (label, before, after, expected) => {
  const entry = { text: '', ability: null, label, before, after }
  expect(patchChange(entry, 'champion')).toBe(expected)
})
