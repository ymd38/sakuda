import { describe, expect, it } from 'vitest'
import { isStoppedAtLimit } from '#shared/utils/engineRun'

describe('isStoppedAtLimit (#84)', () => {
  it('is true when the engine recorded timedOut', () => {
    expect(isStoppedAtLimit({ meta: { timedOut: true }, warnings: [] })).toBe(true)
  })

  it('is true on the engines’ time-limit warnings', () => {
    for (const w of [
      'nuclei was stopped after 60 min; results are partial',
      'nuclei was stopped by the engine timeout before the signature phase started; results are partial',
      'zap-fe timed out after 75 min',
    ])
      expect(isStoppedAtLimit({ meta: { timedOut: false }, warnings: [w] })).toBe(true)
  })

  it('is false for a clean run and for unrelated warnings', () => {
    expect(isStoppedAtLimit({ meta: { timedOut: false }, warnings: [] })).toBe(false)
    expect(
      isStoppedAtLimit({
        meta: {},
        warnings: ['error rate 12.0% (180/1503); coverage may be reduced — lower nucleiRateLimit'],
      }),
    ).toBe(false)
  })
})
