/** One fixed, symmetric percentage-point scale across modes, roles and filters. */
export const HEATMAP_LIMIT_PP = 10
type Rgb = [number, number, number]
function rgb(color: string): Rgb {
  const hex = color.match(/^#([\da-f]{6}|[\da-f]{3})$/i)?.[1]
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb
  }
  const match = color.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/)
  if (!match) throw new Error('Unsupported theme color')
  return match.slice(1, 4).map(Number) as Rgb
}
function luminance(channels: Rgb) {
  const linear = channels.map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}
/** Theme semantic colors, opaque blending, AA foreground even at saturated endpoints. */
export function heatmapColor(
  deltaPp: number,
  palette: { positive: string; negative: string; neutral: string }
) {
  const base = rgb(palette.neutral),
    tone = rgb(deltaPp < 0 ? palette.negative : palette.positive)
  const weight = Math.min(Math.abs(deltaPp) / HEATMAP_LIMIT_PP, 1) * 0.75
  const channels = base.map((v, i) => Math.round(v * (1 - weight) + tone[i] * weight)) as Rgb
  const l = luminance(channels),
    whiteContrast = 1.05 / (l + 0.05),
    blackContrast = (l + 0.05) / 0.05
  return {
    backgroundColor: `rgb(${channels.join(', ')})`,
    color: blackContrast >= whiteContrast ? '#000000' : '#ffffff',
    contrast: Math.max(blackContrast, whiteContrast)
  }
}
