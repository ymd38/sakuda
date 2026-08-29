import { describe, expect, it } from 'vitest'
import { addCounts, emptyCounts, reportedTotal, sortBySeverity } from '#shared/utils/severity'

describe('severity utils', () => {
  it('emptyCounts has all five levels at zero', () => {
    expect(emptyCounts()).toEqual({ critical: 0, high: 0, medium: 0, low: 0, info: 0 })
  })
  it('addCounts sums per level', () => {
    expect(
      addCounts({ ...emptyCounts(), high: 1 }, { ...emptyCounts(), high: 2, info: 4 }),
    ).toEqual({
      critical: 0,
      high: 3,
      medium: 0,
      low: 0,
      info: 4,
    })
  })
  it('reportedTotal counts only critical/high/medium', () => {
    expect(reportedTotal({ critical: 1, high: 2, medium: 3, low: 4, info: 5 })).toBe(6)
  })
  it('sortBySeverity orders critical first and unknown last', () => {
    const out = sortBySeverity([
      { severity: 'medium' },
      { severity: 'x' },
      { severity: 'critical' },
    ])
    expect(out.map((o) => o.severity)).toEqual(['critical', 'medium', 'x'])
  })
})
