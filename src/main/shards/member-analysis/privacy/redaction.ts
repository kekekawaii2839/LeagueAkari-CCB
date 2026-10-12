const SECRET_KEY = /authorization|token|secret|password|cookie/i
const IDENTIFIER_KEY = /puuid|riot.?id|game.?name|tag.?line|player|summoner.?id|game.?id|match.?id/i
const SECRET_TEXT_KEY =
  /((?:["'])?\b(?:authorization|[A-Za-z0-9_-]*token|secret|password|cookie)\b(?:["'])?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi

export function redactMemberAnalysisLogValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY.test(key)) return '[REDACTED]'
  if (IDENTIFIER_KEY.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redactMemberAnalysisLogValue(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        redactMemberAnalysisLogValue(child, childKey)
      ])
    )
  }
  return value
}

export function redactMemberAnalysisLogText(value: string) {
  return value
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+\/=-]+/gi, '$1 [REDACTED]')
    .replace(SECRET_TEXT_KEY, '$1[REDACTED]')
    .replace(
      /((?:["'])?\b(?:puuid|riotId|gameName|tagLine|summonerId|gameId|matchId)\b(?:["'])?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}\]]+)/gi,
      '$1[REDACTED]'
    )
}

export function redactForkLogPayload(value: unknown): unknown {
  if (typeof value === 'string') return redactMemberAnalysisLogText(value)
  if (Array.isArray(value)) return value.map(redactForkLogPayload)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SECRET_KEY.test(key) || IDENTIFIER_KEY.test(key)
          ? '[REDACTED]'
          : redactForkLogPayload(child)
      ])
    )
  }
  return value
}
