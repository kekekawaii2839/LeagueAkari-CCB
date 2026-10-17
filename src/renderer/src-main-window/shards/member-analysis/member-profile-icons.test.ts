import type { MemberAnalysisOverview } from '@shared/shards/member-analysis'
import { expect, test } from 'vitest'

import { resolveMemberProfileIcons } from './member-profile-icons'

const identity = (n: number) => n.toString(16).padStart(64, '0')
const overview = (rows: any[]): MemberAnalysisOverview =>
  ({
    publicationToken: 'A'.repeat(32),
    games: rows.map(([time, name, id, icon], i) => ({
      gameId: i + 1,
      timestamp: time,
      players: [
        { player: name, ...(id ? { profileIdentity: identity(id), profileIconId: icon } : {}) }
      ]
    }))
  }) as MemberAnalysisOverview
test('newest valid match icon wins per exact identity; zero survives latest missing/invalid values', () => {
  const source = overview([
    [1, 'SYNTHETIC_SAME#TESTONLY', 1, 12],
    [2, 'SYNTHETIC_SAME#TESTONLY', 1, 0],
    [3, 'SYNTHETIC_SAME#TESTONLY', 1, null],
    [4, 'SYNTHETIC_SAME#TESTONLY', 1, -1],
    [5, 'SYNTHETIC_RENAMED#TESTONLY', 1, null]
  ])
  expect({ ...resolveMemberProfileIcons(source) }).toEqual({
    'SYNTHETIC_SAME#TESTONLY': 0,
    'SYNTHETIC_RENAMED#TESTONLY': 0
  })
})
test('same display label with distinct server/PUUID identities never picks either avatar', () => {
  expect(
    resolveMemberProfileIcons(
      overview([
        [1, 'SYNTHETIC_SAME#TESTONLY', 1, 22],
        [2, 'SYNTHETIC_SAME#TESTONLY', 2, 33]
      ])
    )['SYNTHETIC_SAME#TESTONLY']
  ).toBeNull()
  expect({
    ...resolveMemberProfileIcons(
      overview([
        [1, 'SYNTHETIC_SAME#TESTONLY1', 1, 22],
        [2, 'SYNTHETIC_SAME#TESTONLY2', 2, 33]
      ])
    )
  }).toEqual({ 'SYNTHETIC_SAME#TESTONLY1': 22, 'SYNTHETIC_SAME#TESTONLY2': 33 })
})
test('old payloads/unproved rows and absent snapshot token remain legitimate missing values', () => {
  expect(resolveMemberProfileIcons(overview([[1, 'Old', null, null]]))['Old']).toBeNull()
  expect(
    resolveMemberProfileIcons(
      overview([
        [1, 'Mixed', 1, 22],
        [2, 'Mixed', null, null]
      ])
    )['Mixed']
  ).toBeNull()
  const source = overview([[1, 'Old', 1, 22]])
  delete source.publicationToken
  expect({ ...resolveMemberProfileIcons(source) }).toEqual({})
  expect({ ...resolveMemberProfileIcons(null) }).toEqual({})
})
