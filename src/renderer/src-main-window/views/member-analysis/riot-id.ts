export interface ParsedRiotId {
  gameName: string
  tagLine: string
}

export function parseRiotId(value: string): ParsedRiotId | null {
  const riotId = value.trim()
  const separatorIndex = riotId.lastIndexOf('#')
  if (separatorIndex <= 0 || separatorIndex === riotId.length - 1) return null

  const gameName = riotId.slice(0, separatorIndex).trim()
  const tagLine = riotId.slice(separatorIndex + 1).trim()
  if (!gameName || !tagLine) return null

  return { gameName, tagLine }
}
