import { expect, test, vi } from 'vitest'

import { useChampionNameMatch } from './useChampionNameMatch'

const state = vi.hoisted(() => ({ offline: false }))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({
    champions: {
      searchKeywords: () => {
        if (state.offline) throw new Error('resources unavailable')
        return ['九尾妖狐', '阿狸', '狐狸', 'Ahri']
      }
    }
  })
}))
test.each(['阿狸', '狐狸', 'hl', 'ali', 'jw', 'AHRI', '10'])(
  'shared champion matching supports %s',
  (query) => {
    expect(useChampionNameMatch().match(query, '九尾妖狐', 103)).toBe(true)
  }
)
test('unknown terms do not match and missing resources retain label/pinyin/id matching', () => {
  const { match } = useChampionNameMatch()
  expect(match('not-a-hero', '九尾妖狐', 103)).toBe(false)
  state.offline = true
  try {
    expect(match('jw', '九尾妖狐', 103)).toBe(true)
    expect(match('103', '九尾妖狐', 103)).toBe(true)
    expect(match('not-a-hero', '九尾妖狐', 103)).toBe(false)
  } finally {
    state.offline = false
  }
})
