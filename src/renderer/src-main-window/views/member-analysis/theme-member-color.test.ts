import { expect, test } from 'vitest'

import { scatterMemberStyle } from './scatter-member-style'
import { themeMemberColor, themeMemberNeutral } from './theme-member-color'

test('SVG local-variable use preserves the user-approved scatter color expression', () => {
  for (let slot = 0; slot < 21; slot++) {
    const identity = scatterMemberStyle(slot).color
    expect(themeMemberColor(identity, 'var(--scatter-match-neutral)')).toBe(
      `color-mix(in srgb, ${identity} 60%, var(--scatter-match-neutral))`
    )
  }
})

test('default DOM-resolution expression uses the same theme neutral and keeps identity slots distinct', () => {
  expect(themeMemberNeutral).toBe(
    'color-mix(in srgb, var(--la-color-text-primary) 55%, var(--la-color-bg-primary))'
  )
  const identities = Array.from({ length: 21 }, (_, slot) => scatterMemberStyle(slot).color)
  const colors = identities.map((identity) => themeMemberColor(identity))
  expect(new Set(colors).size).toBe(21)
  for (let slot = 0; slot < identities.length; slot++)
    expect(colors[slot]).toBe(`color-mix(in srgb, ${identities[slot]} 60%, ${themeMemberNeutral})`)
})
