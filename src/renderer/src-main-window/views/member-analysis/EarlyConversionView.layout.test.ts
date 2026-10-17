// sort-imports-ignore
import './test-i18n'
import { describe, expect, test } from 'vitest'
import { calculateEarlyEvidenceHeight } from './EarlyConversionView.vue'

describe('early-results secondary evidence viewport budget', () => {
  test('uses actual remaining viewport space while keeping the long match list inside its own viewport', () => {
    expect(calculateEarlyEvidenceHeight(900, 520, 24)).toBe(352)
    expect(calculateEarlyEvidenceHeight(800, 520, 24)).toBe(252)
    expect(calculateEarlyEvidenceHeight(760, 520, 24)).toBe(212)
  })
  test('does not clip native table controls in genuinely short windows', () => {
    expect(calculateEarlyEvidenceHeight(600, 520, 24)).toBe(128)
    expect(calculateEarlyEvidenceHeight(400, 620, 24)).toBe(128)
    expect(calculateEarlyEvidenceHeight(0, 620, 24)).toBe(128)
  })
  test('reserves actual native table chrome and one row instead of a fixed 160px floor', () => {
    expect(calculateEarlyEvidenceHeight(600, 460, 12, 123)).toBe(124)
    expect(calculateEarlyEvidenceHeight(600, 480, 12, 123)).toBe(123)
    expect(calculateEarlyEvidenceHeight(600, 480, 12, 96)).toBe(104)
  })
  test('includes wrapped primary content and bottom padding rather than relying on window width', () => {
    expect(calculateEarlyEvidenceHeight(800, 540, 24)).toBe(232)
    expect(calculateEarlyEvidenceHeight(800, 540, 40)).toBe(216)
    expect(calculateEarlyEvidenceHeight(Number.NaN, 540, 24)).toBe(220)
  })
})
