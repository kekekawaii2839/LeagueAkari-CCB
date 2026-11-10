/** Pure descriptive audit. No fitting, coordinate rescaling, data IO or CI claims. */
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length
const covariance = (x, y) => {
  const a = mean(x),
    b = mean(y)
  return x.reduce((s, v, i) => s + (v - a) * (y[i] - b), 0) / (x.length - 1)
}
export function decomposeRoleAverage(vectors) {
  if (
    !Array.isArray(vectors) ||
    !vectors.length ||
    vectors[0].length < 2 ||
    vectors.some(
      (x) =>
        !Array.isArray(x) || x.length !== vectors[0].length || x.some((v) => !Number.isFinite(v))
    )
  )
    throw new Error('Complete aligned finite role vectors required')
  const R = vectors.length,
    N = vectors[0].length
  const matrix = vectors.map((x) => vectors.map((y) => covariance(x, y)))
  const variances = matrix.map((row, i) => row[i]),
    correlations = []
  for (let i = 0; i < R; i++)
    for (let j = i + 1; j < R; j++)
      if (variances[i] > 0 && variances[j] > 0)
        correlations.push(matrix[i][j] / Math.sqrt(variances[i] * variances[j]))
  const averages = Array.from({ length: N }, (_, i) => mean(vectors.map((v) => v[i])))
  const finalVariance = covariance(averages, averages)
  const diagonalVarianceContribution = variances.reduce((s, x) => s + x, 0) / (R * R)
  const covarianceContribution =
    matrix.reduce((s, row, i) => s + row.reduce((t, x, j) => t + (i === j ? 0 : x), 0), 0) / (R * R)
  if (
    Math.abs(finalVariance - diagonalVarianceContribution - covarianceContribution) >
    1e-10 * Math.max(1, finalVariance)
  )
    throw new Error('Variance decomposition failed')
  return {
    N,
    R,
    finalSd: Math.sqrt(finalVariance),
    diagonalVarianceContribution,
    covarianceContribution,
    meanPairRoleCorrelation: correlations.length ? mean(correlations) : null,
    validCorrelationPairs: correlations.length,
    meanRoleSd: mean(variances.map(Math.sqrt)),
    roleSds: variances.map(Math.sqrt),
    covarianceMatrix: matrix
  }
}

export function describeSpreadReference(rows, displayIds) {
  if (
    !Array.isArray(rows) ||
    rows.length < 2 ||
    new Set(rows.map((r) => r.champion)).size !== rows.length ||
    rows.some(
      (r) =>
        typeof r.champion !== 'string' ||
        !r.champion ||
        !Number.isFinite(r.spreadPp) ||
        r.spreadPp < 0
    )
  )
    throw new Error('Invalid reference spread rows')
  if (
    !Array.isArray(displayIds) ||
    displayIds.length < 2 ||
    new Set(displayIds).size !== displayIds.length ||
    displayIds.some((id) => !rows.some((r) => r.champion === id))
  )
    throw new Error('Invalid display subset')
  const selected = new Set(displayIds),
    values = rows.map((r) => r.spreadPp),
    center = mean(values)
  const contributions = rows
    .map((r) => ({ ...r, display: selected.has(r.champion), ss: (r.spreadPp - center) ** 2 }))
    .sort((a, b) => b.ss - a.ss)
  const total = contributions.reduce((s, r) => s + r.ss, 0)
  const referenceSdPp = Math.sqrt(covariance(values, values))
  const displayed = rows.filter((r) => selected.has(r.champion)).map((r) => r.spreadPp)
  const displaySdPp = Math.sqrt(covariance(displayed, displayed))
  return {
    referenceN: rows.length,
    displayN: displayIds.length,
    meanSdPp: center,
    referenceSdPp,
    displaySdPp,
    displayZsd: referenceSdPp > 0 ? displaySdPp / referenceSdPp : 0,
    nonDisplayShareOfReferenceSST:
      total > 0
        ? contributions.filter((r) => !r.display).reduce((s, r) => s + r.ss, 0) / total
        : null,
    zeroSpreadCount: rows.filter((r) => r.spreadPp === 0).length,
    top5ShareOfReferenceSST:
      total > 0 ? contributions.slice(0, 5).reduce((s, r) => s + r.ss, 0) / total : null,
    top5: contributions.slice(0, 5)
  }
}
