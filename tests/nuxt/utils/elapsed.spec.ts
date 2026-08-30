import { describe, expect, it } from 'vitest'
import { formatElapsed } from '~/utils/elapsed'

describe('formatElapsed', () => {
  it('formats seconds under a minute as 0m SSs', () => {
    const now = new Date('2026-01-01T00:00:45.000Z')
    expect(formatElapsed('2026-01-01T00:00:00.000Z', now)).toBe('0m 45s')
  })

  it('formats minutes and zero-pads seconds', () => {
    const now = new Date('2026-01-01T00:02:05.000Z')
    expect(formatElapsed('2026-01-01T00:00:00.000Z', now)).toBe('2m 05s')
  })

  it('returns null when startedAt is null or undefined', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(formatElapsed(null, now)).toBeNull()
    expect(formatElapsed(undefined, now)).toBeNull()
  })

  it('returns null when startedAt is unparsable', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(formatElapsed('not-a-date', now)).toBeNull()
  })

  it('returns null when startedAt is in the future', () => {
    const now = new Date('2026-01-01T00:00:00.000Z')
    expect(formatElapsed('2026-01-01T00:01:00.000Z', now)).toBeNull()
  })
})
