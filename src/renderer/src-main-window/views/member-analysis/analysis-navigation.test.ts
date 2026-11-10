import { describe, expect, test } from 'vitest'

import { analysisGroupDestination, analysisGroupFor, analysisGroups } from './analysis-navigation'

describe('analysis navigation destinations', () => {
  test('does not restore the removed event-results destination', () => {
    expect(
      analysisGroupDestination('team', ['team-metrics', 'early', 'conversion'], 'conversion')
    ).toBe('team-metrics')
  })
  test('opens the full team metric table by default and remembers other team pages', () => {
    expect(analysisGroupFor('team-metrics')).toBe('team')
    expect(analysisGroupDestination('team', ['team-metrics', 'early'])).toBe('team-metrics')
    expect(analysisGroupDestination('team', ['team-metrics', 'early'], 'early')).toBe('early')
  })
  test('removes patch notes from member groups and retains legacy leaf routes', () => {
    expect(analysisGroups.map((group) => group.key)).toEqual([
      'personal',
      'combination',
      'team',
      'metrics',
      'matches'
    ])
    expect(analysisGroupFor('synergy')).toBe('combination')
    expect(analysisGroupFor('champion-tier')).toBe('team')
    expect(analysisGroupDestination('patch-notes', ['patch-notes'])).toBeNull()
    expect(analysisGroupDestination('combination', ['pairs', 'synergy'], 'synergy')).toBe('synergy')
    expect(analysisGroupDestination('team', ['early', 'champion-tier'], 'prediction')).toBe('early')
    expect(analysisGroupDestination('patch-notes', ['patch-notes'])).toBeNull()
  })
})
