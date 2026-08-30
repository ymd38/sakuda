import { describe, expect, it } from 'vitest'
import { buildFingerprint, normalizeUrlForFingerprint } from '../fingerprint'

describe('normalizeUrlForFingerprint', () => {
  it('lowercases scheme/host, drops query and hash', () => {
    expect(normalizeUrlForFingerprint('HTTP://Localhost:3000/Path?x=1#f')).toBe(
      'http://localhost:3000/Path',
    )
  })

  it('returns the trimmed input verbatim when the url is unparsable', () => {
    expect(normalizeUrlForFingerprint('  not a url  ')).toBe('not a url')
  })
})

describe('buildFingerprint', () => {
  it('joins engine, ruleId, normalized url and param', () => {
    expect(
      buildFingerprint({
        engine: 'zap-fe',
        ruleId: '10055-6',
        url: 'HTTP://Localhost:3000/Path?x=1#f',
        param: 'content-security-policy',
      }),
    ).toBe('zap-fe|10055-6|http://localhost:3000/Path|content-security-policy')
  })

  it('leaves a trailing empty segment when param is null', () => {
    expect(
      buildFingerprint({ engine: 'nuclei', ruleId: 'r1', url: 'http://h/p', param: null }),
    ).toBe('nuclei|r1|http://h/p|')
  })

  it('keeps an unparsable url verbatim (trimmed)', () => {
    expect(
      buildFingerprint({ engine: 'nuclei', ruleId: 'r1', url: '  not a url  ', param: null }),
    ).toBe('nuclei|r1|not a url|')
  })
})
