import {
  MemberAnalysisMemberSchema,
  type MemberAnalysisSettings
} from '@shared/shards/member-analysis'

import { parseRiotId } from './riot-id'

export const MEMBER_IMPORT_MAX_BYTES = 256 * 1024
export type MemberImportIssue =
  'empty' | 'json' | 'shape' | 'limit' | 'member' | 'duplicate' | 'file'
export class MemberImportError extends Error {
  constructor(
    public readonly issue: MemberImportIssue,
    public readonly row = 0
  ) {
    super(issue)
  }
}

// Only member identities are imported; settings, credentials and unknown properties are ignored.
export function parseMemberImport(
  text: string,
  defaultServerId: string
): MemberAnalysisSettings['members'] {
  const source = text.replace(/^\uFEFF/, '').trim()
  if (!source) throw new MemberImportError('empty')
  if (new TextEncoder().encode(source).length > MEMBER_IMPORT_MAX_BYTES)
    throw new MemberImportError('limit')
  let input: unknown
  if (/^[\[{]/.test(source)) {
    try {
      input = JSON.parse(source)
    } catch {
      throw new MemberImportError('json')
    }
    if (input && !Array.isArray(input) && typeof input === 'object' && 'members' in input)
      input = input.members
  } else
    input = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  if (!Array.isArray(input)) throw new MemberImportError('shape')
  if (!input.length) throw new MemberImportError('empty')
  if (input.length > 20) throw new MemberImportError('limit')
  const seen = new Set<string>()
  return input.map((entry: unknown, index) => {
    let candidate: unknown
    if (typeof entry === 'string') {
      const riotId = parseRiotId(entry)
      if (!riotId) throw new MemberImportError('member', index + 1)
      candidate = { serverId: defaultServerId.trim(), ...riotId }
    } else if (entry && typeof entry === 'object') {
      const row = entry as Record<string, unknown>
      const riotId =
        typeof row.riotId === 'string'
          ? parseRiotId(row.riotId)
          : typeof row.gameName === 'string'
            ? parseRiotId(row.gameName)
            : null
      candidate = {
        serverId: row.serverId ?? defaultServerId.trim(),
        gameName: riotId?.gameName ?? row.gameName,
        tagLine: riotId?.tagLine ?? row.tagLine
      }
    }
    const parsed = MemberAnalysisMemberSchema.safeParse(candidate)
    if (!parsed.success) throw new MemberImportError('member', index + 1)
    const identity = JSON.stringify([
      parsed.data.serverId.toLowerCase(),
      parsed.data.gameName.toLowerCase(),
      parsed.data.tagLine.toLowerCase()
    ])
    if (seen.has(identity)) throw new MemberImportError('duplicate', index + 1)
    seen.add(identity)
    return parsed.data
  })
}
