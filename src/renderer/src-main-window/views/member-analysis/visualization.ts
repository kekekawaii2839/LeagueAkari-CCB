export type VisualTone = 'blue' | 'red' | 'positive' | 'negative' | 'neutral'

export const finiteOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export const formatSigned = (value: unknown, digits = 0) => {
  const number = finiteOrNull(value)
  if (number === null) return '—'
  const formatted = Math.abs(number).toFixed(digits)
  return number > 0
    ? `+${formatted}`
    : number < 0
      ? `−${formatted}`
      : digits
        ? Number(formatted).toFixed(digits)
        : '0'
}

export const percentWidth = (value: unknown, max = 1) => {
  const number = finiteOrNull(value)
  return number === null || max <= 0
    ? 0
    : Math.min(100, Math.max(0, (Math.abs(number) / max) * 100))
}

export const metricTone = (value: unknown): VisualTone => {
  const number = finiteOrNull(value)
  return number === null || number === 0 ? 'neutral' : number > 0 ? 'positive' : 'negative'
}

export const reliabilityLabel = (games: number, minimum: number) =>
  games < minimum ? '样本较少' : games < minimum * 2 ? '参考样本' : '较多样本'

export const wilsonInterval = (wins: number, games: number, z = 1.96) => {
  if (!Number.isFinite(wins) || !Number.isFinite(games) || games <= 0) return null
  const boundedWins = Math.min(games, Math.max(0, wins))
  const rate = boundedWins / games
  const z2 = z * z
  const denominator = 1 + z2 / games
  const center = (rate + z2 / (2 * games)) / denominator
  const margin = (z * Math.sqrt((rate * (1 - rate) + z2 / (4 * games)) / games)) / denominator
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

export const scatterDomain = (values: unknown[]) => {
  const valid = values.map(finiteOrNull).filter((value): value is number => value !== null)
  if (!valid.length) return { min: 0, max: 1 }
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  if (min === max) {
    const padding = Math.abs(min) * 0.1 || 1
    return { min: min - padding, max: max + padding }
  }
  const padding = (max - min) * 0.08
  return { min: min - padding, max: max + padding }
}

export const scatterPosition = (
  value: unknown,
  domain: { min: number; max: number },
  start: number,
  size: number,
  invert = false
) => {
  const number = finiteOrNull(value)
  const ratio = number === null ? 0.5 : (number - domain.min) / (domain.max - domain.min || 1)
  return start + (invert ? 1 - ratio : ratio) * size
}

const fixedRoles = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
export const fixedFiveRoster = <T extends { role: string }>(players: T[]) =>
  fixedRoles
    .map((role) => players.find((player) => player.role === role))
    .filter((player): player is T => Boolean(player))
    .slice(0, 5)

export const memberOrder = (names: string[], members: { gameName: string; tagLine: string }[]) => {
  const order = new Map(
    members.map((member, index) => [`${member.gameName}#${member.tagLine}`, index])
  )
  return [...names].sort(
    (a, b) =>
      (order.get(a) ?? members.length) - (order.get(b) ?? members.length) ||
      a.localeCompare(b, 'zh-CN')
  )
}

export const identicalRosters = (games: { players: { player: string }[] }[]) => {
  if (!games.length) return false
  const roster = (game: (typeof games)[number]) =>
    JSON.stringify([...new Set(game.players.map((p) => p.player))].sort())
  return games.every((game) => roster(game) === roster(games[0]))
}

// Group coincident marks without moving their measured coordinates.
export const groupScatterPoints = <T extends { x: number; y: number }>(points: T[]) => {
  const groups: { x: number; y: number; rows: T[] }[] = []
  for (const point of points) {
    const found = groups.find(
      (group) => Math.hypot(group.x - point.x, group.y - point.y) < 0.000001
    )
    if (found) found.rows.push(point)
    else groups.push({ x: point.x, y: point.y, rows: [point] })
  }
  return groups
}
