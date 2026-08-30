import { describe, expect, it } from 'vitest'
import { apiErrorIssues, toApiErrorMessage } from '~/composables/useApiError'

describe('toApiErrorMessage', () => {
  it('combines statusMessage and issues for a FetchError-like object', () => {
    const err = {
      statusMessage: 'Validation failed',
      data: {
        code: 'VALIDATION',
        issues: ['name: required', 'frontBaseUrl: must be an http(s) URL'],
      },
    }
    expect(toApiErrorMessage(err)).toBe(
      'Validation failed: name: required; frontBaseUrl: must be an http(s) URL',
    )
  })

  it('uses statusMessage alone when there are no issues', () => {
    const err = { statusMessage: 'site not found', data: { code: 'SITE_NOT_FOUND' } }
    expect(toApiErrorMessage(err)).toBe('site not found')
  })

  it('falls back to the Japanese message for unrecognized errors', () => {
    expect(toApiErrorMessage(new Error('network down'))).toBe(
      'APIとの通信に失敗しました。時間をおいて再度お試しください。',
    )
    expect(toApiErrorMessage('nope')).toBe(
      'APIとの通信に失敗しました。時間をおいて再度お試しください。',
    )
    expect(toApiErrorMessage(null)).toBe(
      'APIとの通信に失敗しました。時間をおいて再度お試しください。',
    )
  })
})

describe('apiErrorIssues', () => {
  it('returns the issues array when present', () => {
    const err = {
      statusMessage: 'Validation failed',
      data: { code: 'VALIDATION', issues: ['a', 'b'] },
    }
    expect(apiErrorIssues(err)).toEqual(['a', 'b'])
  })

  it('returns an empty array when absent or the error is not FetchError-like', () => {
    expect(apiErrorIssues({ statusMessage: 'x', data: { code: 'X' } })).toEqual([])
    expect(apiErrorIssues('nope')).toEqual([])
  })
})
