import { describe, expect, test } from 'vitest'

import { MemberImportError, parseMemberImport } from './member-import'
import { parseRiotId } from './riot-id'

const member = { serverId: 'SYNTHETIC', gameName: 'Example', tagLine: 'TESTONLY' }
const issue = (input: string, server = 'SYNTHETIC') => {
  try {
    parseMemberImport(input, server)
  } catch (error) {
    expect(error).toBeInstanceOf(MemberImportError)
    return (error as MemberImportError).issue
  }
  return undefined
}
describe('member import', () => {
  test('accepts arrays and existing settings without importing other settings', () => {
    expect(parseMemberImport(JSON.stringify([member]), '')).toEqual([member])
    expect(parseMemberImport(JSON.stringify({ enabled: false, members: [member] }), '')).toEqual([
      member
    ])
    expect(parseMemberImport(JSON.stringify([{ ...member, token: 'x' }]), '')).toEqual([member])
  })
  test('accepts multiline client IDs and string arrays with explicit server', () => {
    expect(parseMemberImport('  Example # TESTONLY \r\n Other＃TAG\n', 'SYNTHETIC')).toEqual([
      member,
      { serverId: 'SYNTHETIC', gameName: 'Other', tagLine: 'TAG' }
    ])
    expect(parseMemberImport('["Example#TESTONLY"]', 'SYNTHETIC')).toEqual([member])
    expect(parseMemberImport('[{"riotId":"Example#TESTONLY"}]', 'SYNTHETIC')).toEqual([member])
    expect(issue('Example#TESTONLY', '')).toBe('member')
  })
  test('rejects invalid, oversized and duplicate member lists', () => {
    expect(issue('')).toBe('empty')
    expect(issue('{')).toBe('json')
    expect(issue('{}')).toBe('shape')
    expect(issue('[]')).toBe('empty')
    expect(issue('Example#TESTONLY\nExample#testonly')).toBe('duplicate')
    expect(issue('Example#TESTONLY\nMissingTag')).toBe('member')
    expect(issue(JSON.stringify(Array.from({ length: 21 }, (_, i) => `Member${i}#TESTONLY`)))).toBe(
      'limit'
    )
    expect(issue('a'.repeat(256 * 1024 + 1))).toBe('limit')
  })
  test('normalizes clipboard characters but rejects multiple IDs in a single field', () => {
    expect(parseRiotId('\u200bExample ＃ TESTONLY\ufeff')).toEqual({
      gameName: 'Example',
      tagLine: 'TESTONLY'
    })
    expect(parseRiotId('One#TESTONLY\nTwo#TESTONLY')).toBeNull()
  })
})
