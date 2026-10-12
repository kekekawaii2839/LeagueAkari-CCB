// Feature-owned categorical identity colors, separate from role/result colors.
// Twenty unique light/dark pairs cover the configured roster limit. Chosen by
// max-min Lab distance; redundant member numbers and dashes aid identification.
export const scatterMemberPalette = [
  ['#0553c7', '#5195fb'],
  ['#049504', '#1ff91f'],
  ['#950404', '#f91f1f'],
  ['#428a7b', '#87c5b8'],
  ['#957804', '#f9ce1f'],
  ['#f90698', '#fc83cb'],
  ['#780495', '#ce1ff9'],
  ['#67323c', '#b46474'],
  ['#6706f9', '#b383fc'],
  ['#f93706', '#fc9b83'],
  ['#04955b', '#1ff9a2'],
  ['#324767', '#6484b4'],
  ['#9a53ac', '#cda9d6'],
  ['#675d32', '#b4a464'],
  ['#95043e', '#f91f76'],
  ['#567e1b', '#9bd742'],
  ['#7e1b6a', '#d742b9'],
  ['#d22d4e', '#e996a6'],
  ['#7e431b', '#d77d42'],
  ['#7324a8', '#b16ce0']
] as const

export function scatterMemberStyle(index: number) {
  const slot = Math.max(0, index)
  const pair = scatterMemberPalette[slot]
  // Historical identities outside today's configured roster never reuse a slot.
  const color = pair
    ? `light-dark(${pair[0]}, ${pair[1]})`
    : `light-dark(hsl(${(slot * 137.508) % 360} 65% 35%), hsl(${(slot * 137.508) % 360} 75% 70%))`
  const dash = ['', '9 4', '3 4', '12 4 3 4', '6 3 2 3'][slot % 5]
  return { color, dash, number: slot + 1 }
}
