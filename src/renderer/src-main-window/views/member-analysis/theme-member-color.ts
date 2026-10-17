// Shared member identity tone for feature-owned SVG/DOM and Canvas color resolution.
// Canvas callers must resolve this CSS through getComputedStyle before drawing.
export const themeMemberNeutral =
  'color-mix(in srgb, var(--la-color-text-primary) 55%, var(--la-color-bg-primary))'

export function themeMemberColor(identityColor: string, neutral = themeMemberNeutral) {
  return `color-mix(in srgb, ${identityColor} 60%, ${neutral})`
}
