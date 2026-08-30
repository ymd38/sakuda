import { describe, expect, it } from 'vitest'
import {
  globToPathRegexSource,
  parseExcludePatterns,
  pathMatchesAny,
  toZapExcludeRegex,
} from '../excludePaths'

describe('excludePaths', () => {
  it('parses lines, skipping blanks and comments', () =>
    expect(parseExcludePatterns('/auth/logout\n\n# c\n */register ')).toEqual([
      '/auth/logout',
      '*/register',
    ]))
  it('glob * spans slashes, other regex chars are escaped', () => {
    expect(globToPathRegexSource('/a.b/*')).toBe('^/a\\.b/.*$')
    expect(pathMatchesAny('/api/x/register', ['*/register'])).toBe(true)
    expect(pathMatchesAny('/auth/logout-history', ['/auth/logout'])).toBe(false)
    expect(pathMatchesAny('/auth/logout', ['/auth/logout'])).toBe(true)
  })
  it('ZAP regex is anchored on origin and tolerates a query string', () => {
    const re = new RegExp(toZapExcludeRegex('/auth/refresh'))
    expect(re.test('http://localhost:8080/auth/refresh')).toBe(true)
    expect(re.test('http://localhost:8080/auth/refresh?x=1')).toBe(true)
    expect(re.test('http://localhost:8080/x/auth/refresh')).toBe(false)
  })
})
