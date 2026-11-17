import { getNaiveUiTheme, getNaiveUiThemeOverrides } from '@renderer-shared/theme/naive-ui'
import { type AppThemeId, getThemeColorTheme } from '@shared/types/app-theme'
import { describe, expect, it } from 'vitest'

import { HEATMAP_LIMIT_PP, heatmapColor } from './heatmap-palette'

describe('fixed coverage heatmap encoding', () => {
  for (const id of [
    'light',
    'dark',
    'butter',
    'graphite',
    'cyber',
    'sakura',
    'mint',
    'aurora'
  ] as AppThemeId[]) {
    it(`preserves zero, sign, clipping semantics and readable values in ${id}`, () => {
      const common = {
        ...getNaiveUiTheme(getThemeColorTheme(id))!.common,
        ...getNaiveUiThemeOverrides(id).common
      }
      const palette = {
        positive: common.successColor!,
        negative: common.errorColor!,
        neutral: common.bodyColor!
      }
      const zero = heatmapColor(0, palette)
      expect(heatmapColor(2, palette).backgroundColor).not.toBe(zero.backgroundColor)
      expect(heatmapColor(-2, palette).backgroundColor).not.toBe(
        heatmapColor(2, palette).backgroundColor
      )
      expect(heatmapColor(100, palette)).toEqual(heatmapColor(HEATMAP_LIMIT_PP, palette))
      expect(heatmapColor(-100, palette)).toEqual(heatmapColor(-HEATMAP_LIMIT_PP, palette))
      for (const delta of [-100, -10, -5, -0.1, 0, 0.1, 5, 10, 100])
        expect(heatmapColor(delta, palette).contrast).toBeGreaterThanOrEqual(4.5)
    })
  }
})
