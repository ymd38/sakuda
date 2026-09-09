import { describe, expect, it } from 'vitest'
import { phaseTimeoutMs } from '../index'

const MIN = 30_000

describe('phaseTimeoutMs (#86)', () => {
  it('the last phase (none after it) gets all the remaining budget', () => {
    expect(phaseTimeoutMs(600_000, 0)).toBe(600_000)
  })

  it('reserves the floor for each phase still to come', () => {
    // three later phases → hold back 3 × MIN of the remaining budget
    expect(phaseTimeoutMs(600_000, 3)).toBe(600_000 - 3 * MIN)
  })

  it('never returns below the floor, even when later phases would over-reserve', () => {
    // a slow earlier phase has almost drained the budget; the later phases
    // still each need their floor, and this phase must not go negative
    expect(phaseTimeoutMs(40_000, 2)).toBe(MIN)
    expect(phaseTimeoutMs(0, 1)).toBe(MIN)
  })

  it('honours a custom floor', () => {
    expect(phaseTimeoutMs(100_000, 2, 10_000)).toBe(80_000)
  })
})
