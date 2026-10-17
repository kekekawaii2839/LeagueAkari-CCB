// sort-imports-ignore
import '../test-i18n'
import { expect, test, vi } from 'vitest'
import { snapshotTime } from './format'

test('reuses a local formatter without changing the legacy full Chinese date/time or missing values', () => {
  const Original = Intl.DateTimeFormat
  const constructor = vi
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(function (locales, options) {
      return new Original(locales, options)
    })
  try {
    for (const value of ['2026-10-13T12:05:00Z', '2026-01-01T00:00:00Z', '2000-06-01T06:30:05Z']) {
      expect(snapshotTime(value)).toBe(new Date(value).toLocaleString('zh-CN', { hour12: false }))
    }
    expect(constructor).toHaveBeenCalledTimes(1)
    expect(snapshotTime(undefined)).toBe('未查询成功')
    expect(snapshotTime(null, 'Synthetic missing observation')).toBe(
      'Synthetic missing observation'
    )
    expect(snapshotTime('', 'Synthetic missing timestamp')).toBe('Synthetic missing timestamp')
    expect(snapshotTime('invalid-synthetic-time')).toBe(
      new Date('invalid-synthetic-time').toLocaleString('zh-CN', { hour12: false })
    )
  } finally {
    constructor.mockRestore()
  }
})
