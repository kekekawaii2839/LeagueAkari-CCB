import type { MemberAnalysisGame, MemberAnalysisPlayerGame } from '@shared/shards/member-analysis'
import {
  type PerformanceMetric,
  performanceMetricKeys,
  playerPerformanceMetrics
} from '@shared/shards/member-analysis/performance-metrics'

export const scatterMetricKeys = performanceMetricKeys
export type ScatterMetric = PerformanceMetric

export function regressScatterGroups(
  rows: { player: string; x: number; y: number }[],
  perMember: boolean,
  binary: boolean
) {
  const groups = new Map<string, typeof rows>()
  for (const row of rows) {
    const key = perMember ? row.player : '全部已显示成员'
    const group = groups.get(key) ?? []
    group.push(row)
    groups.set(key, group)
  }
  return [...groups].map(([player, input]) => {
    const points = input.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    return {
      player,
      n: points.length,
      missing: input.length - points.length,
      linear: binary ? null : fitScatterLine(points),
      logistic: binary ? fitScatterLogistic(points) : null
    }
  })
}

// One observation is one member in one match, never an aggregate mean.
export function matchScatterRows(
  games: MemberAnalysisGame[],
  role: string,
  participant = 'all',
  champion = 'all'
) {
  return games.flatMap((game) =>
    game.players
      .filter(
        (row) =>
          row.role === role &&
          (participant === 'all' || row.player === participant) &&
          (champion === 'all' || row.champion === champion)
      )
      .map((row: MemberAnalysisPlayerGame) => ({
        player: row.player,
        role: row.role,
        games: 1,
        gameId: game.gameId,
        date: game.date,
        champion: row.champion,
        result: game.win ? '胜' : '负',
        ...playerPerformanceMetrics(game, row)
      }))
  )
}

// Descriptive OLS with an intercept; no inference of independence or causality.
export function fitScatterLine(points: { x: number; y: number }[]) {
  const valid = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (valid.length < 2) return null
  const meanX = valid[0].x + valid.reduce((sum, p) => sum + p.x - valid[0].x, 0) / valid.length
  const meanY = valid[0].y + valid.reduce((sum, p) => sum + p.y - valid[0].y, 0) / valid.length
  let xx = 0,
    yy = 0,
    xy = 0
  for (const p of valid) {
    xx += (p.x - meanX) ** 2
    yy += (p.y - meanY) ** 2
    xy += (p.x - meanX) * (p.y - meanY)
  }
  if (xx === 0) return null
  const slope = xy / xx
  const r = yy === 0 ? null : Math.max(-1, Math.min(1, xy / Math.sqrt(xx * yy)))
  return {
    slope,
    intercept: meanY - slope * meanX,
    r,
    rSquared: r === null ? null : r * r,
    minX: Math.min(...valid.map((p) => p.x)),
    maxX: Math.max(...valid.map((p) => p.x)),
    n: valid.length
  }
}

/** Unpenalized binary logistic MLE (intercept + one standardized predictor).
 * McFadden pseudo-R² compares log likelihood with an intercept-only model.
 * No Wald intervals/p-values: observations may share a match or member.
 */
export function fitScatterLogistic(points: { x: number; y: number }[]) {
  const unavailable = (reason: string) => ({ status: 'unavailable' as const, reason })
  const rows = points.filter((p) => Number.isFinite(p.x) && (p.y === 0 || p.y === 1))
  if (rows.length < 3) return unavailable('至少需要 3 个有效观测')
  const wins = rows.filter((p) => p.y === 1).map((p) => p.x)
  const losses = rows.filter((p) => p.y === 0).map((p) => p.x)
  if (!wins.length || !losses.length)
    return unavailable('当前二元结果全部为 1 或全部为 0，无法估计结果关系')
  const minX = Math.min(...rows.map((p) => p.x)),
    maxX = Math.max(...rows.map((p) => p.x))
  if (minX === maxX) return unavailable('横轴指标恒定，无法估计关系')
  if (Math.max(...losses) <= Math.min(...wins) || Math.max(...wins) <= Math.min(...losses))
    return unavailable(
      '二元结果样本在横轴上完全或准完全分离（可由一个阈值分开，边界可能同值）；普通 Logistic 参数趋于无穷，无法得到有限曲线。可尝试扩大样本范围'
    )
  const center = rows[0].x + rows.reduce((sum, p) => sum + p.x - rows[0].x, 0) / rows.length
  const scale = Math.sqrt(rows.reduce((sum, p) => sum + (p.x - center) ** 2, 0) / rows.length)
  const z = rows.map((p) => ({ x: (p.x - center) / scale, y: p.y }))
  const sigmoid = (eta: number) =>
    eta >= 0 ? 1 / (1 + Math.exp(-eta)) : Math.exp(eta) / (1 + Math.exp(eta))
  const softplus = (v: number) => Math.max(v, 0) + Math.log1p(Math.exp(-Math.abs(v)))
  const likelihood = (a: number, b: number) =>
    z.reduce((sum, p) => sum - softplus(p.y === 1 ? -(a + b * p.x) : a + b * p.x), 0)
  let a = Math.log(wins.length / losses.length),
    b = 0
  const nullLikelihood = likelihood(a, 0)
  let converged = false
  for (let iteration = 0; iteration < 100; iteration++) {
    let ga = 0,
      gb = 0,
      haa = 0,
      hab = 0,
      hbb = 0
    for (const p of z) {
      const probability = sigmoid(a + b * p.x),
        w = probability * (1 - probability)
      ga += p.y - probability
      gb += (p.y - probability) * p.x
      haa += w
      hab += w * p.x
      hbb += w * p.x * p.x
    }
    const determinant = haa * hbb - hab * hab
    if (determinant <= 1e-14) return unavailable('拟合不稳定，无法得到可靠的有限参数')
    const da = (hbb * ga - hab * gb) / determinant,
      db = (haa * gb - hab * ga) / determinant
    if (Math.max(Math.abs(da), Math.abs(db)) < 1e-8) {
      converged = true
      break
    }
    let step = 1
    const before = likelihood(a, b)
    while (step > 1e-8 && likelihood(a + step * da, b + step * db) < before - 1e-12) step /= 2
    if (step <= 1e-8) return unavailable('Logistic 拟合未收敛')
    a += step * da
    b += step * db
  }
  if (!converged) return unavailable('Logistic 拟合未收敛')
  return {
    status: 'available' as const,
    n: rows.length,
    wins: wins.length,
    losses: losses.length,
    minX,
    maxX,
    slope: b / scale,
    intercept: a - (b * center) / scale,
    pseudoRSquared: Math.max(0, 1 - likelihood(a, b) / nullLikelihood),
    predict: (x: number) => sigmoid(a + (b * (x - center)) / scale)
  }
}
